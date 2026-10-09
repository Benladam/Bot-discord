/** Extraction Lavalink ; files et transport Discord restent ceux du bot. */
const { Readable } = require('node:stream');
const { canonicalYouTubeUrl } = require('./youtubei');
const { ensureLavalink } = require('../lavalinkRuntime');

async function safeFailureReason(response) {
  // Les traces restent dans la connexion privée authentifiée. Aucun texte brut,
  // URL, chemin, compte ou jeton n'est transmis aux logs Discord/console.
  const reader = response.body?.getReader?.();
  if (!reader) return '';
  let text = '';
  try {
    while (text.length < 65536) {
      const { done, value } = await reader.read();
      if (done) break;
      text += Buffer.from(value).toString('utf8').slice(0, 65536 - text.length);
    }
    const reasons = [
      [/sign in to confirm|login.required|requires login|cannot be viewed anonymously|not a bot/i, 'AUTH_REQUIRED'],
      [/requires age verification|inappropriate for some users/i, 'AGE_VERIFICATION_REQUIRED'],
      [/must find action functions|could not.*(?:cipher|signature)|(?:cipher|signature).*?(?:failed|not found|unsupported)/i, 'CIPHER_FAILED'],
      [/status code: 403|403 Forbidden/i, 'UPSTREAM_403'],
      [/status code: 429|429 Too Many Requests/i, 'UPSTREAM_429'],
      [/SocketTimeoutException|timed out/i, 'UPSTREAM_TIMEOUT'],
      [/could not find formats|no formats found/i, 'NO_FORMATS'],
      [/video (?:is |is not )?(?:unavailable|available)|private video|video is unplayable|non-embeddable/i, 'CONTENT_UNAVAILABLE'],
      [/NoSuchMethodError|NoClassDefFoundError|IncompatibleClassChangeError/i, 'PLUGIN_INCOMPATIBLE'],
      [/SSLHandshakeException|PKIX path building/i, 'UPSTREAM_TLS_FAILED'],
    ];
    return reasons.find(([pattern]) => pattern.test(text))?.[1] || '';
  } catch { return ''; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function createLavalinkProvider({ ensure = ensureLavalink, fetchImpl = globalThis.fetch } = {}) {
  async function search(query, { limit = 5, timeoutMs = 6000 } = {}) {
    const term = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (term.length < 2 || /https?:\/\/|[\x00-\x1f]/i.test(term)) throw new Error('Recherche Lavalink invalide.');
    const config = await ensure();
    const url = new URL('/v4/loadtracks', config.url); url.searchParams.set('identifier', `ytsearch:${term}`);
    const response = await fetchImpl(url, { headers: { Authorization: config.password },
      signal: AbortSignal.timeout(Math.max(100, Math.min(12_000, timeoutMs))), redirect: 'error' });
    if (!response.ok) throw Object.assign(new Error(`Recherche Lavalink refusée (HTTP ${response.status}).`), { code: 'LAVALINK_SEARCH_FAILED' });
    const payload = await response.json();
    if (payload.loadType === 'error') throw Object.assign(new Error('Le plugin Lavalink a refusé la recherche YouTube.'), { code: 'LAVALINK_SEARCH_FAILED' });
    const tracks = payload.loadType === 'search' ? payload.data : payload.loadType === 'track' ? [payload.data] : [];
    return (Array.isArray(tracks) ? tracks : []).flatMap(track => {
      const info = track?.info; let source;
      try { source = canonicalYouTubeUrl(info?.uri); } catch { return []; }
      if (info.sourceName !== 'youtube' || info.isStream || !(info.length > 0)) return [];
      return [{ kind: 'track', title: String(info.title || 'Musique inconnue').slice(0, 300), url: source,
        duration: info.length / 1000, durationInSec: info.length / 1000,
        thumbnail: info.artworkUrl || null, channel: { name: String(info.author || '').slice(0, 160) } }];
    }).slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));
  }
  async function stream(value, { timeoutMs = 90_000 } = {}) {
    const sourceUrl = canonicalYouTubeUrl(value);
    const id = new URL(sourceUrl).searchParams.get('v');
    const config = await ensure();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(100, Math.min(120_000, timeoutMs)));
    const failures = [];
    try {
      // La route du plugin peut abandonner dès qu'un client répond CannotBeLoaded.
      // Essais explicites sur la MÊME vidéo, jamais sur un autre résultat.
      for (const client of ['ANDROID_VR', 'WEB', 'WEBEMBEDDED']) {
        if (controller.signal.aborted) break;
        const attempt = new AbortController();
        const headerTimer = setTimeout(() => attempt.abort(), 12_000);
        let response;
        try {
          response = await fetchImpl(`${config.url}/youtube/stream/${id}?withClient=${client}&trace=true`, {
            headers: { Authorization: config.password }, signal: AbortSignal.any([controller.signal, attempt.signal]), redirect: 'error',
          });
        } catch {
          failures.push(`${client}=TIMEOUT_OR_NETWORK`); clearTimeout(headerTimer); attempt.abort(); continue;
        }
        clearTimeout(headerTimer);
        const type = response.headers.get('content-type') || '';
        if (!response.ok || !response.body || !/^(audio\/|video\/|application\/octet-stream)/i.test(type)) {
          const reason = await safeFailureReason(response);
          failures.push(`${client}=HTTP_${response.status}${response.ok ? '_NOT_AUDIO' : ''}${reason ? `/${reason}` : ''}`);
          attempt.abort(); continue;
        }
        const audio = Readable.fromWeb(response.body);
        const cleanup = () => { clearTimeout(timer); controller.abort(); attempt.abort(); };
        audio.once('close', cleanup); audio.once('end', cleanup); audio.cleanup = () => { cleanup(); audio.destroy(); };
        audio.musicSource = { sourceUrl, provider: 'YouTube', extractor: 'lavalink' };
        return audio;
      }
      throw Object.assign(new Error('Aucun client YouTube de Lavalink ne fournit le flux demandé.'), {
        code: 'LAVALINK_STREAM_FAILED', providerReason: { name: 'Lavalink', code: 'CLIENTS_REFUSED', message: failures.join('; ').slice(0, 180) },
      });
    } catch (error) {
      clearTimeout(timer); controller.abort();
      if (error.code === 'LAVALINK_STREAM_FAILED') throw error;
      throw Object.assign(new Error('Ouverture du flux Lavalink impossible ou délai dépassé.'), { code: 'LAVALINK_STREAM_FAILED' });
    }
  }
  return { search, stream };
}
const provider = createLavalinkProvider();
module.exports = { createLavalinkProvider, safeFailureReason, searchLavalink: provider.search, streamLavalink: provider.stream };
