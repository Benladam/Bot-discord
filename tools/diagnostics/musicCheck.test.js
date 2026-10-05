const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { musicCheck, diagnosticUrl, soundCloudCheck } = require('./musicCheck');

test('soundcloudcheck --cache=148 transmet la durée, prépare tout le morceau et nettoie', async () => {
  const logs = []; const stream = new PassThrough(); let cleaned = 0;
  const result = await soundCloudCheck('--cache=148 Ninho - Coco', {
    log: line => logs.push(line),
    probe: async (query, options) => { assert.equal(query, 'Ninho - Coco'); assert.equal(options.expectedDuration, 148); return stream; },
    cache: async (media, options) => {
      assert.equal(options.expectedDuration, 148); assert.equal(media.stream, stream);
      return { cached: true, url: 'nonexistent-test.opus', cleanup() { cleaned++; } };
    },
  });
  assert.deepEqual(result, { available: true }); assert.equal(cleaned, 1); assert.equal(stream.destroyed, true);
  assert.match(logs.join(' '), /durée vérifiée/); assert.match(logs.join(' '), /temporaire supprimé/);
  for (const duration of [0, 2000]) await assert.rejects(soundCloudCheck(`--cache=${duration} Ninho - Coco`), /Durée/);
});

test('musiccheck refuse les URL arbitraires et nettoie le lien vidéo sans paramètres privés', () => {
  assert.equal(diagnosticUrl('https://youtu.be/v2o3in-Aud0?si=secret'), 'https://www.youtube.com/watch?v=v2o3in-Aud0');
  for (const url of ['http://youtube.com/watch?v=v2o3in-Aud0', 'https://example.com/secret', 'https://youtube.com@127.0.0.1/watch?v=v2o3in-Aud0', 'https://youtube.com/playlist?list=private']) assert.throws(() => diagnosticUrl(url));
});

test('soundcloudcheck vérifie un flux sans rejoindre Discord et le ferme après le diagnostic', async () => {
  const logs = [];
  const stream = new PassThrough();
  let cleanups = 0;
  stream.cleanup = () => cleanups++;
  const result = await soundCloudCheck('Koba LaD - RR 9.1', {
    log: text => logs.push(text),
    probe: async (query, options) => {
      assert.equal(query, 'Koba LaD - RR 9.1');
      assert.equal(options.guildId, 'diagnostic');
      assert.equal(options.expectedTitle, query);
      return stream;
    },
  });
  assert.deepEqual(result, { available: true });
  assert.equal(stream.destroyed, true);
  assert.equal(cleanups, 1);
  assert.match(logs.join(' '), /contenu audible non vérifié/);
});

test('soundcloudcheck refuse liens et entrées invalides et ne révèle pas une erreur fournisseur', async () => {
  for (const query of ['', 'niska', 'https://soundcloud.com/artist/title', 'Niska - Réseaux\nsecret']) {
    await assert.rejects(soundCloudCheck(query), /Artiste - Titre/);
  }
  const logs = [];
  const result = await soundCloudCheck('Niska - Réseaux', {
    log: text => logs.push(text),
    probe: async () => { throw new Error('Authorization: secret cookie=secret'); },
  });
  assert.deepEqual(result, { available: false, code: 'EXTRACTION_FAILED' });
  assert.ok(!logs.join(' ').includes('secret'));
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

test('musiccheck distingue flux public sans compte et cookies de secours sans divulgation', async () => {
  for (const mode of ['anonymous', 'cookies', 'SID=test-secret']) {
    const logs = [];
    const stream = new PassThrough(); stream.youtubeAuthentication = mode;
    await musicCheck('https://youtube.com/watch?v=v2o3in-Aud0', {
      getPaths: () => [], log: line => logs.push(line), probe: async () => stream,
    });
    assert.doesNotMatch(logs.join(' '), /test-secret/);
    if (mode === 'anonymous') assert.match(logs.join(' '), /aucun cookie transmis/);
    if (mode === 'cookies') assert.match(logs.join(' '), /cookies de secours/);
  }
});
