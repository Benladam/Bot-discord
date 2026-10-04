/** Métadonnées de l'embed public officiel, jamais ses extraits audio. */
function parsePublicPlaylist(html, playlistId) {
  const script = String(html).match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('Spotify ne publie pas les titres de cette playlist dans son aperçu.');
  const entity = JSON.parse(script[1]).props?.pageProps?.state?.data?.entity;
  if (entity?.uri !== `spotify:playlist:${playlistId}`) throw new Error('L’aperçu Spotify ne correspond pas à la playlist demandée.');
  const tracks = (Array.isArray(entity.trackList) ? entity.trackList : []).flatMap(item => {
    const id = String(item?.uri || '').match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1];
    if (!id || !item.title || !item.subtitle) return [];
    return [{ id, name: item.title, artists: [{ name: item.subtitle }], duration_ms: Number(item.duration) || 0,
      external_urls: { spotify: `https://open.spotify.com/track/${id}` } }];
  }).slice(0, 100);
  if (!tracks.length) throw new Error('Aucun titre public accessible pour cette playlist Spotify.');
  return tracks;
}

async function getPublicPlaylist(playlistId, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(`https://open.spotify.com/embed/playlist/${encodeURIComponent(playlistId)}`, {
    headers: { accept: 'text/html' }, signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Aperçu Spotify indisponible (HTTP ${response.status}).`);
  const html = await response.text();
  if (html.length > 2_000_000) throw new Error('Aperçu Spotify trop volumineux.');
  return parsePublicPlaylist(html, playlistId);
}

module.exports = { getPublicPlaylist, parsePublicPlaylist };
