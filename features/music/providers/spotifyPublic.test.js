const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getPublicPlaylist, parsePublicPlaylist } = require('./spotifyPublic');
const html = (id, tracks) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { uri: `spotify:playlist:${id}`, trackList: tracks } } } } } })}</script>`;

test('l’aperçu officiel conserve l’ordre, les titres, les durées et ignore les extraits audio', async () => {
  const result = await getPublicPlaylist('playlist123', async (url, options) => {
    assert.equal(url, 'https://open.spotify.com/embed/playlist/playlist123');
    assert.equal(options.headers.Authorization, undefined); assert.ok(options.signal);
    return new Response(html('playlist123', [
      { uri: 'spotify:track:first', title: 'Premier', subtitle: 'Artiste', duration: 222000, audioPreview: { url: 'https://p.scdn.co/30secondes' } },
      { uri: 'spotify:episode:podcast', title: 'Podcast', subtitle: 'Hôte' },
      { uri: 'spotify:track:second', title: 'Second', subtitle: 'Autre artiste', duration: 164000 },
    ]));
  });
  assert.deepEqual(result.map(track => track.id), ['first', 'second']);
  assert.equal(result[0].duration_ms, 222000); assert.equal(result[0].audioPreview, undefined);
});

test('une autre playlist ou une playlist privée ne devient pas un faux résultat', () => {
  assert.throws(() => parsePublicPlaylist(html('wrong', []), 'requested'), /ne correspond pas/);
  assert.throws(() => parsePublicPlaylist(html('requested', []), 'requested'), /Aucun titre public/);
  assert.throws(() => parsePublicPlaylist('<html>Login</html>', 'requested'), /ne publie pas/);
});
