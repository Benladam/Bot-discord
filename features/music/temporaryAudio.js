/** Cache privé par lecture : Opus stéréo, borné, vérifié et supprimé après usage. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { getDataDirectory } = require('./ytDlp');

const MiB = 1024 * 1024;
const reservations = new Map();
const activeDirectories = new Set();
const sessionName = /^track-[a-zA-Z0-9_-]+$/;

function failure(code, message) { return Object.assign(new Error(message), { code }); }

function ffmpegBinary(env = process.env) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  if (process.platform === 'win32') {
    const bundled = require('ffmpeg-static');
    if (bundled && fs.existsSync(bundled)) return bundled;
  }
  return 'ffmpeg';
}

function closeMedia(media) {
  try { media?.stream?.cleanup?.(); } catch (_) {}
  try { media?.stream?.destroy?.(); } catch (_) {}
  try { media?.cleanup?.(); } catch (_) {}
}

function removeSession(root, directory) {
  // Aucun chemin fournisseur/utilisateur ne peut devenir une cible de suppression.
  if (path.dirname(directory) !== root || !sessionName.test(path.basename(directory))) return;
  try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch (_) {
    // Sous Windows, FFmpeg peut relâcher son fichier après l'envoi de kill.
    const timer = setTimeout(() => {
      try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch (_) {}
    }, 1000);
    timer.unref?.();
  }
}

function cacheUsage(root, now = Date.now()) {
  let bytes = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !sessionName.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    if (!activeDirectories.has(directory) && now - fs.statSync(directory).mtimeMs > 2 * 60 * 60 * 1000) {
      removeSession(root, directory);
      continue;
    }
    for (const name of ['audio.opus']) {
      try { bytes += fs.lstatSync(path.join(directory, name)).size; } catch (_) {}
    }
  }
  return bytes;
}

async function cacheAudio(media, {
  env = process.env, root = path.join(getDataDirectory({ env }), '.cache', 'audio-playback-v1'),
  ffmpeg = ffmpegBinary(env),
  spawnImpl = spawn, expectedDuration, shouldStart = () => true,
  maxBytes = 32 * MiB, totalBytes = 128 * MiB, reserveBytes = 64 * MiB,
  timeoutMs = 90_000, freeSpace = directory => {
    const stat = fs.statfsSync(directory); return Number(stat.bavail) * Number(stat.bsize);
  }, log = console.info,
} = {}) {
  if (media?.cached || String(env.MUSIC_CACHE_ENABLED || 'true').toLowerCase() === 'false' || !media?.stream) return media;
  const expected = Number(expectedDuration);
  const knownDuration = Number.isFinite(expected) && expected > 0;
  if (knownDuration && expected > 20 * 60) return media;
  if (!shouldStart()) { closeMedia(media); throw failure('AUDIO_CANCELLED', 'Préparation audio annulée.'); }
  root = path.resolve(root);
  let directory;
  try {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(root).isSymbolicLink()) throw new Error('cache symlink');
    if (process.platform !== 'win32') fs.chmodSync(root, 0o700);
    const used = cacheUsage(root);
    const reserved = reservations.get(root) || 0;
    if (used + reserved + maxBytes > totalBytes || freeSpace(root) < maxBytes + reserveBytes) {
      log('[audio-cache] Espace ou quota insuffisant : streaming avec reprises, sans téléchargement sur disque.');
      return media; // Le flux n'a pas été consommé.
    }
    directory = fs.mkdtempSync(path.join(root, 'track-'));
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
    activeDirectories.add(directory);
    reservations.set(root, reserved + maxBytes);
  } catch (_) {
    if (directory) removeSession(root, directory);
    log('[audio-cache] Cache privé indisponible : streaming avec reprises.');
    return media;
  }
  const file = path.join(directory, 'audio.opus');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    activeDirectories.delete(directory);
    removeSession(root, directory);
  };
  let child;
  let timer;
  let cancellation;
  let bytes = 0;
  let duration = 0;
  let progress = '';
  let write;
  let inputError;
  const abort = error => {
    inputError ||= error;
    child?.stdout?.destroy(error);
    try { child?.kill(); } catch (_) {}
    closeMedia(media);
  };
  try {
    log('[audio-cache] Préparation complète en Opus 128 kb/s avant lecture.');
    child = spawnImpl(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats',
      '-i', 'pipe:0', '-map', '0:a:0', '-vn', '-map_metadata', '-1',
      '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'on', '-ar', '48000', '-ac', '2', '-t', '1201',
      '-progress', 'pipe:2', '-f', 'opus', 'pipe:1',
    ], { windowsHide: true });
    child.stdout.on('error', () => {});
    const exit = new Promise((resolve, reject) => {
      child.once('error', () => reject(failure('AUDIO_CACHE_FAILED', 'Le préparateur audio n’a pas pu démarrer.')));
      child.once('close', (code, signal) => code === 0 ? resolve() : reject(
        inputError || failure('AUDIO_CACHE_FAILED', `Préparation audio interrompue (${signal || code || 'inconnu'}).`),
      ));
    });
    // Observe immédiatement les rejets, même si l'écriture échoue avant close.
    exit.catch(() => {});
    child.stderr.on('data', chunk => {
      progress += chunk.toString();
      const lines = progress.split(/\r?\n/); progress = lines.pop().slice(-200);
      for (const line of lines) {
        const match = line.match(/^out_time_us=(\d+)$/);
        if (match) duration = Math.max(duration, Number(match[1]) / 1e6);
      }
    });
    child.stdin.on('error', error => abort(failure('AUDIO_CACHE_FAILED', `Entrée audio fermée (${error.code || 'PIPE'}).`)));
    media.stream.on('error', abort);
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > maxBytes ? failure('AUDIO_CACHE_LIMIT', 'Le morceau dépasse le quota temporaire audio.') : null, chunk);
    } });
    write = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 });
    timer = setTimeout(() => abort(failure('AUDIO_STALLED', 'Le téléchargement audio complet a dépassé 90 secondes.')), timeoutMs);
    cancellation = setInterval(() => {
      if (!shouldStart()) abort(failure('AUDIO_CANCELLED', 'Préparation audio annulée.'));
    }, 100);
    const output = pipeline(child.stdout, limit, write);
    media.stream.pipe(child.stdin);
    await Promise.all([output, exit]);
    if (inputError) throw inputError;
    if (!shouldStart()) throw failure('AUDIO_CANCELLED', 'Préparation audio annulée.');
    const tolerance = Math.min(12, Math.max(2, expected * 0.03));
    if (bytes < 100 || duration < 1 || duration > 20 * 60 || knownDuration && Math.abs(duration - expected) > tolerance) {
      log(`[audio-cache] Durée refusée : audio=${duration.toFixed(2)}s, catalogue=${knownDuration ? expected : 'inconnu'}s.`);
      throw failure('AUDIO_PREMATURE_END', knownDuration
        ? `Audio incomplet ou durée différente : ${Math.floor(duration)} s préparées sur ${Math.floor(expected)} s attendues.`
        : 'Le téléchargement ne fournit pas un morceau fini de 1 seconde à 20 minutes.');
    }
    log(`[audio-cache] Audio complet vérifié : ${duration.toFixed(2)}s, ${(bytes / MiB).toFixed(2)} Mio; suppression en fin de lecture.`);
    return { ...media, stream: undefined, url: file, cached: true, cleanup };
  } catch (error) {
    abort(error);
    // Attendre la fermeture du fichier avant suppression, notamment sous Windows.
    if (write && !write.closed) await new Promise(resolve => { write.once('close', resolve); write.destroy(); });
    cleanup();
    throw inputError || error;
  } finally {
    clearTimeout(timer); clearInterval(cancellation);
    media.stream.removeListener('error', abort);
    closeMedia(media);
    reservations.set(root, Math.max(0, (reservations.get(root) || 0) - maxBytes));
  }
}

module.exports = { cacheAudio, closeMedia, ffmpegBinary };
