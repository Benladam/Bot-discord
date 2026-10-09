const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { connectionConfig, LavalinkRuntime } = require('./lavalinkRuntime');
const { applicationConfig } = require('../../tools/setup/installLavalink');
const { VERSION, PLUGIN_VERSION } = require('./lavalinkRuntime');

test('Lavalink est désactivable et exige HTTPS hors loopback, sans identifiant dans l’URL', () => {
  assert.equal(connectionConfig({ LAVALINK_MODE: 'off', LAVALINK_URL: 'invalid' }), null);
  for (const url of ['http://audio.example.test', 'https://name:secret@audio.example.test', 'https://audio.example.test/?token=secret']) {
    assert.throws(() => connectionConfig({ LAVALINK_URL: url, LAVALINK_PASSWORD: 'test-secret' }), /HTTPS/);
  }
  assert.equal(connectionConfig({ LAVALINK_URL: 'http://127.0.0.1:2333', LAVALINK_PASSWORD: 'test-secret' }).external, true);
});

test('Lavalink externe ne lance aucun processus Java et vérifie la présence du plugin', async () => {
  const runtime = new LavalinkRuntime({ env: { LAVALINK_URL: 'https://audio.example.test', LAVALINK_PASSWORD: 'test-secret' },
    forkImpl: assert.fail, fetchImpl: async () => Response.json({ version: { semver: '4.2.2' }, plugins: [{ name: 'youtube-plugin' }] }) });
  assert.equal((await runtime.ensure()).external, true);
  runtime.fetchImpl = async () => Response.json({ version: { semver: '4.2.2' }, plugins: [] });
  await assert.rejects(runtime.ensure(), error => error.code === 'LAVALINK_UNAVAILABLE');
});

test('la configuration locale n’expose ni HTTP arbitraire ni OAuth et désactive les logs de requêtes', () => {
  const config = applicationConfig('test-secret');
  assert.match(config, /address: 127\.0\.0\.1/);
  assert.match(config, /http: false/); assert.match(config, /local: false/);
  assert.match(config, /request:\n    enabled: false/);
  assert.doesNotMatch(config, /oauth|refreshToken|cookie/i);
});

test('le redémarrage Lavalink privé attend la fin de Java avant de démarrer le flux OAuth', async () => {
  const runtime = new LavalinkRuntime({ env: { LAVALINK_MODE: 'off' } });
  await assert.rejects(runtime.restart(), /service privé/);
});

test('la commande OAuth ne prétend pas redémarrer un Lavalink actif géré par un autre processus', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-lavalink-oauth-runtime-'));
  const env = { BOT_DATA_DIR: path.join(parent, 'data') };
  const root = path.join(env.BOT_DATA_DIR, '.cache', 'lavalink', VERSION);
  fs.mkdirSync(path.join(root, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Lavalink.jar'), 'test');
  fs.writeFileSync(path.join(root, 'plugins', `youtube-plugin-${PLUGIN_VERSION}.jar`), 'test');
  fs.writeFileSync(path.join(root, 'installed.json'), JSON.stringify({ version: VERSION, pluginVersion: PLUGIN_VERSION }));
  fs.writeFileSync(path.join(root, 'connection.json'), JSON.stringify({ password: 'p'.repeat(32), java: 'java' }));
  try {
    const runtime = new LavalinkRuntime({ env, forkImpl: assert.fail,
      fetchImpl: async () => Response.json({ version: { semver: '4.2.2' }, plugins: [{ name: 'youtube-plugin' }] }) });
    await assert.rejects(runtime.restart(), /ne possède pas son processus Java/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('le statut du prompt OAuth attend une émission réelle, sans supposer que le redémarrage en a produit un', async () => {
  const runtime = new LavalinkRuntime({ env: { LAVALINK_MODE: 'off' } });
  assert.equal(await runtime.waitForOAuthDevicePrompt(1), false);
  runtime.oauthDevicePrompt = true;
  assert.equal(await runtime.waitForOAuthDevicePrompt(1), true);
});
