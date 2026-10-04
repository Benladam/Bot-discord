/**
 * Utilitaire Spotify -> YouTube
 *
 * Spotify n'autorise pas le streaming audio direct, on résout donc les
 * métadonnées de la piste (titre + artiste) puis on lit l'audio équivalent
 * sur YouTube via play-dl.
 *
 * Nécessite les identifiants Spotify (Client ID + Client Secret) dans .env :
 *   SPOTIFY_CLIENT_ID=...
 *   SPOTIFY_CLIENT_SECRET=...
 */

const play = require('play-dl');
const { searchYouTubeCandidates } = require('../audioSender');
const { getPublicPlaylist } = require('./spotifyPublic');
const MAX_SPOTIFY_TRACKS = 100;

const tokenCaches = new Map();

async function getSpotifyApi({ userAccess = false, forceRefresh = false } = {}) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const SpotifyWebApi = require('spotify-web-api-node');
  const refreshToken = userAccess ? process.env.SPOTIFY_REFRESH_TOKEN || '' : '';
  const mode = userAccess ? 'user' : 'app';
  const credentials = JSON.stringify([clientId, clientSecret, refreshToken]);
  let cache = tokenCaches.get(mode);
  if (!cache || cache.credentials !== credentials) {
    cache = { api: new SpotifyWebApi({ clientId, clientSecret }), credentials, expiresAt: 0, request: null };
    if (refreshToken) cache.api.setRefreshToken(refreshToken);
    tokenCaches.set(mode, cache);
  }
  if (!forceRefresh && Date.now() < cache.expiresAt - 60_000) return cache.api;
  if (!cache.request) {
    cache.request = (refreshToken ? cache.api.refreshAccessToken() : cache.api.clientCredentialsGrant())
      .then(({ body }) => {
        if (!body.access_token) throw new Error('Spotify n’a pas délivré de jeton d’accès.');
        cache.api.setAccessToken(body.access_token);
        if (body.refresh_token) cache.api.setRefreshToken(body.refresh_token);
        cache.expiresAt = Date.now() + (body.expires_in || 3600) * 1000;
        return cache.api;
      })
      .finally(() => { cache.request = null; });
  }
  return cache.request;
}

/** Résultats de recherche Spotify pour les suggestions de /play. */
async function searchSpotify(query, limit = 10) {
  const api = await getSpotifyApi();
  if (!api) return [];
  const { body } = await api.searchTracks(query, { limit: Math.min(10, Math.max(1, limit)) });
  return (body.tracks?.items || []).map((track) => {
    const artists = (track.artists || []).map((artist) => artist.name).join(', ');
    return {
      title: `${track.name}${artists ? ` — ${artists}` : ''}`,
      url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
      source: 'spotify',
    };
  }).filter((track) => track.url);
}

/** Recherche publique Spotify: morceaux, albums, artistes et playlists. */
async function searchSpotifyCatalog(query, limit = 5) {
  const api = await getSpotifyApi();
  if (!api) return [];
  const { body } = await api.search(query, ['track', 'album', 'artist', 'playlist'], {
    limit: Math.min(10, Math.max(1, limit)), market: process.env.MUSIC_MARKET || 'FR',
  });
  const results = [];
  for (const track of body.tracks?.items || []) {
    const artist = (track.artists || []).map((item) => item.name).join(', ');
    results.push({
      provider: 'spotify', kind: 'track', title: track.name,
      subtitle: artist, duration: Math.floor((track.duration_ms || 0) / 1000),
      url: track.external_urls?.spotify || `https://open.spotify.com/track/${track.id}`,
    });
  }
  for (const album of body.albums?.items || []) {
    results.push({
      provider: 'spotify', kind: 'album', title: album.name,
      subtitle: `${(album.artists || []).map((item) => item.name).join(', ')} · ${album.total_tracks || '?'} titres`,
      url: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`,
    });
  }
  for (const artist of body.artists?.items || []) {
    results.push({
      provider: 'spotify', kind: 'artist', title: artist.name,
      subtitle: 'Voir les albums et singles',
      url: artist.external_urls?.spotify || `https://open.spotify.com/artist/${artist.id}`,
      artistId: artist.id,
    });
  }
  for (const playlist of body.playlists?.items || []) {
    if (!playlist) continue;
    results.push({
      provider: 'spotify', kind: 'playlist', title: playlist.name,
      subtitle: `${playlist.owner?.display_name || 'Playlist publique'} · ${playlist.items?.total ?? playlist.tracks?.total ?? '?'} titres`,
      url: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlist.id}`,
    });
  }
  return results;
}

async function getSpotifyArtistAlbums(artistId, maxAlbums = 500) {
  const api = await getSpotifyApi();
  if (!api) throw new Error('Configure SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET pour ouvrir la discographie Spotify.');
  const albums = [];
  let offset = 0;
  while (offset < maxAlbums) {
    const limit = Math.min(10, maxAlbums - offset);
    const { body } = await api.getArtistAlbums(String(artistId), {
      include_groups: 'album,single,compilation,appears_on', limit, offset,
      market: process.env.MUSIC_MARKET || 'FR',
    });
    albums.push(...(body.items || []).map((album) => ({
      provider: 'spotify', kind: 'album', title: album.name,
      subtitle: `${(album.artists || []).map((item) => item.name).join(', ')} · ${album.total_tracks || '?'} titres · ${album.release_date || ''}`.trim(),
      url: album.external_urls?.spotify || `https://open.spotify.com/album/${album.id}`,
    })));
    if (!body.next || !body.items?.length) break;
    offset += body.items.length;
  }
  const seen = new Set();
  return albums.filter((item) => !seen.has(item.url) && seen.add(item.url));
}

function isSpotifyUrl(query) {
  return /(?:open\.spotify\.com|spotify\.com)\//i.test(query) || /^spotify:(?:track|album|playlist):/i.test(query);
}

function parseSpotifyUrl(url) {
  const value = String(url || '').trim();
  const uri = value.match(/^spotify:(track|playlist|album|artist):([A-Za-z0-9]+)/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'spotify.com' && !host.endsWith('.spotify.com')) return { type: 'unknown', id: null };
    // Spotify shares links with locale prefixes (for example /intl-fr/track/<id>).
    const match = parsed.pathname.match(/\/(?:intl-[a-z]{2,3}(?:-[a-z]{2})?\/)?(track|playlist|album|artist)\/([A-Za-z0-9]+)/i);
    if (!match) return { type: 'unknown', id: null };
    return { type: match[1].toLowerCase(), id: match[2] };
  } catch (_) {
    return { type: 'unknown', id: null };
  }
}

function normalizeYouTubeMatch(r, query) {
  if (!r?.url) return null;
  try {
    const parsed = new URL(r.url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (parsed.protocol !== 'https:' || !['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return null;
  } catch (_) { return null; }
  return {
    title: r.title,
    url: r.url,
    duration: r.durationInSec || 0,
    thumbnail: r.thumbnail && r.thumbnail.url ? r.thumbnail.url : null,
    source: 'spotify',
    fallbackQuery: query,
  };
}

async function searchYouTube(query, {
  searchYtDlp = searchYouTubeCandidates,
  searchPlayDl = (...args) => play.search(...args),
} = {}) {
  let ytDlpError = null;
  try {
    const results = await searchYtDlp(query, { limit: 1 });
    const match = normalizeYouTubeMatch(results[0], query);
    if (match) return match;
  } catch (error) {
    ytDlpError = error;
  }

  // Kinetic peut momentanément refuser l’extraction du binaire autonome.
  // play-dl essaie un chemin distinct pour retrouver une URL vidéo directe.
  try {
    const results = await searchPlayDl(query, { limit: 3, source: { youtube: 'video' } });
    const match = (Array.isArray(results) ? results : [])
      .map((item) => normalizeYouTubeMatch(item, query))
      .find(Boolean);
    if (match) return match;
  } catch (error) {
    if (ytDlpError) {
      console.warn(`[spotify] recherche yt-dlp/play-dl échouée pour « ${String(query).slice(0, 100)} »: ${error.message}`);
    }
  }

  if (ytDlpError) throw ytDlpError;
  return null;
}

async function resolveTrack(api, track) {
  if (!track || !track.name) return null;
  const artistNames = (track.artists || []).map((a) => a.name).join(', ');
  const searchQuery = `${artistNames} - ${track.name}`;
  const yt = await searchYouTube(searchQuery);
  if (!yt) return null;
  yt.title = `${track.name} - ${artistNames}`;
  if (track.album && track.album.images && track.album.images.length) {
    yt.thumbnail = track.album.images[0].url;
  }
  return yt;
}

async function resolveTracks(api, tracks) {
  // La recherche audio se fait au démarrage de chaque piste, pas pour toute
  // la playlist avant sa mise en file. Aucun flux partagé ou persisté.
  return tracks.filter(track => track?.name && track.id && !track.is_local && (!track.type || track.type === 'track'))
    .slice(0, MAX_SPOTIFY_TRACKS).map(track => {
      const artists = (track.artists || []).map(artist => artist.name).filter(Boolean).join(', ');
      return { title: `${track.name}${artists ? ` - ${artists}` : ''}`,
        url: `https://open.spotify.com/track/${track.id}`, source: 'spotify', requiresSearch: true,
        fallbackQuery: `${artists} - ${track.name}`, duration: Math.round((Number(track.duration_ms) || 0) / 1000),
        thumbnail: track.album?.images?.[0]?.url || null };
    });
}

async function getSpotifyPlaylistItems(api, playlistId, limit, offset, retry = true) {
  const params = new URLSearchParams({
    limit: String(Math.min(50, limit)), offset: String(offset),
    market: process.env.MUSIC_MARKET || 'FR', additional_types: 'track',
  });
  const response = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?${params}`, {
    headers: { Authorization: `Bearer ${api.getAccessToken()}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 401 && retry) {
    const refreshed = await getSpotifyApi({ userAccess: true, forceRefresh: true });
    return getSpotifyPlaylistItems(refreshed, playlistId, limit, offset, false);
  }
  if (response.status === 403) {
    const error = new Error('Spotify ne permet de lire cette playlist qu’avec le compte propriétaire ou un collaborateur autorisé. Configure SPOTIFY_REFRESH_TOKEN avec son autorisation OAuth.');
    error.statusCode = 403;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`Spotify refuse la lecture de la playlist (HTTP ${response.status}). Pour un accès complet, configure SPOTIFY_REFRESH_TOKEN avec l’autorisation du propriétaire.`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

/**
 * Résout un lien Spotify (track / album / playlist accessible) en chansons
 * correspondantes sur YouTube. Les titres de playlist dépendent des droits OAuth.
 * @returns {Promise<Array<{title,url,duration,thumbnail,source}>>}
 */
async function resolveSpotifyLink(url) {
  const { type, id } = parseSpotifyUrl(url);
  if (type === 'unknown') throw new Error('Lien Spotify non supporté. Utilisez un lien piste (track), album ou playlist.');
  // Le catalogue public reste accessible si les droits API ont changé.
  if (type === 'playlist') {
    let apiError;
    try {
      const api = await getSpotifyApi({ userAccess: true });
      if (!api) throw new Error('Configure SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET et SPOTIFY_REFRESH_TOKEN pour accéder à une playlist privée.');
      let offset = 0;
      const tracks = [];
      while (offset < 1000 && tracks.length < MAX_SPOTIFY_TRACKS) {
        const page = await getSpotifyPlaylistItems(api, id, Math.min(50, MAX_SPOTIFY_TRACKS - tracks.length), offset);
        tracks.push(...(page.items || []).map(entry => entry?.item || entry?.track).filter(track => track?.name && !track.is_local && (!track.type || track.type === 'track')));
        if (!page.next || !page.items?.length) break;
        offset += page.items.length;
      }
      const songs = await resolveTracks(api, tracks);
      if (!songs.length) throw new Error('Aucune musique correspondante accessible pour cette playlist Spotify.');
      return songs;
    } catch (error) {
      apiError = error;
      if (error.statusCode && ![401, 403].includes(error.statusCode)) throw error;
      if (/Aucune musique correspondante/.test(error.message)) throw error;
    }
    try {
      const tracks = await getPublicPlaylist(id);
      const songs = await resolveTracks(null, tracks);
      if (!songs.length) throw apiError;
      songs[0].playlistNotice = `Aperçu public Spotify : ${songs.length} titres accessibles, pas nécessairement la playlist complète. Pour l’accès complet, configure l’autorisation Spotify du propriétaire.`;
      console.info(`[spotify] playlist publique ${id}: ${songs.length} titres importés depuis l’aperçu, liste potentiellement partielle.`);
      return songs;
    } catch (_) { throw apiError; }
  }
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  // Le mode oEmbed permet au minimum de lire un lien de piste sans créer
  // d'application Spotify. Les albums/playlists nécessitent encore l'API.
  if (!clientId || !clientSecret) {
    const fallback = await resolveTrackWithoutApi(url);
    if (fallback) return [fallback];
    throw new Error('Ajoutez SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET dans .env pour les albums/playlists Spotify.');
  }

  const api = await getSpotifyApi();

  const songs = [];

  if (type === 'track') {
    const { body } = await api.getTrack(id);
    const s = await resolveTrack(api, body);
    if (s) songs.push(s);
  } else if (type === 'album') {
    const tracks = [];
    let offset = 0;
    while (tracks.length < MAX_SPOTIFY_TRACKS) {
      const limit = Math.min(50, MAX_SPOTIFY_TRACKS - tracks.length);
      const { body } = await api.getAlbumTracks(id, { limit, offset, market: process.env.MUSIC_MARKET || 'FR' });
      tracks.push(...(body.items || []));
      if (!body.next || !body.items?.length) break;
      offset += body.items.length;
    }
    songs.push(...await resolveTracks(api, tracks));
  } else {
    throw new Error(
      'Lien Spotify non supporté. Utilisez un lien piste (track), album ou playlist.'
    );
  }

  if (songs.length === 0) {
    throw new Error('Aucune musique correspondante trouvée sur YouTube pour ce lien Spotify.');
  }

  return songs;
}

async function resolveTrackWithoutApi(url) {
  const parsed = parseSpotifyUrl(url);
  if (parsed.type !== 'track') return null;
  const canonical = `https://open.spotify.com/track/${parsed.id}`;
  try {
    const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.title) return null;
    const yt = await searchYouTube(data.title);
    if (!yt) return null;
    yt.title = data.title;
    yt.thumbnail = data.thumbnail_url || yt.thumbnail;
    yt.source = 'spotify';
    return yt;
  } catch (_) { return null; }
}

module.exports = {
  isSpotifyUrl, parseSpotifyUrl, resolveSpotifyLink, searchSpotify, searchSpotifyCatalog, getSpotifyArtistAlbums, searchYouTube, getSpotifyApi,
};
