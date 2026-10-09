/** Métadonnées Deezer publiques ; aucun cookie de navigateur ni flux premium. */
const HOSTS = new Set(['deezer.com', 'www.deezer.com', 'link.deezer.com', 'dzr.page.link']);

async function request(path, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  const url = new URL(path, 'https://api.deezer.com');
  if (url.origin !== 'https://api.deezer.com' || url.username || url.password) throw new Error('Pagination Deezer invalide.');
  const response = await fetchImpl(url.href, {
    redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`API Deezer indisponible (HTTP ${response.status}).`);
  const data = await response.json();
  if (data?.error) throw new Error('Deezer ne fournit pas ce catalogue public.');
  return data;
}

function normalize(item, type = 'track') {
  return { ...item, type, title: item.title || item.name,
    url: item.link || `https://www.deezer.com/${type}/${item.id}`,
    durationInSec: Number(item.duration) || 0,
    tracksCount: Number(item.nb_tracks) || 0,
  };
}

async function getDeezerEntry(value, options = {}) {
  let url = new URL(value);
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || !HOSTS.has(url.hostname)) throw new Error('Lien Deezer HTTPS invalide.');
    const match = url.pathname.match(/\/(track|album|playlist|artist)\/(\d+)(?:\/|$)/i);
    if (match) return normalize(await request(`/${match[1].toLowerCase()}/${match[2]}`, options), match[1].toLowerCase());
    if (redirects === 4) break;
    const response = await (options.fetchImpl || globalThis.fetch)(url.href, {
      redirect: 'manual', signal: AbortSignal.timeout(options.timeoutMs || 5000),
    });
    const location = response.headers.get('location');
    if (!location || response.status < 300 || response.status >= 400) break;
    url = new URL(location, url);
  }
  throw new Error('Utilise un lien Deezer piste, album ou playlist.');
}

async function getDeezerTracks(value, options = {}) {
  const entry = await getDeezerEntry(value, options);
  if (entry.type === 'track') return [entry];
  if (!['album', 'playlist'].includes(entry.type)) throw new Error('Utilise un lien Deezer piste, album ou playlist.');
  let page = entry.tracks;
  if (!Array.isArray(page?.data)) page = await request(`/${entry.type}/${entry.id}/tracks?limit=100`, options);
  const tracks = [];
  const seen = new Set();
  while (Array.isArray(page?.data) && tracks.length < 100) {
    for (const item of page.data) {
      if (!item?.id || seen.has(item.id)) continue;
      seen.add(item.id);
      tracks.push(normalize({ ...item, artist: item.artist || entry.artist, album: item.album || (entry.type === 'album' ? entry : undefined) }));
      if (tracks.length === 100) break;
    }
    if (!page.next || !page.data.length || tracks.length === 100) break;
    const next = new URL(page.next, 'https://api.deezer.com');
    if (next.hostname === 'api.deezer.com' && next.protocol === 'http:') next.protocol = 'https:';
    if (seen.has(next.href)) break;
    seen.add(next.href);
    page = await request(next.href, options);
  }
  return tracks;
}

async function searchDeezer(query, { type = 'track', limit = 10, ...options } = {}) {
  if (!['track', 'album', 'playlist'].includes(type)) throw new Error('Type de recherche Deezer invalide.');
  const url = new URL(`/search/${type}`, 'https://api.deezer.com');
  url.searchParams.set('q', String(query).trim().slice(0, 200));
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, Number(limit) || 10))));
  const data = await request(url.href, options);
  return (Array.isArray(data.data) ? data.data : []).map(item => normalize(item, type));
}

module.exports = { getDeezerEntry, getDeezerTracks, searchDeezer };
