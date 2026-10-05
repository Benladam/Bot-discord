function songIdentity(song) {
  const text = String(song?.fallbackQuery || song?.title || '').trim();
  const parts = text.split(/\s+[-–—]\s+/u);
  const parsedArtist = parts.length > 1 ? parts.shift() : '';
  const artist = String(song?.artist?.name || song?.artist || parsedArtist).trim();
  const title = parts.join(' - ').replace(/\[(?:clip|official|officiel|audio|lyrics|video)[^\]]*\]/gi, '').trim();
  if (!artist || !title || artist.length > 200 || title.length > 200) throw new Error('Indique Artiste - Titre pour trouver les paroles exactes.');
  return { artist, title };
}
function normalized(text) { return String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
async function getLyrics(identity, { fetchImpl = globalThis.fetch } = {}) {
  const url = new URL('https://lrclib.net/api/get');
  url.searchParams.set('artist_name', identity.artist); url.searchParams.set('track_name', identity.title);
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Bot-discord/2.0 (open-source lyrics lookup)' } });
  if (!response.ok) throw new Error(response.status === 404 ? 'Aucune parole disponible pour ce titre.' : 'Service de paroles temporairement indisponible.');
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 96_000) throw new Error('Réponse de paroles trop volumineuse.');
    chunks.push(Buffer.from(chunk));
  }
  const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (normalized(result.artistName) !== normalized(identity.artist) || normalized(result.trackName) !== normalized(identity.title)) throw new Error('Le service a renvoyé un autre morceau; paroles non affichées.');
  if (result.instrumental) return 'Ce morceau est instrumental.';
  const lyrics = String(result.plainLyrics || '').trim();
  if (!lyrics) throw new Error('Aucune parole disponible pour ce titre.');
  return lyrics.slice(0, 20_000);
}
module.exports = { songIdentity, getLyrics };
