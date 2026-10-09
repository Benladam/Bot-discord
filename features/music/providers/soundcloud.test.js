const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchSoundCloud, getSoundCloudTrack, streamSoundCloudInfo } = require('./soundcloud');
const env = { SOUNDCLOUD_CLIENT_ID: 'fake-client-for-tests' };

test('SoundCloud HTTP normalise les millisecondes avant comparaison et ne transmet aucun cookie', async () => {
  const [track] = await searchSoundCloud('Niska Salé', { env, fetchImpl: async (value, options) => {
    const url = new URL(value); assert.equal(url.hostname, 'api-v2.soundcloud.com');
    assert.equal(url.searchParams.get('client_id'), env.SOUNDCLOUD_CLIENT_ID);
    assert.deepEqual(options.headers, { accept: 'application/json' });
    assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ collection: [{ title: 'Salé', duration: 170000, permalink_url: 'https://soundcloud.com/niska/sale', user: { username: 'Niska' } }] }));
  } });
  assert.equal(track.durationInSec, 170); assert.equal(track.duration, 170);
  assert.equal(track.permalink, 'https://soundcloud.com/niska/sale');
});

test('SoundCloud résout une piste et sélectionne une URL média complète', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return new Response(JSON.stringify(calls.length === 1 ? {
      kind: 'track', title: 'Titre', duration: 181000, permalink_url: 'https://soundcloud.com/artist/track',
      media: { transcodings: [{ url: 'https://api-v2.soundcloud.com/media/complete', format: { protocol: 'hls' } }] },
    } : { url: 'https://cf-hls-media.sndcdn.com/full/audio.m3u8' }));
  };
  const track = await getSoundCloudTrack('https://soundcloud.com/artist/track', { env, fetchImpl });
  const media = await streamSoundCloudInfo(track, { env, fetchImpl });
  assert.equal(media.url, 'https://cf-hls-media.sndcdn.com/full/audio.m3u8');
});

test('SoundCloud refuse previews et redirections média arbitraires', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return new Response(JSON.stringify({ url: 'https://127.0.0.1/audio' })); };
  await assert.rejects(streamSoundCloudInfo({ formats: [{ snipped: true, url: 'https://api-v2.soundcloud.com/media/a' }] }, { env, fetchImpl }), error => error.code === 'SOUNDCLOUD_PREVIEW_ONLY');
  assert.equal(calls, 0);
  await assert.rejects(streamSoundCloudInfo({ formats: [{ url: 'https://api-v2.soundcloud.com/media/a' }] }, { env, fetchImpl }), /invalide/);
});

test('SoundCloud sans clé échoue sans révéler une réponse ou envoyer une requête', async () => {
  await assert.rejects(searchSoundCloud('Niska', { env: {}, fetchImpl: async () => assert.fail('aucune requête') }), /SOUNDCLOUD_CLIENT_ID/);
});
