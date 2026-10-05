const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { cacheAudio, closeMedia } = require('./temporaryAudio');
const { preparePlaybackInput } = require('./audioSender');

function fixture(t, { duration = 150, size = 1000, hang = false, code = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-audio-cache-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const children = [];
  const spawnImpl = (_bin, args) => {
    assert.ok(args.includes('128k')); assert.ok(args.includes('-map_metadata'));
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; child.stdout.destroy(); child.emit('close', 1); };
    child.stdin.resume();
    children.push(child);
    if (!hang) setImmediate(() => {
      child.stderr.end(`out_time_us=${duration * 1e6}\nprogress=end\n`);
      child.stdout.end(Buffer.alloc(size, 42)); child.emit('close', code);
    });
    return child;
  };
  const media = () => { const stream = new PassThrough(); stream.end('synthetic-input'); return { stream, sourceUrl: 'https://youtu.be/example', provider: 'YouTube' }; };
  return { root, children, media, options: { root, spawnImpl, freeSpace: () => Infinity, env: {}, expectedDuration: 150, log() {} } };
}

test('cache complet, privé, distinct entre guildes; aucune réutilisation de chanson', async t => {
  const f = fixture(t);
  const first = await cacheAudio(f.media(), f.options);
  const second = await cacheAudio(f.media(), f.options);
  assert.notEqual(first.url, second.url); assert.equal(first.sourceUrl, 'https://youtu.be/example');
  assert.equal(first.cached, true); assert.equal(first.stream, undefined);
  assert.equal(fs.statSync(first.url).size, 1000);
  if (process.platform !== 'win32') assert.equal(fs.statSync(first.url).mode & 0o777, 0o600);
  closeMedia(first); closeMedia(first);
  assert.equal(fs.existsSync(first.url), false); assert.equal(fs.existsSync(second.url), true);
  closeMedia(second); assert.deepEqual(fs.readdirSync(f.root), []);
});

test('configuration désactivée, morceau long et manque de disque gardent le flux intact', async t => {
  const f = fixture(t);
  for (const options of [{ env: { MUSIC_CACHE_ENABLED: 'false' } }, { expectedDuration: 2000 }, { freeSpace: () => 0 }, { totalBytes: 1 }]) {
    const source = f.media();
    assert.equal(await cacheAudio(source, { ...f.options, ...options }), source);
    assert.equal(source.stream.destroyed, false); closeMedia(source);
  }
  assert.equal(f.children.length, 0);
});

test('rejet d’un téléchargement court, trop volumineux ou d’un FFmpeg interrompu : nettoyage', async t => {
  for (const setup of [{ duration: 126 }, { size: 2000, maxBytes: 1000 }, { code: 1 }, { duration: 1300 }]) {
    const f = fixture(t, setup);
    const source = f.media();
    await assert.rejects(cacheAudio(source, { ...f.options, ...(setup.maxBytes ? { maxBytes: setup.maxBytes } : {}) }));
    assert.equal(source.stream.destroyed, true); assert.deepEqual(fs.readdirSync(f.root), []);
  }
});

test('Stop et délai borné annulent processus et fichier temporaire sans audio tardif', async t => {
  for (const cancelled of [false, true]) {
    const f = fixture(t, { hang: true });
    const source = f.media(); let alive = true;
    const pending = cacheAudio(source, { ...f.options, timeoutMs: cancelled ? 2000 : 20, shouldStart: () => alive });
    const rejected = assert.rejects(pending, { code: cancelled ? 'AUDIO_CANCELLED' : 'AUDIO_STALLED' });
    if (cancelled) alive = false;
    await rejected;
    assert.equal(f.children[0].killed, true); assert.deepEqual(fs.readdirSync(f.root), []);
  }
});

test('un téléchargement sans durée catalogue reste borné et n’accepte pas un live long', async t => {
  const f = fixture(t);
  const cached = await cacheAudio(f.media(), { ...f.options, expectedDuration: 0 });
  assert.equal(cached.cached, true); closeMedia(cached);
});

test('nettoyage après crash limité aux anciennes sessions, sans toucher aux autres fichiers', async t => {
  const f = fixture(t);
  const stale = path.join(f.root, 'track-stale'); fs.mkdirSync(stale);
  fs.writeFileSync(path.join(stale, 'audio.opus'), 'old');
  fs.utimesSync(stale, new Date(0), new Date(0));
  const other = path.join(f.root, 'do-not-delete'); fs.mkdirSync(other);
  const cached = await cacheAudio(f.media(), f.options);
  assert.equal(fs.existsSync(stale), false); assert.equal(fs.existsSync(other), true);
  closeMedia(cached);
});

test('cache interrompu : une alternative exacte, avec URL défaillante exclue', async () => {
  const first = { stream: new PassThrough(), sourceUrl: 'https://youtu.be/failed' };
  const second = { stream: new PassThrough(), sourceUrl: 'https://soundcloud.com/artist/song' };
  let count = 0; const optionsSeen = [];
  const cached = await preparePlaybackInput('https://youtu.be/failed', 'Ninho - Coco', {
    expectedTitle: 'Coco - Ninho', expectedDuration: 148,
    resolveInput: async (_url, _query, options) => { optionsSeen.push(options); return optionsSeen.length === 1 ? first : second; },
    cacheAudio: async media => { if (++count === 1) throw Object.assign(new Error('short'), { code: 'AUDIO_PREMATURE_END' }); return { ...media, cached: true }; },
  });
  assert.equal(first.stream.destroyed, true);
  assert.equal(optionsSeen[1].recoverySearch, true); assert.deepEqual(optionsSeen[1].excludedUrls, ['https://youtu.be/failed']);
  assert.equal(optionsSeen[1].expectedTitle, 'Coco - Ninho'); assert.equal(cached.cached, true); closeMedia(cached);
});

test('annulation avant cache ne lance jamais une source alternative', async () => {
  let calls = 0; const source = new PassThrough();
  await assert.rejects(preparePlaybackInput('https://youtu.be/song', 'Artist - Song', {
    resolveInput: async () => { calls++; return { stream: source }; },
    cacheAudio: async () => { throw Object.assign(new Error('cancel'), { code: 'AUDIO_CANCELLED' }); },
  }), { code: 'AUDIO_CANCELLED' });
  assert.equal(calls, 1); assert.equal(source.destroyed, true);
});
