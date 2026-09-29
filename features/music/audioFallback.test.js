const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { prepareInput } = require('./audioSender');

test('bascule de YouTube vers SoundCloud si l’extraction YouTube échoue', async () => {
  const soundCloudStream = new PassThrough();
  let searchedQuery = '';
  const media = await prepareInput('https://www.youtube.com/watch?v=track', 'Niska - Chasse à l’homme', {
    getYouTubeStream: async () => { throw new Error('HTTP 503'); },
    searchSoundCloudStream: async (query) => { searchedQuery = query; return soundCloudStream; },
  });

  assert.equal(searchedQuery, 'Niska - Chasse à l’homme');
  assert.equal(media.stream, soundCloudStream);
  assert.equal(media.fallback, true);
  assert.equal(media.fallbackProvider, 'SoundCloud');
  soundCloudStream.destroy();
});

test('bascule d’un lien SoundCloud vers YouTube avec la recherche de titre', async () => {
  let searchedQuery = '';
  const media = await prepareInput('https://soundcloud.com/artist/track', 'Artist - Track', {
    getSoundCloudStream: async () => { throw new Error('Flux SoundCloud indisponible'); },
    searchYouTubeStream: async (query) => { searchedQuery = query; return 'https://audio.example/stream'; },
  });

  assert.equal(searchedQuery, 'Artist - Track');
  assert.equal(media.url, 'https://audio.example/stream');
  assert.equal(media.fallback, true);
  assert.equal(media.fallbackProvider, 'YouTube');
});

test('explique les deux échecs et les réglages serveur manquants', async () => {
  await assert.rejects(prepareInput('https://youtu.be/track', 'Artist - Track', {
    getYouTubeStream: async () => { throw new Error('YouTube bloqué'); },
    searchSoundCloudStream: async () => { throw new Error('SOUNDCLOUD_CLIENT_ID manquant'); },
  }), (error) => {
    assert.equal(error.code, 'MUSIC_PROVIDERS_FAILED');
    assert.match(error.message, /YouTube bloqué/);
    assert.match(error.message, /SOUNDCLOUD_CLIENT_ID/);
    assert.match(error.message, /YOUTUBE_COOKIES_PATH/);
    return true;
  });
});

test('ne lance pas une recherche de repli sans métadonnées de requête', async () => {
  let attemptedSoundCloud = false;
  await assert.rejects(prepareInput('https://youtu.be/track', '', {
    getYouTubeStream: async () => { throw new Error('YouTube indisponible'); },
    searchSoundCloudStream: async () => { attemptedSoundCloud = true; return new PassThrough(); },
  }), /YouTube indisponible/);
  assert.equal(attemptedSoundCloud, false);
});
