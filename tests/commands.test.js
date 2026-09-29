const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandBuilder } = require('discord.js');

function serializeCommand(command) {
  let builder = new SlashCommandBuilder()
    .setName(command.data.name)
    .setDescription(command.data.description || 'Commande');

  for (const option of command.data.options || command.options || []) {
    if (option.type === 4) {
      builder = builder.addIntegerOption((item) => item
        .setName(option.name).setDescription(option.description || '').setRequired(!!option.required));
    } else if (option.type === 5) {
      builder = builder.addBooleanOption((item) => item
        .setName(option.name).setDescription(option.description || '').setRequired(!!option.required));
    } else if (option.type === 3) {
      builder = builder.addStringOption((item) => {
        item.setName(option.name).setDescription(option.description || '').setRequired(!!option.required);
        if (option.choices) item.addChoices(...option.choices);
        else if (option.autocomplete) item.setAutocomplete(true);
        return item;
      });
    }
  }

  return builder.toJSON();
}

test('les commandes play et playlist se sérialisent pour l’API Discord', () => {
  for (const name of ['play', 'playlist']) {
    const command = require(`../commands/${name}`);
    const json = serializeCommand(command);
    assert.equal(json.name, name);
    assert.ok(json.options.length > 0);
  }
});

test('les suggestions /play ont un format lisible et gardent morceaux et playlists', () => {
  const { formatDuration, formatChoiceName, toAutocompleteChoice, selectAutocompleteItems } = require('../utils/catalogAutocomplete');
  assert.equal(formatDuration(164), '02:44');
  const items = [
    ...Array.from({ length: 20 }, (_, i) => ({
      kind: 'track', title: `Titre ${i}`, subtitle: 'Niska', duration: 164, url: `https://music.test/track/${i}`,
    })),
    ...Array.from({ length: 12 }, (_, i) => ({
      kind: 'playlist', title: `Playlist ${i}`, subtitle: 'par un membre', url: `https://music.test/playlist/${i}`,
    })),
    { kind: 'artist', title: 'Niska', url: 'https://music.test/artist/niska' },
  ];
  const selected = selectAutocompleteItems(items);
  const choices = selected.map(toAutocompleteChoice);
  assert.equal(choices.length, 25);
  assert.match(choices[0].name, /^🎵 Niska - Titre 0 - 02:44$/);
  assert.ok(choices.some((choice) => choice.name.startsWith('📁 Playlist')));
  assert.ok(choices.every((choice) => choice.name.length <= 100 && choice.value.length <= 100));
  assert.doesNotMatch(formatChoiceName({ kind: 'track', title: 'https://youtube.com/watch?v=secret', subtitle: 'Niska' }), /https?:/i);
});

test('le champ /play vide propose les 25 morceaux du classement mondial Deezer', async () => {
  const { getWorldTopTracks } = require('../utils/musicCatalog');
  const { formatChoiceName, selectAutocompleteItems, toAutocompleteChoice } = require('../utils/catalogAutocomplete');
  const payload = {
    data: Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      title: `Titre ${index + 1}`,
      duration: 164,
      link: `https://www.deezer.com/track/${index + 1}`,
      artist: { name: `Artiste ${index + 1}` },
    })),
  };
  const items = await getWorldTopTracks({
    fresh: true,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.deezer.com/chart/0/tracks?limit=25');
      assert.ok(options.signal);
      return { ok: true, json: async () => payload };
    },
  });
  const choices = selectAutocompleteItems(items).map(toAutocompleteChoice);
  assert.equal(choices.length, 25);
  assert.match(choices[0].name, /^🌍 #1 · 🎵 Artiste 1 - Titre 1 - 02:44$/);
  assert.match(choices[24].name, /^🌍 #25 · /);
  assert.equal(formatChoiceName(items[0]), choices[0].name);
  assert.equal(choices[0].value, 'https://www.deezer.com/track/1');

  const playCommand = require('../commands/play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => '' },
    respond: async (choices) => { assert.ok(Array.isArray(choices)); response = choices; },
  });
  assert.deepEqual(response, choices);
});

test('/play sans query ouvre le Top 25 mondial au lieu de rendre le champ obligatoire', async () => {
  const playCommand = require('../commands/play');
  const option = playCommand.data.options.find((entry) => entry.name === 'query');
  assert.equal(option.required, false);

  const items = Array.from({ length: 25 }, (_, index) => ({
    provider: 'deezer', kind: 'track', title: `Titre ${index + 1}`,
    subtitle: `Artiste ${index + 1}`, url: `https://www.deezer.com/track/${index + 1}`,
    duration: 164, chartPosition: index + 1, worldChart: true,
  }));
  let deferred = false;
  let response;
  const ctx = {
    user: { id: 'user-1', username: 'Adam' },
    guildId: 'guild-1',
    isChatInputCommand: () => true,
    async deferReply(options) { deferred = options.ephemeral; },
    async editReply(payload) { response = payload; return payload; },
  };

  await playCommand.execute(ctx, [], {
    getWorldTopTracks: async () => items,
    logger: { info() {}, warn() {}, error() {} },
  });

  assert.equal(deferred, true);
  assert.equal(response.embeds[0].data.title, '🌍 Top 25 mondial');
  assert.equal(response.components.length, 2);
  assert.equal(response.components[0].components[0].toJSON().options.length, 25);
});

test('l’autocomplétion répond avec un choix de secours si un fournisseur dépasse le délai', async () => {
  const playCommand = require('../commands/play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => 'niska' },
    respond: async (choices) => { assert.ok(Array.isArray(choices)); response = choices; },
  }, {
    autocompleteTimeoutMs: 5,
    searchCatalog: () => new Promise(() => {}),
  });

  assert.deepEqual(response, [{ name: '🔎 Rechercher « niska »', value: 'niska' }]);
});

test('le Top mondial en retard renvoie un choix de secours au lieu de laisser expirer Discord', async () => {
  const playCommand = require('../commands/play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => '' },
    respond: async (choices) => { assert.ok(Array.isArray(choices)); response = choices; },
  }, {
    autocompleteTimeoutMs: 5,
    getWorldTopTracks: () => new Promise(() => {}),
  });

  assert.deepEqual(response, [{ name: '🌍 Rechercher « Top mondial »', value: 'top mondial' }]);
});

test('l’autocomplétion d’un lien YouTube recherche le titre et affiche les noms, pas les URL', async () => {
  const playCommand = require('../commands/play');
  let searched;
  let response;
  await playCommand.autocomplete({
    user: { id: 'user-1' },
    guildId: 'guild-1',
    options: { getFocused: () => 'https://youtu.be/epmR0g3udAk?si=PRIVATE' },
    respond: async (choices) => { response = choices; },
  }, {
    autocompleteTimeoutMs: 1800,
    fetch: async () => ({ ok: true, json: async () => ({ title: 'Chasse à l’homme', author_name: 'Niska' }) }),
    searchCatalog: async (query) => {
      searched = query;
      return [{ kind: 'track', provider: 'youtube', title: 'Chasse à l’homme', subtitle: 'Niska', url: 'https://youtube.com/watch?v=epmR0g3udAk' }];
    },
  });
  assert.equal(searched, 'Niska - Chasse à l’homme');
  assert.match(response[0].name, /Niska - Chasse à l’homme/);
  assert.doesNotMatch(response[0].name, /https?:/i);
});

test('si un fournisseur ne fournit aucun titre, le choix de secours ne révèle pas le lien', async () => {
  const playCommand = require('../commands/play');
  let response;
  await playCommand.autocomplete({
    user: { id: 'user-2' },
    guildId: 'guild-2',
    options: { getFocused: () => 'https://youtu.be/abcdefghijk?si=PRIVATE' },
    respond: async (choices) => { response = choices; },
  }, {
    autocompleteTimeoutMs: 1800,
    fetch: async () => ({ ok: false, status: 404 }),
    searchCatalog: async () => [],
  });
  assert.equal(response.length, 1);
  assert.match(response[0].name, /Lien YouTube/);
  assert.doesNotMatch(JSON.stringify(response), /youtu\.be|PRIVATE|abcdefghijk/);
  assert.match(response[0].value, /^music-ref:/);
});

test('un /play Spotify localisé affiche une recherche par titre et journalise le lien sans paramètres privés', async () => {
  const playCommand = require('../commands/play');
  const logs = [];
  let searched;
  let edited;
  const ctx = {
    user: { id: 'user-1', username: 'Adam', tag: 'Adam#0001' },
    member: { voice: { channel: { id: 'voice-1' } } },
    guildId: 'guild-1',
    guild: { id: 'guild-1', name: 'Test' },
    channel: { id: 'text-1', guildId: 'guild-1' },
    isChatInputCommand: () => true,
    async deferReply() {},
    async editReply(payload) { edited = payload; return payload; },
    async reply(payload) { edited = payload; return payload; },
  };
  await playCommand.execute(ctx, [
    'https://open.spotify.com/intl-fr/track/518c5Dr5EmpzACX268Aeqs?si=PRIVATE',
  ], {
    logger: { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) },
    fetch: async () => ({ ok: true, json: async () => ({ title: 'Dracula (with JENNIE) - Tame Impala' }) }),
    searchCatalog: async (query) => {
      searched = query;
      return [{ kind: 'track', provider: 'deezer', title: 'Dracula (with JENNIE)', subtitle: 'Tame Impala', url: 'https://www.deezer.com/track/123' }];
    },
  });
  assert.equal(searched, 'Dracula (with JENNIE) - Tame Impala');
  assert.match(edited.embeds[0].data.title, /Dracula \(with JENNIE\)/);
  assert.match(logs.join('\n'), /entrée=lien plateforme=Spotify/);
  assert.match(logs.join('\n'), /Tame Impala/);
  assert.doesNotMatch(logs.join('\n'), /PRIVATE/);
  assert.doesNotMatch(edited.embeds[0].data.title, /open\.spotify/);
});
