/** Envoi audio maison : yt-dlp stdout -> FFmpeg Ogg/Opus -> RTP/UDP. */
const fs = require('fs');
const path = require('node:path');
const { spawn } = require('child_process');
const { PassThrough } = require('node:stream');
const ffmpegStatic = require('ffmpeg-static');
const { ensureManagedYtDlp, getDataDirectory } = require('./ytDlp');
const { configureSoundCloud, searchSoundCloud, getSoundCloudTrack, streamSoundCloudInfo } = require('./providers/soundcloud');
const { candidateTitle, candidateArtist, fallbackSearchQuery } = require('./trackMatching');
const { PcmVolume } = require('./pcmVolume');
const { readCookieFile } = require('./youtubeCookies');
const { soundCloudMatchScore, soundCloudSearchQueries } = require('./soundCloudMatching');
const { startRecoveringPlayback } = require('./playbackRecovery');
const { cacheAudio, closeMedia } = require('./temporaryAudio');
const { ensurePoToken, currentPoTokenConfig, poTokenArgs } = require('./youtubePoToken');
const { searchYouTubei, streamYouTubei } = require('./providers/youtubei');
const { lavalinkConfigured } = require('./lavalinkRuntime');
const { searchLavalink, streamLavalink } = require('./providers/lavalink');

const YTDLP_TIMEOUT_MS = 30_000;
const YTDLP_OUTPUT_LIMIT = 128 * 1024;
const MIN_FALLBACK_DURATION_RATIO = 0.65;
const MAX_BUFFERED_OPUS_FRAMES = 250;
const RESUME_OPUS_BUFFER_FRAMES = 125;
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
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

function isMissingYtDlp(error) {
  return /spawn .* ENOENT|No module named ['"]?yt_dlp['"]?/i.test(String(error || ''));
}

function bestYtDlpError(errors, fallback) {
  const available = errors.map((error) => String(error || '').trim()).filter(Boolean);
  const actionable = available.filter((error) => !isMissingYtDlp(error));
  if (actionable.length) return actionable.at(-1);
  if (available.length) {
    return 'yt-dlp est introuvable sur cet hôte. Autorise son installation automatique ou configure YTDLP_PATH vers un binaire yt-dlp exécutable.';
  }
  return fallback;
}

function isPreparationAbort(error) {
  return ['AUDIO_CANCELLED', 'AUDIO_PREPARATION_TIMEOUT'].includes(error?.code);
}

function ytDlpSetupFailure(error, action) {
  if (error?.code === 'ENOSPC') {
    const wrapped = new Error(
      `Ressource temporaire indisponible (ENOSPC) pendant ${action} yt-dlp. Vérifie l’espace libre et les quotas du volume de données et du dossier temporaire du conteneur.`,
    );
    wrapped.code = 'ENOSPC';
    wrapped.resourceExhausted = true;
    wrapped.cause = error;
    return wrapped;
  }
  return error;
}

function ytDlpResourceError(message, code) {
  const error = new Error(message || 'Ressources temporaires indisponibles (ENOSPC) pour yt-dlp.');
  error.code = code || 'ENOSPC';
  error.resourceExhausted = error.code === 'ENOSPC';
  return error;
}

function getYtDlpCookieTempDirectory(options = {}) {
  return options.cookieTempDirectory || path.join(
    getDataDirectory({ env: options.env || process.env }), '.cache', 'yt-dlp', 'cookies',
  );
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
    const { summary } = readCookieFile(cookiesPath);
    return `cookies=readable,${stat.size}B,actifs=${summary.activeEntries},auth=${summary.activeAuthEntries},expires=${summary.expiredEntries}`;
  } catch (error) {
    return `cookies=unreadable(${error.code || 'error'})`;
  }
}

function createTemporaryCookiesCopy(sourcePath, temporaryRoot = path.join(
  getDataDirectory(), '.cache', 'yt-dlp', 'cookies',
)) {
  if (!sourcePath) return null;
  const { content } = readCookieFile(sourcePath);
  fs.mkdirSync(temporaryRoot, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(temporaryRoot, 0o700);
  const directory = fs.mkdtempSync(path.join(temporaryRoot, 'session-'));
  try {
    if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
    const workingPath = path.join(directory, 'cookies.txt');
    fs.writeFileSync(workingPath, content, { flag: 'wx', mode: 0o600 });
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

function ytDlpSpawnOptions(options = {}) {
  const env = { ...process.env, ...(options.env || {}) };
  env.PATH ||= env.Path || process.env.Path || '';
  const runtimeTempDirectory = options.runtimeTempDirectory || path.join(
    getDataDirectory({ env }), '.cache', 'yt-dlp', 'runtime',
  );
  fs.mkdirSync(runtimeTempDirectory, { recursive: true, mode: 0o700 });
  return {
    windowsHide: true,
    env: {
      ...env,
      // Le binaire Linux autonome yt-dlp est empaqueté avec PyInstaller et
      // extrait ses bibliothèques dans TMPDIR avant de démarrer.
      TMPDIR: runtimeTempDirectory,
      TEMP: runtimeTempDirectory,
      TMP: runtimeTempDirectory,
    },
  };
}

function isSoundCloudPreviewFormat(format) {
  return format.snipped === true
    || /(?:^|_)preview(?:_|$)/i.test(String(format.format_id || ''))
    || /\/(?:preview(?:\/|$)|playlist\/0\/30(?:\/|$))/i.test(String(format.url || ''));
}

async function soundCloudStream(url, {
  getYtDlpStream = streamYtDlp,
  getTrack = getSoundCloudTrack,
  streamFromInfo = streamSoundCloudInfo,
  isConfigured = configureSoundCloud,
} = {}) {
  try {
    return await getYtDlpStream(url);
  } catch (ytDlpError) {
    if (!isConfigured()) throw ytDlpError;
    try {
      const track = await getTrack(url);
      const minimumMs = Number(track?.durationInSec) * 1_000 * MIN_FALLBACK_DURATION_RATIO;
      const formats = (Array.isArray(track?.formats) ? track.formats : []).filter((format) => (
        format?.format?.protocol === 'hls'
        && !isSoundCloudPreviewFormat(format)
        && !(minimumMs > 0 && Number(format.duration) > 0 && Number(format.duration) < minimumMs)
      ));
      if (track?.type !== 'track' || !formats.length) {
        const error = new Error('SoundCloud ne fournit aucun flux complet HLS pour cette piste; les extraits ont été refusés.');
        error.code = 'SOUNDCLOUD_PREVIEW_ONLY';
        throw error;
      }
      // Seuls les transcodages complets du titre demandé sont transmis à l’API.
      track.formats = formats;
      const result = await streamFromInfo(track);
      if (typeof result?.url === 'string' && isAudioUrl(result.url)) return result.url;
      if (!result?.stream || typeof result.stream.pipe !== 'function') {
        throw new Error('SoundCloud n’a pas fourni de flux audio lisible.');
      }
      return result.stream;
    } catch (soundCloudError) {
      soundCloudError.cause ||= ytDlpError;
      throw soundCloudError;
    }
  }
}

async function soundCloudSearchStream(query, {
  expectedDuration,
  expectedTitle,
  guildId,
  searchCandidates = searchSoundCloudCandidates,
  searchFallback = searchSoundCloud,
  openTrack = soundCloudStream,
  isConfigured = configureSoundCloud,
  timeoutMs = 12_000,
  excludedUrls = [],
  validateStream,
} = {}) {
  const queries = soundCloudSearchQueries(query, expectedTitle);
  if (!queries.length) throw new Error('Recherche SoundCloud trop courte.');
  let deadline = Date.now() + Math.max(100, Math.min(30_000, Number(timeoutMs) || 12_000));
  const seen = new Set();
  const opened = new Set();
  let lastError = null;
  const expected = Number(expectedDuration);
  const minimumDuration = Number.isFinite(expected) && expected >= 45
    ? expected * MIN_FALLBACK_DURATION_RATIO
    : 0;
  let rejectedShortTracks = 0;
  let rejectedDifferentTracks = 0;
  let attemptedFullTracks = 0;
  const select = async (tracks) => {
    const ranked = [];
    for (const track of (Array.isArray(tracks) ? tracks : []).slice(0, 25)) {
      if (!track) continue;
      const url = track.permalink || track.webpage_url || track.url;
      if (!url || !isSoundCloudUrl(url) || opened.has(url) || excludedUrls.includes(url)) continue;
      const duration = Number(track.durationInSec ?? track.duration);
      const score = soundCloudMatchScore(track, { query, expectedTitle, expectedDuration });
      // Une autre source peut fournir des métadonnées plus complètes pour la
      // même URL : on déduplique les logs, pas les nouvelles validations.
      if (!score) {
        if (!seen.has(url)) {
          if (minimumDuration && duration > 0 && duration < minimumDuration) rejectedShortTracks++;
          else rejectedDifferentTracks++;
          console.info(`[audio] résultat SoundCloud refusé serveur=${guildId || '?'} demandé=${JSON.stringify(sanitizeYtDlpDiagnostic(expectedTitle || queries[0]))} candidat=${JSON.stringify(sanitizeYtDlpDiagnostic(candidateTitle(track)))} artiste=${JSON.stringify(sanitizeYtDlpDiagnostic(candidateArtist(track)))} durée=${duration || 0}s attendue=${Number(expectedDuration) || 0}s`);
        }
        seen.add(url);
        continue;
      }
      ranked.push({ track, url, duration, score });
    }
    ranked.sort((a, b) => b.score - a.score);
    for (const { track, url, duration, score } of ranked) {
      if (opened.has(url) || attemptedFullTracks >= 3) continue;
      opened.add(url);
      attemptedFullTracks++;
      let stream;
      const preparationStart = Date.now();
      try {
        stream = await openTrack(url);
        if (stream && typeof stream === 'object') stream.musicSource = { sourceUrl: url, provider: 'SoundCloud' };
        if (validateStream) stream = await validateStream(stream);
        console.info(`[audio] repli SoundCloud validé serveur=${guildId || '?'} demandé=${JSON.stringify(sanitizeYtDlpDiagnostic(expectedTitle || queries[0]))} candidat=${JSON.stringify(sanitizeYtDlpDiagnostic(candidateTitle(track)))} artiste=${JSON.stringify(sanitizeYtDlpDiagnostic(candidateArtist(track)))} durée=${duration || 0}s score=${score.toFixed(1)}`);
        return stream;
      } catch (error) {
        closeMedia(stream?.cached ? stream : { stream });
        if (isPreparationAbort(error)) throw error;
        lastError = error;
      } finally {
        // Le budget de recherche ne compte pas le téléchargement complet,
        // qui a sa propre échéance et reste limité à trois candidats.
        if (validateStream) deadline += Date.now() - preparationStart;
      }
    }
    return null;
  };
  const searchWithinDeadline = async (search) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return [];
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => search(remaining)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Le délai de recherche SoundCloud a été dépassé.')), remaining); }),
      ]);
    } catch (error) { lastError = error; return []; }
    finally { clearTimeout(timer); }
  };
  let apiTried = false;
  for (const term of queries) {
    if (Date.now() >= deadline || attemptedFullTracks >= 3) break;
    console.info(`[audio] recherche SoundCloud serveur=${guildId || '?'} terme=${JSON.stringify(sanitizeYtDlpDiagnostic(term))}`);
    const tracks = await searchWithinDeadline(remaining => searchCandidates(term, { limit: 25, timeoutMs: remaining }));
    const stream = await select(tracks);
    if (stream) return stream;
    // Des résultats existent mais sont faux : l'API ne doit pas être ignorée.
    if (!apiTried && Date.now() < deadline && attemptedFullTracks < 3 && isConfigured()) {
      apiTried = true;
      const alternatives = await searchWithinDeadline(remaining => searchFallback(term, { limit: 25, timeoutMs: remaining }));
      const fallback = await select(alternatives);
      if (fallback) return fallback;
    }
  }
  if (rejectedShortTracks && !rejectedDifferentTracks && attemptedFullTracks === 0) {
    throw new Error('SoundCloud ne propose que des extraits trop courts pour cette piste; ces résultats ont été refusés.');
  }
  if (rejectedDifferentTracks && attemptedFullTracks === 0) {
    const error = new Error('Aucun résultat SoundCloud ne correspond au titre, à l’artiste et à la version demandés. Aucun autre morceau n’a été lancé.');
    error.code = 'MUSIC_TRACK_MISMATCH';
    throw error;
  }
  throw lastError || new Error('Aucune piste SoundCloud publique et lisible trouvée.');
}

async function youtubeSearchStream(query, {
  expectedDuration,
  expectedTitle,
  guildId,
  searchCandidates = searchYouTubeCandidates,
  openTrack = streamYouTubeAudio,
  excludedUrls = [],
  validateStream,
} = {}) {
  const normalized = fallbackSearchQuery(query, expectedTitle);
  if (normalized.length < 2) throw new Error('Recherche YouTube trop courte.');
  const videos = await searchCandidates(normalized, { limit: 5, timeoutMs: 6_000 });
  let lastError = null;
  let attempted = 0;
  for (const video of videos.slice(0, 10)) {
    if (!video.url || !isYouTubeUrl(video.url) || excludedUrls.includes(video.url)) continue;
    if (!soundCloudMatchScore(video, { query, expectedTitle, expectedDuration })) {
      console.info(`[audio] résultat YouTube refusé serveur=${guildId || '?'} demandé=${JSON.stringify(sanitizeYtDlpDiagnostic(expectedTitle || normalized))} candidat=${JSON.stringify(sanitizeYtDlpDiagnostic(candidateTitle(video)))}`);
      continue;
    }
    attempted++;
    let stream;
    try {
      stream = await openTrack(video.url);
      if (stream && typeof stream === 'object') stream.musicSource = { sourceUrl: video.url, provider: 'YouTube' };
      if (validateStream) stream = await validateStream(stream);
      console.info(`[audio] repli YouTube validé serveur=${guildId || '?'} demandé=${JSON.stringify(sanitizeYtDlpDiagnostic(expectedTitle || normalized))} candidat=${JSON.stringify(sanitizeYtDlpDiagnostic(candidateTitle(video)))}`);
      return stream;
    } catch (error) {
      closeMedia(stream?.cached ? stream : { stream });
      if (isPreparationAbort(error)) throw error;
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  const error = new Error(attempted ? 'Aucun flux YouTube lisible pour les résultats trouvés.' : 'Aucun résultat YouTube ne correspond au morceau demandé. Aucun autre morceau n’a été lancé.');
  if (!attempted) error.code = 'MUSIC_TRACK_MISMATCH';
  throw error;
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

function buildYtDlpArgs(preArgs, url, {
  playerClient,
  cookiesPath,
  projectRoot = PROJECT_ROOT,
  env = process.env,
  outputToStdout = false,
  poToken = currentPoTokenConfig(),
} = {}) {
  const args = [...preArgs, '--ignore-config', '--js-runtimes', `node:${process.execPath}`];
  args.push('--remote-components', 'ejs:github');
  if (isYouTubeUrl(url)) args.push(...poTokenArgs(poToken, playerClient));
  const resolvedCookiesPath = cookiesPath === undefined
    ? getYouTubeCookiesPath({ env, projectRoot })
    : normalizeCookiesPath(cookiesPath, projectRoot);
  if (isYouTubeUrl(url) && resolvedCookiesPath) args.push('--cookies', resolvedCookiesPath);
  if (isYouTubeUrl(url) && playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  const formatSelector = isSoundCloudUrl(url)
    ? 'bestaudio[format_id!*=preview]/best[format_id!*=preview]'
    : 'bestaudio/best';
  args.push('--no-playlist', '-f', formatSelector);
  args.push('--socket-timeout', '10', '--retries', '2', '--fragment-retries', '3', '--abort-on-unavailable-fragments');
  if (outputToStdout) args.push('-o', '-');
  else args.push('-g');
  args.push(url);
  return args;
}

function buildYtDlpSearchArgs(preArgs, query, {
  playerClient,
  cookiesPath,
  projectRoot = PROJECT_ROOT,
  env = process.env,
  limit = 5,
  provider = 'youtube',
  searchPrefix = provider === 'soundcloud' ? 'scsearch' : 'ytsearch',
  inputMode = 'search',
  poToken = currentPoTokenConfig(),
} = {}) {
  const normalized = String(query || '').trim().slice(0, inputMode === 'direct' ? 2_048 : 200);
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 5));
  const args = [
    ...preArgs,
    '--ignore-config',
    '--js-runtimes', `node:${process.execPath}`,
    '--remote-components', 'ejs:github',
    '--no-warnings', '--flat-playlist', '--dump-single-json', '--skip-download',
    '--playlist-end', String(safeLimit),
  ];
  if (provider === 'youtube') {
    args.push(...poTokenArgs(poToken, playerClient));
    const resolvedCookiesPath = cookiesPath === undefined
      ? getYouTubeCookiesPath({ env, projectRoot })
      : normalizeCookiesPath(cookiesPath, projectRoot);
    if (resolvedCookiesPath) args.push('--cookies', resolvedCookiesPath);
    if (playerClient) args.push('--extractor-args', `youtube:player_client=${playerClient}`);
  }
  args.push(inputMode === 'direct' ? normalized : `${searchPrefix}${safeLimit}:${normalized}`);
  return args;
}

function youtubeUrlFromSearchItem(item) {
  const directUrl = item?.webpage_url || item?.original_url;
  if (isYouTubeUrl(directUrl)) return directUrl;
  if (isYouTubeUrl(item?.url)) return item.url;
  const id = String(item?.id || item?.video_id || '').trim();
  if (item?._type === 'playlist' && /^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/playlist?list=${id}`;
  if (/^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  return '';
}

function soundCloudUrlFromSearchItem(item) {
  return [item?.webpage_url, item?.original_url, item?.url].find(isSoundCloudUrl) || '';
}

function normalizeYtDlpSearchItem(item, provider = 'youtube') {
  if (!item || typeof item !== 'object') return null;
  const url = provider === 'soundcloud' ? soundCloudUrlFromSearchItem(item) : youtubeUrlFromSearchItem(item);
  if (!url) return null;
  return {
    title: item.title || 'Musique inconnue',
    kind: provider === 'youtube' && new URL(url).pathname === '/playlist' ? 'playlist' : 'track',
    url,
    durationInSec: Number(item.duration) || 0,
    duration: Number(item.duration) || 0,
    thumbnail: item.thumbnail || null,
    channel: item.channel ? { name: item.channel } : item.uploader ? { name: item.uploader } : undefined,
    ...(provider === 'soundcloud' ? {
      artist: item.artist,
      metadata_artist: item.metadata_artist,
      publisher_metadata: item.publisher_metadata,
      publisher: item.publisher,
      user: item.user,
      uploader: item.uploader,
    } : {}),
  };
}

function parseYtDlpSearch(output, provider = 'youtube') {
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
  }).map((item) => normalizeYtDlpSearchItem(item, provider)).filter(Boolean);
}

function runYtDlpSearch(command, preArgs, query, spawnImpl = spawn, options = {}) {
  return new Promise((resolve) => {
    const outputLimit = options.provider === 'soundcloud' ? 512 * 1024 : YTDLP_OUTPUT_LIMIT;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let childClosed = false;
    let timer;
    let cleanupTimer;
    let child;
    let cookiesCopy = null;
    let spawnAttempted = false;
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
      cookiesCopy = createTemporaryCookiesCopy(configuredCookiesPath(options), getYtDlpCookieTempDirectory(options));
      options = { ...options, cookiesPath: cookiesCopy?.path || '' };
      spawnAttempted = true;
      child = spawnImpl(command, buildYtDlpSearchArgs(preArgs, query, options), ytDlpSpawnOptions(options));
    } catch (error) {
      childClosed = true;
      cleanupCookiesCopy();
      const failure = ytDlpSetupFailure(error, 'la recherche');
      finish({ items: [], error: failure.code === 'ENOENT' || /^YOUTUBE_COOKIES_/.test(failure.code) ? failure.message : failure.resourceExhausted ? failure.message : `Impossible de préparer la recherche yt-dlp (${failure.code || 'erreur'}).`, code: failure.code, resourceExhausted: failure.resourceExhausted, missing: spawnAttempted && failure.code === 'ENOENT', skipped: !spawnAttempted });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* processus déjà terminé */ }
      finish({ items: [], error: 'Le délai de recherche du catalogue a été dépassé.' });
    }, options.timeoutMs || YTDLP_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      if (stdout.length + data.length <= outputLimit) stdout += data;
      else {
        try { child.kill(); } catch (_) { /* processus déjà terminé */ }
        finish({ items: [], error: 'La réponse de recherche musicale est trop volumineuse.' });
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
    child.on('error', (error) => {
      childClosed = true;
      cleanupCookiesCopy();
      const failure = ytDlpSetupFailure(error, 'la recherche');
      finish({ items: [], error: failure.message, code: failure.code, resourceExhausted: failure.resourceExhausted, missing: failure.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      childClosed = true;
      cleanupCookiesCopy();
      if (settled) return;
      const items = code === 0 ? parseYtDlpSearch(stdout, options.provider) : [];
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

async function searchYtDlpCandidates(query, {
  provider = 'youtube',
  inputMode = 'search',
  searchPrefix = provider === 'soundcloud' ? 'scsearch' : 'ytsearch',
  limit = 5,
  timeoutMs = YTDLP_TIMEOUT_MS,
  candidates = ytDlpCandidates(),
  install = ensureManagedYtDlpOnce,
  spawnImpl = spawn,
  cookiesPaths,
  cookieTempDirectory,
  runtimeTempDirectory,
  projectRoot = PROJECT_ROOT,
  env = process.env,
} = {}) {
  const normalized = String(query || '').trim().slice(0, inputMode === 'direct' ? 2_048 : 200);
  const deadline = Date.now() + Math.max(100, Math.min(YTDLP_TIMEOUT_MS, Number(timeoutMs) || YTDLP_TIMEOUT_MS));
  if (inputMode === 'search' && normalized.length < 2) throw new Error(`Recherche ${provider === 'soundcloud' ? 'SoundCloud' : 'YouTube'} trop courte.`);
  const safeLimit = Math.max(1, Math.min(inputMode === 'direct' ? 100 : provider === 'soundcloud' ? 25 : 10, Number(limit) || 5));
  const configuredCookiesPaths = provider !== 'youtube' ? [] : cookiesPaths === undefined
    ? getYouTubeCookiesPaths({ env, projectRoot })
    : (Array.isArray(cookiesPaths) ? cookiesPaths : [cookiesPaths])
      .flatMap((entry) => splitCookiesPaths(entry))
      .map((entry) => normalizeCookiesPath(entry, projectRoot));
  const cookieAttempts = provider === 'youtube' ? [...new Set(configuredCookiesPaths.filter(Boolean)), ''] : [''];
  const errors = [];
  let missingOnly = true;
  let authCandidate = null;

  const attempt = async (command, args, cookiesPath, playerClient) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error('Le délai de recherche du catalogue a été dépassé.');
    const result = await runYtDlpSearch(command, args, normalized, spawnImpl, {
      timeoutMs: remainingMs,
      limit: safeLimit,
      cookiesPath: provider === 'youtube' ? cookiesPath : '',
      cookieTempDirectory,
      runtimeTempDirectory,
      playerClient,
      provider,
      searchPrefix,
      inputMode,
      projectRoot,
      env,
    });
    if (result.items.length) return { items: result.items.slice(0, safeLimit), missing: false };
    if (result.resourceExhausted) {
      missingOnly = false;
      errors.push(result.error);
      return { items: null, missing: false, resourceExhausted: true, code: result.code, error: result.error };
    }
    errors.push(result.error);
    if (!result.missing && !result.skipped) missingOnly = false;
    if (provider === 'youtube' && !authCandidate && needsYouTubeAuthentication(result.error)) {
      authCandidate = [command, args, cookiesPath];
    }
    return { items: null, missing: result.missing };
  };

  for (const [command, args] of candidates) {
    for (const cookiesPath of cookieAttempts) {
      const result = await attempt(command, args, cookiesPath);
      if (result.items) return result.items;
      if (result.resourceExhausted) throw ytDlpResourceError(result.error, result.code);
      if (result.missing) break;
    }
  }
  if (missingOnly) {
    try {
      const managed = await install();
      for (const cookiesPath of cookieAttempts) {
        const result = await attempt(managed, [], cookiesPath);
        if (result.items) return result.items;
        if (result.resourceExhausted) throw ytDlpResourceError(result.error, result.code);
        if (result.missing) break;
      }
    } catch (error) {
      if (error?.resourceExhausted) throw error;
      errors.push(`installation automatique impossible : ${error.message}`);
    }
  }
  if (authCandidate) {
    const [command, args, cookiesPath] = authCandidate;
    const found = await attempt(command, args, cookiesPath, 'web_embedded');
    if (found.items) return found.items;
  }
  throw new Error(bestYtDlpError(errors, `Aucun résultat ${provider === 'soundcloud' ? 'SoundCloud' : 'YouTube'} trouvé.`));
}

async function searchYouTubeCandidates(query, options = {}) {
  // Les recherches publiques n'ont pas besoin des cookies d'un compte.
  const {
    youtubeiFallback = true,
    youtubeiSearch = searchYouTubei,
    ...ytDlpOptions
  } = options;
  const hasInjectedYtDlp = Boolean(options.candidates || options.spawnImpl || options.install);
  if (!hasInjectedYtDlp && !options.youtubeiSearch && lavalinkConfigured()) {
    try {
      const tracks = await searchLavalink(query, { limit: options.limit || 5, timeoutMs: options.timeoutMs || 6000 });
      if (tracks.length) return tracks;
    } catch (error) {
      console.warn(`[catalogue] Lavalink indisponible (${sanitizeYtDlpDiagnostic(error.code || 'SEARCH_FAILED')}); essai YouTubei.`);
    }
  }
  // Le chemin Node.js sans navigateur est prioritaire. Les injections de tests
  // ne déclenchent jamais un fournisseur réseau non injecté.
  const youtubeiFirst = options.youtubeiFirst !== false && !hasInjectedYtDlp;
  if (youtubeiFirst) {
    try {
      const tracks = await youtubeiSearch(query, { limit: options.limit || 5,
        timeoutMs: Math.min(12_000, Number(options.timeoutMs) || 6_000) });
      if (tracks?.length) return tracks;
    } catch (error) {
      console.warn(`[catalogue] Recherche YouTubei indisponible (${sanitizeYtDlpDiagnostic(error.code || 'SEARCH_FAILED')}); essai yt-dlp.`);
    }
  }
  try {
    return await searchYtDlpCandidates(query, {
      cookiesPaths: [], ...ytDlpOptions, provider: 'youtube', searchPrefix: 'ytsearch', inputMode: 'search',
    });
  } catch (ytDlpError) {
    // Les tests/injections gardent leur isolation réseau. En production, le
    // catalogue YouTubei contourne aussi les erreurs d'espace temporaire yt-dlp.
    if (youtubeiFirst || !youtubeiFallback || hasInjectedYtDlp && !options.youtubeiSearch || isPreparationAbort(ytDlpError)) throw ytDlpError;
    try {
      const tracks = await youtubeiSearch(query, {
        limit: options.limit || 5,
        timeoutMs: Math.min(12_000, Number(options.timeoutMs) || 6_000),
      });
      if (tracks?.length) {
        console.info('[catalogue] Résultats YouTubei utilisés après l’échec de la recherche yt-dlp.');
        return tracks;
      }
    } catch (youtubeiError) {
      const code = /^[A-Z0-9_]+$/.test(youtubeiError?.code || '') ? youtubeiError.code : 'SEARCH_FAILED';
      console.warn(`[catalogue] Repli YouTubei indisponible (${code}); conservation de l’erreur yt-dlp.`);
    }
    throw ytDlpError;
  }
}

function searchYouTubePlaylists(query, options = {}) {
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', String(query || '').trim().slice(0, 200));
  url.searchParams.set('sp', 'EgIQAw==');
  return searchYtDlpCandidates(url.href, { cookiesPaths: [], ...options, provider: 'youtube', inputMode: 'direct' })
    .then(items => items.filter(item => item.kind === 'playlist'));
}

function searchSoundCloudCandidates(query, options = {}) {
  return searchYtDlpCandidates(query, { ...options, provider: 'soundcloud', searchPrefix: 'scsearch', inputMode: 'search' });
}

function resolveSoundCloudCandidates(url, options = {}) {
  return searchYtDlpCandidates(url, { ...options, provider: 'soundcloud', inputMode: 'direct', limit: options.limit || 100 });
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
    let spawnAttempted = false;
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
      cookiesCopy = createTemporaryCookiesCopy(sourceCookiesPath, getYtDlpCookieTempDirectory(options));
      options = { ...options, cookiesPath: cookiesCopy?.path || '' };
      spawnAttempted = true;
      child = spawnImpl(command, buildYtDlpArgs(preArgs, url, options), ytDlpSpawnOptions(options));
    } catch (error) {
      childClosed = true;
      cleanupCookiesCopy();
      const failure = ytDlpSetupFailure(error, 'le flux');
      finish({ error: failure.code === 'ENOENT' ? failure.message : failure.resourceExhausted ? failure.message : `Impossible de préparer le flux yt-dlp (${failure.code || 'erreur'}).`, code: failure.code, resourceExhausted: failure.resourceExhausted, missing: spawnAttempted && failure.code === 'ENOENT', skipped: !spawnAttempted });
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
      const failure = ytDlpSetupFailure(error, 'le flux');
      finish({ error: failure.message, code: failure.code, resourceExhausted: failure.resourceExhausted, missing: failure.code === 'ENOENT' });
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
  cookieTempDirectory,
  runtimeTempDirectory,
  projectRoot = PROJECT_ROOT,
  env = process.env,
} = {}) {
  if (isYouTubeUrl(url) && spawnImpl === spawn) await ensurePoToken();
  const errors = [];
  let missingOnly = true;
  let authCandidate = null;
  const youtubeUrl = isYouTubeUrl(url);
  const configuredCookiesPaths = cookiesPaths === undefined
    ? getYouTubeCookiesPaths({ env, projectRoot })
    : (Array.isArray(cookiesPaths) ? cookiesPaths : [cookiesPaths])
      .flatMap((entry) => splitCookiesPaths(entry))
      .map((entry) => normalizeCookiesPath(entry, projectRoot));
  const cookieAttempts = youtubeUrl
    ? ['', ...new Set(configuredCookiesPaths.filter(Boolean))]
    : [''];
  for (const [command, args] of candidates) {
    for (const cookiesPath of cookieAttempts) {
      const result = await runYtDlp(command, args, url, spawnImpl, { cookiesPath, cookieTempDirectory, runtimeTempDirectory, projectRoot, env });
      if (result.audioUrl) return result.audioUrl;
      if (result.resourceExhausted) throw ytDlpResourceError(result.error, result.code);
      errors.push(result.error);
      if (!result.missing && !result.skipped) missingOnly = false;
      if (youtubeUrl && (!authCandidate || cookiesPath) && needsYouTubeAuthentication(result.error)) {
        authCandidate = [command, args, cookiesPath, result.error];
      }
      if (result.missing) break;
    }
    if (authCandidate) break;
  }

  if (missingOnly) {
    try {
      const managed = await install();
      for (const cookiesPath of cookieAttempts) {
        const result = await runYtDlp(managed, [], url, spawnImpl, { cookiesPath, cookieTempDirectory, runtimeTempDirectory, projectRoot, env });
        if (result.audioUrl) return result.audioUrl;
        if (result.resourceExhausted) throw ytDlpResourceError(result.error, result.code);
        errors.push(result.error);
        if (youtubeUrl && (!authCandidate || cookiesPath) && needsYouTubeAuthentication(result.error)) {
          authCandidate = [managed, [], cookiesPath, result.error];
        }
        if (result.missing) break;
      }
    } catch (error) {
      if (error?.resourceExhausted) throw error;
      errors.push(`installation automatique impossible : ${error.message}`);
    }
  }

  if (authCandidate) {
    const [command, args, rejectedCookiesPath, cookieAttemptError] = authCandidate;
    // yt-dlp has a documented client-order workaround for this specific
    // response when authenticated cookies trigger "page needs to be reloaded".
    if (rejectedCookiesPath && /page needs to be reloaded/i.test(cookieAttemptError)) {
      const alternateClient = await runYtDlp(command, args, url, spawnImpl, {
        playerClient: 'default,web_embedded', cookiesPath: rejectedCookiesPath, cookieTempDirectory, runtimeTempDirectory, projectRoot, env,
      });
      if (alternateClient.audioUrl) return alternateClient.audioUrl;
      errors.push(alternateClient.error);
    }
    // Après un rejet explicite des cookies, ne les renvoie pas au client
    // intégré : ils ne feront que répéter l'échec et peuvent être périmés.
    const embedded = await runYtDlp(command, args, url, spawnImpl, {
      playerClient: 'web_embedded', cookiesPath: '', cookieTempDirectory, runtimeTempDirectory, projectRoot, env,
    });
    if (embedded.audioUrl) return embedded.audioUrl;
    errors.push(embedded.error);
    console.warn(`[yt-dlp] Repli YouTube refusé; binaire=${path.basename(command)}; ${describeCookiesFile(rejectedCookiesPath)}; réponse avec cookies: ${sanitizeYtDlpDiagnostic(cookieAttemptError) || 'aucun détail'}; client intégré sans cookies: ${sanitizeYtDlpDiagnostic(embedded.error) || 'aucun détail fourni'}`);
    const error = new Error(rejectedCookiesPath
      ? 'YouTube réclame toujours une authentification malgré les essais sans compte et avec cookies. Cela peut être une restriction du contenu, du compte ou de l’hébergeur; ce refus ne prouve pas que les cookies sont expirés.'
      : 'YouTube réclame une authentification depuis cet hébergeur malgré les essais sans compte. Aucun cookie utilisable n’a été accepté; une autre source du même morceau sera recherchée si ses métadonnées sont disponibles.');
    error.code = 'YOUTUBE_AUTH_BLOCKED';
    error.cookiesConfigured = Boolean(rejectedCookiesPath);
    throw error;
  }
  throw new Error(bestYtDlpError(errors, 'Aucun flux audio valide renvoyé par yt-dlp. Vérifie yt-dlp et YTDLP_PATH.'));
}

function runYtDlpPipe(command, preArgs, url, spawnImpl = spawn, options = {}) {
  return new Promise((resolve) => {
    let child;
    let stderr = '';
    let settled = false;
    let started = false;
    let childClosed = false;
    let timer;
    let cleanupTimer;
    let cookiesCopy = null;
    const audioStream = new PassThrough();
    // Keep a listener until the caller attaches its own handler after the
    // promise resolves; otherwise a very fast extractor error could be fatal.
    audioStream.on('error', () => {});
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
    const stop = () => {
      if (!childClosed) {
        try { child?.kill(); } catch (_) { /* processus déjà terminé */ }
        if (cleanupTimer) clearTimeout(cleanupTimer);
        cleanupTimer = setTimeout(cleanupCookiesCopy, 10_000);
        cleanupTimer.unref?.();
      }
      if (!audioStream.destroyed) audioStream.destroy();
    };
    try {
      cookiesCopy = createTemporaryCookiesCopy(configuredCookiesPath(options), getYtDlpCookieTempDirectory(options));
      options = { ...options, cookiesPath: cookiesCopy?.path || '', outputToStdout: true };
      child = spawnImpl(command, buildYtDlpArgs(preArgs, url, options), ytDlpSpawnOptions(options));
      child.stdout.pipe(audioStream);
    } catch (error) {
      childClosed = true;
      cleanupCookiesCopy();
      const failure = ytDlpSetupFailure(error, 'le flux');
      finish({ error: failure.message, diagnostic: failure.message, code: failure.code, resourceExhausted: failure.resourceExhausted, missing: failure.code === 'ENOENT' });
      return;
    }
    timer = setTimeout(() => {
      try { child.kill(); } catch (_) { /* processus déjà terminé */ }
      finish({ error: `yt-dlp n’a fourni aucun audio après ${YTDLP_TIMEOUT_MS / 1000} secondes.`, diagnostic: stderr });
    }, YTDLP_TIMEOUT_MS);
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4_000); });
    child.stdout.once('data', () => {
      if (settled) return;
      started = true;
      audioStream.cleanup = stop;
      settled = true;
      clearTimeout(timer);
      resolve({ stream: audioStream, stop });
    });
    child.on('error', (error) => {
      childClosed = true;
      cleanupCookiesCopy();
      if (!started) {
        const failure = ytDlpSetupFailure(error, 'le flux');
        finish({ error: failure.message, diagnostic: failure.message, code: failure.code, resourceExhausted: failure.resourceExhausted, missing: failure.code === 'ENOENT' });
      }
      else audioStream.destroy(error);
    });
    child.on('close', (code, signal) => {
      childClosed = true;
      cleanupCookiesCopy();
      const diagnostic = stderr.trim() || `yt-dlp s’est arrêté avec ${signal ? `le signal ${signal}` : `le code ${code ?? 'inconnu'}`}.`;
      if (!started) {
        const missingModule = /No module named ['"]?yt_dlp['"]?/i.test(stderr);
        finish({ error: sanitizeYtDlpDiagnostic(diagnostic), diagnostic, missing: missingModule });
      } else if (code !== 0 && !audioStream.destroyed && !audioStream.readableEnded) {
        const isForbidden = /HTTP(?: Error)?\s*403|403\s+Forbidden/i.test(diagnostic);
        const error = new Error(isForbidden
          ? 'Le fournisseur refuse le flux audio (HTTP 403) pendant le téléchargement.'
          : sanitizeYtDlpDiagnostic(diagnostic));
        if (needsYouTubeAuthentication(diagnostic)) error.code = 'YOUTUBE_AUTH_BLOCKED';
        else if (isForbidden) error.code = 'AUDIO_HTTP_FORBIDDEN';
        audioStream.destroy(error);
      }
    });
  });
}

async function streamYtDlp(url, {
  candidates = ytDlpCandidates(),
  install = ensureManagedYtDlpOnce,
  spawnImpl = spawn,
  cookiesPaths,
  cookieTempDirectory,
  runtimeTempDirectory,
  projectRoot = PROJECT_ROOT,
  env = process.env,
} = {}) {
  const youtubeUrl = isYouTubeUrl(url);
  if (youtubeUrl && spawnImpl === spawn) await ensurePoToken();
  const configuredCookiesPaths = !youtubeUrl ? [] : cookiesPaths === undefined
    ? getYouTubeCookiesPaths({ env, projectRoot })
    : (Array.isArray(cookiesPaths) ? cookiesPaths : [cookiesPaths])
      .flatMap((entry) => splitCookiesPaths(entry))
      .map((entry) => normalizeCookiesPath(entry, projectRoot));
  // Les titres publics ne doivent pas dépendre d'une session Google exportée.
  const cookieAttempts = youtubeUrl ? ['', ...new Set(configuredCookiesPaths.filter(Boolean))] : [''];
  const errors = [];
  let missingOnly = true;
  let authCandidate = null;

  const attempt = async (command, args, cookiesPath, playerClient) => {
    const result = await runYtDlpPipe(command, args, url, spawnImpl, {
      cookiesPath: youtubeUrl ? cookiesPath : '',
      cookieTempDirectory,
      runtimeTempDirectory,
      playerClient,
      projectRoot,
      env,
    });
    if (result.stream) {
      if (youtubeUrl) result.stream.youtubeAuthentication = cookiesPath ? 'cookies' : 'anonymous';
      return result.stream;
    }
    if (result.resourceExhausted) throw ytDlpResourceError(result.error, result.code);
    errors.push(result.error);
    if (!result.missing) missingOnly = false;
    if (youtubeUrl && (!authCandidate || cookiesPath) && needsYouTubeAuthentication(result.diagnostic || result.error)) {
      authCandidate = [command, args, cookiesPath, result.diagnostic || result.error];
    }
    return null;
  };

  for (const [command, args] of candidates) {
    for (const cookiesPath of cookieAttempts) {
      const stream = await attempt(command, args, cookiesPath);
      if (stream) return stream;
      if (missingOnly && errors.length && /spawn .* ENOENT/i.test(String(errors.at(-1)))) break;
    }
    // Un refus de compte/IP ne dépend pas du nom du binaire. Ne pas répéter
    // tous les essais avec Python puis le binaire géré pour la même vidéo.
    if (authCandidate) break;
  }
  if (missingOnly) {
    try {
      const managed = await install();
      for (const cookiesPath of cookieAttempts) {
        const stream = await attempt(managed, [], cookiesPath);
        if (stream) return stream;
      }
    } catch (error) {
      if (error?.resourceExhausted) throw error;
      errors.push(`installation automatique impossible : ${error.message}`);
    }
  }

  if (authCandidate) {
    const [command, args, rejectedCookiesPath, cookieAttemptError] = authCandidate;
    if (rejectedCookiesPath && /page needs to be reloaded/i.test(cookieAttemptError)) {
      const alternateClient = await attempt(command, args, rejectedCookiesPath, 'default,web_embedded');
      if (alternateClient) return alternateClient;
    }
    const embedded = await attempt(command, args, '', 'web_embedded');
    if (embedded) return embedded;
    const error = new Error(rejectedCookiesPath
      ? 'YouTube réclame toujours une authentification malgré les essais sans compte et avec cookies. Cela peut être une restriction du contenu, du compte ou de l’hébergeur; ce refus ne prouve pas que les cookies sont expirés.'
      : 'YouTube réclame une authentification depuis cet hébergeur malgré les essais sans compte. Aucun cookie utilisable n’a été accepté; une autre source du même morceau sera recherchée si ses métadonnées sont disponibles.');
    error.code = 'YOUTUBE_AUTH_BLOCKED';
    error.cookiesConfigured = Boolean(rejectedCookiesPath);
    throw error;
  }

  throw new Error(bestYtDlpError(errors, 'yt-dlp n’a pas réussi à ouvrir un flux audio.'));
}

function resolveYouTubePlaylist(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(parsed.hostname)
      || !/^[A-Za-z0-9_-]+$/.test(parsed.searchParams.get('list') || '')) throw new Error('Lien playlist YouTube invalide.');
  const canonical = new URL('https://www.youtube.com/playlist');
  canonical.searchParams.set('list', parsed.searchParams.get('list'));
  return searchYtDlpCandidates(canonical.href, { cookiesPaths: [], ...options, provider: 'youtube', inputMode: 'direct', limit: options.limit || 100 });
}

async function streamYouTubeAudio(url, { primary = streamYouTubei, fallback = streamYtDlp,
  useLavalink = primary === streamYouTubei && fallback === streamYtDlp,
  lavalink = streamLavalink, isLavalinkConfigured = lavalinkConfigured } = {}) {
  if (useLavalink && isLavalinkConfigured()) {
    try {
      return await lavalink(url);
    } catch (error) {
      if (isPreparationAbort(error)) throw error;
      console.warn(`[audio] Lavalink indisponible (${sanitizeYtDlpDiagnostic(error.code || 'STREAM_FAILED')}); essai YouTubei puis yt-dlp.`);
    }
  }
  try {
    return await primary(url);
  } catch (primaryError) {
    if (isPreparationAbort(primaryError)) throw primaryError;
    const reason = primaryError?.providerReason;
    const cause = reason ? ` cause=${sanitizeYtDlpDiagnostic(`${reason.name || 'Error'}: ${reason.message || ''}`)}` : '';
    console.warn(`[audio] Fournisseur YouTube primaire indisponible (${sanitizeYtDlpDiagnostic(primaryError.code || 'STREAM_FAILED')})${cause}; essai du secours.`);
    try {
      const stream = await fallback(url);
      console.info('[audio] Flux YouTube de secours ouvert; la durée sera vérifiée avant lecture.');
      return stream;
    } catch (fallbackError) {
      if (isPreparationAbort(fallbackError)) throw fallbackError;
      console.warn(`[audio] Secours YouTube indisponible (${sanitizeYtDlpDiagnostic(fallbackError.code || 'STREAM_FAILED')}).`);
      fallbackError.cause ||= primaryError;
      throw fallbackError;
    }
  }
}

function providerFailure(primaryProvider, primaryError, alternateProvider, alternateError) {
  const detail = (error) => String(error?.message || error || 'échec inconnu').replace(/[\r\n]+/g, ' ').slice(0, 300);
  const youtubeError = primaryProvider === 'YouTube' ? primaryError : alternateError;
  const soundCloudError = primaryProvider === 'SoundCloud' ? primaryError : alternateError;
  const soundCloudNeedsClientId = /SOUNDCLOUD_CLIENT_ID/i.test(String(soundCloudError?.message || soundCloudError || ''));
  const youtubeAdvice = youtubeError?.code === 'YOUTUBE_AUTH_BLOCKED'
    ? 'Une session valide peut être nécessaire pour un contenu réservé à un compte; aucun renouvellement automatique ne garantit l’accès depuis cet hébergeur.'
    : '';
  const soundCloudAdvice = soundCloudNeedsClientId
    ? 'Configure SOUNDCLOUD_CLIENT_ID dans le .env du bot pour activer le repli SoundCloud.'
    : '';
  const error = new Error(
    `Lecture impossible sur ${primaryProvider} (${detail(primaryError)}) puis ${alternateProvider} (${detail(alternateError)}). `
    + [youtubeAdvice, soundCloudAdvice].filter(Boolean).join(' '),
  );
  error.code = 'MUSIC_PROVIDERS_FAILED';
  error.cause = primaryError;
  return error;
}

async function prepareInput(url, fallbackQuery, providerOverrides = {}) {
  const getYouTubeStream = providerOverrides.getYouTubeStream || streamYouTubeAudio;
  const searchYouTubeStream = providerOverrides.searchYouTubeStream || youtubeSearchStream;
  const getSoundCloudStream = providerOverrides.getSoundCloudStream || soundCloudStream;
  const searchSoundCloudStream = providerOverrides.searchSoundCloudStream || soundCloudSearchStream;
  const normalizedQuery = String(fallbackQuery || '').trim().slice(0, 200);
  const asMedia = async (source, options = {}) => {
    let media;
    if (source && typeof source.pipe === 'function') media = { stream: source, ...source.musicSource, ...options };
    else if (source && typeof source === 'object' && (source.stream?.pipe || source.cached && typeof source.cleanup === 'function')) media = { ...source, ...options };
    else if (typeof source === 'string' && isAudioUrl(source)) media = { url: source, ...options };
    else throw new Error('Le fournisseur n’a pas retourné de flux audio exploitable.');
    return providerOverrides.validateMedia && !media.cached ? providerOverrides.validateMedia(media) : media;
  };
  const validation = providerOverrides.validateMedia ? { validateStream: source => asMedia(source) } : {};

  if ((providerOverrides.recoverySearch || providerOverrides.requiresSearch) && normalizedQuery) {
    const options = {
      expectedDuration: providerOverrides.expectedDuration, expectedTitle: providerOverrides.expectedTitle,
      guildId: providerOverrides.guildId, excludedUrls: providerOverrides.excludedUrls || [],
      ...validation,
    };
    try {
      return await asMedia(await searchYouTubeStream(normalizedQuery, options), { fallback: !!providerOverrides.recoverySearch, fallbackProvider: 'YouTube' });
    } catch (youtubeError) {
      if (isPreparationAbort(youtubeError)) throw youtubeError;
      try {
        return await asMedia(await searchSoundCloudStream(normalizedQuery, options), { fallback: true, fallbackProvider: 'SoundCloud' });
      } catch (soundCloudError) {
        if (isPreparationAbort(soundCloudError)) throw soundCloudError;
        throw providerFailure('YouTube', youtubeError, 'SoundCloud', soundCloudError);
      }
    }
  }

  if (isSoundCloudUrl(url)) {
    try {
      return await asMedia(await getSoundCloudStream(url), { fallback: false, sourceUrl: url, provider: 'SoundCloud' });
    } catch (soundCloudError) {
      if (isPreparationAbort(soundCloudError)) throw soundCloudError;
      if (!normalizedQuery) throw soundCloudError;
      try {
        return await asMedia(await searchYouTubeStream(normalizedQuery, {
          expectedDuration: providerOverrides.expectedDuration,
          expectedTitle: providerOverrides.expectedTitle,
          guildId: providerOverrides.guildId,
          ...validation,
        }), { fallback: true, fallbackProvider: 'YouTube' });
      } catch (youtubeError) {
        if (isPreparationAbort(youtubeError)) throw youtubeError;
        if (providerOverrides.validateMedia) {
          try {
            return await asMedia(await searchSoundCloudStream(normalizedQuery, {
              expectedDuration: providerOverrides.expectedDuration,
              expectedTitle: providerOverrides.expectedTitle, guildId: providerOverrides.guildId,
              excludedUrls: [...new Set([...(providerOverrides.excludedUrls || []), url])], ...validation,
            }), { fallback: true, fallbackProvider: 'SoundCloud' });
          } catch (alternativeError) {
            if (isPreparationAbort(alternativeError)) throw alternativeError;
            throw providerFailure('YouTube', youtubeError, 'SoundCloud', alternativeError);
          }
        }
        throw providerFailure('SoundCloud', soundCloudError, 'YouTube', youtubeError);
      }
    }
  }

  try {
    return await asMedia(await getYouTubeStream(url), { fallback: false, sourceUrl: url, provider: 'YouTube' });
  } catch (youtubeError) {
    if (isPreparationAbort(youtubeError)) throw youtubeError;
    if (!normalizedQuery || !isYouTubeUrl(url)) throw youtubeError;
    console.warn(`[audio] source YouTube indisponible serveur=${providerOverrides.guildId || '?'} demandé=${JSON.stringify(sanitizeYtDlpDiagnostic(providerOverrides.expectedTitle || normalizedQuery))} cause=${JSON.stringify(sanitizeYtDlpDiagnostic(youtubeError.message))}`);
    try {
      return await asMedia(await searchSoundCloudStream(normalizedQuery, {
        expectedDuration: providerOverrides.expectedDuration,
        expectedTitle: providerOverrides.expectedTitle,
        guildId: providerOverrides.guildId,
        ...validation,
      }), { fallback: true, fallbackProvider: 'SoundCloud' });
    } catch (soundCloudError) {
      if (isPreparationAbort(soundCloudError)) throw soundCloudError;
      throw providerFailure('YouTube', youtubeError, 'SoundCloud', soundCloudError);
    }
  }
}

async function preparePlaybackInput(url, fallbackQuery, options = {}) {
  const prepare = options.resolveInput || prepareInput;
  const cache = options.cacheAudio || cacheAudio;
  let cacheDeadline;
  const cacheSource = async media => {
    if (media.cached) return media;
    cacheDeadline ||= Date.now() + 90_000;
    const remaining = cacheDeadline - Date.now();
    if (remaining <= 0) {
      closeMedia(media);
      throw Object.assign(new Error('Le budget global de préparation audio est épuisé.'), { code: 'AUDIO_PREPARATION_TIMEOUT' });
    }
    try { return await cache(media, { ...options, timeoutMs: remaining }); }
    catch (error) {
      if (error.code === 'AUDIO_STALLED' && Date.now() >= cacheDeadline) error.code = 'AUDIO_PREPARATION_TIMEOUT';
      throw error;
    }
  };
  const validatedOptions = { ...options, validateMedia: cacheSource };
  let media = await prepare(url, fallbackQuery, validatedOptions);
  try {
    return await cacheSource(media);
  } catch (error) {
    closeMedia(media);
    // Un cache interrompu n'est jamais remis au lecteur. Une seule recherche
    // alternative du même titre est autorisée avant la connexion vocale.
    if (isPreparationAbort(error) || options.shouldStart && !options.shouldStart()
        || !fallbackQuery || !['AUDIO_PREMATURE_END', 'AUDIO_STALLED', 'YOUTUBE_AUTH_BLOCKED', 'AUDIO_HTTP_FORBIDDEN'].includes(error.code)) throw error;
    console.warn(`[audio-cache] Source incomplète serveur=${options.guildId || '?'}; recherche du même titre sur une autre source.`);
    media = await prepare(url, fallbackQuery, { ...validatedOptions, recoverySearch: true,
      excludedUrls: [...new Set([...(options.excludedUrls || []), media.sourceUrl || url])],
    });
    return cacheSource(media);
  }
}

async function start(connection, url, onStart, onEnd, onError, fallbackQuery, dependencies = {}) {
  if (dependencies.recovery === false || !(dependencies.requiresSearch || isYouTubeUrl(url) || isSoundCloudUrl(url))) {
    return startAttempt(connection, url, onStart, onEnd, onError, fallbackQuery, dependencies);
  }
  const prepare = dependencies.prepareInput || preparePlaybackInput;
  const failedUrls = new Set();
  return startRecoveringPlayback({
    shouldStart: dependencies.shouldStart, initialVolume: dependencies.initialVolume, initialFilter: dependencies.initialFilter,
    onStart, onEnd, onError,
    onRecovery: ({ attempt, position, code }) => console.info(`[audio] reprise même titre serveur=${dependencies.guildId || '?'} tentative=${attempt}/2 position=${position.toFixed(2)}s cause=${code}`),
    prepareRecovery: (error, attempt) => {
      const sourceUrl = error.sourceUrl || url;
      failedUrls.add(sourceUrl);
      return prepare(attempt === 1 ? sourceUrl : url, fallbackQuery, {
        expectedDuration: dependencies.expectedDuration, expectedTitle: dependencies.expectedTitle,
        guildId: dependencies.guildId, recoverySearch: attempt > 1 || sourceUrl === url && dependencies.requiresSearch,
        excludedUrls: [...failedUrls],
        shouldStart: dependencies.shouldStart,
      });
    },
    startAttempt: options => startAttempt(connection, url, options.onStart, options.onEnd, options.onError, fallbackQuery, {
      ...dependencies, ...options, preparedMedia: options.preparedMedia || (options.resumeAt === 0 ? dependencies.preparedMedia : undefined),
    }),
  });
}

async function startAttempt(connection, url, onStart, onEnd, onError, fallbackQuery, dependencies = {}) {
  const media = dependencies.preparedMedia || await (dependencies.prepareInput || preparePlaybackInput)(url, fallbackQuery, {
    expectedDuration: dependencies.expectedDuration,
    expectedTitle: dependencies.expectedTitle,
    guildId: dependencies.guildId,
    requiresSearch: dependencies.requiresSearch,
    shouldStart: dependencies.shouldStart,
  });
  if (dependencies.shouldStart && !dependencies.shouldStart()) {
    closeMedia(media);
    const error = new Error('Lecture annulée pendant la préparation du flux.');
    error.code = 'AUDIO_CANCELLED';
    throw error;
  }
  if (media.fallback) console.info(`[audio] Bascule vers ${media.fallbackProvider || 'un fournisseur alternatif'} après l’échec du flux principal.`);
  const requestedBitrate = Number(connection?.audioBitrate);
  const bitrate = Number.isFinite(requestedBitrate) && requestedBitrate > 0
    ? Math.min(192_000, Math.max(64_000, Math.round(requestedBitrate / 1_000) * 1_000))
    : 160_000;
  let ffmpeg;
  let decoder;
  const gain = new PcmVolume(dependencies.initialVolume ?? 1, dependencies.initialFilter || 'none');
  const resumeAt = Math.max(0, Number(dependencies.resumeAt) || 0);
  try {
    decoder = (dependencies.spawn || spawn)(bin('ffmpeg', 'FFMPEG_PATH'), [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      ...(resumeAt ? (media.stream ? [] : ['-ss', String(resumeAt)]) : ['-re']),
      '-i', media.stream ? 'pipe:0' : media.url,
      ...(resumeAt && media.stream ? ['-ss', String(resumeAt)] : []), '-vn',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '48000', '-ac', '2',
      '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1',
    ], { windowsHide: true });
    ffmpeg = (dependencies.spawn || spawn)(bin('ffmpeg', 'FFMPEG_PATH'), [
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 's16le', '-ar', '48000', '-ac', '2', '-i', 'pipe:0', '-vn',
      '-c:a', 'libopus', '-application', 'audio', '-vbr', 'on', '-compression_level', '10',
      '-frame_duration', '20', '-ar', '48000', '-ac', '2', '-b:a', `${bitrate / 1_000}k`,
      '-f', 'opus', 'pipe:1',
    ], { windowsHide: true });
  } catch (error) {
    decoder?.kill(); gain.destroy();
    closeMedia(media);
    throw error;
  }
  const parser = new OggParser(); let frames = []; let paused = false; let started = false; let stopped = false;
  let ffmpegError = ''; let errorReported = false;
  let totalAudioFrames = 0;
  let sentAudioFrames = 0;
  let readinessTimer = null;
  let drainTimer = null;
  let watchdog = null;
  let lastProgress = Date.now();
  const cleanup = () => {
    clearInterval(tick);
    clearInterval(drainTimer);
    clearInterval(watchdog);
    clearTimeout(readinessTimer);
    try { ffmpeg.kill(); } catch (_) {}
    try { decoder.kill(); } catch (_) {}
    closeMedia(media);
    gain.destroy();
  };
  const reportFfmpegError = (error) => {
    if (stopped || errorReported) return;
    errorReported = true;
    error.playbackPosition = resumeAt + sentAudioFrames * 0.02;
    Object.defineProperty(error, 'sourceUrl', { value: media.sourceUrl || url, configurable: true });
    stopped = true;
    cleanup();
    onError?.(error);
  };
  const tick = setInterval(() => {
    if (dependencies.shouldStart && !dependencies.shouldStart()) { stopped = true; cleanup(); return; }
    if (stopped || paused || !connection.connected || !frames.length) return;
    if (connection.daveRequired && (!connection.dave || !connection.dave.ready)) return;
    let ok;
    try { ok = connection.sendOpus(frames[0]); }
    catch (error) { reportFfmpegError(error); return; }
    if (!ok) return;
    frames.shift();
    sentAudioFrames++;
    lastProgress = Date.now();
    if (frames.length <= RESUME_OPUS_BUFFER_FRAMES && ffmpeg.stdout.isPaused()) ffmpeg.stdout.resume();
    if (readinessTimer) { clearTimeout(readinessTimer); readinessTimer = null; }
    if (!started) { started = true; onStart?.(); }
  }, 20);
  watchdog = setInterval(() => {
    if (paused || connection.daveRequired && !connection.dave?.ready) { lastProgress = Date.now(); return; }
    if (!stopped && Date.now() - lastProgress > (dependencies.stallTimeoutMs || 20_000)) {
      const error = new Error('Le flux audio ne progresse plus.');
      error.code = 'AUDIO_STALLED';
      reportFfmpegError(error);
    }
  }, 1000);
  readinessTimer = setTimeout(() => {
    if (connection.daveRequired && (!connection.dave || !connection.dave.ready)) {
      reportFfmpegError(new Error('La session DAVE de Discord ne s’est pas initialisée. Réessaie de rejoindre le vocal.'));
    }
  }, 30_000);
  ffmpeg.stdout.on('data', chunk => parser.feed(chunk, frame => {
    frames.push(frame);
    totalAudioFrames += 1;
    // Ne supprime pas les anciennes trames quand l’envoi Discord ralentit
    // (notamment pendant l’initialisation DAVE) : la contre-pression suspend
    // FFmpeg au lieu de sauter silencieusement des morceaux du flux.
    if (frames.length >= MAX_BUFFERED_OPUS_FRAMES && !ffmpeg.stdout.isPaused()) ffmpeg.stdout.pause();
  }));
  decoder.stdout.pipe(gain).pipe(ffmpeg.stdin);
  decoder.on('error', reportFfmpegError);
  decoder.stdout.on('error', reportFfmpegError);
  decoder.stdin.on('error', reportFfmpegError);
  gain.on('error', reportFfmpegError);
  ffmpeg.stdin.on('error', reportFfmpegError);
  if (media.stream) {
    media.stream.on('error', reportFfmpegError);
    media.stream.pipe(decoder.stdin);
  }
  // Never retain arbitrary stderr: signed URLs can span chunks and truncation
  // can remove their scheme, defeating URL-based redaction.
  const recordDiagnostic = d => {
    const diagnostic = ffmpegError + d.toString();
    if (/HTTP 403 Forbidden|(?:HTTP(?: error)?|Server returned)\s*:?\s*403|403\s+Forbidden/i.test(diagnostic)) ffmpegError = 'HTTP 403 Forbidden';
    else if (ffmpegError !== 'HTTP 403 Forbidden') ffmpegError = diagnostic.slice(-80);
  };
  ffmpeg.stderr.on('data', recordDiagnostic);
  decoder.stderr.on('data', recordDiagnostic);
  decoder.on('close', (code, signal) => {
    if (stopped || code === 0) return;
    const forbidden = ffmpegError === 'HTTP 403 Forbidden';
    const error = new Error(forbidden ? 'Le fournisseur refuse le flux audio (HTTP 403).' : `Décodage audio interrompu (${signal || code || 'inconnu'}).`);
    error.code = forbidden ? 'AUDIO_HTTP_FORBIDDEN' : 'FFMPEG_FAILED';
    reportFfmpegError(error);
  });
  ffmpeg.on('error', e => {
    console.error('[ffmpeg] démarrage impossible:', e.message);
    reportFfmpegError(e);
  });
  ffmpeg.on('close', (code, signal) => {
    if (stopped) return;
    if (code !== 0) {
      const reason = signal ? `le signal ${signal}` : `le code ${code ?? 'inconnu'}`;
      const forbidden = ffmpegError === 'HTTP 403 Forbidden';
      const error = new Error(forbidden
        ? 'Le fournisseur refuse le flux audio (HTTP 403), même après extraction du lien. Vérifie l’accès au média depuis cet hébergeur ; trouver le titre ne garantit pas que son flux soit accessible.'
        : `FFmpeg s'est arrêté avec ${reason}.`);
      error.code = forbidden ? 'AUDIO_HTTP_FORBIDDEN' : 'FFMPEG_FAILED';
      reportFfmpegError(error);
      return;
    }
    const expectedDuration = Number(dependencies.expectedDuration);
    const streamedDuration = resumeAt + totalAudioFrames * 0.02;
    const endTolerance = Math.min(15, Math.max(5, expectedDuration * 0.06));
    if (totalAudioFrames < 50 || (Number.isFinite(expectedDuration) && expectedDuration >= 45 && streamedDuration < expectedDuration - endTolerance)) {
      const error = new Error(totalAudioFrames < 50
        ? 'Le fournisseur a fermé le flux avant que la musique ne commence réellement.'
        : `Le flux audio s’est terminé prématurément (${Math.floor(streamedDuration)} s reçues sur environ ${Math.floor(expectedDuration)} s).`);
      error.code = 'AUDIO_PREMATURE_END';
      reportFfmpegError(error);
      return;
    }
    drainTimer = setInterval(() => {
      if (stopped || frames.length) return;
      stopped = true;
      cleanup();
      onEnd?.();
    }, 100);
  });
  return { pause() { paused = true; }, resume() { paused = false; }, setVolume(value) { gain.setVolume(value); }, setFilter(name) { gain.setFilter(name); }, stop() { stopped = true; cleanup(); } };
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
  OpusSender: { start, prepare: preparePlaybackInput },
  streamUrl,
  streamYtDlp,
  streamYouTubeAudio,
  searchYouTubei,
  streamYouTubei,
  buildYtDlpArgs,
  buildYtDlpSearchArgs,
  getYouTubeCookiesPath,
  getYouTubeCookiesPaths,
  parseYtDlpSearch,
  prepareInput,
  preparePlaybackInput,
  searchYouTubeCandidates,
  searchYouTubePlaylists,
  searchSoundCloudCandidates,
  soundCloudStream,
  soundCloudSearchStream,
  resolveSoundCloudCandidates,
  resolveYouTubePlaylist,
  youtubeSearchStream,
};
