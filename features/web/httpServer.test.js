'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpService } = require('./httpServer');
const logger = { info() {}, error() {} };

test('le bot public expose healthz et le panneau sans extension privée', async (t) => {
  const service = createHttpService({ client: { isReady: () => true }, logger, env: { PORT: '0' },
    handleRequest: (_request, response) => { response.writeHead(200); response.end('panel'); } });
  t.after(() => service.close());
  const address = await service.ready;
  const health = await fetch(`http://127.0.0.1:${address.port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', discord: 'online' });
  const panel = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(await panel.text(), 'panel');
});

test('une erreur du panneau ne révèle pas ses détails dans la réponse HTTP', async (t) => {
  const service = createHttpService({ client: { isReady: () => false }, logger, env: { PORT: '0' },
    handleRequest: () => { throw new Error('private-detail'); } });
  t.after(() => service.close());
  const address = await service.ready;
  const response = await fetch(`http://127.0.0.1:${address.port}/`);
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Internal server error');
});
