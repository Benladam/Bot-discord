const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MusicPlayer } = require('./musicPlayer');
const { controlledPlayer } = require('./musicControls');
const { PcmVolume } = require('./pcmVolume');
const { getLyrics, songIdentity } = require('./lyrics');
const { OpusSender } = require('./audioSender');
test('queue remove/move are 1-based and do not touch current or another guild', () => {
  const a = new MusicPlayer('a', {}); const b = new MusicPlayer('b', {});
  a.current = { title: 'Current' }; a.queue = [{ title: 'A' }, { title: 'B' }, { title: 'C' }];
  a.moveTrack(3, 1); assert.deepEqual(a.queue.map(song => song.title), ['C', 'A', 'B']);
  assert.equal(a.removeTrack(2).title, 'A'); assert.equal(a.current.title, 'Current'); assert.deepEqual(b.queue, []);
  assert.throws(() => a.moveTrack(1, 0)); assert.throws(() => a.removeTrack(1.2));
  a._rememberCurrent(); a.stop(); assert.deepEqual(a.history, []);
});
test('previous invalidates old end callbacks and queues interrupted current after previous', async () => {
  const player = new MusicPlayer('g', {}); player.connection = { connected: true, channelId: 'v' };
  player.history = [{ title: 'A', url: 'a' }]; player.current = { title: 'B', url: 'b' };
  let stopped = 0; player.sender = { stop() { stopped++; } }; player.isPlaying = true;
  const original = OpusSender.start;
  OpusSender.start = async (_conn, url, _start, _end, _error, _query, options) => {
    assert.equal(url, 'a'); assert.equal(options.initialFilter, 'none'); return { setVolume() {}, stop() {} };
  };
  try {
    await player.previous(); assert.equal(stopped, 1); assert.equal(player.current.title, 'A');
    assert.deepEqual(player.queue.map(song => song.title), ['B']);
  } finally { player.stop(); player._clearIdleTimer(); OpusSender.start = original; }
});
test('music controls require matching guild voice channel', () => {
  const ctx = { guildId: 'a', guild: {}, member: { voice: { channelId: 'v' } } };
  assert.ok(controlledPlayer(ctx, { getPlayer: id => ({ connection: { channelId: 'v' }, guildId: id }) }));
  assert.throws(() => controlledPlayer(ctx, { getPlayer: () => ({ connection: { channelId: 'other' } }) }));
});
test('live mono filtering handles partial stereo frames, volume and reset without changing sample count', async () => {
  const gain = new PcmVolume(1, 'mono'); const chunks = [];
  gain.on('data', chunk => chunks.push(chunk));
  const frame = Buffer.alloc(4); frame.writeInt16LE(20000); frame.writeInt16LE(-10000, 2);
  gain.write(frame.subarray(0, 3)); gain.write(frame.subarray(3));
  gain.setFilter('none'); gain.end(frame);
  await new Promise(resolve => gain.on('end', resolve));
  const output = Buffer.concat(chunks);
  assert.equal(output.length, 8); assert.equal(output.readInt16LE(0), 5000); assert.equal(output.readInt16LE(2), 5000);
  assert.equal(output.readInt16LE(4), 20000); assert.throws(() => gain.setFilter('arbitrary-ffmpeg-expression'));
});
test('lyrics exact artist/title metadata and refusal of mismatched response', async () => {
  assert.deepEqual(songIdentity({ title: 'Artist - Song [Clip Officiel]' }), { artist: 'Artist', title: 'Song' });
  const request = { artist: 'Artist', title: 'Song' };
  const fetchImpl = async url => {
    assert.equal(url.origin, 'https://lrclib.net');
    return new Response(JSON.stringify({ artistName: 'Artist', trackName: 'Song', plainLyrics: 'test lyrics' }));
  };
  assert.equal(await getLyrics(request, { fetchImpl }), 'test lyrics');
  await assert.rejects(getLyrics(request, { fetchImpl: async () => new Response(JSON.stringify({ artistName: 'Other', trackName: 'Song' })) }), /autre morceau/);
});
