const { test } = require('node:test');
const assert = require('node:assert/strict');
const { matchesRequestedTrack } = require('./trackMatching');

const requested = {
  query: "Niska Officiel - Niska - Chasse à l'homme #KeDuSal 2",
  expectedTitle: "Niska - Chasse à l'homme #KeDuSal 2",
  expectedDuration: 164,
};

test('Niska : accepte les métadonnées équivalentes sans exiger le hashtag du clip', () => {
  assert.equal(matchesRequestedTrack({
    name: 'Chasse a l’homme (Official Audio)',
    user: { username: 'Niska' }, durationInSec: 163,
  }, requested), true);
});

test('Niska : refuse les autres morceaux, artistes, versions et durées incohérentes', () => {
  for (const track of [
    { title: 'Niska - Réseaux', durationInSec: 164 },
    { title: 'Autre artiste - Chasse à l’homme', durationInSec: 164 },
    { title: 'Niska - Chasse à l’homme (Remix)', durationInSec: 164 },
    { title: 'Niska - Chasse à l’homme live', durationInSec: 164 },
    { title: 'Niska - Chasse à l’homme instrumental', durationInSec: 164 },
    { title: 'Niska - Chasse à l’homme', durationInSec: 30 },
    { title: 'Niska - Chasse à l’homme', durationInSec: 900 },
    { durationInSec: 164 },
  ]) assert.equal(matchesRequestedTrack(track, requested), false, JSON.stringify(track));
});

test('une requête artiste générique ne remplace pas le titre sélectionné', () => {
  assert.equal(matchesRequestedTrack({ title: 'Niska - Réseaux' }, {
    query: 'niska', expectedTitle: 'Niska - Chasse à l’homme',
  }), false);
});

test('une version remix explicitement demandée reste acceptée', () => {
  assert.equal(matchesRequestedTrack({ title: 'Niska - Chasse à l’homme Remix' }, {
    query: 'Niska - Chasse à l’homme Remix',
  }), true);
});
