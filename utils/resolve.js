/**
 * Résolution de musique : YouTube (lien ou recherche) et Spotify.
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

  // 2) Lien YouTube
  if (query.includes('youtube.com') || query.includes('youtu.be')) {
    const valid = await play.validate(query);
    if (!valid) {
      throw new Error('Lien YouTube invalide.');
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

module.exports = { resolveQuery };
