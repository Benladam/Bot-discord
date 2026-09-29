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

test('encode la musique en Opus stéréo haute qualité', async () => {
  const process = child();
  let args;
  const sender = await OpusSender.start({ audioBitrate: 256_000 }, 'unused', null, null, assert.fail, '', {
    prepareInput: async () => ({ url: 'https://example.invalid/audio' }),
    spawn: (_command, ffmpegArgs) => { args = ffmpegArgs; return process; },
  });
  assert.ok(args.includes('192k'));
  assert.ok(args.includes('48000'));
  assert.ok(args.includes('2'));
  assert.ok(args.includes('loudnorm=I=-16:TP=-1.5:LRA=11'));
  sender.stop();
});

test('adapte le débit Opus au plafond du salon vocal', async () => {
  const process = child();
  let args;
  const sender = await OpusSender.start({ audioBitrate: 96_000 }, 'unused', null, null, assert.fail, '', {
    prepareInput: async () => ({ url: 'https://example.invalid/audio' }),
    spawn: (_command, ffmpegArgs) => { args = ffmpegArgs; return process; },
  });
  assert.ok(args.includes('96k'));
  sender.stop();
});
