const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PresenceManager } = require('../utils/presenceManager');

test('la présence globale ne révèle pas le titre joué sur un serveur', () => {
  const sent = [];
  const manager = new PresenceManager({
    client: { user: { setPresence: (presence) => sent.push(presence) } },
    database: {
      getGlobalSetting: () => null,
      setGlobalSetting() {},
    },
  });

  manager.start();
  manager.setMusicActivity('guild:one', { title: 'Titre privé du serveur A' });
  manager.setMusicActivity('guild:two', { title: 'Titre privé du serveur B' });
  assert.equal(manager.musicActivities.size, 2);
  assert.equal(sent.at(-1).activities[0].name, '🎵 lecture en cours');
  assert.doesNotMatch(JSON.stringify(sent.at(-1)), /Titre privé du serveur/);

  manager.setMusicActivity('guild:one', null);
  assert.equal(sent.at(-1).activities[0].name, '🎵 lecture en cours');
  manager.setMusicActivity('guild:two', null);
  manager.stop();
});
