const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { musicCheck, diagnosticUrl } = require('./musicCheck');

test('musiccheck refuse les URL arbitraires et nettoie le lien vidéo sans paramètres privés', () => {
  assert.equal(diagnosticUrl('https://youtu.be/v2o3in-Aud0?si=secret'), 'https://www.youtube.com/watch?v=v2o3in-Aud0');
  for (const url of ['http://youtube.com/watch?v=v2o3in-Aud0', 'https://example.com/secret', 'https://youtube.com@127.0.0.1/watch?v=v2o3in-Aud0', 'https://youtube.com/playlist?list=private']) assert.throws(() => diagnosticUrl(url));
});

test('musiccheck ne publie ni chemin privé ni erreur brute et ferme son flux sans lecture Discord', async () => {
  const logs = [];
  const stream = new PassThrough();
  let cleanups = 0;
  stream.cleanup = () => cleanups++;
  const dependencies = {
    log: text => logs.push(text), getPaths: () => ['/private/account/cookies.txt'],
    readCookies: () => { const error = new Error('SID=secret /private/account'); error.code = 'ENOENT'; throw error; },
    probe: async () => stream,
  };
  assert.deepEqual(await musicCheck('https://youtube.com/watch?v=v2o3in-Aud0', dependencies), { probed: true, available: true });
  assert.equal(stream.destroyed, true);
  assert.equal(cleanups, 1);
  assert.ok(!logs.join(' ').includes('secret') && !logs.join(' ').includes('/private'));
  dependencies.probe = async () => { throw new Error('Cookie: SID=secret'); };
  assert.deepEqual(await musicCheck('https://youtube.com/watch?v=v2o3in-Aud0', dependencies), { probed: true, available: false });
  assert.ok(!logs.join(' ').includes('secret'));
});
