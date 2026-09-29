const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

test('les handshakes vocaux restent isolés par serveur et utilisent le bon shard', async () => {
  const { MusicPlayer } = require('../utils/musicPlayer');
  const writes = new Map([[0, []], [1, []]]);
  const shards = new Map([...writes].map(([id, packets]) => [id, {
    send(packet) { packets.push(packet); },
  }]));

  const client = new EventEmitter();
  client.user = { id: 'bot-user' };

  const guildIdForShard = (shardId) => String((40n + BigInt(shardId)) << 22n);
  const guild0 = guildIdForShard(0);
  const guild1 = guildIdForShard(1);
  client.guilds = { cache: new Map([
    [guild0, { shard: shards.get(0) }],
    [guild1, { shard: shards.get(1) }],
  ]) };
  const player0 = new MusicPlayer(guild0, client);
  const player1 = new MusicPlayer(guild1, client);

  const request0 = player0._requestVoice('channel-0');
  let request1Resolved = false;
  const request1 = player1._requestVoice('channel-1').then((value) => {
    request1Resolved = true;
    return value;
  });

  assert.equal(writes.get(0).length, 1);
  assert.equal(writes.get(1).length, 1);
  assert.equal(writes.get(0)[0].d.guild_id, guild0);
  assert.equal(writes.get(1)[0].d.guild_id, guild1);

  client.emit('raw', { t: 'VOICE_SERVER_UPDATE', d: { guild_id: guild0, endpoint: 'voice-0', token: 'token-0' } });
  client.emit('raw', { t: 'VOICE_STATE_UPDATE', d: { guild_id: guild0, user_id: 'bot-user', channel_id: 'channel-0', session_id: 'session-0' } });
  await new Promise(setImmediate);
  assert.equal(request1Resolved, false, 'les paquets du premier serveur ne doivent pas valider le second handshake');

  client.emit('raw', { t: 'VOICE_STATE_UPDATE', d: { guild_id: guild1, user_id: 'bot-user', channel_id: 'channel-1', session_id: 'session-1' } });
  client.emit('raw', { t: 'VOICE_SERVER_UPDATE', d: { guild_id: guild1, endpoint: 'voice-1', token: 'token-1' } });

  assert.deepEqual(await request0, { endpoint: 'voice-0', token: 'token-0', sessionId: 'session-0' });
  assert.deepEqual(await request1, { endpoint: 'voice-1', token: 'token-1', sessionId: 'session-1' });
  assert.equal(client.listenerCount('raw'), 0);
});

test('chaque serveur garde sa propre chanson et sa propre file', () => {
  const { MusicPlayer } = require('../utils/musicPlayer');
  const client = { user: { id: 'bot-user', setActivity() {} } };
  const playerA = new MusicPlayer('guild-a', client);
  const playerB = new MusicPlayer('guild-b', client);
  playerA.addToQueue({ title: 'Titre A', url: 'https://example.test/a' });
  playerB.addToQueue({ title: 'Titre B', url: 'https://example.test/b' });
  playerA.current = playerA.getNextSong();
  playerB.current = playerB.getNextSong();

  assert.equal(playerA.getState().current.title, 'Titre A');
  assert.equal(playerB.getState().current.title, 'Titre B');
  playerA.stop();
  assert.equal(playerA.getState().current, null);
  assert.equal(playerB.getState().current.title, 'Titre B');
});

test('le lecteur publie un état local au serveur et ne change jamais la présence globale', () => {
  const { MusicPlayer } = require('../utils/musicPlayer');
  const globalActivities = [];
  const states = [];
  const player = new MusicPlayer('guild-a', { user: { id: 'bot-user', setActivity: (...args) => globalActivities.push(args) } });
  player.onActivityChange = (state) => states.push(state);
  player.current = { title: 'Titre privé A', url: 'https://private.test/stream?token=secret' };
  player.isPlaying = true;
  player._activity();

  assert.equal(states[0].current.title, 'Titre privé A');
  assert.equal(Object.hasOwn(states[0].current, 'url'), false);
  assert.deepEqual(globalActivities, []);
});

test('chaque lecteur transmet au encodeur le débit de son propre salon vocal', async () => {
  const { MusicPlayer } = require('../utils/musicPlayer');
  const { VoiceConnection } = require('../utils/voice');
  const originalConnect = VoiceConnection.prototype.connect;
  VoiceConnection.prototype.connect = async function connectForTest() {
    this.connected = true;
    return this;
  };
  try {
    const client = { user: { id: 'bot-user', setActivity() {} } };
    const playerA = new MusicPlayer('guild-a', client);
    const playerB = new MusicPlayer('guild-b', client);
    playerA._requestVoice = async () => ({ endpoint: 'voice-a', token: 'token-a', sessionId: 'session-a' });
    playerB._requestVoice = async () => ({ endpoint: 'voice-b', token: 'token-b', sessionId: 'session-b' });

    const connectionA = await playerA.ensureConnection({ id: 'channel-a', bitrate: 96_000 });
    const connectionB = await playerB.ensureConnection({ id: 'channel-b', bitrate: 192_000 });
    assert.equal(connectionA.audioBitrate, 96_000);
    assert.equal(connectionB.audioBitrate, 192_000);
    await playerA.ensureConnection({ id: 'channel-a', bitrate: 128_000 });
    assert.equal(connectionA.audioBitrate, 128_000, 'le débit est mis à jour si la configuration du vocal change');
    playerA.destroy();
    playerB.destroy();
  } finally {
    VoiceConnection.prototype.connect = originalConnect;
  }
});

test('un envoi Gateway vocal échoué nettoie le listener au lieu de le laisser expirer', async () => {
  const { MusicPlayer } = require('../utils/musicPlayer');
  const guildId = '123456789012345678';
  const client = new EventEmitter();
  client.user = { id: 'bot-user' };
  client.guilds = { cache: new Map([[guildId, {
    shard: { send() { throw new Error('gateway write failed'); } },
  }]]) };
  const player = new MusicPlayer(guildId, client);

  await assert.rejects(player._requestVoice('channel'), /gateway write failed/);
  assert.equal(client.listenerCount('raw'), 0);
});
