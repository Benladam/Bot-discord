const { test } = require('node:test');
const assert = require('node:assert/strict');
const { musicArtwork } = require('./artwork');

test('les pochettes Spotify, Deezer, SoundCloud et YouTube survivent aux différents formats', () => {
  assert.equal(musicArtwork({ album: { images: [{ url: 'https://images.example/spotify.jpg' }] } }), 'https://images.example/spotify.jpg');
  assert.equal(musicArtwork({ album: { cover_big: 'https://images.example/deezer.jpg' } }), 'https://images.example/deezer.jpg');
  assert.equal(musicArtwork({ artwork_url: 'https://images.example/soundcloud.jpg' }), 'https://images.example/soundcloud.jpg');
  assert.equal(musicArtwork({ thumbnail: { url: 'https://images.example/video.jpg' } }), 'https://images.example/video.jpg');
  assert.equal(musicArtwork({ url: 'https://youtu.be/v2o3in-Aud0' }), 'https://i.ytimg.com/vi/v2o3in-Aud0/hqdefault.jpg');
  assert.equal(musicArtwork({ thumbnail: 'https://images.example/album.jpg', url: 'https://youtu.be/v2o3in-Aud0' }), 'https://images.example/album.jpg');
});

test('pas de faux clip ni d’URL de pochette non sûre', () => {
  assert.equal(musicArtwork({ thumbnail: 'file:///private.txt', url: 'https://evil.example/watch?v=v2o3in-Aud0' }), null);
  assert.equal(musicArtwork({ thumbnail: 'https://secret:password@example.com/image.jpg', images: {}, album: { images: {} } }), null);
});
