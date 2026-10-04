const { test } = require('node:test');
const assert = require('node:assert/strict');
const SpotifyWebApi = require('spotify-web-api-node');
const snapshotEnvironment = () => Object.fromEntries(
  ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REFRESH_TOKEN'].map(key => [key, process.env[key]]),
);

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

test('un HTTP 401 renouvelle une seule fois le jeton et importe la playlist sans recherches audio anticipées', async t => {
  const oldFetch = global.fetch, oldGrant = SpotifyWebApi.prototype.clientCredentialsGrant;
  const env = snapshotEnvironment();
  t.after(() => { global.fetch = oldFetch; SpotifyWebApi.prototype.clientCredentialsGrant = oldGrant;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  process.env.SPOTIFY_CLIENT_ID = 'retry-test-client'; process.env.SPOTIFY_CLIENT_SECRET = 'retry-secret'; delete process.env.SPOTIFY_REFRESH_TOKEN;
  let grants = 0, requests = 0;
  SpotifyWebApi.prototype.clientCredentialsGrant = async () => ({ body: { access_token: `token-${++grants}`, expires_in: 3600 } });
  global.fetch = async (url, options) => {
    requests++; assert.equal(new URL(url).searchParams.get('limit'), '50'); assert.ok(options.signal);
    assert.equal(options.headers.Authorization, `Bearer token-${requests}`);
    if (requests === 1) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ items: [{ item: { id: 'song123', name: 'Je suis love', duration_ms: 222000,
      artists: [{ name: 'Jul' }], type: 'track' } }], next: null }));
  };
  const songs = await require('./spotify').resolveSpotifyLink('https://open.spotify.com/playlist/testretry');
  assert.equal(grants, 2); assert.equal(requests, 2); assert.equal(songs[0].requiresSearch, true);
  assert.equal(songs[0].duration, 222); assert.equal(songs[0].fallbackQuery, 'Jul - Je suis love');
});

test('Spotify sans identifiants importe l’aperçu public et signale qu’il peut être partiel', async t => {
  const oldFetch = global.fetch;
  const env = snapshotEnvironment();
  t.after(() => { global.fetch = oldFetch; for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  delete process.env.SPOTIFY_CLIENT_ID; delete process.env.SPOTIFY_CLIENT_SECRET;
  global.fetch = async url => {
    assert.equal(url, 'https://open.spotify.com/embed/playlist/public123');
    const data = { props: { pageProps: { state: { data: { entity: { uri: 'spotify:playlist:public123', trackList: [
      { uri: 'spotify:track:song1', title: 'Premier', subtitle: 'Artiste', duration: 164000 },
      { uri: 'spotify:track:song2', title: 'Second', subtitle: 'Artiste', duration: 222000 },
    ] } } } } } };
    return new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
  };
  const songs = await require('./spotify').resolveSpotifyLink('https://open.spotify.com/playlist/public123?si=ignored');
  assert.deepEqual(songs.map(song => song.title), ['Premier - Artiste', 'Second - Artiste']);
  assert.match(songs[0].playlistNotice, /pas nécessairement la playlist complète/);
});

test('l’OAuth utilisateur et le jeton application ont des caches indépendants', async t => {
  const oldGrant = SpotifyWebApi.prototype.clientCredentialsGrant, oldRefresh = SpotifyWebApi.prototype.refreshAccessToken;
  const env = snapshotEnvironment();
  t.after(() => { SpotifyWebApi.prototype.clientCredentialsGrant = oldGrant; SpotifyWebApi.prototype.refreshAccessToken = oldRefresh;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  process.env.SPOTIFY_CLIENT_ID = 'oauth-test'; process.env.SPOTIFY_CLIENT_SECRET = 'secret'; process.env.SPOTIFY_REFRESH_TOKEN = 'fake-refresh';
  let refreshes = 0, grants = 0;
  SpotifyWebApi.prototype.clientCredentialsGrant = async () => { grants++; return { body: { access_token: 'app-token', expires_in: 3600 } }; };
  SpotifyWebApi.prototype.refreshAccessToken = async function () { assert.equal(this.getRefreshToken(), 'fake-refresh'); refreshes++; return { body: { access_token: 'user-token', expires_in: 3600 } }; };
  const { getSpotifyApi } = require('./spotify');
  const [app, user] = await Promise.all([getSpotifyApi(), getSpotifyApi({ userAccess: true })]);
  assert.equal(app.getAccessToken(), 'app-token'); assert.equal(user.getAccessToken(), 'user-token');
  await getSpotifyApi({ userAccess: true }); assert.equal(refreshes, 1); assert.equal(grants, 1);
});

test('un 401 persistant ou 403 utilise l’aperçu public sans boucle de renouvellement', async t => {
  const oldFetch = global.fetch, oldGrant = SpotifyWebApi.prototype.clientCredentialsGrant;
  const env = snapshotEnvironment();
  t.after(() => { global.fetch = oldFetch; SpotifyWebApi.prototype.clientCredentialsGrant = oldGrant;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  process.env.SPOTIFY_CLIENT_SECRET = 'fake-secret'; delete process.env.SPOTIFY_REFRESH_TOKEN;
  for (const status of [401, 403]) {
    process.env.SPOTIFY_CLIENT_ID = `public-fallback-${status}`;
    let apiCalls = 0, publicCalls = 0, grants = 0;
    SpotifyWebApi.prototype.clientCredentialsGrant = async () => { grants++; return { body: { access_token: 'fake-token', expires_in: 3600 } }; };
    global.fetch = async (url, options) => {
      if (String(url).startsWith('https://api.spotify.com/')) { apiCalls++; return new Response('{}', { status }); }
      publicCalls++; assert.equal(options.headers.Authorization, undefined);
      const data = { props: { pageProps: { state: { data: { entity: { uri: 'spotify:playlist:public123', trackList: [
        { uri: 'spotify:track:song1', title: 'Titre', subtitle: 'Artiste', duration: 180000 },
      ] } } } } } };
      return new Response(`<script id="__NEXT_DATA__">${JSON.stringify(data)}</script>`);
    };
    const songs = await require('./spotify').resolveSpotifyLink('https://open.spotify.com/playlist/public123');
    assert.equal(songs[0].title, 'Titre - Artiste');
    assert.equal(publicCalls, 1); assert.equal(apiCalls, status === 401 ? 2 : 1); assert.equal(grants, status === 401 ? 2 : 1);
  }
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
