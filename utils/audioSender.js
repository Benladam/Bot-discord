/** Envoi audio maison : yt-dlp -> FFmpeg Ogg/Opus -> RTP/UDP. */
const fs = require('fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const play = require('play-dl');
const { ensureManagedYtDlp, getDataDirectory } = require('./ytDlp');
const { configureSoundCloud } = require('./soundcloud');

const YTDLP_TIMEOUT_MS = 30_000;
const YTDLP_OUTPUT_LIMIT = 128 * 1024;
const PROJECT_ROOT = path.resolve(__dirname, '..');
let managedInstallPromise = null;

function ensureManagedYtDlpOnce() {
  if (!managedInstallPromise) {
    managedInstallPromise = ensureManagedYtDlp().finally(() => { managedInstallPromise = null; });
  }
  return managedInstallPromise;
}

function bin(name, env) {
  const configured = String(process.env[env] || '').trim();
  if (configured) return configured;

  // Le conteneur Linux installe FFmpeg via le gestionnaire de paquets. Il est
  // généralement plus compatible avec l'image hôte que le binaire optionnel
  // de ffmpeg-static (qui peut être absent ou compilé pour une autre libc).
  if (name === 'ffmpeg' && process.platform !== 'win32') return 'ffmpeg';
  if (name === 'ffmpeg' && ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  return process.platform === 'win32' ? `${name}.exe` : name;
}
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

function isYouTubeUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return hostname === 'youtu.be'
      || hostname === 'youtube-nocookie.com'
      || hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com');
  } catch (_) { return false; }
}

function needsYouTubeAuthentication(error) {
  return /sign in to confirm|confirm (?:that )?you(?:'|’)re not a bot|not a bot|--(?:from-browser|cookies(?:-from-browser)?).{0,100}authentication/i
    .test(String(error || ''));
}

function sanitizeYtDlpDiagnostic(value) {
  return String(value || '')
    .replace(/\b(set-cookie|cookie|authorization|proxy-authorization)\s*:\s*[^\r\n]*/gi, '$1: [redacted]')
    .replace(/\b(__Secure-[A-Za-z0-9_-]+|SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|YSC|VISITOR_INFO1_LIVE)\s*=\s*[^;,\s]+/gi, '$1=[redacted]')
    .replace(/\b(access_token|refresh_token|id_token|token|signature|sig)\s*=\s*[^&#\s]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-450);
}

function describeCookiesFile(cookiesPath) {
  if (!cookiesPath) return 'cookies=not-configured';
  try {
    const stat = fs.statSync(cookiesPath);
    if (!stat.isFile()) return 'cookies=not-a-file';
    fs.accessSync(cookiesPath, fs.constants.R_OK);
    return `cookies=readable,${stat.size}B`;
  } catch (error) {
    return `cookies=unreadable(${error.code || 'error'})`;
  }
}

function createTemporaryCookiesCopy(sourcePath) {
  if (!sourcePath) return null;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-discord-ytdlp-cookies-'));
  try {
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
    const workingPath = path.join(directory, 'cookies.txt');
    fs.copyFileSync(sourcePath, workingPath, fs.constants.COPYFILE_EXCL);
    if (process.platform !== 'win32') fs.chmodSync(workingPath, 0o600);
    let cleaned = false;
    return {
      path: workingPath,
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch (_) { /* nettoyage au prochain démarrage du système */ }
      },
    };
  } catch (error) {
    try { fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch (_) { /* ignorer le nettoyage secondaire */ }
    throw error;
  }
}

function normalizeCookiesPath(value, projectRoot = PROJECT_ROOT) {
  const configured = String(value || '').trim();
  if (!configured) return '';
  return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(projectRoot, configured);
}

function splitCookiesPaths(value) {
  return String(value || '').split(/[;\r\n]+/).map((entry) => entry.trim()).filter(Boolean);
}

function getYouTubeCookiesPaths({ env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  const configured = String(env.YOUTUBE_COOKIES_PATH || '').trim();
  if (configured) {
    return [...new Set(splitCookiesPaths(configured).map((entry) => normalizeCookiesPath(entry, projectRoot)))];
  }

  // Détection sans configuration : déposer le fichier privé dans data/ suffit.
  const defaultPath = path.join(projectRoot, 'data', 'youtube-cookies.txt');
  return fs.existsSync(defaultPath) ? [defaultPath] : [];
}

function getYouTubeCookiesPath({ env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  return getYouTubeCookiesPaths({ env, projectRoot })[0] || '';
}

function configuredCookiesPath(options = {}) {
  const projectRoot = options.projectRoot || PROJECT_ROOT;
  return options.cookiesPath === undefined
    ? getYouTubeCookiesPath({ env: options.env || process.env, projectRoot })
    : normalizeCookiesPath(options.cookiesPath, projectRoot);
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

async function youtubeSearchStream(query) {
  const normalized = String(query || '').trim().slice(0, 200);
  if (normalized.length < 2) throw new Error('Recherche YouTube trop courte.');
  const videos = await searchYouTubeCandidates(normalized, { limit: 5 });
  let lastError = null;
  let attempted = 0;
  for (const video of videos.slice(0, 3)) {
    if (!video.url || !isYouTubeUrl(video.url)) continue;
    attempted++;
    try {
      return await streamUrl(video.url);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error(attempted ? 'Aucun flux YouTube lisible pour les résultats trouvés.' : 'Aucun morceau YouTube trouvé.');
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

function buildYtDlpArgs(preArgs, url, { playerClient, cookiesPath, projectRoot = PROJECT_ROOT, env = process.env } = {}) {
  const args = [...preArgs, '--js-runtimes', `node:${process.execPath}`];
  args.push('--remote-components', 'ejs:github');
  const resolvedCookiesPath = cookiesPath === undefined
    ? getYouTubeCookiesPath({ env, projectRoot })
    : normalizeCookiesPath(cookiesPath, projectRoot);
  if (isYouTubeUrl(url) && resolvedCookiesPath) args.push('--cookies', resolvedCookiesPath);
  if (isYouTubeUrl(url) && playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  args.push('--no-playlist', '-f', 'bestaudio/best', '-g', url);
  return args;
}

function buildYtDlpSearchArgs(preArgs, query, {
  playerClient,
  cookiesPath,
  projectRoot = PROJECT_ROOT,
  env = process.env,
  limit = 5,
} = {}) {
  const normalized = String(query || '').trim().slice(0, 200);
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  const args = [
    ...preArgs,
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '--no-warnings', '--flat-playlist', '--dump-single-json', '--skip-download',
    '--playlist-end', String(safeLimit),
  ];
  const resolvedCookiesPath = cookiesPath === undefined
    ? getYouTubeCookiesPath({ env, projectRoot })
    : normalizeCookiesPath(cookiesPath, projectRoot);
  if (resolvedCookiesPath) args.push('--cookies', resolvedCookiesPath);
  if (playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  args.push(`ytsearch${safeLimit}:${normalized}`);
  return args;
}

function youtubeUrlFromSearchItem(item) {
  const directUrl = item?.webpage_url || item?.original_url;
  if (isYouTubeUrl(directUrl)) return directUrl;
  if (isYouTubeUrl(item?.url)) return item.url;
  const id = String(item?.id || item?.video_id || '').trim();
  if (/^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  return '';
}

function normalizeYtDlpSearchItem(item) {
  const url = youtubeUrlFromSearchItem(item);
  if (!url) return null;
  return {
    title: item.title || 'Musique inconnue',
    url,
    durationInSec: Number(item.duration) || 0,
    duration: Number(item.duration) || 0,
    thumbnail: item.thumbnail || null,
    channel: item.channel ? { name: item.channel } : item.uploader ? { name: item.uploader } : undefined,
  };
}

function parseYtDlpSearch(output) {
  const text = String(output || '').trim();
  if (!text) return [];
  const payloads = [];
  try {
    payloads.push(JSON.parse(text));
  } catch (_) {
    for (const line of text.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
      try { payloads.push(JSON.parse(line)); } catch (_) { /* ignorer les lignes non JSON */ }
    }
  }
  return payloads.flatMap((payload) => {
    if (Array.isArray(payload)) return payload;
    return Array.isArray(payload?.entries) ? payload.entries : [payload];
  }).map(normalizeYtDlpSearchItem).filter(Boolean);
}

function runYtDlpSearch(command, preArgs, query, spawnImpl = spawn, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let childClosed = false;
    let timer;
    let cleanupTimer;
    let child;
    let cookiesCopy = null;
    const cleanupCookiesCopy = () => {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cookiesCopy?.cleanup();
      cookiesCopy = null;
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child || childClosed) cleanupCookiesCopy();
      else {
        cleanupTimer = setTimeout(cleanupCookiesCopy, 10_000);
        cleanupTimer.unref?.();
      }
      resolve(result);
    };
    try {
      cookiesCopy = createTemporaryCookiesCopy(configuredCookiesPath(options));
      options = { ...options, cookiesPath: cookiesCopy?.path || '' };
      child = spawnImpl(command, buildYtDlpSearchArgs(preArgs, query, options), { windowsHide: true });
    } catch (error) {
      childClosed = true;
      cleanupCookiesCopy();
      finish({ items: [], error: error.code === 'ENOENT' ? error.message : `Impossible de préparer la recherche yt-dlp (${error.code || 'erreur'}).`, missing: error.code === 'ENOENT' });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* processus déjà terminé */ }
      finish({ items: [], error: `Recherche YouTube dépassée après ${YTDLP_TIMEOUT_MS / 1000} secondes.` });
    }, YTDLP_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      if (stdout.length < YTDLP_OUTPUT_LIMIT) stdout += chunk.toString().slice(0, YTDLP_OUTPUT_LIMIT - stdout.length);
      else {
        try { child.kill(); } catch (_) { /* processus déjà terminé */ }
        finish({ items: [], error: 'La réponse de recherche YouTube est trop volumineuse.' });
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
    child.on('error', (error) => {
      childClosed = true;
      cleanupCookiesCopy();
      finish({ items: [], error: error.message, missing: error.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      childClosed = true;
      cleanupCookiesCopy();
      if (settled) return;
      const items = code === 0 ? parseYtDlpSearch(stdout) : [];
      if (items.length) {
        finish({ items });
        return;
      }
      const missingModule = /No module named ['"]?yt_dlp['"]?/i.test(stderr);
      const error = stderr.trim().slice(-300) || (code === 0
        ? 'YouTube n’a renvoyé aucun résultat exploitable.'
        : `yt-dlp recherche s’est arrêté avec le code ${code}.`);
      finish({ items: [], error, missing: missingModule });
    });
  });
}

async function searchYouTubeCandidates(query, {
  limit = 5,
  candidates = ytDlpCandidates(),
  install = ensureManagedYtDlpOnce,
  spawnImpl = spawn,
  cookiesPaths,
  projectRoot = PROJECT_ROOT,
  env = process.env,
} = {}) {
  const normalized = String(query || '').trim().slice(0, 200);
  if (normalized.length < 2) throw new Error('Recherche YouTube trop courte.');
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
  const configuredCookiesPaths = cookiesPaths === undefined
    ? getYouTubeCookiesPaths({ env, projectRoot })
    : (Array.isArray(cookiesPaths) ? cookiesPaths : [cookiesPaths])
      .flatMap((entry) => splitCookiesPaths(entry))
      .map((entry) => normalizeCookiesPath(entry, projectRoot));
  const cookieAttempts = configuredCookiesPaths.length ? configuredCookiesPaths : [''];
  const errors = [];
  let missingOnly = true;
  let authCandidate = null;

  const attempt = async (command, args, cookiesPath, playerClient) => {
    const result = await runYtDlpSearch(command, args, normalized, spawnImpl, {
      limit: safeLimit, cookiesPath, playerClient, projectRoot, env,
    });
    if (result.items.length) return result.items.slice(0, safeLimit);
    errors.push(result.error);
    if (!result.missing) missingOnly = false;
    if (!authCandidate && needsYouTubeAuthentication(result.error)) {
      authCandidate = [command, args, cookiesPath];
    }
    return null;
  };

  for (const [command, args] of candidates) {
    for (const cookiesPath of cookieAttempts) {
      const found = await attempt(command, args, cookiesPath);
      if (found) return found;
    }
  }
  if (missingOnly) {
    try {
      const managed = await install();
      for (const cookiesPath of cookieAttempts) {
        const found = await attempt(managed, [], cookiesPath);
        if (found) return found;
      }
    } catch (error) {
      errors.push(`installation automatique impossible : ${error.message}`);
    }
  }
  if (authCandidate) {
    const [command, args, cookiesPath] = authCandidate;
    const found = await attempt(command, args, cookiesPath, 'web_embedded');
    if (found) return found;
  }
  throw new Error(errors.filter(Boolean).at(-1) || 'Aucun résultat YouTube trouvé.');
}

function runYtDlp(command, preArgs, url, spawnImpl = spawn, options = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let childClosed = false;
    let timer;
    let cleanupTimer;
    let child;
    let cookiesCopy = null;
    const cleanupCookiesCopy = () => {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      cookiesCopy?.cleanup();
      cookiesCopy = null;
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!child || childClosed) cleanupCookiesCopy();
      else {
        cleanupTimer = setTimeout(cleanupCookiesCopy, 10_000);
        cleanupTimer.unref?.();
      }
      resolve(result);
    };
    try {
      const sourceCookiesPath = isYouTubeUrl(url) ? configuredCookiesPath(options) : '';
      cookiesCopy = createTemporaryCookiesCopy(sourceCookiesPath);
      options = { ...options, cookiesPath: cookiesCopy?.path || '' };
      child = spawnImpl(command, buildYtDlpArgs(preArgs, url, options), { windowsHide: true });
    } catch (error) {
      childClosed = true;
      cleanupCookiesCopy();
      finish({ error: error.code === 'ENOENT' ? error.message : `Impossible de préparer le flux yt-dlp (${error.code || 'erreur'}).`, missing: error.code === 'ENOENT' });
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
    child.on('error', (error) => {
      childClosed = true;
      cleanupCookiesCopy();
      finish({ error: error.message, missing: error.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      childClosed = true;
      cleanupCookiesCopy();
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

async function streamUrl(url, {
  candidates = ytDlpCandidates(),
  install = ensureManagedYtDlpOnce,
  spawnImpl = spawn,
  cookiesPaths,
  projectRoot = PROJECT_ROOT,
  env = process.env,
} = {}) {
  const errors = [];
  let missingOnly = true;
  let authCandidate = null;
  const youtubeUrl = isYouTubeUrl(url);
  const configuredCookiesPaths = cookiesPaths === undefined
    ? getYouTubeCookiesPaths({ env, projectRoot })
    : (Array.isArray(cookiesPaths) ? cookiesPaths : [cookiesPaths])
      .flatMap((entry) => splitCookiesPaths(entry))
      .map((entry) => normalizeCookiesPath(entry, projectRoot));
  const cookieAttempts = youtubeUrl && configuredCookiesPaths.length ? configuredCookiesPaths : [''];
  for (const [command, args] of candidates) {
    for (const cookiesPath of cookieAttempts) {
      const result = await runYtDlp(command, args, url, spawnImpl, { cookiesPath, projectRoot, env });
      if (result.audioUrl) return result.audioUrl;
      errors.push(result.error);
      if (!result.missing) missingOnly = false;
      if (youtubeUrl && !authCandidate && needsYouTubeAuthentication(result.error)) {
        authCandidate = [command, args, cookiesPath];
      }
    }
  }

  if (missingOnly) {
    try {
      const managed = await install();
      for (const cookiesPath of cookieAttempts) {
        const result = await runYtDlp(managed, [], url, spawnImpl, { cookiesPath, projectRoot, env });
        if (result.audioUrl) return result.audioUrl;
        errors.push(result.error);
        if (youtubeUrl && !authCandidate && needsYouTubeAuthentication(result.error)) {
          authCandidate = [managed, [], cookiesPath];
        }
      }
    } catch (error) {
      errors.push(`installation automatique impossible : ${error.message}`);
    }
  }

  if (authCandidate) {
    const [command, args, cookiesPath] = authCandidate;
    const embedded = await runYtDlp(command, args, url, spawnImpl, {
      playerClient: 'web_embedded', cookiesPath, projectRoot, env,
    });
    if (embedded.audioUrl) return embedded.audioUrl;
    errors.push(embedded.error);
    console.warn(`[yt-dlp] Repli YouTube refusé; binaire=${path.basename(command)}; ${describeCookiesFile(cookiesPath)}; ${sanitizeYtDlpDiagnostic(embedded.error) || 'aucun détail fourni'}`);
    const error = new Error('YouTube demande une vérification depuis cet hébergeur; le mode lecteur intégré sans compte n’a pas réussi pour ce titre. Configure YOUTUBE_COOKIES_PATH avec un fichier de cookies local seulement si ce contenu exige un compte, ou choisis un autre titre.');
    error.code = 'YOUTUBE_AUTH_BLOCKED';
    throw error;
  }
  const detail = errors.filter(Boolean).at(-1);
  throw new Error(detail || 'Aucun flux audio valide renvoyé par yt-dlp. Vérifie yt-dlp et YTDLP_PATH.');
}

function providerFailure(primaryProvider, primaryError, alternateProvider, alternateError) {
  const detail = (error) => String(error?.message || error || 'échec inconnu').replace(/[\r\n]+/g, ' ').slice(0, 300);
  const error = new Error(
    `Lecture impossible sur ${primaryProvider} (${detail(primaryError)}) puis ${alternateProvider} (${detail(alternateError)}). `
    + 'Sur le serveur, configure SOUNDCLOUD_CLIENT_ID et, si YouTube demande une vérification, YOUTUBE_COOKIES_PATH=data/youtube-cookies.txt.',
  );
  error.code = 'MUSIC_PROVIDERS_FAILED';
  error.cause = primaryError;
  return error;
}

async function prepareInput(url, fallbackQuery, providerOverrides = {}) {
  const getYouTubeStream = providerOverrides.getYouTubeStream || streamUrl;
  const searchYouTubeStream = providerOverrides.searchYouTubeStream || youtubeSearchStream;
  const getSoundCloudStream = providerOverrides.getSoundCloudStream || soundCloudStream;
  const searchSoundCloudStream = providerOverrides.searchSoundCloudStream || soundCloudSearchStream;
  const normalizedQuery = String(fallbackQuery || '').trim().slice(0, 200);

  if (isSoundCloudUrl(url)) {
    try {
      return { stream: await getSoundCloudStream(url), fallback: false };
    } catch (soundCloudError) {
      if (!normalizedQuery) throw soundCloudError;
      try {
        return { url: await searchYouTubeStream(normalizedQuery), fallback: true, fallbackProvider: 'YouTube' };
      } catch (youtubeError) {
        throw providerFailure('SoundCloud', soundCloudError, 'YouTube', youtubeError);
      }
    }
  }

  try {
    return { url: await getYouTubeStream(url), fallback: false };
  } catch (youtubeError) {
    if (!normalizedQuery || !isYouTubeUrl(url)) throw youtubeError;
    try {
      return { stream: await searchSoundCloudStream(normalizedQuery), fallback: true, fallbackProvider: 'SoundCloud' };
    } catch (soundCloudError) {
      throw providerFailure('YouTube', youtubeError, 'SoundCloud', soundCloudError);
    }
  }
}

async function start(connection, url, onStart, onEnd, onError, fallbackQuery) {
  const media = await prepareInput(url, fallbackQuery);
  if (media.fallback) console.info(`[audio] Bascule vers ${media.fallbackProvider || 'un fournisseur alternatif'} après l’échec du flux principal.`);
  const ffmpeg = spawn(bin('ffmpeg', 'FFMPEG_PATH'), [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-i', media.stream ? 'pipe:0' : media.url, '-vn',
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
  ffmpeg.on('close', (code, signal) => {
    if (stopped) return;
    if (code !== 0) {
      const reason = signal ? `le signal ${signal}` : `le code ${code ?? 'inconnu'}`;
      const message = ffmpegError.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').replace(/https?:\/\/\S+/g, '[URL audio]').slice(-300);
      reportFfmpegError(new Error(message || `FFmpeg s'est arrêté avec ${reason}.`));
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
module.exports = {
  OpusSender: { start },
  streamUrl,
  buildYtDlpArgs,
  buildYtDlpSearchArgs,
  getYouTubeCookiesPath,
  getYouTubeCookiesPaths,
  parseYtDlpSearch,
  prepareInput,
  searchYouTubeCandidates,
  youtubeSearchStream,
};
