const { test } = require('node:test');
const assert = require('node:assert/strict');
const SpotifyWebApi = require('spotify-web-api-node');

test('un échec de recherche yt-dlp retombe sur la recherche YouTube play-dl', async () => {
  const { searchYouTube } = require('./spotify');
  const result = await searchYouTube('Artiste - Titre', {
    searchYtDlp: async () => { throw new Error('PyInstaller extraction failed'); },
    searchPlayDl: async (query, options) => {
      assert.equal(query, 'Artiste - Titre');
      assert.deepEqual(options, { limit: 3, source: { youtube: 'video' } });
      return [{
        title: 'Titre officiel',
        url: 'https://www.youtube.com/watch?v=abc1234',
        durationInSec: 181,
        thumbnails: [{ url: 'https://i.ytimg.com/vi/abc1234/default.jpg' }],
      }];
    },
  });
  assert.equal(result.title, 'Titre officiel');
  assert.equal(result.url, 'https://www.youtube.com/watch?v=abc1234');
  assert.equal(result.duration, 181);
  assert.equal(result.fallbackQuery, 'Artiste - Titre');
});

test('la recherche Spotify ignore les URL vidéo retournées par des domaines inattendus', async () => {
  const { searchYouTube } = require('./spotify');
  const result = await searchYouTube('Artiste - Titre', {
    searchYtDlp: async () => [],
    searchPlayDl: async () => [{ title: 'Titre', url: 'https://example.com/audio' }],
  });
  assert.equal(result, null);
});

test('les playlists Spotify utilisent /items et expliquent les accès refusés', async () => {
  const oldFetch = global.fetch;
  const oldGrant = SpotifyWebApi.prototype.clientCredentialsGrant;
  const oldClientId = process.env.SPOTIFY_CLIENT_ID;
  const oldClientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  let requestedUrl = '';

  process.env.SPOTIFY_CLIENT_ID = 'test-client';
  process.env.SPOTIFY_CLIENT_SECRET = 'test-secret';
  SpotifyWebApi.prototype.clientCredentialsGrant = async function grant() {
    return { body: { access_token: 'test-token', expires_in: 3600 } };
  };
  global.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      items: [], next: null,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const { resolveSpotifyLink } = require('./spotify');
    await assert.rejects(
      resolveSpotifyLink('https://open.spotify.com/playlist/testplaylist'),
      /Aucune musique correspondante/,
    );
    assert.match(requestedUrl, /\/playlists\/testplaylist\/items\?/);

    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
      status: 403, headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(
      resolveSpotifyLink('https://open.spotify.com/playlist/otherplaylist'),
      /propriétaire ou un collaborateur/,
    );
  } finally {
    global.fetch = oldFetch;
    SpotifyWebApi.prototype.clientCredentialsGrant = oldGrant;
    if (oldClientId === undefined) delete process.env.SPOTIFY_CLIENT_ID;
    else process.env.SPOTIFY_CLIENT_ID = oldClientId;
    if (oldClientSecret === undefined) delete process.env.SPOTIFY_CLIENT_SECRET;
    else process.env.SPOTIFY_CLIENT_SECRET = oldClientSecret;
  }
});
