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

function isSpotifyUrl(query) {
  return /open\.spotify\.com/i.test(query);
}

function parseSpotifyUrl(url) {
  const m = url.match(/open\.spotify\.com\/(track|playlist|album|artist)\/([A-Za-z0-9]+)/i);
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

  if (!clientId || !clientSecret) {
    throw new Error(
      'Identifiants Spotify manquants. Ajoutez SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET dans votre .env ' +
      '(voir .env.example).'
    );
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

module.exports = { isSpotifyUrl, resolveSpotifyLink };
