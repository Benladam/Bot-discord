const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { streamYouTubeAudio } = require('./audioSender');

test('Lavalink est essayé avant les autres moteurs sur exactement la même vidéo', async () => {
  const events = []; const audio = new PassThrough();
  const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  const result = await streamYouTubeAudio(url, {
    useLavalink: true, isLavalinkConfigured: () => true,
    lavalink: async target => { events.push(['lavalink', target]); return audio; }, primary: assert.fail, fallback: assert.fail,
  });
  assert.equal(result, audio); assert.deepEqual(events, [['lavalink', url]]); audio.destroy();
});

test('si Lavalink échoue, le parcours YouTubei puis yt-dlp reste disponible sans changer de vidéo', async () => {
  const events = []; const audio = new PassThrough();
  const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  await streamYouTubeAudio(url, {
    useLavalink: true, isLavalinkConfigured: () => true,
    lavalink: async () => { events.push('lavalink'); throw Object.assign(new Error('denied'), { code: 'LAVALINK_STREAM_FAILED' }); },
    primary: async target => { assert.equal(target, url); events.push('youtubei'); throw new Error('denied'); },
    fallback: async target => { assert.equal(target, url); events.push('yt-dlp'); return audio; },
  });
  assert.deepEqual(events, ['lavalink', 'youtubei', 'yt-dlp']); audio.destroy();
});
