/** Envoi audio maison : yt-dlp -> FFmpeg Ogg/Opus -> RTP/UDP. */
const fs = require('fs');
const path = require('node:path');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const play = require('play-dl');
const { ensureManagedYtDlp, getDataDirectory } = require('./ytDlp');
const { configureSoundCloud } = require('./soundcloud');

const YTDLP_TIMEOUT_MS = 30_000;
const YTDLP_OUTPUT_LIMIT = 128 * 1024;
let managedInstallPromise = null;

function ensureManagedYtDlpOnce() {
  if (!managedInstallPromise) {
    managedInstallPromise = ensureManagedYtDlp().finally(() => { managedInstallPromise = null; });
  }
  return managedInstallPromise;
}

function bin(name, env) { if (process.env[env]) return process.env[env]; if (name === 'ffmpeg' && ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic; return process.platform === 'win32' ? `${name}.exe` : name; }
function isAudioUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !/(^|\.)ytimg\.com$/i.test(parsed.hostname);
  } catch (_) { return false; }
}

function isSoundCloudUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'snd.sc' || host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
  } catch (_) { return false; }
}

async function soundCloudStream(url) {
  if (!configureSoundCloud()) throw new Error('Les liens SoundCloud nécessitent SOUNDCLOUD_CLIENT_ID dans le fichier .env.');
  const result = await play.stream(url);
  if (!result?.stream || typeof result.stream.pipe !== 'function') {
    throw new Error('SoundCloud n’a pas fourni de flux audio lisible.');
  }
  return result.stream;
}

async function soundCloudSearchStream(query) {
  if (!configureSoundCloud()) throw new Error('La recherche SoundCloud nécessite SOUNDCLOUD_CLIENT_ID dans le fichier .env.');
  const normalized = String(query || '').trim().slice(0, 200);
  if (normalized.length < 2) throw new Error('Recherche SoundCloud trop courte.');
  const tracks = await play.search(normalized, { limit: 5, source: { soundcloud: 'tracks' } });
  let lastError = null;
  for (const track of tracks) {
    const url = track.permalink || track.url;
    if (!url || !isSoundCloudUrl(url)) continue;
    try {
      return await soundCloudStream(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Aucune piste SoundCloud publique et lisible trouvée.');
}

function ytDlpCandidates() {
  const candidates = [];
  const add = (command, args = []) => {
    if (command && !candidates.some(([existing, existingArgs]) => (
      existing === command && JSON.stringify(existingArgs) === JSON.stringify(args)
    ))) candidates.push([command, args]);
  };
  if (process.env.YTDLP_PATH) add(process.env.YTDLP_PATH);

  const managed = path.join(getDataDirectory(), '.cache', 'yt-dlp', process.platform === 'win32'
    ? (process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe')
    : 'yt-dlp');
  if (fs.existsSync(managed)) add(managed);

  if (process.platform === 'win32') {
    // py -m yt_dlp privilégie une version Python mise à jour au binaire du PATH.
    add('py', ['-m', 'yt_dlp']);
    add('py', ['-3.12', '-m', 'yt_dlp']);
    add('yt-dlp.exe');
    add(process.env.PYTHON || 'python', ['-m', 'yt_dlp']);
  } else {
    add('python3', ['-m', 'yt_dlp']);
    add('yt-dlp');
  }
  return candidates;
}

function buildYtDlpArgs(preArgs, url) {
  return [...preArgs, '--js-runtimes', `node:${process.execPath}`, '--no-playlist', '-f', 'bestaudio/best', '-g', url];
}

function runYtDlp(command, preArgs, url, spawnImpl = spawn) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    try {
      child = spawnImpl(command, buildYtDlpArgs(preArgs, url), { windowsHide: true });
    } catch (error) {
      finish({ error: error.message, missing: error.code === 'ENOENT' });
      return;
    }

    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish({ error: `yt-dlp a dépassé le délai de ${YTDLP_TIMEOUT_MS / 1000} secondes.` });
    }, YTDLP_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < YTDLP_OUTPUT_LIMIT) stdout += chunk.toString().slice(0, YTDLP_OUTPUT_LIMIT - stdout.length);
      else { child.kill(); finish({ error: 'yt-dlp a produit une réponse trop volumineuse.' }); }
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-4_000);
    });
    child.on('error', (error) => finish({ error: error.message, missing: error.code === 'ENOENT' }));
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) { finish({ error: `yt-dlp a dépassé le délai de ${YTDLP_TIMEOUT_MS / 1000} secondes.` }); return; }
      const audioUrl = stdout.trim().split(/\r?\n/).pop();
      if (code === 0 && isAudioUrl(audioUrl)) { finish({ audioUrl }); return; }
      const missingModule = /No module named ['\"]?yt_dlp['\"]?/i.test(stderr);
      const error = code === 0 && audioUrl && !isAudioUrl(audioUrl)
        ? 'yt-dlp a renvoyé une vignette au lieu du flux audio.'
        : stderr.trim().slice(-300) || `yt-dlp s'est arrêté avec le code ${code}.`;
      finish({ error, missing: missingModule });
    });
  });
}

async function streamUrl(url, { candidates = ytDlpCandidates(), install = ensureManagedYtDlpOnce, spawnImpl = spawn } = {}) {
  const errors = [];
  let missingOnly = true;
  let youtubeBlocked = false;
  for (const [command, args] of candidates) {
    const result = await runYtDlp(command, args, url, spawnImpl);
    if (result.audioUrl) return result.audioUrl;
    errors.push(result.error);
    if (!result.missing) missingOnly = false;
    if (/sign in to confirm|confirm you(?:'|’)re not a bot|not a bot/i.test(result.error || '')) youtubeBlocked = true;
  }

  if (missingOnly) {
    try {
      const managed = await install();
      const result = await runYtDlp(managed, [], url, spawnImpl);
      if (result.audioUrl) return result.audioUrl;
      errors.push(result.error);
      if (/sign in to confirm|confirm you(?:'|’)re not a bot|not a bot/i.test(result.error || '')) youtubeBlocked = true;
    } catch (error) {
      errors.push(`installation automatique impossible : ${error.message}`);
    }
  }

  if (youtubeBlocked) throw new Error('YouTube bloque cette requête de lecture depuis l’hébergeur.');
  const detail = errors.filter(Boolean).at(-1);
  throw new Error(detail || 'Aucun flux audio valide renvoyé par yt-dlp. Vérifie yt-dlp et YTDLP_PATH.');
}

async function prepareInput(url, fallbackQuery) {
  if (isSoundCloudUrl(url)) return { stream: await soundCloudStream(url), fallback: false };
  try {
    return { url: await streamUrl(url), fallback: false };
  } catch (error) {
    if (!fallbackQuery || !/YouTube bloque cette requête de lecture/i.test(error.message)) throw error;
    try {
      return { stream: await soundCloudSearchStream(fallbackQuery), fallback: true };
    } catch (fallbackError) {
      throw new Error(`YouTube bloque la lecture depuis l’hébergeur et aucune piste correspondante n’est lisible sur SoundCloud. Sélectionne un résultat SoundCloud dans /play. (${fallbackError.message})`);
    }
  }
}

async function start(connection, url, onStart, onEnd, onError, fallbackQuery) {
  const media = await prepareInput(url, fallbackQuery);
  if (media.fallback) console.info('[audio] Bascule vers SoundCloud après un blocage YouTube.');
  const ffmpeg = spawn(bin('ffmpeg', 'FFMPEG_PATH'), [
    '-hide_banner', '-loglevel', 'error', '-re', '-i', media.stream ? 'pipe:0' : media.url, '-vn',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:a', 'libopus', '-application', 'audio', '-vbr', 'on', '-compression_level', '10',
    '-frame_duration', '20', '-ar', '48000', '-ac', '2', '-b:a', '160k',
    '-f', 'opus', 'pipe:1',
  ], { windowsHide: true });
  const parser = new OggParser(); let frames = []; let paused = false; let started = false; let stopped = false;
  let ffmpegError = ''; let errorReported = false;
  let readinessTimer = null;
  const reportFfmpegError = (error) => {
    if (stopped || errorReported) return;
    errorReported = true;
    stopped = true;
    clearInterval(tick);
    if (readinessTimer) clearTimeout(readinessTimer);
    try { ffmpeg.kill(); } catch (_) {}
    onError?.(error);
  };
  const tick = setInterval(() => {
    if (stopped || paused || !connection.connected || !frames.length) return;
    if (connection.daveRequired && (!connection.dave || !connection.dave.ready)) return;
    let ok;
    try { ok = connection.sendOpus(frames[0]); }
    catch (error) { reportFfmpegError(error); return; }
    if (!ok) return;
    frames.shift();
    if (readinessTimer) { clearTimeout(readinessTimer); readinessTimer = null; }
    if (!started) { started = true; onStart?.(); }
  }, 20);
  readinessTimer = setTimeout(() => {
    if (connection.daveRequired && (!connection.dave || !connection.dave.ready)) {
      reportFfmpegError(new Error('La session DAVE de Discord ne s’est pas initialisée. Réessaie de rejoindre le vocal.'));
    }
  }, 30_000);
  ffmpeg.stdout.on('data', chunk => parser.feed(chunk, frame => {
    frames.push(frame);
    if (frames.length > 250) frames.shift();
  }));
  if (media.stream) {
    media.stream.on('error', reportFfmpegError);
    ffmpeg.stdin.on('error', reportFfmpegError);
    media.stream.pipe(ffmpeg.stdin);
  }
  ffmpeg.stderr.on('data', d => { ffmpegError = (ffmpegError + d.toString()).slice(-1000); });
  ffmpeg.on('error', e => {
    console.error('[ffmpeg] démarrage impossible:', e.message);
    reportFfmpegError(e);
  });
  ffmpeg.on('close', code => {
    if (stopped) return;
    if (code !== 0) {
      const message = ffmpegError.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').replace(/https?:\/\/\S+/g, '[URL audio]').slice(-300);
      reportFfmpegError(new Error(message || `FFmpeg s'est arrêté avec le code ${code}.`));
      return;
    }
    const wait = setInterval(() => { if (!frames.length) { clearInterval(wait); if (!stopped) { if (readinessTimer) clearTimeout(readinessTimer); onEnd?.(); } } }, 100);
  });
  return { pause() { paused = true; }, resume() { paused = false; }, setVolume() {}, stop() { stopped = true; clearInterval(tick); if (readinessTimer) clearTimeout(readinessTimer); try { media.stream?.destroy(); } catch (_) {} try { ffmpeg.kill(); } catch (_) {} } };
}

class OggParser {
  constructor() { this.buf = Buffer.alloc(0); this.count = 0; this.packet = []; }
  feed(chunk, emit) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 27) {
      if (this.buf.toString('ascii', 0, 4) !== 'OggS') { this.buf = this.buf.slice(1); continue; }
      const n = this.buf[26]; if (this.buf.length < 27 + n) return;
      const sizes = [...this.buf.slice(27, 27 + n)]; const total = sizes.reduce((a, b) => a + b, 0); const end = 27 + n + total; if (this.buf.length < end) return;
      let pos = 27 + n;
      for (const size of sizes) { this.packet.push(this.buf.slice(pos, pos + size)); pos += size; if (size < 255) { const full = Buffer.concat(this.packet); this.packet = []; this.count++; if (this.count > 2 && full.length) emit(full); } }
      this.buf = this.buf.slice(end);
    }
  }
}
module.exports = { OpusSender: { start }, streamUrl, buildYtDlpArgs };
