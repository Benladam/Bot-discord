/** Agrégateur de métadonnées publics. L'audio est résolu séparément par fournisseur. */
const play = require('play-dl');
const { searchSpotifyCatalog, getSpotifyArtistAlbums } = require('./providers/spotify');
const { configureSoundCloud } = require('./providers/soundcloud');
const { searchYouTubeCandidates, searchYouTubePlaylists } = require('./audioSender');
const { collectCatalogResults } = require('./catalogSearch');

const cache = new Map();
const pendingSearches = new Map();
const CACHE_TTL = 2 * 60_000;
const DEFAULT_SOURCE_TIMEOUT_MS = 2_500;
const WORLD_CHART_TTL = 10 * 60_000;
let worldChartCache = null;
let worldChartRequest = null;

function normalizeWorldChart(payload) {
  if (payload?.error) {
    throw new Error(payload.error.message || 'Le classement Deezer est indisponible.');
  }
  if (!Array.isArray(payload?.data)) {
    throw new Error('Réponse invalide du classement Deezer.');
  }

  return payload.data.slice(0, 25).flatMap((track, index) => {
    const url = track.link || (track.id ? `https://www.deezer.com/track/${track.id}` : null);
    if (!url || !track.title) return [];
    return [{
      provider: 'deezer',
      kind: 'track',
      title: track.title,
      subtitle: track.artist?.name || '',
      url,
      duration: Number(track.duration) || 0,
      chartPosition: index + 1,
      worldChart: true,
    }];
  });
}

async function getWorldTopTracks({ fetchImpl = globalThis.fetch, fresh = false, timeoutMs = 7000 } = {}) {
  if (!fresh && worldChartCache?.expiresAt > Date.now()) return worldChartCache.items;
  if (worldChartRequest) return worldChartRequest;
  if (typeof fetchImpl !== 'function') throw new Error('fetch n’est pas disponible dans cette version de Node.js.');

  worldChartRequest = (async () => {
    const response = await fetchImpl('https://api.deezer.com/chart/0/tracks?limit=25', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`API Deezer indisponible (HTTP ${response.status}).`);
    const items = normalizeWorldChart(await response.json());
    if (!items.length) throw new Error('Le classement Deezer ne contient aucun morceau.');
    worldChartCache = { expiresAt: Date.now() + WORLD_CHART_TTL, items };
    return items;
  })();

  try {
    return await worldChartRequest;
  } finally {
    worldChartRequest = null;
  }
}

function describe(item) {
  const provider = { youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud', deezer: 'Deezer' }[item.provider] || item.provider;
  const kind = { track: 'morceau', playlist: 'playlist', album: 'album', artist: 'artiste' }[item.kind] || 'résultat';
  return `${provider} · ${kind}${item.subtitle ? ` · ${item.subtitle}` : ''}`.slice(0, 100);
}

function normalizeYoutube(item, kind) {
  return {
    provider: 'youtube', kind,
    title: item.title || item.name || 'Sans titre',
    subtitle: item.channel?.name || item.channel?.title || item.owner?.name || '',
    url: item.url,
    duration: item.durationInSec || 0,
  };
}

function normalizeSoundCloud(item) {
  return {
    provider: 'soundcloud', kind: 'track',
    title: item.name || item.title || 'Sans titre',
    subtitle: item.user?.username || item.publisher?.name || '',
    url: item.permalink || item.url,
    duration: item.durationInSec || 0,
  };
}

function normalizeDeezer(item, kind) {
  const artist = item.artist?.name || item.creator?.name || '';
  return {
    provider: 'deezer', kind,
    title: item.title || item.name || 'Sans titre',
    subtitle: kind === 'track' ? artist : `${artist}${item.tracksCount ? ` · ${item.tracksCount} titres` : ''}`,
    url: item.url,
    duration: item.durationInSec || 0,
  };
}

async function safeSearch(label, fn, timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`délai dépassé (${timeoutMs} ms)`)), timeoutMs);
      }),
    ]);
  }
  catch (error) {
    console.warn(`[catalogue] ${label} indisponible: ${error.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function searchCatalog(query, { limit = 10, fresh = false, sourceTimeoutMs = DEFAULT_SOURCE_TIMEOUT_MS } = {}) {
  const normalized = String(query || '').trim();
  if (normalized.length < 2) return [];
  const sourceWaitMs = Number.isFinite(sourceTimeoutMs)
    ? Math.max(100, Math.min(15_000, sourceTimeoutMs))
    : DEFAULT_SOURCE_TIMEOUT_MS;
  const cacheKey = `${normalized.toLocaleLowerCase()}|${limit}`;
  const cached = cache.get(cacheKey);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.items;
  if (!fresh && pendingSearches.has(cacheKey)) return pendingSearches.get(cacheKey);

  const searchRequest = (async () => {
    // Le client Discord reçoit une réponse rapide, mais la première extraction
    // peut continuer et enrichir le cache sans être relancée à chaque saisie.
    const workerWaitMs = Math.max(6000, sourceWaitMs);
    const perType = Math.min(10, Math.max(1, limit));
    const tasks = [
      safeSearch('YouTube vidéos', async () => (await searchYouTubeCandidates(normalized, {
        limit: perType,
        timeoutMs: workerWaitMs,
      })).map((item) => normalizeYoutube(item, 'track')), workerWaitMs + 100),
      safeSearch('YouTube playlists', async () => (await searchYouTubePlaylists(normalized, {
        limit: Math.min(5, perType), timeoutMs: workerWaitMs,
      })).map((item) => normalizeYoutube(item, 'playlist')), workerWaitMs + 100),
      safeSearch('Spotify', () => searchSpotifyCatalog(normalized, Math.min(5, perType)), sourceWaitMs),
      safeSearch('Deezer morceaux', async () => (await play.search(normalized, {
        limit: perType, source: { deezer: 'track' },
      })).map((item) => normalizeDeezer(item, 'track')), sourceWaitMs),
      safeSearch('Deezer albums', async () => (await play.search(normalized, {
        limit: Math.min(5, perType), source: { deezer: 'album' },
      })).map((item) => normalizeDeezer(item, 'album')), sourceWaitMs),
      safeSearch('Deezer playlists', async () => (await play.search(normalized, {
        limit: Math.min(5, perType), source: { deezer: 'playlist' },
      })).map((item) => normalizeDeezer(item, 'playlist')), sourceWaitMs),
    ];
    if (configureSoundCloud()) {
      tasks.splice(1, 0, safeSearch('SoundCloud morceaux', async () => (await play.search(normalized, {
        limit: perType, source: { soundcloud: 'tracks' },
      })).map(normalizeSoundCloud), sourceWaitMs));
    }
    const storeResults = (results) => {
      const previous = cache.get(cacheKey);
      if (!results.length || (previous?.expiresAt > Date.now() && previous.items.length > results.length)) return;
      results.forEach(item => { item.description = describe(item); });
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL, items: results });
      if (cache.size > 100) cache.delete(cache.keys().next().value);
    };
    const items = await collectCatalogResults(tasks, {
      timeoutMs: Math.min(1500, sourceWaitMs), onComplete: results => {
        storeResults(results);
        if (pendingSearches.get(cacheKey) === searchRequest) pendingSearches.delete(cacheKey);
      },
    });
    storeResults(items);
    return items;
  })();

  if (!fresh) pendingSearches.set(cacheKey, searchRequest);
  try { return await searchRequest; }
  catch (error) {
    if (pendingSearches.get(cacheKey) === searchRequest) pendingSearches.delete(cacheKey);
    throw error;
  }
}

function getArtistAlbums(artistId) { return getSpotifyArtistAlbums(artistId); }

module.exports = { searchCatalog, getArtistAlbums, getWorldTopTracks, normalizeWorldChart, describe };
