const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { OpusSender } = require('./audioSender');

test('Stop invalide les ajouts anciens en attente de la préparation précédente', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const originalStart = OpusSender.start;
  let release;
  const urls = [];
  OpusSender.start = async (_connection, url) => {
    urls.push(url);
    await new Promise(resolve => { release = resolve; });
    return { stop() {}, setVolume() {} };
  };
  const player = new MusicPlayer('epoch', { user: { id: 'bot' } });
  player.connection = { connected: true, channelId: 'voice' };
  try {
    const first = player.enqueueSongs([{ title: 'Premier', url: 'first' }], { voiceChannel: { id: 'voice' } });
    await new Promise(setImmediate);
    const oldRequest = player.enqueueSongs([{ title: 'Je suis un voyou', url: 'old' }], { voiceChannel: { id: 'voice' } });
    const cancelled = Promise.all([assert.rejects(first, { code: 'AUDIO_CANCELLED' }), assert.rejects(oldRequest, { code: 'AUDIO_CANCELLED' })]);
    player.stop(); release(); await cancelled;
    assert.deepEqual(urls, ['first']); assert.equal(player.current, null); assert.deepEqual(player.queue, []);
  } finally { player._clearIdleTimer(); OpusSender.start = originalStart; }
});

test('un flux interrompu ne déclenche pas un ancien titre de la file', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const originalStart = OpusSender.start;
  let fail;
  const starts = [];
  OpusSender.start = async (_connection, url, _begin, _end, onError) => {
    starts.push(url); fail = onError;
    return { stop() {}, setVolume() {} };
  };
  const player = new MusicPlayer('no-auto-error', { user: { id: 'bot' } });
  player.connection = { connected: true, channelId: 'voice' };
  try {
    await player.enqueueSongs([{ title: 'J’fais mes affaires', url: 'requested' }, { title: 'Je suis un voyou', url: 'old' }], { voiceChannel: { id: 'voice' } });
    await fail(new Error('Flux coupé'));
    assert.deepEqual(starts, ['requested']); assert.equal(player.current, null); assert.deepEqual(player.queue, []);
  } finally { player.stop(); player._clearIdleTimer(); OpusSender.start = originalStart; }
});

test('prépare le flux avant de rejoindre le vocal et ne le recherche pas deux fois', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const originalPrepare = OpusSender.prepare;
  const originalStart = OpusSender.start;
  const events = [];
  const media = { url: 'https://example.test/audio' };
  const player = new MusicPlayer('prepare-guild', { user: { id: 'bot' } });
  OpusSender.prepare = async () => { events.push('prepare'); return media; };
  OpusSender.start = async (_conn, _url, _begin, _end, _error, _query, options) => {
    events.push('start'); assert.equal(options.preparedMedia, media);
    return { setVolume() {}, stop() {} };
  };
  player.ensureConnection = async channel => { events.push('connect'); player.connection = { connected: true, channelId: channel.id }; };
  try {
    await player.enqueueSongs([{ title: 'Titre', url: 'song' }], { voiceChannel: { id: 'voice' } });
    assert.deepEqual(events, ['prepare', 'connect', 'start']);
    assert.equal(player.isPlaying, true);
    player.stop(); player._clearIdleTimer();
  } finally { OpusSender.prepare = originalPrepare; OpusSender.start = originalStart; }
});

test('une recherche audio ratée ne fait pas rejoindre le vocal', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const originalPrepare = OpusSender.prepare;
  const player = new MusicPlayer('no-join', { user: { id: 'bot' } });
  player.ensureConnection = assert.fail;
  OpusSender.prepare = async () => { throw new Error('introuvable'); };
  try {
    await assert.rejects(player.enqueueSongs([{ title: 'Titre', url: 'song' }], { voiceChannel: { id: 'voice' } }), /introuvable/);
    assert.equal(player.current, null); assert.equal(player.connection, null);
  } finally { OpusSender.prepare = originalPrepare; }
});

test('Stop pendant la recherche ferme la source et ne rejoint pas le vocal', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const { PassThrough } = require('node:stream');
  const originalPrepare = OpusSender.prepare;
  const player = new MusicPlayer('cancel-prepare', { user: { id: 'bot' } });
  const source = new PassThrough();
  let release;
  OpusSender.prepare = () => new Promise(resolve => { release = resolve; });
  player.ensureConnection = assert.fail;
  try {
    const pending = player.enqueueSongs([{ title: 'Ancien', url: 'old' }], { voiceChannel: { id: 'voice' } });
    await new Promise(setImmediate);
    player.stop(); release({ stream: source });
    await assert.rejects(pending, { code: 'AUDIO_CANCELLED' });
    assert.equal(source.destroyed, true); assert.equal(player.current, null); assert.equal(player.queue.length, 0);
  } finally { OpusSender.prepare = originalPrepare; }
});

test('une erreur d’extraction audio remet le lecteur à l’arrêt', async () => {
  const originalStart = OpusSender.start;
  OpusSender.start = async () => { throw new Error('YouTube bloque la lecture'); };
  delete require.cache[require.resolve('./musicPlayer')];
  const { MusicPlayer } = require('./musicPlayer');

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
    delete require.cache[require.resolve('./musicPlayer')];
  }
});

test('une extraction annulée par Stop ne relance rien et ne remet pas à zéro le nouveau morceau', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const originalStart = OpusSender.start;
  let rejectOld;
  let oldOptions;
  const oldExtraction = new Promise((_resolve, reject) => { rejectOld = reject; });
  const newSender = { stop() {}, setVolume() {} };
  OpusSender.start = async (_connection, url, _start, _end, _error, _query, options) => {
    if (url === 'old-track') { oldOptions = options; return oldExtraction; }
    return newSender;
  };
  const player = new MusicPlayer('guild-stop-race', { user: { id: 'bot-user' } });
  player.connection = { connected: true };
  try {
    player.addToQueue({ title: 'Niska - Chasse à l’homme', duration: 164, url: 'old-track' });
    const pending = player.playNext();
    await new Promise(setImmediate);
    assert.equal(oldOptions.expectedTitle, 'Niska - Chasse à l’homme');
    assert.equal(oldOptions.expectedDuration, 164);
    assert.equal(oldOptions.guildId, 'guild-stop-race');
    assert.equal(oldOptions.shouldStart(), true);
    player.stop();
    assert.equal(oldOptions.shouldStart(), false);
    player.addToQueue({ title: 'Nouveau morceau', url: 'new-track' });
    await player.playNext();
    rejectOld(Object.assign(new Error('Annulée'), { code: 'AUDIO_CANCELLED' }));
    assert.equal(await pending, null);
    assert.equal(player.isPlaying, true);
    assert.equal(player.current.title, 'Nouveau morceau');
    assert.equal(player.sender, newSender);
  } finally {
    rejectOld(new Error('nettoyage'));
    player.stop();
    player._clearIdleTimer();
    OpusSender.start = originalStart;
  }
});

test('un skip remonte l’échec du titre suivant au lieu de signaler un faux succès', async () => {
  const { MusicPlayer } = require('./musicPlayer');
  const originalStart = OpusSender.start;
  const failure = Object.assign(new Error('Aucun résultat correspondant à Réseaux'), { code: 'MUSIC_TRACK_MISMATCH' });
  OpusSender.start = async () => { throw failure; };
  const player = new MusicPlayer('guild-skip-failure', { user: { id: 'bot-user' } });
  player.connection = { connected: true };
  player.current = { title: 'Love d’un voyou' };
  player.isPlaying = true;
  let ended = 0;
  player.onQueueEnd = () => ended++;
  player.addToQueue({ title: 'Niska - Réseaux', url: 'next' });
  try {
    await assert.rejects(player.skip(), error => error === failure);
    assert.equal(player.current, null);
    assert.equal(player.isPlaying, false);
    assert.equal(ended, 0, 'un échec de lecture ne doit pas être présenté comme une fin normale de file');
  } finally {
    player.stop();
    player._clearIdleTimer();
    OpusSender.start = originalStart;
  }
});

test('les handshakes vocaux restent isolés par serveur et utilisent le bon shard', async () => {
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
  const { VoiceConnection } = require('./voice');
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
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
  const originalStart = OpusSender.start;
  const originalPrepare = OpusSender.prepare;
  OpusSender.prepare = async () => ({ url: 'https://example.test/audio' });
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
    OpusSender.prepare = originalPrepare;
  }
});

test('un skip pendant la préparation audio annule le démarrage obsolète', async () => {
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
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
  await new Promise((resolve, reject) => {
    let finished = false;
    const timeout = setTimeout(() => {
      finished = true;
      reject(new Error('l’avis temporaire n’a pas expiré à temps'));
    }, 2000);
    const waitForDelete = () => {
      if (finished) return;
      if (deleted) {
        finished = true;
        clearTimeout(timeout);
        resolve();
      } else setTimeout(waitForDelete, 10);
    };
    waitForDelete();
  });

  assert.equal(destroyed, true);
  assert.equal(player.connection, null);
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].embeds[0].data.title, /inactivité/);
  assert.match(notifications[0].embeds[0].data.description, /\/24-7/);
  assert.deepEqual(leavePackets[0], { op: 4, d: { guild_id: guildId, channel_id: null, self_mute: false, self_deaf: false } });
  assert.equal(deleted, 1, 'l’avis temporaire est supprimé après son délai');
});

test('le mode 24/7 empêche les minuteurs d’inactivité, même s’il est activé avant leur échéance', async () => {
  const { MusicPlayer } = require('./musicPlayer');
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
  const { MusicPlayer } = require('./musicPlayer');
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
