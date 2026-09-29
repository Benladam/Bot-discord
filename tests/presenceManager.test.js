const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PresenceManager } = require('../utils/presenceManager');

test('la présence globale reste indépendante de la musique de chaque serveur', () => {
  const sent = [];
  const manager = new PresenceManager({
    client: { user: { setPresence: (presence) => sent.push(presence) } },
    database: {
      getGlobalSetting: () => null,
      setGlobalSetting() {},
    },
  });

  manager.start();
  const initial = sent.at(-1);
  assert.equal(manager.setMusicActivity('guild:one', { title: 'Titre privé du serveur A' }), false);
  assert.equal(manager.setMusicActivity('guild:two', { title: 'Titre privé du serveur B' }), false);
  assert.deepEqual(sent.at(-1), initial);
  assert.doesNotMatch(JSON.stringify(sent.at(-1)), /Titre privé du serveur/);

  manager.setMusicActivity('guild:one', null);
  assert.deepEqual(sent.at(-1), initial);
  manager.setMusicActivity('guild:two', null);
  manager.stop();
});
