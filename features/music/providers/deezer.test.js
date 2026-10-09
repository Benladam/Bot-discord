const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDeezerTracks, getDeezerEntry, searchDeezer } = require('./deezer');

test('Deezer HTTP conserve durée, pochette et artiste sans cookies', async () => {
  const tracks = await getDeezerTracks('https://www.deezer.com/fr/track/123?utm_source=private', {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.deezer.com/track/123');
      assert.deepEqual(options.headers, { accept: 'application/json' });
      return new Response(JSON.stringify({ id: 123, title: 'Salé', duration: 170, artist: { name: 'Niska' }, album: { cover_xl: 'https://cdn.test/cover.jpg' } }));
    },
  });
  assert.equal(tracks[0].durationInSec, 170);
  assert.equal(tracks[0].artist.name, 'Niska');
  assert.equal(tracks[0].album.cover_xl, 'https://cdn.test/cover.jpg');
});

test('playlist Deezer paginée garde l’ordre et les crédits artiste', async () => {
  const requests = [];
  const tracks = await getDeezerTracks('https://deezer.com/playlist/123', { fetchImpl: async url => {
    requests.push(url);
    return new Response(JSON.stringify(requests.length === 1
      ? { id: 123, title: 'Playlist', tracks: { data: [{ id: 1, title: 'Premier', duration: 180 }], next: 'http://api.deezer.com/playlist/123/tracks?index=1' } }
      : { data: [{ id: 2, title: 'Second', artist: { name: 'Artiste' } }] }));
  } });
  assert.deepEqual(tracks.map(track => track.title), ['Premier', 'Second']);
  assert.equal(requests[1], 'https://api.deezer.com/playlist/123/tracks?index=1');
});

test('liens courts Deezer refusent une redirection vers un hôte arbitraire', async () => {
  let calls = 0;
  await assert.rejects(getDeezerEntry('https://link.deezer.com/short', { fetchImpl: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
  } }), /invalide/);
  assert.equal(calls, 1);
});

test('recherche Deezer borne la limite et traite les erreurs API', async () => {
  const items = await searchDeezer('Niska & Dinaz', { type: 'album', limit: 999, fetchImpl: async value => {
    const url = new URL(value); assert.equal(url.pathname, '/search/album');
    assert.equal(url.searchParams.get('q'), 'Niska & Dinaz'); assert.equal(url.searchParams.get('limit'), '25');
    return new Response(JSON.stringify({ data: [{ id: 1, title: 'Album', nb_tracks: 12 }] }));
  } });
  assert.equal(items[0].url, 'https://www.deezer.com/album/1');
  await assert.rejects(searchDeezer('Niska', { fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'private' } })) }), /catalogue public/);
});
