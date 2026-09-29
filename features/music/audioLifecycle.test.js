const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { OpusSender } = require('./audioSender');

function child() {
  const process = new EventEmitter();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.stdin = new PassThrough();
  process.kill = () => { process.killed = true; };
  return process;
}

function opusPage(audioFrameCount) {
  const packetCount = audioFrameCount + 2; // deux paquets Ogg d’en-tête Opus
  const page = Buffer.alloc(27 + packetCount + packetCount);
  page.write('OggS', 0, 'ascii');
  page[26] = packetCount;
  page.fill(1, 27, 27 + packetCount);
  page.fill(0xf8, 27 + packetCount);
  return page;
}

test('Stop pendant l’extraction ferme la source sans lancer FFmpeg ni envoyer du son', async () => {
  const stream = new PassThrough();
  let release;
  let allowed = true;
  let cleaned = 0;
  let spawned = 0;
  stream.cleanup = () => cleaned++;
  const prepared = new Promise(resolve => { release = resolve; });
  const pending = OpusSender.start({ connected: true, sendOpus: assert.fail }, 'unused', assert.fail, assert.fail, assert.fail, '', {
    prepareInput: () => prepared,
    shouldStart: () => allowed,
    spawn: () => { spawned++; return child(); },
  });
  const rejected = assert.rejects(pending, { code: 'AUDIO_CANCELLED' });
  allowed = false;
  release({ stream });
  await rejected;
  assert.equal(spawned, 0);
  assert.equal(cleaned, 1);
  assert.equal(stream.destroyed, true);
});

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
  const sender = await OpusSender.start({ connected: true, sendOpus: () => true }, 'unused', null, () => ended++, assert.fail, '', {
    prepareInput: async () => ({ url: 'https://example.invalid/audio' }), spawn: () => process,
  });
  process.stdout.write(opusPage(50));
  process.emit('close', 0, null);
  await new Promise(resolve => setTimeout(resolve, 2_000));
  assert.equal(ended, 1);
  assert.equal(process.killed, true);
  sender.stop();
});

test('un flux FFmpeg vide ou nettement trop court est signalé comme interrompu', async () => {
  const process = child();
  const errors = [];
  let ended = 0;
  const sender = await OpusSender.start({}, 'unused', null, () => ended++, error => errors.push(error), '', {
    prepareInput: async () => ({ url: 'https://example.invalid/audio' }), spawn: () => process,
    expectedDuration: 120,
  });
  process.stdout.write(opusPage(50)); // environ une seconde d’audio pour un titre annoncé à deux minutes
  process.emit('close', 0, null);
  assert.equal(ended, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'AUDIO_PREMATURE_END');
  assert.match(errors[0].message, /terminé prématurément/);
  sender.stop();
});

test('un flux Opus en attente applique la contre-pression au lieu de supprimer des trames', async () => {
  const process = child();
  const sender = await OpusSender.start({ connected: true, sendOpus: () => true }, 'unused', null, null, assert.fail, '', {
    prepareInput: async () => ({ url: 'https://example.invalid/audio' }), spawn: () => process,
  });
  process.stdout.write(opusPage(252));
  await new Promise(setImmediate);
  assert.equal(process.stdout.isPaused(), true);
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
