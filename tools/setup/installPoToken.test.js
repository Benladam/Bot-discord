const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { installPoToken } = require('./installPoToken');
const { COMMIT } = require('../../features/music/youtubePoToken');
test('installer rejects a changed upstream commit and removes only its own staging directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-pot-test-'));
  try {
    await fs.writeFile(path.join(root, 'keep.txt'), 'private');
    await assert.rejects(installPoToken({ env: { BOT_DATA_DIR: root }, log() {}, fetchImpl: assert.fail,
      runImpl: async (_cmd, args) => {
        const provider = args.at(-1); await fs.mkdir(path.join(provider, '.git'), { recursive: true });
        await fs.writeFile(path.join(provider, '.git/HEAD'), 'wrong-commit');
      } }), /commit/);
    assert.deepEqual(await fs.readdir(path.join(root, '.cache/youtube-pot')), []);
    assert.equal(await fs.readFile(path.join(root, 'keep.txt'), 'utf8'), 'private');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('installer checks plugin checksum before publishing an installation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-pot-test-'));
  let provider;
  try {
    await assert.rejects(installPoToken({ env: { BOT_DATA_DIR: root }, log() {},
      runImpl: async (cmd, args) => {
        if (cmd === 'git') {
          provider = args.at(-1); await fs.mkdir(path.join(provider, '.git'), { recursive: true });
          await fs.writeFile(path.join(provider, '.git/HEAD'), COMMIT);
        } else if (cmd === process.execPath) {
          await fs.mkdir(path.join(provider, 'server/build'), { recursive: true }); await fs.writeFile(path.join(provider, 'server/build/main.js'), 'fixture');
        }
      }, fetchImpl: async () => new Response('corrupted plugin') }), /Checksum/);
    assert.deepEqual(await fs.readdir(path.join(root, '.cache/youtube-pot')), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
