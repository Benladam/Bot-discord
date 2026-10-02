'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { createLocalBotApi } = require('./localBotApi');

test('l’API locale fonctionne avec un service public TLS et reste authentifiée sur loopback', async (t) => {
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const token = 'local-api-test-token'.padEnd(64, 'x');
  const service = createLocalBotApi({
    env: { SERVER_PORT: '25610', DASHBOARD_LOOPBACK_PORT: String(port), DASHBOARD_API_TOKEN: token,
      WEB_PUBLIC_URL: 'http://public.invalid', MINECRAFT_BRIDGE_CERT_PATH: 'private-certificate.pem' },
    client: { isReady: () => true, guilds: { cache: new Map() } },
    database: {}, telemetry: { stats: () => ({}) }, logger: { info() {}, error() {} },
  });
  t.after(() => service.close());
  const address = await service.ready;
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/api/dashboard/status`)).status, 401);
  const response = await fetch(`${base}/api/dashboard/status`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.protocolVersion, 1);
  assert.equal(data.bot.ready, true);
  assert.deepEqual(data.guilds, []);
  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await fetch(`${base}/minecraft-bridge`)).status, 404);
});

test('l’API locale reste désactivée sans port et refuse un port invalide', () => {
  assert.equal(createLocalBotApi({ env: {} }), null);
  assert.throws(() => createLocalBotApi({ env: { DASHBOARD_LOOPBACK_PORT: '0' } }), /DASHBOARD_LOOPBACK_PORT/);
  assert.throws(() => createLocalBotApi({ env: { DASHBOARD_LOOPBACK_PORT: 'abc' } }), /DASHBOARD_LOOPBACK_PORT/);
});
