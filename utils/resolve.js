/**
 * Résolution de musique : YouTube, Spotify et Deezer via leurs métadonnées.
 * Fonctionne pour les deux modes de commande (! et /).
 */

const play = require('play-dl');
const { isSpotifyUrl, resolveSpotifyLink } = require('./spotify');
const { configureSoundCloud } = require('./soundcloud');

function youtubeVideoId(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
    const fromQuery = parsed.searchParams.get('v');
    if (fromQuery) return fromQuery;
    return parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/i)?.[1] || null;
  } catch (_) {
    return null;
  }
}

function normalizeSoundCloudTrack(track) {
  const title = track.name || 'Musique inconnue';
  const artist = track.user?.username || track.publisher?.name || '';
  return {
    title,
    url: track.permalink || track.url,
    duration: track.durationInSec || 0,
    thumbnail: track.thumbnail || null,
    source: 'soundcloud',
    fallbackQuery: [artist, title].filter(Boolean).join(' - '),
  };
}

async function resolveSoundCloudLink(url) {
  if (!configureSoundCloud()) throw new Error('Les liens SoundCloud nécessitent SOUNDCLOUD_CLIENT_ID dans le fichier .env.');
  const entry = await play.soundcloud(url);
  const tracks = entry.type === 'track' ? [entry]
    : entry.type === 'playlist' ? await entry.all_tracks()
      : [];
  const songs = tracks.slice(0, 100).map(normalizeSoundCloudTrack).filter((track) => track.url);
  if (!songs.length) throw new Error('Aucun morceau SoundCloud public et lisible trouvé dans ce lien.');
  return songs;
}

/**
 * Résout une requête utilisateur en une ou plusieurs chansons jouables.
 * @returns {Promise<Array<{title,url,duration,thumbnail,source}>>}
 */
async function resolveQuery(query) {
  if (/(?:soundcloud\.com|snd\.sc)\//i.test(query)) {
    return resolveSoundCloudLink(query);
  }

  // 1) Lien Spotify
  if (isSpotifyUrl(query)) {
    return resolveSpotifyLink(query);
  }

  // Deezer sert de catalogue/metadata; l'audio est ensuite trouvé sur YouTube.
  if (/(?:deezer\.com|dzr\.page\.link)\//i.test(query)) {
    return resolveDeezerLink(query);
  }

  // 2) Lien YouTube
  if (query.includes('youtube.com') || query.includes('youtu.be')) {
    const videoId = youtubeVideoId(query);
    // Ne pas demander les métadonnées par play-dl avant la lecture : YouTube
    // bloque souvent ces requêtes d'hébergeur avec "Sign in to confirm...".
    // yt-dlp récupère le flux audio dans audioSender.js au démarrage de la lecture.
    if (videoId) {
      return [{ title: `YouTube · ${videoId}`, url: query, duration: 0, thumbnail: null, source: 'youtube' }];
    }
    const valid = await play.validate(query);
    if (!valid) {
      throw new Error('Lien YouTube invalide.');
    }
    if (valid === 'yt_playlist') {
      const playlist = await play.playlist_info(query, { incomplete: true });
      const videos = (await playlist.all_videos()).slice(0, 100);
      return videos.map((video) => ({
        title: video.title || 'Musique inconnue',
        url: video.url,
        duration: video.durationInSec || 0,
        thumbnail: video.thumbnails?.[0]?.url || null,
        source: 'youtube',
      }));
    }
    const info = await play.video_info(query);
    const d = info.video_details;
    return [{
      title: d.title || 'Musique inconnue',
      url: d.url || query,
      duration: d.durationInSec || 0,
      thumbnail: d.thumbnails && d.thumbnails.length ? d.thumbnails[0].url : null,
      source: 'youtube',
    }];
  }

  // 3) Recherche texte sur YouTube
  const results = await play.search(query, { limit: 1 });
  if (!results.length) {
    throw new Error(`Aucun résultat trouvé pour: \`${query}\``);
  }
  const r = results[0];
  return [{
    title: r.title,
    url: r.url,
    duration: r.durationInSec || 0,
    thumbnail: r.thumbnail && r.thumbnail.url ? r.thumbnail.url : null,
    source: 'youtube',
    fallbackQuery: query,
  }];
}

async function resolveDeezerLink(url) {
  const entry = await play.deezer(url);
  const tracks = entry.type === 'track' ? [entry] : await entry.all_tracks();
  const candidates = tracks.slice(0, 100);
  const songs = new Array(candidates.length);
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = candidates.slice(offset, offset + 4);
    const resolved = await Promise.all(batch.map(async (track) => {
      const title = track.title || track.name || 'Musique inconnue';
      const artist = track.artist?.name || '';
      const results = await play.search(`${artist} - ${title}`, { limit: 1 });
      const video = results[0];
      if (!video) return null;
      return {
        title: `${title}${artist ? ` - ${artist}` : ''}`,
        url: video.url,
        duration: track.durationInSec || video.durationInSec || 0,
        thumbnail: track.album?.cover?.medium || track.album?.cover_medium || null,
        source: 'deezer',
        fallbackQuery: `${artist} - ${title}`.trim(),
      };
    }));
    resolved.forEach((song, index) => { songs[offset + index] = song; });
  }
  const ready = songs.filter(Boolean);
  if (!ready.length) throw new Error('Aucun équivalent YouTube trouvé pour ce lien Deezer.');
  if (tracks.length > candidates.length) console.info('[catalogue] liste Deezer limitée aux 100 premiers titres.');
  return ready;
}

module.exports = { resolveQuery, youtubeVideoId, normalizeSoundCloudTrack };
