const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuildNowPlayingManager, SETTING_KEY } = require('../utils/guildNowPlaying');

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
  assert.match(messageA.payload.embeds[0].toJSON().title, /Aucune musique/);
  assert.match(JSON.stringify(messageB.payload.embeds[0].toJSON()), /Titre serveur fipfap/);
});
