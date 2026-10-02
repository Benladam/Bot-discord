'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createDashboardApi } = require('./api');

test('le redémarrage refuse la clé de lecture et exige une clé administrateur sur un bot supervisé', async () => {
  const readToken = 'read-'.padEnd(64, 'r');
  const controlToken = 'control-'.padEnd(64, 'c');
  let calls = 0;
  const events = [];
  const api = createDashboardApi({ client: {}, database: {}, telemetry: { record: (entry) => events.push(entry) },
    env: { DASHBOARD_API_TOKEN: readToken, DASHBOARD_CONTROL_TOKEN: controlToken, BOT_SUPERVISED: '1' },
    restartBot: () => { calls++; } });
  const server = http.createServer((req, res) => { void api.handle(req, res, new URL(req.url, 'http://localhost').pathname); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/dashboard/restart`;
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${readToken}` } })).status, 403);
    assert.equal(calls, 0);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${controlToken}` } })).status, 202);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${controlToken}` } })).status, 409);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal(calls, 1);
    assert.equal(events.length, 1);
    assert.equal(JSON.stringify(events).includes(controlToken), false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
