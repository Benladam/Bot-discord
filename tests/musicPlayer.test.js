const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { OpusSender } = require('../features/music/audioSender');

test('une erreur d’extraction audio remet le lecteur à l’arrêt', async () => {
  const originalStart = OpusSender.start;
  OpusSender.start = async () => { throw new Error('YouTube bloque la lecture'); };
  delete require.cache[require.resolve('../features/music/musicPlayer')];
  const { MusicPlayer } = require('../features/music/musicPlayer');

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
    delete require.cache[require.resolve('../features/music/musicPlayer')];
  }
});

test('les handshakes vocaux restent isolés par serveur et utilisent le bon shard', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
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
  const { MusicPlayer } = require('../features/music/musicPlayer');
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
  const { MusicPlayer } = require('../features/music/musicPlayer');
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
  const { MusicPlayer } = require('../features/music/musicPlayer');
  const { VoiceConnection } = require('../features/music/voice');
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
  const { MusicPlayer } = require('../features/music/musicPlayer');
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

test('deux ajouts simultanés restent en file sans remplacer la première piste', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  const originalStart = OpusSender.start;
  let releaseFirst;
  const firstStart = new Promise((resolve) => { releaseFirst = resolve; });
  const starts = [];
  OpusSender.start = async (_connection, url) => {
    starts.push(url);
    if (url === 'track-a') await firstStart;
    return { setVolume() {}, stop() {} };
  };

  try {
    const player = new MusicPlayer('guild-queue-race', { user: { id: 'bot-user' } });
    player.connection = { connected: true, channelId: 'voice-a' };
    const context = { voiceChannel: { id: 'voice-a', name: 'Général' } };
    const addFirst = player.enqueueSongs([{ title: 'A', url: 'track-a' }], context);
    await new Promise(setImmediate);
    assert.deepEqual(starts, ['track-a']);

    const addSecond = player.enqueueSongs([{ title: 'B', url: 'track-b' }], context);
    await new Promise(setImmediate);
    assert.equal(player.current.title, 'A');
    assert.equal(player.queue.length, 0, 'la deuxième mutation attend la fin de la préparation du lecteur');

    releaseFirst();
    const [first, second] = await Promise.all([addFirst, addSecond]);
    assert.equal(first.queued, false);
    assert.equal(second.queued, true);
    assert.equal(player.current.title, 'A');
    assert.deepEqual(player.queue.map((song) => song.title), ['B']);
    assert.deepEqual(starts, ['track-a'], 'aucun second démarrage ne doit couper la piste courante');
    player.stop();
    player._clearIdleTimer();
  } finally {
    releaseFirst();
    OpusSender.start = originalStart;
  }
});

test('un lecteur inactif rejoint le salon demandé, mais ne déplace pas une lecture active', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  const originalStart = OpusSender.start;
  OpusSender.start = async () => ({ setVolume() {}, stop() {} });
  try {
    const player = new MusicPlayer('guild-channel-guard', { user: { id: 'bot-user' } });
    player.connection = { connected: true, channelId: 'voice-old' };
    player.ensureConnection = async (channel) => {
      player.connection = { connected: true, channelId: channel.id };
      return player.connection;
    };
    await player.enqueueSongs([{ title: 'Nouvelle', url: 'track-new' }], {
      voiceChannel: { id: 'voice-new', name: 'Salon nouveau' },
    });
    assert.equal(player.connection.channelId, 'voice-new');

    player.current = { title: 'En cours', url: 'track-current' };
    player.isPlaying = true;
    await assert.rejects(player.enqueueSongs([{ title: 'Autre', url: 'track-other' }], {
      voiceChannel: { id: 'voice-other', name: 'Autre salon' },
    }), /déjà dans un autre salon vocal/);
    assert.equal(player.connection.channelId, 'voice-new');
    player.stop();
    player._clearIdleTimer();
  } finally {
    OpusSender.start = originalStart;
  }
});

test('un skip pendant la préparation audio annule le démarrage obsolète', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  const originalStart = OpusSender.start;
  const gates = new Map();
  const starts = [];
  const stopped = [];
  for (const url of ['track-a', 'track-b']) {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    gates.set(url, { promise, release });
  }
  OpusSender.start = async (_connection, url) => {
    starts.push(url);
    await gates.get(url).promise;
    return { setVolume() {}, stop() { stopped.push(url); } };
  };

  try {
    const player = new MusicPlayer('guild-skip-race', { user: { id: 'bot-user' } });
    player.connection = { connected: true, channelId: 'voice-a' };
    const add = player.enqueueSongs([
      { title: 'A', url: 'track-a' },
      { title: 'B', url: 'track-b' },
    ], { voiceChannel: { id: 'voice-a', name: 'Général' } });
    await new Promise(setImmediate);
    const skip = player.skip();
    await new Promise(setImmediate);
    assert.deepEqual(starts, ['track-a', 'track-b']);
    assert.equal(player.current.title, 'B');

    gates.get('track-a').release();
    await new Promise(setImmediate);
    assert.deepEqual(stopped, ['track-a']);
    gates.get('track-b').release();
    await Promise.all([add, skip]);
    assert.equal(player.sender != null, true);
    assert.equal(player.current.title, 'B');
    player.stop();
    player._clearIdleTimer();
  } finally {
    gates.get('track-a').release();
    gates.get('track-b').release();
    OpusSender.start = originalStart;
  }
});

test('la fin naturelle de la file notifie le demandeur et libère le lecteur', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  const originalStart = OpusSender.start;
  let finishTrack;
  let notifiedRequester;
  let queueEndCount = 0;
  OpusSender.start = async (_connection, _url, _onStarted, onFinished) => {
    finishTrack = onFinished;
    return { setVolume() {}, stop() {} };
  };

  try {
    const player = new MusicPlayer('guild-finished', { user: { id: 'bot-user' } });
    player.connection = { connected: true, channelId: 'voice-a' };
    player.onQueueEnd = async (_instance, requesterId) => {
      notifiedRequester = requesterId;
      queueEndCount += 1;
    };
    await player.enqueueSongs([{ title: 'Fin', url: 'track-end' }], {
      voiceChannel: { id: 'voice-a', name: 'Général' },
      requesterId: '123456789012345678',
    });
    await finishTrack();
    assert.equal(notifiedRequester, '123456789012345678');
    assert.equal(player.current, null);
    assert.equal(player.isPlaying, false);
    assert.equal(player.sender, null);

    player.current = { title: 'Passée par skip' };
    player.isPlaying = true;
    await player.skip();
    assert.equal(queueEndCount, 2, 'skipper le dernier titre de la file déclenche aussi l’avis de fin');
    assert.equal(notifiedRequester, null);
    player._clearIdleTimer();
  } finally {
    OpusSender.start = originalStart;
  }
});

test('le délai d’inactivité publie un embed puis quitte le vocal', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  let destroyed = false;
  let deleted = 0;
  const leavePackets = [];
  const notifications = [];
  const guildId = 'guild-idle-notice';
  const shard = { send: (packet) => leavePackets.push(packet) };
  const client = { user: { id: 'bot-user' }, guilds: { cache: new Map([[guildId, { shard }]]) } };
  const player = new MusicPlayer(guildId, client, { inactivityTimeoutMs: 10, noticeTtlMs: 10 });
  player.connection = { connected: true, channelId: 'voice-idle', destroy() { destroyed = true; } };
  player.lastChannel = { send: async (payload) => { notifications.push(payload); return { delete: async () => { deleted += 1; } }; } };

  player._scheduleIdleLeave();
  await new Promise((resolve) => setTimeout(resolve, 45));

  assert.equal(destroyed, true);
  assert.equal(player.connection, null);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].embeds[0].data.title, /inactivité/);
  assert.match(notifications[0].embeds[0].data.description, /\/24-7/);
  assert.deepEqual(leavePackets[0], { op: 4, d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false } });
  assert.equal(deleted, 1, 'l’avis temporaire est supprimé après son délai');
});

test('le mode 24/7 empêche les minuteurs d’inactivité, même s’il est activé avant leur échéance', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  let alwaysOn = false;
  let destroyed = false;
  let notifications = 0;
  const player = new MusicPlayer('guild-always-on', { user: { id: 'bot-user' } }, {
    inactivityTimeoutMs: 10,
    keepAlive: () => alwaysOn,
  });
  player.connection = { connected: true, channelId: 'voice-always-on', destroy() { destroyed = true; } };
  player.lastChannel = { send: async () => { notifications += 1; } };
  player._hasHumanMembers = () => false;

  player._scheduleIdleLeave();
  player._scheduleAloneLeave('voice-always-on');
  assert.ok(player._idleTimer);
  assert.ok(player._aloneTimer);
  alwaysOn = true;
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(destroyed, false);
  assert.ok(player.connection);
  assert.equal(notifications, 0);
  player.destroy();
});

test('l’absence de membres déclenche une notification distincte avant de quitter', async () => {
  const { MusicPlayer } = require('../features/music/musicPlayer');
  let destroyed = false;
  const leavePackets = [];
  const notifications = [];
  const guildId = 'guild-alone-notice';
  const client = { user: { id: 'bot-user' }, guilds: { cache: new Map([[guildId, { shard: { send: (packet) => leavePackets.push(packet) } }]]) } };
  const player = new MusicPlayer(guildId, client, { inactivityTimeoutMs: 10 });
  player.connection = { connected: true, channelId: 'voice-empty', destroy() { destroyed = true; } };
  player._hasHumanMembers = () => false;
  player.lastChannel = { send: async (payload) => { notifications.push(payload); } };

  player._scheduleAloneLeave('voice-empty');
  await new Promise((resolve) => setTimeout(resolve, 35));

  assert.equal(destroyed, true);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].embeds[0].data.title, /salon vocal/);
  assert.match(notifications[0].embeds[0].data.description, /\/24-7/);
  assert.equal(leavePackets[0]?.d?.channel_id, null, 'le Gateway Discord reçoit bien la demande de départ');
});
