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

function isSpotifyUrl(query) {
  return /(?:open\.spotify\.com|spotify\.com)\//i.test(query) || /^spotify:(?:track|album|playlist):/i.test(query);
}

function parseSpotifyUrl(url) {
  const m = url.match(/(?:open\.)?spotify\.com\/(track|playlist|album|artist)\/([A-Za-z0-9]+)/i)
    || url.match(/^spotify:(track|playlist|album|artist):([A-Za-z0-9]+)/i);
  if (!m) return { type: 'unknown', id: null };
  return { type: m[1].toLowerCase(), id: m[2] };
}

async function searchYouTube(query) {
  const results = await play.search(query, { limit: 1 });
  if (!results.length) return null;
  const r = results[0];
  return {
    title: r.title,
    url: r.url,
    duration: r.durationInSec || 0,
    thumbnail: r.thumbnail && r.thumbnail.url ? r.thumbnail.url : null,
    source: 'spotify',
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

/**
 * Résout un lien Spotify (track / album / playlist) en une liste de chansons
 * prêtes à jouer sur YouTube.
 * @returns {Promise<Array<{title,url,duration,thumbnail,source}>>}
 */
async function resolveSpotifyLink(url) {
  const SpotifyWebApi = require('spotify-web-api-node');
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  // Le mode oEmbed permet au minimum de lire un lien de piste sans créer
  // d'application Spotify. Les albums/playlists nécessitent encore l'API.
  if (!clientId || !clientSecret) {
    const fallback = await resolveTrackWithoutApi(url);
    if (fallback) return [fallback];
    throw new Error('Ajoutez SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET dans .env pour les albums/playlists Spotify.');
  }

  const api = new SpotifyWebApi({ clientId, clientSecret });
  const grant = await api.clientCredentialsGrant();
  api.setAccessToken(grant.body.access_token);

  const { type, id } = parseSpotifyUrl(url);
  const songs = [];

  if (type === 'track') {
    const { body } = await api.getTrack(id);
    const s = await resolveTrack(api, body);
    if (s) songs.push(s);
  } else if (type === 'album') {
    const { body } = await api.getAlbum(id);
    for (const t of body.tracks.items) {
      const s = await resolveTrack(api, t);
      if (s) songs.push(s);
    }
  } else if (type === 'playlist') {
    let offset = 0;
    while (true) {
      const { body } = await api.getPlaylistTracks(id, { offset, limit: 100 });
      for (const item of body.items) {
        if (item.track) {
          const s = await resolveTrack(api, item.track);
          if (s) songs.push(s);
        }
      }
      if (!body.next) break;
      offset += body.items.length;
    }
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

module.exports = { isSpotifyUrl, resolveSpotifyLink, searchSpotify };
