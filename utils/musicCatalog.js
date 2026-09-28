/** Agrégateur de métadonnées publics. L'audio est résolu séparément par fournisseur. */
const play = require('play-dl');
const { searchSpotifyCatalog, getSpotifyArtistAlbums } = require('./spotify');

const cache = new Map();
const CACHE_TTL = 30_000;
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

async function getWorldTopTracks({ fetchImpl = globalThis.fetch, fresh = false } = {}) {
  if (!fresh && worldChartCache?.expiresAt > Date.now()) return worldChartCache.items;
  if (worldChartRequest) return worldChartRequest;
  if (typeof fetchImpl !== 'function') throw new Error('fetch n’est pas disponible dans cette version de Node.js.');

  worldChartRequest = (async () => {
    const response = await fetchImpl('https://api.deezer.com/chart/0/tracks?limit=25', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
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
  const provider = item.provider === 'youtube' ? 'YouTube' : item.provider === 'spotify' ? 'Spotify' : 'Deezer';
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

async function safeSearch(label, fn) {
  try { return await fn(); }
  catch (error) {
    console.warn(`[catalogue] ${label} indisponible: ${error.message}`);
    return [];
  }
}

async function searchCatalog(query, { limit = 10, fresh = false } = {}) {
  const normalized = String(query || '').trim();
  if (normalized.length < 2) return [];
  const cacheKey = `${normalized.toLocaleLowerCase()}|${limit}`;
  const cached = cache.get(cacheKey);
  if (!fresh && cached && cached.expiresAt > Date.now()) return cached.items;

  const perType = Math.min(10, Math.max(1, limit));
  const tasks = [
    safeSearch('YouTube vidéos', async () => (await play.search(normalized, {
      limit: perType, source: { youtube: 'video' },
    })).map((item) => normalizeYoutube(item, 'track'))),
    safeSearch('YouTube playlists', async () => (await play.search(normalized, {
      limit: Math.min(5, perType), source: { youtube: 'playlist' },
    })).map((item) => normalizeYoutube(item, 'playlist'))),
    safeSearch('Spotify', () => searchSpotifyCatalog(normalized, Math.min(5, perType))),
    safeSearch('Deezer morceaux', async () => (await play.search(normalized, {
      limit: perType, source: { deezer: 'track' },
    })).map((item) => normalizeDeezer(item, 'track'))),
    safeSearch('Deezer albums', async () => (await play.search(normalized, {
      limit: Math.min(5, perType), source: { deezer: 'album' },
    })).map((item) => normalizeDeezer(item, 'album'))),
    safeSearch('Deezer playlists', async () => (await play.search(normalized, {
      limit: Math.min(5, perType), source: { deezer: 'playlist' },
    })).map((item) => normalizeDeezer(item, 'playlist'))),
  ];
  const groups = await Promise.all(tasks);
  const items = [];
  const seen = new Set();
  for (const item of groups.flat()) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    item.description = describe(item);
    items.push(item);
  }
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL, items });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return items;
}

function getArtistAlbums(artistId) { return getSpotifyArtistAlbums(artistId); }

module.exports = { searchCatalog, getArtistAlbums, getWorldTopTracks, normalizeWorldChart, describe };
