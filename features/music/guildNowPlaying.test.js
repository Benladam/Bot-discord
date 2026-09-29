const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuildNowPlayingManager, SETTING_KEY, controlComponents, statusEmbed } = require('./guildNowPlaying');

function makeGuild(guildId, guildName, channelId) {
  const messages = new Map();
  let nextId = 0;
  const channel = {
    id: channelId,
    guildId,
    guild: { name: guildName },
    messages: { fetch: async (id) => messages.get(id) || null },
    async send(payload) {
      const message = {
        id: `${channelId}-message-${++nextId}`,
        payload,
        async edit(nextPayload) { this.payload = nextPayload; return this; },
        async delete() { messages.delete(this.id); return this; },
      };
      messages.set(message.id, message);
      return message;
    },
  };
  return { channel, messages };
}

test('chaque serveur possède et modifie son propre message en cours de lecture', async () => {
  const settings = new Map();
  const database = {
    getGuildSetting(guildId, key, fallback) { return settings.get(`${guildId}:${key}`) ?? fallback; },
    setGuildSetting(guildId, key, value) { settings.set(`${guildId}:${key}`, value); },
  };
  const a = makeGuild('guild-a', 'Test', 'text-a');
  const b = makeGuild('guild-b', 'fipfap', 'text-b');
  const client = { channels: { cache: new Map([[a.channel.id, a.channel], [b.channel.id, b.channel]]) } };
  const manager = new GuildNowPlayingManager({ client, database });
  const playerA = { guildId: 'guild-a', lastChannel: a.channel };
  const playerB = { guildId: 'guild-b', lastChannel: b.channel };

  await Promise.all([
    manager.update(playerA, { isPlaying: true, current: { title: 'Titre serveur Test' }, queueLength: 0, volume: 100 }),
    manager.update(playerB, { isPlaying: true, current: { title: 'Titre serveur fipfap' }, queueLength: 2, volume: 80 }),
  ]);
  const recordA = database.getGuildSetting('guild-a', SETTING_KEY);
  const recordB = database.getGuildSetting('guild-b', SETTING_KEY);
  const messageA = a.messages.get(recordA.messageId);
  const messageB = b.messages.get(recordB.messageId);
  assert.match(JSON.stringify(messageA.payload.embeds[0].toJSON()), /Titre serveur Test/);
  assert.doesNotMatch(JSON.stringify(messageA.payload.embeds[0].toJSON()), /Titre serveur fipfap/);
  assert.match(JSON.stringify(messageB.payload.embeds[0].toJSON()), /Titre serveur fipfap/);
  assert.doesNotMatch(JSON.stringify(messageB.payload.embeds[0].toJSON()), /Titre serveur Test/);

  await manager.update(playerA, { isPlaying: false, current: null, queueLength: 0, volume: 100 });
  assert.equal(a.messages.has(messageA.id), false, 'la carte en cours est retirée dès que le lecteur est inactif');
  assert.equal(database.getGuildSetting('guild-a', SETTING_KEY).messageId, null);
  assert.match(JSON.stringify(messageB.payload.embeds[0].toJSON()), /Titre serveur fipfap/);
});

test('la carte musicale fournit pause, suivant, stop, boucle et file sans bouton d’ajout', () => {
  const rows = controlComponents('guild-controls', {
    current: { title: 'Chanson' }, isPlaying: true, isPaused: false,
    queueLength: 2, loopMode: 0,
  }).map((row) => row.toJSON().components);
  const controls = rows[0];
  assert.deepEqual(controls.map((item) => item.custom_id), [
    'musicctl:guild-controls:pause',
    'musicctl:guild-controls:skip',
    'musicctl:guild-controls:stop',
    'musicctl:guild-controls:loop',
    'musicctl:guild-controls:queue',
  ]);
  assert.ok(controls.every((item) => item.emoji?.name));
  assert.ok(controls.every((item) => !/ajouter|play music/i.test(item.label)));
  assert.equal(rows[1][0].custom_id, 'musicctl:guild-controls:shuffle');
  assert.equal(rows[1][0].disabled, false);
  assert.match(rows[1][1].label, /Dashboard/);
  assert.ok(rows[1][1].url || rows[1][1].custom_id);
});

test('la carte affiche la plateforme et lie la piste sans republier les paramètres secrets', () => {
  const embed = statusEmbed({
    isPlaying: true,
    current: {
      title: 'Une chanson', provider: 'spotify',
      sourceUrl: 'https://open.spotify.com/track/abc123?si=secret-value',
    },
    queueLength: 1, volume: 72, loopMode: 1, addedBy: 'Adam', voiceChannelName: 'Général',
  }, 'Serveur Alpha').toJSON();
  assert.equal(embed.author.name, 'Spotify · Lecture en cours');
  assert.equal(embed.url, 'https://open.spotify.com/track/abc123');
  assert.match(embed.title, /Une chanson/);
  assert.doesNotMatch(JSON.stringify(embed), /secret-value/);
  assert.match(JSON.stringify(embed.fields), /72%|72/);
});

test('les boutons agissent uniquement depuis le même salon vocal', async () => {
  const manager = new GuildNowPlayingManager({ client: {}, database: {} });
  let replies = 0;
  let deferred = 0;
  let refreshed = 0;
  const player = {
    guildId: 'guild-controls',
    connection: { connected: true, channelId: 'voice-a' },
    current: { title: 'Titre' },
    isPlaying: true,
    isPaused: false,
    loopMode: 0,
    pause() { this.isPaused = true; return this._activity(); },
    resume() { this.isPaused = false; return this._activity(); },
    async _activity() { refreshed += 1; },
  };
  const makeInteraction = (customId, voiceId = 'voice-a') => ({
    customId,
    guildId: 'guild-controls',
    member: { voice: { channelId: voiceId } },
    async reply() { replies += 1; },
    async deferUpdate() { deferred += 1; },
  });

  await manager.handleControl(makeInteraction('musicctl:guild-controls:pause'), () => player);
  assert.equal(player.isPaused, true);
  assert.equal(deferred, 1);
  await manager.handleControl(makeInteraction('musicctl:guild-controls:loop'), () => player);
  assert.equal(player.loopMode, 1);
  assert.equal(deferred, 2);

  await manager.handleControl(makeInteraction('musicctl:guild-controls:pause', 'voice-b'), () => player);
  assert.equal(replies, 1);
  assert.equal(deferred, 2);
  assert.equal(refreshed, 2);
});

test('à la fin de la file, la carte est remplacée par un avis qui expire en 30 secondes', async () => {
  const settings = new Map();
  const database = {
    getGuildSetting(guildId, key, fallback) { return settings.get(`${guildId}:${key}`) ?? fallback; },
    setGuildSetting(guildId, key, value) { settings.set(`${guildId}:${key}`, value); },
  };
  const { channel, messages } = makeGuild('guild-end', 'Test', 'text-end');
  const client = { channels: { cache: new Map([[channel.id, channel]]) } };
  const manager = new GuildNowPlayingManager({ client, database, noticeTtlMs: 30 });
  const player = { guildId: 'guild-end', lastChannel: channel, isPlaying: true, current: { title: 'Fin' }, queue: [] };
  await manager.update(player, { isPlaying: true, current: { title: 'Fin' }, queueLength: 0, volume: 100 });
  const saved = database.getGuildSetting('guild-end', SETTING_KEY);
  const oldStatus = messages.get(saved.messageId);

  player.isPlaying = false;
  player.current = null;
  assert.equal(await manager.finishQueue(player, '123456789012345678'), true);
  assert.equal(messages.has(oldStatus.id), false, 'l’ancienne carte « en cours » est supprimée');
  const notice = [...messages.values()][0];
  assert.equal(notice.payload.embeds[0].toJSON().title, '📜 File d’attente terminée');
  assert.equal(notice.payload.content, '🎶 <@123456789012345678> — ta file de musique est terminée.');
  assert.deepEqual(notice.payload.allowedMentions.users, ['123456789012345678']);
  assert.equal(database.getGuildSetting('guild-end', SETTING_KEY).messageId, notice.id);
  assert.equal(database.getGuildSetting('guild-end', SETTING_KEY).finishedNotice, true);

  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(messages.has(notice.id), false, 'l’avis temporaire est retiré après expiration');
  assert.equal(database.getGuildSetting('guild-end', SETTING_KEY).messageId, null);
});

test('un nouveau morceau efface l’avis de fin et recrée une carte propre au serveur', async () => {
  const settings = new Map();
  const database = {
    getGuildSetting(guildId, key, fallback) { return settings.get(`${guildId}:${key}`) ?? fallback; },
    setGuildSetting(guildId, key, value) { settings.set(`${guildId}:${key}`, value); },
  };
  const { channel, messages } = makeGuild('guild-next', 'Test', 'text-next');
  const client = { channels: { cache: new Map([[channel.id, channel]]) } };
  const manager = new GuildNowPlayingManager({ client, database });
  const player = { guildId: 'guild-next', lastChannel: channel, isPlaying: true, current: { title: 'Ancien' }, queue: [] };
  await manager.update(player, { isPlaying: true, current: player.current, queueLength: 0, volume: 100 });
  player.isPlaying = false;
  player.current = null;
  await manager.finishQueue(player);
  const notice = [...messages.values()][0];

  player.isPlaying = true;
  player.current = { title: 'Nouveau' };
  await manager.update(player, { isPlaying: true, current: player.current, queueLength: 0, volume: 100 });
  assert.equal(messages.has(notice.id), false);
  const saved = database.getGuildSetting('guild-next', SETTING_KEY);
  assert.match(JSON.stringify(messages.get(saved.messageId).payload.embeds[0].toJSON()), /Nouveau/);
});

test('le redémarrage supprime les anciennes cartes sans restaurer une piste', async () => {
  const settings = new Map();
  const database = {
    getGuildSetting(guildId, key, fallback) { return settings.get(`${guildId}:${key}`) ?? fallback; },
    setGuildSetting(guildId, key, value) { settings.set(`${guildId}:${key}`, value); },
  };
  const { channel, messages } = makeGuild('guild-restart', 'Test', 'text-restart');
  const client = { channels: { cache: new Map([[channel.id, channel]]) } };
  const manager = new GuildNowPlayingManager({ client, database });
  const player = { guildId: 'guild-restart', lastChannel: channel };
  await manager.update(player, { isPlaying: true, current: { title: 'Avant redémarrage' }, queueLength: 1, volume: 100 });
  const saved = database.getGuildSetting('guild-restart', SETTING_KEY);
  assert.equal(messages.has(saved.messageId), true);

  assert.equal(await manager.resetAfterRestart(['guild-restart']), 1);
  assert.equal(messages.has(saved.messageId), false);
  assert.deepEqual(database.getGuildSetting('guild-restart', SETTING_KEY), { channelId: channel.id, messageId: null });
  assert.equal(player.queue, undefined, 'le statut n’enregistre jamais la file musicale à restaurer');
});
