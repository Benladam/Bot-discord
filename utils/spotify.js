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
const { searchYouTubeCandidates } = require('./audioSender');
const MAX_SPOTIFY_TRACKS = 100;

let spotifySearchApi = null;
let spotifySearchClientId = null;
let spotifySearchTokenExpiresAt = 0;
let spotifySearchTokenRequest = null;

async function getSpotifyApi() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const SpotifyWebApi = require('spotify-web-api-node');
  if (!spotifySearchApi || spotifySearchClientId !== clientId) {
    spotifySearchApi = new SpotifyWebApi({ clientId, clientSecret });
    spotifySearchClientId = clientId;
    spotifySearchTokenExpiresAt = 0;
  }
  if (Date.now() < spotifySearchTokenExpiresAt - 60_000) return spotifySearchApi;

  if (!spotifySearchTokenRequest) {
    spotifySearchTokenRequest = spotifySearchApi.clientCredentialsGrant()
      .then(({ body }) => {
        spotifySearchApi.setAccessToken(body.access_token);
        spotifySearchTokenExpiresAt = Date.now() + (body.expires_in || 3600) * 1000;
        return spotifySearchApi;
      })
      .finally(() => { spotifySearchTokenRequest = null; });
  }
  return spotifySearchTokenRequest;
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

async function searchYouTube(query) {
  const results = await searchYouTubeCandidates(query, { limit: 1 });
  if (!results.length) return null;
  const r = results[0];
  return {
    title: r.title,
    url: r.url,
    duration: r.durationInSec || 0,
    thumbnail: r.thumbnail && r.thumbnail.url ? r.thumbnail.url : null,
    source: 'spotify',
    fallbackQuery: query,
  };
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
  const resolved = [];
  for (let offset = 0; offset < tracks.length && resolved.length < MAX_SPOTIFY_TRACKS; offset += 4) {
    const batch = tracks.slice(offset, offset + 4);
    const songs = await Promise.all(batch.map((track) =>
      resolveTrack(api, track).catch((error) => {
        console.warn(`[spotify] piste ignorée (${track?.name || 'sans titre'}): ${error.message}`);
        return null;
      })
    ));
    resolved.push(...songs.filter(Boolean).slice(0, MAX_SPOTIFY_TRACKS - resolved.length));
  }
  return resolved;
}

async function getSpotifyPlaylistItems(api, playlistId, limit, offset) {
  const params = new URLSearchParams({
    limit: String(limit), offset: String(offset),
    market: process.env.MUSIC_MARKET || 'FR', additional_types: 'track',
  });
  const response = await fetch(`https://api.spotify.com/v1/playlists/${encodeURIComponent(playlistId)}/items?${params}`, {
    headers: { Authorization: `Bearer ${api.getAccessToken()}` },
  });
  if (response.status === 403) {
    throw new Error('Spotify ne permet de lire cette playlist qu’avec le compte propriétaire ou un collaborateur autorisé.');
  }
  if (!response.ok) throw new Error(`Spotify refuse la lecture de la playlist (HTTP ${response.status}).`);
  return response.json();
}

/**
 * Résout un lien Spotify (track / album / playlist accessible) en chansons
 * correspondantes sur YouTube. Les titres de playlist dépendent des droits OAuth.
 * @returns {Promise<Array<{title,url,duration,thumbnail,source}>>}
 */
async function resolveSpotifyLink(url) {
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

  const { type, id } = parseSpotifyUrl(url);
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
  } else if (type === 'playlist') {
    let offset = 0;
    const tracks = [];
    while (tracks.length < MAX_SPOTIFY_TRACKS) {
      const limit = Math.min(100, MAX_SPOTIFY_TRACKS - tracks.length);
      const page = await getSpotifyPlaylistItems(api, id, limit, offset);
      tracks.push(...(page.items || []).map((entry) => entry.item || entry.track).filter(Boolean));
      if (!page.next || !page.items?.length) break;
      offset += page.items.length;
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
  isSpotifyUrl, parseSpotifyUrl, resolveSpotifyLink, searchSpotify, searchSpotifyCatalog, getSpotifyArtistAlbums,
};
