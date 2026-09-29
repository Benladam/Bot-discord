const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { prepareInput, soundCloudStream, buildYtDlpArgs } = require('./audioSender');

test('yt-dlp refuse les formats preview SoundCloud pour les deux modes de lecture', () => {
  for (const outputToStdout of [false, true]) {
    const args = buildYtDlpArgs([], 'https://soundcloud.com/artist/track', { outputToStdout });
    assert.equal(args[args.indexOf('-f') + 1], 'bestaudio[format_id!*=preview]/best[format_id!*=preview]');
  }
  const youtubeArgs = buildYtDlpArgs([], 'https://youtu.be/track', { cookiesPath: '' });
  assert.equal(youtubeArgs[youtubeArgs.indexOf('-f') + 1], 'bestaudio/best');
});

test('le repli play-dl exclut les previews même quand SoundCloud annonce une durée complète', async () => {
  const stream = new PassThrough();
  const complete = { url: 'https://api.soundcloud.com/full', duration: 181_000, format: { protocol: 'hls' } };
  let receivedFormats;
  const selected = await soundCloudStream('https://soundcloud.com/artist/track', {
    getYtDlpStream: async () => { throw new Error('yt-dlp indisponible'); },
    isConfigured: () => true,
    getTrack: async () => ({ type: 'track', durationInSec: 181, formats: [
      { url: 'https://api.soundcloud.com/a', snipped: true, duration: 181_000, format: { protocol: 'hls' } },
      { url: 'https://api.soundcloud.com/preview/track', duration: 181_000, format: { protocol: 'hls' } },
      { url: 'https://api.soundcloud.com/b', duration: 30_000, format: { protocol: 'hls' } },
      complete,
    ] }),
    streamFromInfo: async (track) => { receivedFormats = track.formats; return { stream }; },
  });
  assert.equal(selected, stream);
  assert.deepEqual(receivedFormats, [complete]);
  stream.destroy();
});

test('le repli play-dl refuse une piste dont tous les transcodages sont des extraits', async () => {
  let opened = false;
  await assert.rejects(soundCloudStream('https://soundcloud.com/artist/track', {
    getYtDlpStream: async () => { throw new Error('yt-dlp indisponible'); },
    isConfigured: () => true,
    getTrack: async () => ({ type: 'track', durationInSec: 181, formats: [
      { url: 'https://api.soundcloud.com/playlist/0/30/audio', format: { protocol: 'hls' } },
    ] }),
    streamFromInfo: async () => { opened = true; return { stream: new PassThrough() }; },
  }), (error) => error.code === 'SOUNDCLOUD_PREVIEW_ONLY');
  assert.equal(opened, false);
});

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
