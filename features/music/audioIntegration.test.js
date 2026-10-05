const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { spawn } = require('node:child_process');
const { OpusSender } = require('./audioSender');
const { cacheAudio, ffmpegBinary } = require('./temporaryAudio');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('FFmpeg réel : cache Opus compact puis lecture complète et suppression naturelle', { timeout: 15000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-opus-cache-integration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = ffmpegBinary();
  const generator = spawn(binary, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-f', 'wav', 'pipe:1'], { windowsHide: true });
  generator.on('error', error => generator.stdout.destroy(error));
  generator.stdout.on('error', () => {});
  const media = await cacheAudio({ stream: generator.stdout, sourceUrl: 'synthetic' }, {
    root, ffmpeg: binary, expectedDuration: 3, env: {}, freeSpace: () => Infinity, log() {},
  });
  assert.equal(media.cached, true);
  assert.ok(fs.statSync(media.url).size < 100000);
  assert.ok(fs.readFileSync(media.url).includes(Buffer.from('OpusHead')));
  let resolve; let reject; let frames = 0;
  const ended = new Promise((yes, no) => { resolve = yes; reject = no; });
  const sender = await OpusSender.start({ connected: true, sendOpus() { frames++; return true; } }, '', null, resolve, reject, '', { preparedMedia: media, expectedDuration: 3 });
  const timer = setTimeout(() => reject(new Error('lecture synthétique bloquée')), 10000);
  try {
    await ended; assert.ok(frames >= 145); assert.ok(frames <= 160);
    assert.equal(fs.existsSync(media.url), false);
  } finally { clearTimeout(timer); sender.stop(); generator.kill(); media.cleanup(); }
});

for (const resumeAt of [0, 1]) {
test(`la chaîne réelle FFmpeg → gain PCM → Opus finit proprement (reprise=${resumeAt}s)`, { timeout: 15000 }, async () => {
  const source = new PassThrough();
  const rate = 48000;
  const pcm = Buffer.alloc(rate * 2 * 2 * 2); // 2 s, stéréo, 16 bits
  for (let frame = 0; frame < rate * 2; frame++) {
    const sample = Math.round(8000 * Math.sin(2 * Math.PI * 440 * frame / rate));
    pcm.writeInt16LE(sample, frame * 4); pcm.writeInt16LE(sample, frame * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  source.end(Buffer.concat([header, pcm]));
  let packets = 0;
  let encodedSamples = 0;
  let nonZero = false;
  let finish;
  let reject;
  const ended = new Promise((resolve, fail) => { finish = resolve; reject = fail; });
  const sender = await OpusSender.start({ connected: true, sendOpus: () => { packets++; return true; } }, '', null, finish, reject, '', {
    preparedMedia: { stream: source }, initialVolume: 0, resumeAt,
    spawn: (binary, args, options) => {
      const child = spawn(binary, args, options);
      if (args.includes('libopus')) {
        const write = child.stdin.write.bind(child.stdin);
        child.stdin.write = (chunk, ...rest) => {
          encodedSamples += chunk.length / 2;
          if (chunk.some(byte => byte !== 0)) nonZero = true;
          return write(chunk, ...rest);
        };
      }
      return child;
    },
  });
  const timeout = setTimeout(() => reject(new Error('FFmpeg ne termine pas le flux synthétique')), 10000);
  try {
    await ended;
    assert.ok(packets >= 50);
    if (resumeAt) assert.ok(packets <= 55, 'la reprise ne renvoie que la seconde restante');
    assert.ok(encodedSamples > 10000);
    assert.equal(nonZero, false, 'le mode muet doit encoder du silence, pas seulement afficher 0%');
  } finally { clearTimeout(timeout); sender.stop(); }
});
}
