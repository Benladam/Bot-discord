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
  const { formatDuration, toAutocompleteChoice, selectAutocompleteItems } = require('../utils/catalogAutocomplete');
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
    respond: async (payload) => { response = payload; },
  });
  assert.deepEqual(response.choices, choices);
});

test('l’autocomplétion répond avec un choix de secours si un fournisseur dépasse le délai', async () => {
  const playCommand = require('../commands/play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => 'niska' },
    respond: async (payload) => { response = payload; },
  }, {
    autocompleteTimeoutMs: 5,
    searchCatalog: () => new Promise(() => {}),
  });

  assert.deepEqual(response.choices, [{ name: '🔎 Rechercher « niska »', value: 'niska' }]);
});

test('le Top mondial en retard renvoie un choix de secours au lieu de laisser expirer Discord', async () => {
  const playCommand = require('../commands/play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => '' },
    respond: async (payload) => { response = payload; },
  }, {
    autocompleteTimeoutMs: 5,
    getWorldTopTracks: () => new Promise(() => {}),
  });

  assert.deepEqual(response.choices, [{ name: '🌍 Rechercher « Top mondial »', value: 'top mondial' }]);
});
