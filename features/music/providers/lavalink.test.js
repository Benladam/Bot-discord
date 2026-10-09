const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLavalinkProvider } = require('./lavalink');
const config = { url: 'https://audio.example.test', password: 'test-secret' };
const ensure = async () => config;

test('Lavalink recherche par titre, canonicalise les candidats et refuse un autre fournisseur', async () => {
  const provider = createLavalinkProvider({ ensure, fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('identifier'), 'ytsearch:Niska - Salé');
    assert.equal(options.headers.Authorization, config.password); assert.equal(options.redirect, 'error');
    return Response.json({ loadType: 'search', data: [
      { info: { title: 'Niska - Salé', author: 'Niska', length: 170000, sourceName: 'youtube', uri: 'https://youtu.be/abcdefghijk?si=private', artworkUrl: 'https://i.ytimg.com/cover.jpg' } },
      { info: { sourceName: 'soundcloud', length: 170000, uri: 'https://youtu.be/123456789ab' } },
    ] });
  } });
  const [track] = await provider.search('Niska - Salé');
  assert.equal(track.url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(track.durationInSec, 170); assert.equal(track.channel.name, 'Niska');
  assert.equal((await provider.search('Niska - Salé')).length, 1);
});

test('Lavalink ouvre uniquement la vidéo exacte et ferme requête et flux au nettoyage', async () => {
  let signal;
  const provider = createLavalinkProvider({ ensure, fetchImpl: async (url, options) => {
    assert.equal(url, `${config.url}/youtube/stream/abcdefghijk`);
    signal = options.signal;
    return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/webm' } });
  } });
  const stream = await provider.stream('https://youtu.be/abcdefghijk?si=private');
  assert.deepEqual(stream.musicSource, { sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk', provider: 'YouTube', extractor: 'lavalink' });
  stream.cleanup(); assert.equal(signal.aborted, true); assert.equal(stream.destroyed, true);
  await assert.rejects(provider.stream('https://example.test/secret'), /YouTube/);
});

test('Lavalink refuse les erreurs JSON sans exposer les URLs signées et ne lit pas un corps de diagnostic comme audio', async () => {
  const provider = createLavalinkProvider({ ensure, fetchImpl: async () => Response.json({ secret: 'private' }, { status: 400 }) });
  await assert.rejects(provider.stream('https://youtu.be/abcdefghijk'), error => {
    assert.equal(error.code, 'LAVALINK_STREAM_FAILED'); assert.doesNotMatch(error.message, /private|test-secret/); return true;
  });
  await assert.rejects(provider.search('https://youtu.be/abcdefghijk'), /invalide/);
});
