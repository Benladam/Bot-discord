const { test } = require('node:test');
const assert = require('node:assert/strict');
const { soundCloudMatchScore, soundCloudSearchQueries } = require('./soundCloudMatching');

const rr = { query: 'Koba LaD - RR 9.1', expectedTitle: 'RR 9.1 - Koba LaD', expectedDuration: 200 };

test('RR 9.1 : accepte ponctuation, espaces et collaboration créditée dans le titre', () => {
  for (const artist of ['Koba LaD', 'Koba La D', 'Koba Lad Official']) {
    for (const title of ['RR91 (feat. Niska)', 'Koba La D - RR 9.1 (Official Audio)', 'RR9 1']) {
      assert.ok(soundCloudMatchScore({ title, user: { username: artist }, durationInSec: 200 }, rr) > 0, `${artist} / ${title}`);
    }
  }
});

test('les métadonnées d’artiste sont conservées même si le compte diffuseur a un autre nom', () => {
  assert.equal(soundCloudMatchScore(null, rr), 0);
  assert.ok(soundCloudMatchScore({ title: 'RR 9.1', metadata_artist: 'Koba LaD, Niska', user: { username: 'Label' }, duration: 200 }, rr) > 0);
  assert.ok(soundCloudMatchScore({ title: 'RR 9.1', publisher_metadata: { artist: 'Koba La D' }, user: { username: 'Label' }, duration: 200 }, rr) > 0);
  assert.ok(soundCloudMatchScore({ title: 'Koba LaD - RR 9.1', user: { username: 'upload-anonyme' }, duration: 200 }, rr) > 0);
});

test('un compte différent est accepté uniquement avec attribution complète, durée et sans crédits contradictoires', () => {
  const upload = { title: 'koba la d rr9 1 (feat niska)', user: { username: 'tim_cnss' }, duration: 200 };
  assert.ok(soundCloudMatchScore(upload, rr) > 0);
  assert.ok(soundCloudMatchScore(upload, { query: rr.query }) > 0);
  assert.ok(soundCloudMatchScore({ ...upload, metadata_artist: '  ', artist: '' }, rr) > 0);
  for (const changes of [
    { title: 'RR9.1' }, { title: 'Koba Lady - RR9.1' }, { title: 'Koba LaD - RR91 Desire' },
    { duration: 0 }, { duration: 30 }, { duration: 250 }, { metadata_artist: 'Autre Artiste' },
  ]) assert.equal(soundCloudMatchScore({ ...upload, ...changes }, rr), 0, JSON.stringify(changes));
  assert.ok(soundCloudMatchScore({ ...upload, metadata_artist: 'Koba LaD' }, rr) > soundCloudMatchScore(upload, rr));
});

test('RR 9.1 : refuse mashups sans étiquette, mauvais artistes, extraits et versions alternatives', () => {
  for (const title of ['RR 91 Desire', 'RR 9.1 remix', 'RR 9.1 bootleg', 'RR 9.1 rework', 'RR 9.1 acoustic', 'RR 9.1 radio edit', 'RR 9.1 extended', 'RR 9.1 8D', 'RR 9.1 nightcore', 'RR 9.1 live', 'RR 9.1 parodie', 'RR 9.1 bass boosted', 'RR 9.1 dub', 'RR 9.1 flip', 'RR 9.1 extrait', 'RR 9.1 edit', 'RR 9.1 type beat']) {
    assert.equal(soundCloudMatchScore({ title, user: { username: 'Koba LaD' }, duration: 200 }, rr), 0, title);
  }
  assert.equal(soundCloudMatchScore({ title: 'RR 9.1', user: { username: 'Koba Lady' }, duration: 200 }, rr), 0);
  assert.equal(soundCloudMatchScore({ title: 'RR 9.1', user: { username: 'Koba LaD' }, duration: 30 }, rr), 0);
  assert.equal(soundCloudMatchScore({ title: 'RR 9.1', user: { username: 'Koba LaD' }, duration: 250 }, rr), 0);
});

test('le classement favorise les crédits artiste et une durée proche du titre demandé', () => {
  const best = soundCloudMatchScore({ title: 'RR 9.1', metadata_artist: 'Koba LaD', duration: 200 }, rr);
  assert.ok(best > soundCloudMatchScore({ title: 'RR 9.1', user: { username: 'Koba LaD' }, duration: 200 }, rr));
  assert.ok(best > soundCloudMatchScore({ title: 'RR 9.1', metadata_artist: 'Koba LaD', duration: 219 }, rr));
  assert.ok(best > soundCloudMatchScore({ title: 'RR 9.1', metadata_artist: 'Koba LaD' }, rr));
});

test('une version remix demandée reste acceptée; le duo Djadja & Dinaz reste entier', () => {
  assert.ok(soundCloudMatchScore({ title: 'RR 9.1 Remix', user: { username: 'Koba LaD' } }, { query: 'Koba LaD - RR 9.1 Remix' }) > 0);
  const duo = { query: "Djadja & Dinaz - J'fais mes affaires", expectedDuration: 276 };
  assert.ok(soundCloudMatchScore({ title: "J'fais mes affaires", metadata_artist: 'Djadja & Dinaz', duration: 276 }, duo) > 0);
  assert.equal(soundCloudMatchScore({ title: "J'fais mes affaires", metadata_artist: 'Djadja', duration: 276 }, duo), 0);
});

test('les recherches supplémentaires sont bornées et incluent numéro compact et ordre inversé', () => {
  assert.deepEqual(soundCloudSearchQueries(rr.query, rr.expectedTitle), ['rr 9 1 koba lad', 'koba lad rr 91', 'rr 91 koba lad']);
  assert.deepEqual(soundCloudSearchQueries('Niska Officiel - Niska - Réseaux (Clip Officiel)', 'Niska - Réseaux (Clip Officiel)'), ['niska reseaux', 'reseaux niska']);
});
