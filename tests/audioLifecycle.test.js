const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { OpusSender } = require('../utils/audioSender');

function child() {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.kill = () => { process.killed = true; };
  return process;
}

test('FFmpeg 403 never exposes a signed URL split across chunks and closes its source', async () => {
  const process = child();
  const stream = new PassThrough();
  const errors = [];
  const sender = await OpusSender.start({}, 'unused', null, null, e => errors.push(e), '', {
    prepareInput: async () => ({ stream }), spawn: () => process,
  });
  process.stderr.write('Error opening https://example.invalid/?sig=');
  process.stderr.write('SECRET'.repeat(500));
  process.stderr.write('\nServer returned 40');
  process.stderr.write('3 Forbidden');
  process.emit('close', 1, null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'AUDIO_HTTP_FORBIDDEN');
  assert.doesNotMatch(errors[0].message, /SECRET|sig=|example/);
  assert.equal(stream.destroyed, true);
  assert.equal(process.killed, true);
  sender.stop();
});

test('normal end cleans sender timers and calls onEnd only once', async () => {
  const process = child();
  let ended = 0;
  const sender = await OpusSender.start({}, 'unused', null, () => ended++, assert.fail, '', {
    prepareInput: async () => ({ url: 'https://example.invalid/audio' }), spawn: () => process,
  });
  process.emit('close', 0, null);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(ended, 1);
  assert.equal(process.killed, true);
  sender.stop();
});
