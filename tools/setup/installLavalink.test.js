const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { installLavalink } = require('./installLavalink');

test('l’installation rejette un JAR modifié et supprime uniquement son staging sans publier de secret', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lavalink-installer-test-'));
  const logs = [];
  try {
    await fs.writeFile(path.join(root, 'user-file.txt'), 'keep');
    await assert.rejects(installLavalink({ env: { BOT_DATA_DIR: root }, log: line => logs.push(line),
      runImpl: async () => 'openjdk version "21.0.12"',
      fetchImpl: async () => new Response('altered jar'),
    }), /Checksum/);
    assert.equal(await fs.readFile(path.join(root, 'user-file.txt'), 'utf8'), 'keep');
    assert.deepEqual(await fs.readdir(path.join(root, '.cache/lavalink')), []);
    assert.doesNotMatch(logs.join(' '), /password|cookie=/i);
  } finally {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('lavalink-installer-test-')) await fs.rm(root, { recursive: true, force: true });
  }
});

test('off empêche toute installation ou demande réseau', async () => {
  await assert.rejects(installLavalink({ env: { LAVALINK_MODE: 'off' }, fetchImpl: assert.fail }), /off/);
});
