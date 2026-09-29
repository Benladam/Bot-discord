const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-discord-db-'));
process.env.BOT_DB_PATH = path.join(testDirectory, 'nested', 'bot.sqlite3');
const store = require('./database');

after(() => {
  store.closeDatabase();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('playlists et réglages sont persistants, isolés par serveur et réindexés', () => {
  store.createPlaylist('guild-a', 'owner-a', 'Mix');
  assert.throws(() => store.createPlaylist('guild-a', 'owner-a', 'mix'), /déjà ce nom/);
  store.addTrack('guild-a', 'owner-a', 'Mix', { title: 'one', url: 'https://youtu.be/one' });
  store.addTrack('guild-a', 'owner-a', 'Mix', { title: 'two', url: 'https://youtu.be/two' });
  store.addTrack('guild-a', 'owner-a', 'Mix', { title: 'three', url: 'https://youtu.be/three' });
  assert.throws(
    () => store.addTrack('guild-a', 'other-user', 'Mix', { title: 'nope', url: 'https://youtu.be/nope' }),
    /créateur/,
  );

  store.removeTrack('guild-a', 'owner-a', 'Mix', 2);
  assert.deepEqual(
    store.getPlaylist('guild-a', 'mix').tracks.map(({ position, title }) => [position, title]),
    [[1, 'one'], [2, 'three']],
  );
  assert.equal(store.listPlaylists('guild-b').length, 0);

  store.setGuildSetting('guild-a', 'defaultVolume', 0.65);
  assert.equal(store.getGuildSetting('guild-a', 'defaultVolume'), 0.65);
  assert.equal(store.getGuildSetting('guild-b', 'defaultVolume', 1), 1);

  store.closeDatabase();
  assert.equal(store.getPlaylist('guild-a', 'Mix').tracks.length, 2);
});
