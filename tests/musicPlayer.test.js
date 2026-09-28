const { test } = require('node:test');
const assert = require('node:assert/strict');
const { OpusSender } = require('../utils/audioSender');

test('une erreur d’extraction audio remet le lecteur à l’arrêt', async () => {
  const originalStart = OpusSender.start;
  OpusSender.start = async () => { throw new Error('YouTube bloque la lecture'); };
  delete require.cache[require.resolve('../utils/musicPlayer')];
  const { MusicPlayer } = require('../utils/musicPlayer');

  try {
    const player = new MusicPlayer('guild', {
      user: { id: 'bot', setActivity() {} },
    });
    player.connection = { connected: true };
    player.addToQueue({ title: 'Test', url: 'https://youtu.be/abc123' });

    await assert.rejects(player.playNext(), /YouTube bloque la lecture/);
    assert.equal(player.isPlaying, false);
    assert.equal(player.isPaused, false);
    assert.equal(player.current, null);
    assert.equal(player.sender, null);
  } finally {
    OpusSender.start = originalStart;
    delete require.cache[require.resolve('../utils/musicPlayer')];
  }
});
