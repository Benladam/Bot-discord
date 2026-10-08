/** Adaptateur YouTubei sans file, client Discord ni transport vocal propres. */
const DEFAULT_SEARCH_TIMEOUT_MS = 12_000;
const DEFAULT_STREAM_TIMEOUT_MS = 20_000;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

function canonicalYouTubeUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error('Lien YouTube invalide.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Lien YouTube HTTPS requis.');
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'music.youtube.com'
      && host !== 'youtube-nocookie.com' && host !== 'youtu.be') throw new Error('Lien YouTube invalide.');
  const id = host === 'youtu.be'
    ? parsed.pathname.split('/').filter(Boolean)[0]
    : parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:shorts|live|embed)\/([^/?]+)/)?.[1];
  if (!YOUTUBE_ID.test(id || '')) throw new Error('Lien YouTube invalide.');
  return `https://www.youtube.com/watch?v=${id}`;
}

function secondsFromTrack(track) {
  const milliseconds = Number(track?.durationMS);
  if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds / 1_000;
  const parts = String(track?.duration || '').split(':').map(Number);
  if (!parts.length || parts.some(value => !Number.isFinite(value) || value < 0)) return 0;
  return parts.reduce((seconds, value) => seconds * 60 + value, 0);
}

function summarizeProviderError(value) {
  if (!value || typeof value !== 'object') return null;
  const name = String(value.name || 'Error').replace(/[^A-Za-z0-9_$.-]/g, '').slice(0, 60) || 'Error';
  const code = /^[A-Z0-9_]{1,60}$/.test(String(value.code || '')) ? String(value.code) : '';
  const message = String(value.message || '')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/\b(cookie|authorization|token|signature|sig)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return { name, code, message };
}

function withTimeout(promise, timeoutMs, code, description, onLateValue) {
  const safeTimeout = Math.max(100, Math.min(30_000, Number(timeoutMs) || DEFAULT_SEARCH_TIMEOUT_MS));
  let timer;
  let timedOut = false;
  const operation = Promise.resolve(promise);
  operation.then(value => { if (timedOut) onLateValue?.(value); }, () => {});
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(Object.assign(new Error(description), { code }));
      }, safeTimeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function createRuntime() {
  // Charge les dépendances seulement au premier recours YouTubei.
  const { YoutubeExtractor } = require('discord-player-youtubei');
  const { QueryType } = require('discord-player');
  let lastStreamError = null;
  const extractor = new YoutubeExtractor({ player: { debug(...values) {
    for (const value of values) {
      const summary = summarizeProviderError(value);
      if (summary) lastStreamError = summary;
    }
  } } }, {
    downloads: { trialOrder: ['adaptive', 'sabr'] },
  });
  return extractor.activate().then(() => ({
    extractor,
    searchType: QueryType.YOUTUBE_SEARCH,
    clearStreamError() { lastStreamError = null; },
    getStreamError() { return lastStreamError; },
  }));
}

function createYoutubeiProvider({ loadRuntime = createRuntime } = {}) {
  let runtimePromise;
  const runtime = () => {
    if (!runtimePromise) {
      runtimePromise = Promise.resolve().then(loadRuntime).catch(error => {
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise;
  };

  async function search(query, { limit = 5, timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS } = {}) {
    const normalized = String(query || '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (normalized.length < 2 || /[\r\n\x00-\x1f]/.test(normalized)) throw new Error('Recherche YouTube invalide.');
    const { extractor, searchType } = await runtime();
    const result = await withTimeout(
      extractor.handle(normalized, { type: searchType, requestedBy: null }),
      timeoutMs,
      'YOUTUBEI_SEARCH_TIMEOUT',
      'La recherche YouTubei a dépassé son délai.',
    );
    const maxResults = Math.max(1, Math.min(10, Number(limit) || 5));
    return (result?.tracks || []).flatMap(track => {
      let url;
      try { url = canonicalYouTubeUrl(track.url); } catch (_) { return []; }
      const duration = secondsFromTrack(track);
      return [{
        title: String(track.title || 'Musique inconnue').slice(0, 300),
        kind: 'track',
        url,
        durationInSec: duration,
        duration,
        thumbnail: typeof track.thumbnail === 'string' ? track.thumbnail : null,
        channel: track.author ? { name: String(track.author).slice(0, 160) } : undefined,
      }];
    }).slice(0, maxResults);
  }

  async function stream(value, { timeoutMs = DEFAULT_STREAM_TIMEOUT_MS } = {}) {
    const url = canonicalYouTubeUrl(value);
    const state = await runtime();
    const { extractor } = state;
    state.clearStreamError?.();
    const output = await withTimeout(
      extractor.stream({ url, title: '', live: false }),
      timeoutMs,
      'YOUTUBEI_STREAM_TIMEOUT',
      'L’ouverture du flux YouTubei a dépassé son délai.',
      late => { try { (late?.stream || late)?.destroy?.(); } catch (_) {} },
    );
    const audio = output && typeof output.pipe === 'function' ? output : output?.stream;
    if (!audio || typeof audio.pipe !== 'function') {
      try { output?.destroy?.(); } catch (_) {}
      const error = Object.assign(new Error('YouTubei n’a pas fourni de flux audio exploitable.'), { code: 'YOUTUBEI_NO_STREAM' });
      error.providerReason = state.getStreamError?.() || null;
      throw error;
    }
    audio.musicSource = { sourceUrl: url, provider: 'YouTube' };
    return audio;
  }

  return { search, stream };
}

const youtubei = createYoutubeiProvider();

module.exports = {
  canonicalYouTubeUrl,
  createYoutubeiProvider,
  summarizeProviderError,
  searchYouTubei: youtubei.search,
  streamYouTubei: youtubei.stream,
};
