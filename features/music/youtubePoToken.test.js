const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PoTokenProvider, poTokenArgs, helperEnvironment } = require('./youtubePoToken');
const { buildYtDlpArgs, buildYtDlpSearchArgs } = require('./audioSender');

test('helper receives no bot/account secret or Node injection options', () => {
  assert.deepEqual(helperEnvironment({ PATH: 'bin', HOME: 'home', DISCORD_TOKEN: 'fake', YOUTUBE_TOKEN: 'fake', NODE_OPTIONS: '--require evil' }), { PATH: 'bin', HOME: 'home' });
});
test('PO plugin applies to YouTube only, with mweb by default and explicit fallback preserved', () => {
  const poToken = { ready: true, plugins: 'private-plugins' };
  const options = { poToken, cookiesPath: '', env: {} };
  assert.ok(buildYtDlpArgs([], 'https://youtube.com/watch?v=abcdefghijk', options).includes('youtube:player_client=mweb'));
  assert.ok(buildYtDlpSearchArgs([], 'artist', options).includes('private-plugins'));
  assert.ok(!buildYtDlpArgs([], 'https://soundcloud.com/artist/song', options).includes('private-plugins'));
  assert.ok(!buildYtDlpSearchArgs([], 'artist', { ...options, provider: 'soundcloud' }).includes('private-plugins'));
  assert.ok(!poTokenArgs(poToken, 'web_embedded').includes('youtube:player_client=mweb'));
  assert.deepEqual(poTokenArgs(null), []);
});
test('disabled/not installed never forks or fetches', async () => {
  for (const env of [{ YOUTUBE_PO_TOKEN_MODE: 'off' }, {}]) {
    const provider = new PoTokenProvider({ env, isInstalled: () => false, fetchImpl: assert.fail, forkImpl: assert.fail });
    assert.equal(await provider.ensure(), null);
  }
});
test('one singleton startup per concurrent request and an owned helper can be stopped', async () => {
  let spawned = 0; let calls = 0; let killed = 0;
  const child = new EventEmitter(); child.kill = () => { killed++; };
  const provider = new PoTokenProvider({ env: {}, isInstalled: () => true, log() {},
    fetchImpl: async () => ({ ok: ++calls > 1, json: async () => ({ version: '2.0.1' }) }),
    forkImpl: (_file, args, options) => {
      spawned++; assert.equal(options.stdio[3], 'ipc'); assert.ok(args[0].endsWith('main.js')); return child;
    } });
  const results = await Promise.all([provider.ensure(), provider.ensure()]);
  assert.equal(spawned, 1); assert.ok(results.every(item => item.ready));
  child.emit('exit'); assert.equal(provider.status().ready, false);
  provider.child = child; provider.stop(); assert.equal(killed, 1);
});
