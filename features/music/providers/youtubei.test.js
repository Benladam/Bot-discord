const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { canonicalYouTubeUrl, createYoutubeiProvider, summarizeProviderError } = require('./youtubei');

test('normalise les liens YouTube vers une vidéo canonique et refuse les autres hôtes', () => {
  assert.equal(canonicalYouTubeUrl('https://youtu.be/abcdefghijk?si=private'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(canonicalYouTubeUrl('https://youtube-nocookie.com/embed/abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.throws(() => canonicalYouTubeUrl('https://example.com/watch?v=abcdefghijk'), /YouTube/);
  assert.throws(() => canonicalYouTubeUrl('http://youtube.com/watch?v=abcdefghijk'), /HTTPS/);
});

test('adapte la recherche YouTubei et n’expose que les champs utiles au catalogue', async () => {
  const calls = [];
  const provider = createYoutubeiProvider({ loadRuntime: async () => ({
    searchType: 'youtubeSearch',
    extractor: { handle: async (query, context) => {
      calls.push({ query, context });
      return { tracks: [
        { title: 'Niska - Chasse à l’homme', url: 'https://youtu.be/abcdefghijk', durationMS: 181_000, thumbnail: 'https://i.ytimg.com/cover.jpg', author: 'Niska' },
        { title: 'invalid host', url: 'https://example.com/watch?v=abcdefghijk', duration: '03:01' },
      ] };
    }, stream: async () => new PassThrough() },
  }) });
  const results = await provider.search('Niska - Chasse à l’homme', { limit: 3 });
  assert.deepEqual(calls, [{ query: 'Niska - Chasse à l’homme', context: { type: 'youtubeSearch', requestedBy: null } }]);
  assert.deepEqual(results, [{
    title: 'Niska - Chasse à l’homme', kind: 'track',
    url: 'https://www.youtube.com/watch?v=abcdefghijk', durationInSec: 181, duration: 181,
    thumbnail: 'https://i.ytimg.com/cover.jpg', channel: { name: 'Niska' },
  }]);
});

test('ouvre un flux YouTubei canonique et marque sa provenance', async () => {
  let requested;
  const stream = new PassThrough();
  const provider = createYoutubeiProvider({ loadRuntime: async () => ({
    searchType: 'search',
    extractor: { handle: async () => ({ tracks: [] }), stream: async track => { requested = track; return stream; } },
  }) });
  assert.equal(await provider.stream('https://youtube.com/shorts/abcdefghijk'), stream);
  assert.deepEqual(requested, { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: '', live: false });
  assert.deepEqual(stream.musicSource, { sourceUrl: requested.url, provider: 'YouTube' });
  stream.destroy();
});

test('conserve une cause expurgée lorsque le fournisseur ne renvoie aucun flux', async () => {
  const provider = createYoutubeiProvider({ loadRuntime: async () => ({
    searchType: 'search',
    clearStreamError() {},
    getStreamError: () => ({ name: 'Error', code: 'STREAM_DENIED', message: 'blocked https://example.test/?token=private' }),
    extractor: { handle: async () => ({ tracks: [] }), stream: async () => undefined },
  }) });
  await assert.rejects(provider.stream('https://youtube.com/watch?v=abcdefghijk'), error => {
    assert.equal(error.code, 'YOUTUBEI_NO_STREAM');
    assert.deepEqual(error.providerReason, {
      name: 'Error', code: 'STREAM_DENIED', message: 'blocked https://example.test/?token=private',
    });
    return true;
  });
});

test('expurge les URL et valeurs de secrets du diagnostic de la bibliothèque', () => {
  assert.deepEqual(summarizeProviderError(Object.assign(new Error('blocked https://example.test/?token=private cookie=abc123'), { code: 'STREAM_DENIED' })), {
    name: 'Error', code: 'STREAM_DENIED', message: 'blocked [URL] cookie=[redacted]',
  });
});
