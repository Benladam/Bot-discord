'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createLocalDashboard } = require('./localServer');

const TOKEN = 'dashboard-test-token-'.padEnd(64, 'x');

async function startLocal(env = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-dashboard-'));
  const dashboard = createLocalDashboard({
    env: {
      DASHBOARD_LOCAL_PORT: '0',
      DASHBOARD_DATA_DIR: root,
      DASHBOARD_LOCAL_ENV_FILE: path.join(root, '.env'),
      ...env,
    },
  });
  const address = await dashboard.ready;
  return { root, dashboard, base: address.url };
}

async function bootstrap(base) {
  const response = await fetch(`${base}/api/bootstrap`);
  const cookie = response.headers.get('set-cookie').split(';', 1)[0];
  return { data: await response.json(), cookie };
}

async function jsonRequest(base, route, cookie, csrf, body, method = 'POST') {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { cookie, 'x-dashboard-csrf': csrf, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

test('le dashboard stocke plusieurs clés dans son .env privé, jamais dans le JSON', async () => {
  const fixture = await startLocal();
  try {
    const session = await bootstrap(fixture.base);
    const created = await jsonRequest(fixture.base, '/api/connections', session.cookie, session.data.csrfToken, {
      name: 'Bot test', url: 'http://127.0.0.1:65534', token: TOKEN,
    });
    assert.equal(created.response.status, 201);
    const metadata = JSON.parse(await fs.readFile(path.join(fixture.root, 'connections.json'), 'utf8'));
    assert.equal(metadata.length, 1);
    assert.equal(Object.hasOwn(metadata[0], 'token'), false);
    const secrets = await fs.readFile(path.join(fixture.root, '.env'), 'utf8');
    assert.match(secrets, new RegExp(TOKEN));
    assert.equal(JSON.stringify(created.data).includes(TOKEN), false);
    const perBot = await fs.readFile(path.join(fixture.root, 'bots', created.data.id, '.env'), 'utf8');
    assert.match(perBot, new RegExp(TOKEN));
    assert.equal(require('dotenv').parse(perBot).DASHBOARD_REMOTE_URL, 'http://127.0.0.1:65534');
    await jsonRequest(fixture.base, `/api/connections/${created.data.id}`, session.cookie, session.data.csrfToken, {}, 'DELETE');
    await assert.rejects(fs.stat(path.join(fixture.root, 'bots', created.data.id)), { code: 'ENOENT' });
  } finally {
    await fixture.dashboard.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('les connexions DASHBOARD_BOT_n du fichier d’environnement sont importées', async () => {
  const fixture = await startLocal({
    DASHBOARD_BOT_1_NAME: 'Bot un', DASHBOARD_BOT_1_URL: 'http://127.0.0.1:65531', DASHBOARD_BOT_1_TOKEN: TOKEN,
    DASHBOARD_BOT_2_NAME: 'Bot deux', DASHBOARD_BOT_2_URL: 'http://127.0.0.1:65532', DASHBOARD_BOT_2_TOKEN: `${TOKEN}2`,
  });
  try {
    const session = await bootstrap(fixture.base);
    assert.deepEqual(session.data.connections.map((item) => item.name), ['Bot un', 'Bot deux']);
    assert.equal(JSON.stringify(session.data).includes(TOKEN), false);
  } finally {
    await fixture.dashboard.close();
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
