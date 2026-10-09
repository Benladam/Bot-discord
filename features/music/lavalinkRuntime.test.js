const { test } = require('node:test');
const assert = require('node:assert/strict');
const { connectionConfig, LavalinkRuntime } = require('./lavalinkRuntime');
const { applicationConfig } = require('../../tools/setup/installLavalink');

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
