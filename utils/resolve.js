/**
 * Résolution de musique : YouTube, Spotify et Deezer via leurs métadonnées.
 * Fonctionne pour les deux modes de commande (! et /).
 */

const play = require('play-dl');
const { isSpotifyUrl, resolveSpotifyLink } = require('./spotify');

/**
 * Résout une requête utilisateur en une ou plusieurs chansons jouables.
 * @returns {Promise<Array<{title,url,duration,thumbnail,source}>>}
 */
async function resolveQuery(query) {
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
      };
    }));
    resolved.forEach((song, index) => { songs[offset + index] = song; });
  }
  const ready = songs.filter(Boolean);
  if (!ready.length) throw new Error('Aucun équivalent YouTube trouvé pour ce lien Deezer.');
  if (tracks.length > candidates.length) console.info('[catalogue] liste Deezer limitée aux 100 premiers titres.');
  return ready;
}

module.exports = { resolveQuery };
