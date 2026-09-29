const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectCatalogResults } = require('./catalogSearch');

test('un catalogue rapide répond sans attendre le lent et les résultats tardifs enrichissent le cache', async () => {
  let releaseSlow;
  let complete;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  const fast = { url: 'fast', title: 'Titre' };
  const items = await collectCatalogResults([Promise.resolve([fast]), slow], {
    settleMs: 5, timeoutMs: 500, onComplete: items => { complete = items; },
  });
  assert.deepEqual(items, [fast]);
  assert.equal(complete, undefined);
  releaseSlow([fast, { url: 'slow' }]);
  await new Promise(setImmediate);
  assert.deepEqual(complete.map(item => item.url), ['fast', 'slow']);
});

test('les sources absentes ou bloquées ne bloquent pas la réponse', async () => {
  const items = await collectCatalogResults([Promise.reject(new Error('API indisponible')), new Promise(() => {})], { timeoutMs: 10 });
  assert.deepEqual(items, []);
  assert.deepEqual(await collectCatalogResults([]), []);
});
