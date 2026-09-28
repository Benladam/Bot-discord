const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveQuery, youtubeVideoId, normalizeSoundCloudTrack } = require('../utils/resolve');

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

test('les pistes SoundCloud conservent artiste et titre pour un repli YouTube', () => {
  const song = normalizeSoundCloudTrack({
    name: 'Track',
    permalink: 'https://soundcloud.com/artist/track',
    durationInSec: 180,
    user: { username: 'Artist' },
  });
  assert.equal(song.source, 'soundcloud');
  assert.equal(song.fallbackQuery, 'Artist - Track');
});
