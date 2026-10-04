const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { startRecoveringPlayback } = require('./playbackRecovery');
const flush = () => new Promise(setImmediate);
const interrupted = position => Object.assign(new Error('coupure'), { code: 'AUDIO_PREMATURE_END', playbackPosition: position });

function harness(overrides = {}) {
  const attempts = [], prepared = [], errors = [];
  let starts = 0, ends = 0;
  return { attempts, prepared, errors, get starts() { return starts; }, get ends() { return ends; },
    start: () => startRecoveringPlayback({
      startAttempt: async options => {
        const controls = { stops: 0, pauses: 0, volume: 1,
          stop() { this.stops++; }, pause() { this.pauses++; }, resume() {}, setVolume(value) { this.volume = value; } };
        attempts.push({ ...options, controls }); options.onStart(); return controls;
      },
      prepareRecovery: async (error, attempt) => { prepared.push({ error, attempt }); return { url: 'same-track' }; },
      onStart: () => starts++, onEnd: () => ends++, onError: error => errors.push(error), ...overrides,
    }),
  };
}

test('126/222 secondes : reprise à la position entendue, un seul début et une seule fin', async () => {
  const h = harness(); const sender = await h.start();
  h.attempts[0].onError(interrupted(126)); await flush();
  assert.equal(h.attempts[1].resumeAt, 126);
  assert.equal(h.prepared[0].attempt, 1);
  assert.equal(h.attempts[0].controls.stops, 1);
  h.attempts[0].onEnd(); assert.equal(h.ends, 0);
  h.attempts[1].onEnd(); h.attempts[1].onEnd();
  assert.equal(h.starts, 1); assert.equal(h.ends, 1); assert.deepEqual(h.errors, []);
  sender.stop();
});

test('la reprise respecte pause et volume, et reste indépendante des autres lecteurs', async () => {
  const h = harness(), other = harness();
  const sender = await h.start(), second = await other.start();
  sender.pause(); sender.setVolume(0.4);
  h.attempts[0].onError(interrupted(20)); await flush();
  assert.equal(h.attempts[1].controls.volume, 0.4);
  assert.equal(h.attempts[1].controls.pauses, 1);
  assert.equal(other.attempts.length, 1); assert.equal(other.attempts[0].controls.stops, 0);
  sender.stop(); second.stop();
});

test('Stop/skip pendant la recherche ferme le flux tardif et ne lance aucun autre titre', async () => {
  let release;
  const media = new PassThrough();
  const h = harness({ prepareRecovery: () => new Promise(resolve => { release = resolve; }) });
  const sender = await h.start(); h.attempts[0].onError(interrupted(10)); sender.stop();
  release({ stream: media }); await flush();
  assert.equal(media.destroyed, true); assert.equal(h.attempts.length, 1);
  assert.deepEqual(h.errors, []); assert.equal(h.ends, 0);
});

test('deux reprises maximum, puis une erreur définitive unique', async () => {
  const h = harness(); const sender = await h.start();
  for (let i = 0; i < 3; i++) { h.attempts[i].onError(interrupted(20 + i)); await flush(); }
  assert.equal(h.attempts.length, 3); assert.equal(h.prepared.length, 2); assert.equal(h.errors.length, 1);
  h.attempts[2].onError(interrupted(99)); assert.equal(h.errors.length, 1);
  sender.stop();
});

test('un échec de démarrage FFmpeg en reprise ne laisse pas le lecteur bloqué', async () => {
  let calls = 0, preparations = 0, reported = 0, initial;
  const sender = await startRecoveringPlayback({
    startAttempt: async options => { calls++; if (calls > 1) throw new Error('FFmpeg absent'); initial = options; return { stop() {} }; },
    prepareRecovery: async () => { preparations++; return { stream: new PassThrough() }; },
    onError: error => { assert.match(error.message, /FFmpeg absent/); reported++; },
  });
  initial.onError(interrupted(126)); await flush();
  assert.equal(calls, 3); assert.equal(preparations, 2); assert.equal(reported, 1); sender.stop();
});

test('un morceau différent est refusé sans tentative automatique supplémentaire', async () => {
  const h = harness(); const sender = await h.start();
  h.attempts[0].onError(Object.assign(new Error('autre titre'), { code: 'MUSIC_TRACK_MISMATCH' }));
  await flush(); assert.equal(h.prepared.length, 0); assert.equal(h.errors.length, 1); sender.stop();
});
