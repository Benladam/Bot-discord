'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createWebPanel, getWebPanelPublicUrl } = require('./server');

const ADMIN_TOKEN = 'c'.repeat(64);
const GUILD_A = '123456789012345678';
const GUILD_B = '223456789012345678';

async function createTestPanel(overrides = {}) {
  const guilds = [
    { id: GUILD_A, name: 'Serveur Alpha' },
    { id: GUILD_B, name: 'Serveur Beta' },
  ];
  const guildMap = new Map(guilds.map((guild) => [guild.id, guild]));
  const settings = new Map();
  const players = new Map(guilds.map((guild) => [guild.id, {
    connection: { connected: true, channelId: `voice-${guild.id}` },
    voiceChannelName: 'Général',
    current: { title: `Titre ${guild.name}`, url: 'https://secret.example/audio', duration: 180, source: 'youtube' },
    queue: [
      { title: `Suivant ${guild.name}`, url: 'https://secret.example/queued', duration: 120 },
      { title: `Encore ${guild.name}`, url: 'https://secret.example/queued-2', duration: 90 },
    ],
    isPlaying: true,
    isPaused: false,
    volume: 1,
    loopMode: 0,
    pause: async function pause() { this.isPaused = true; },
    resume: async function resume() { this.isPaused = false; },
    skip: async function skip() { this.current = null; this.isPlaying = false; },
    stop: async function stop() { this.current = null; this.queue = []; this.isPlaying = false; },
    shuffleQueue() { this.queue.reverse(); this.shuffled = true; },
    setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value) || 0)); },
    destroy() { this.connection = null; },
    _clearIdleTimer() { this.idleCleared = true; },
    _clearAloneTimer() { this.aloneCleared = true; },
    _scheduleIdleLeave() { this.idleScheduled = true; },
    _scheduleAloneLeave() { this.aloneScheduled = true; },
  }]));
  const logger = { info() {}, warn() {}, error() {} };
  const panel = createWebPanel({
    env: {
      WEB_ADMIN_TOKEN: ADMIN_TOKEN,
      WEB_PUBLIC_URL: 'https://music.example/panel',
      WEB_COOKIE_SECURE: 'true',
      ...overrides,
    },
    client: {
      isReady: () => true,
      guilds: { cache: { get: (id) => guildMap.get(id), values: () => guildMap.values() } },
    },
    getPlayer: (guildId) => players.get(guildId),
    database: {
      getGuildSetting: (guildId, key, fallback) => settings.get(`${guildId}:${key}`) ?? fallback,
      setGuildSetting: (guildId, key, value) => settings.set(`${guildId}:${key}`, value),
    },
    logger,
  });
  const server = http.createServer((request, response) => { void panel.handleHttp(request, response); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    panel,
    server,
    players,
    settings,
    origin: `http://127.0.0.1:${address.port}`,
    publicOrigin: 'https://music.example',
    close: async () => {
      panel.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test('le panneau web exige un jeton fort et une URL HTTPS publique correcte', () => {
  assert.equal(createWebPanel({ env: { WEB_ADMIN_TOKEN: 'short' } }).enabled, false);
  assert.equal(getWebPanelPublicUrl({ WEB_PUBLIC_URL: 'https://music.example/panel' }), 'https://music.example/panel/');
  assert.equal(getWebPanelPublicUrl({ WEB_PUBLIC_URL: 'https://user:pass@music.example' }), null);
  assert.equal(getWebPanelPublicUrl({ WEB_PUBLIC_URL: 'javascript:alert(1)' }), null);
  assert.equal(getWebPanelPublicUrl({ WEB_PUBLIC_URL: 'http://music.example' }), null);
  assert.equal(getWebPanelPublicUrl({ WEB_PUBLIC_URL: 'http://localhost:7777' }), 'http://localhost:7777/');
});

test('le panneau authentifie les sessions, protège les actions CSRF et isole les serveurs', async (t) => {
  const app = await createTestPanel();
  t.after(app.close);
  const base = `${app.origin}/panel`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/panel\/app\.js/);

  const unauthorized = await fetch(`${base}/api/status`);
  assert.equal(unauthorized.status, 401);

  const rejectedOrigin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  assert.equal(rejectedOrigin.status, 403);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: app.publicOrigin },
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  assert.equal(login.status, 200);
  const loginData = await login.json();
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\/panel/);
  const sessionCookie = cookie.split(';', 1)[0];

  const status = await fetch(`${base}/api/status`, { headers: { cookie: sessionCookie } });
  const statusData = await status.json();
  assert.equal(status.status, 200);
  assert.deepEqual(statusData.guilds.map(({ id }) => id), [GUILD_A, GUILD_B]);

  const firstStateResponse = await fetch(`${base}/api/guilds/${GUILD_A}/music`, { headers: { cookie: sessionCookie } });
  const firstState = await firstStateResponse.json();
  assert.equal(firstState.guild.name, 'Serveur Alpha');
  assert.equal(firstState.current.title, 'Titre Serveur Alpha');
  assert.equal(firstState.queue[0].title, 'Suivant Serveur Alpha');
  assert.doesNotMatch(JSON.stringify(firstState), /secret\.example/);

  const noCsrf = await fetch(`${base}/api/guilds/${GUILD_A}/music/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: sessionCookie, origin: app.publicOrigin },
    body: JSON.stringify({ action: 'toggle-24-7' }),
  });
  assert.equal(noCsrf.status, 403);

  const badBody = await fetch(`${base}/api/guilds/${GUILD_A}/music/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie, origin: app.publicOrigin,
      'x-csrf-token': loginData.csrfToken,
    },
    body: JSON.stringify({ action: 'toggle-24-7', guildId: GUILD_B }),
  });
  assert.equal(badBody.status, 400);

  const toggle = await fetch(`${base}/api/guilds/${GUILD_A}/music/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie, origin: app.publicOrigin,
      'x-csrf-token': loginData.csrfToken,
    },
    body: JSON.stringify({ action: 'toggle-24-7' }),
  });
  assert.equal(toggle.status, 200);
  assert.equal((await toggle.json()).state.alwaysOn, true);
  assert.equal(app.settings.get(`${GUILD_A}:music24_7`), true);
  assert.equal(app.settings.has(`${GUILD_B}:music24_7`), false);

  const volume = await fetch(`${base}/api/guilds/${GUILD_A}/music/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie, origin: app.publicOrigin,
      'x-csrf-token': loginData.csrfToken,
    },
    body: JSON.stringify({ action: 'volume', value: 73 }),
  });
  assert.equal(volume.status, 200);
  assert.equal((await volume.json()).state.volume, 73);
  assert.equal(app.settings.get(`${GUILD_A}:defaultVolume`), 0.73);
  assert.equal(app.players.get(GUILD_B).volume, 1, 'le volume du second serveur ne change pas');

  const invalidVolume = await fetch(`${base}/api/guilds/${GUILD_A}/music/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie, origin: app.publicOrigin,
      'x-csrf-token': loginData.csrfToken,
    },
    body: JSON.stringify({ action: 'volume', value: 73.5 }),
  });
  assert.equal(invalidVolume.status, 400);

  const shuffle = await fetch(`${base}/api/guilds/${GUILD_A}/music/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', cookie: sessionCookie, origin: app.publicOrigin,
      'x-csrf-token': loginData.csrfToken,
    },
    body: JSON.stringify({ action: 'shuffle' }),
  });
  assert.equal(shuffle.status, 200);
  assert.equal(app.players.get(GUILD_A).shuffled, true);
  assert.equal(app.players.get(GUILD_B).shuffled, undefined);

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: {
      cookie: sessionCookie, origin: app.publicOrigin, 'x-csrf-token': loginData.csrfToken,
    },
  });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${base}/api/status`, { headers: { cookie: sessionCookie } });
  assert.equal(afterLogout.status, 401);
});

test('un panneau non configuré ne sert pas le tableau de bord', async (t) => {
  const app = await createTestPanel({ WEB_ADMIN_TOKEN: 'invalide' });
  t.after(app.close);
  const response = await fetch(`${app.origin}/panel/`);
  assert.equal(response.status, 503);
});
