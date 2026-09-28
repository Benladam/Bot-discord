const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveQuery, youtubeVideoId } = require('../utils/resolve');

test('un lien YouTube direct ne déclenche pas la requête play-dl de métadonnées', async () => {
  const url = 'https://www.youtube.com/watch?v=abc123';
  assert.equal(youtubeVideoId(url), 'abc123');
  assert.deepEqual(await resolveQuery(url), [{
    title: 'YouTube · abc123',
    url,
    duration: 0,
    thumbnail: null,
    source: 'youtube',
  }]);
});
