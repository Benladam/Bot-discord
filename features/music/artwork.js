/** Conserve la pochette du catalogue ; à défaut, miniature du clip réellement résolu. */
function safeArtwork(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : value?.url);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch (_) { /* métadonnée absente ou invalide */ }
  return null;
}

function musicArtwork(song = {}) {
  const candidates = [song.thumbnail, song.artwork_url, song.thumbnail_url,
    song.album?.cover?.xl, song.album?.cover?.big, song.album?.cover?.medium,
    song.album?.cover_xl, song.album?.cover_big, song.album?.cover_medium,
    ...(Array.isArray(song.album?.images) ? song.album.images : []),
    ...(Array.isArray(song.images) ? song.images : []),
    ...(Array.isArray(song.thumbnails) ? song.thumbnails : [])];
  for (const value of candidates) {
    const url = safeArtwork(value);
    if (url) return url;
  }
  for (const value of [song.sourceUrl, song.url]) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const id = host === 'youtu.be' ? url.pathname.slice(1)
        : ['youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)
          ? url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)$/)?.[1] : null;
      if (/^[A-Za-z0-9_-]{11}$/.test(id || '')) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    } catch (_) { /* lien non YouTube */ }
  }
  return null;
}

module.exports = { musicArtwork, safeArtwork };
