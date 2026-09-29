const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandBuilder } = require('discord.js');

function serializeCommand(command) {
  let builder = new SlashCommandBuilder()
    .setName(command.data.name)
    .setDescription(command.data.description || 'Commande');
  if (command.data.defaultMemberPermissions !== undefined) {
    builder = builder.setDefaultMemberPermissions(command.data.defaultMemberPermissions);
  }

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
    const command = require(`./${name}`);
    const json = serializeCommand(command);
    assert.equal(json.name, name);
    assert.ok(json.options.length > 0);
  }
});

test('les deux systèmes de commandes restent actifs et l’aide affiche les noms sans préfixe', async () => {
  const { normalizeCommandPrefix, parsePrefixedCommand } = require('../core/commandConfig');
  assert.equal(normalizeCommandPrefix('!'), '!');
  assert.deepEqual(parsePrefixedCommand('!play Niska', '!'), { name: 'play', args: ['Niska'] });

  const command = require('./help');
  const registered = new Map([['play', {
    slash: true,
    helpCategory: 'music',
    data: { name: 'play', description: 'Jouer une musique', options: [{ type: 3, name: 'query', required: true }] },
  }]]);
  let response;
  await command.execute({
    user: { id: 'user-1' },
    isChatInputCommand: () => true,
    reply: async (payload) => { response = payload; },
  }, [], { commands: registered, langFor: () => 'fr' });
  const helpText = JSON.stringify(response.embeds[0].toJSON());
  assert.match(helpText, /\*\*play\*\*.*query/);
  assert.doesNotMatch(helpText, /[!/](?:play|pause|skip)/);
  assert.equal(response.flags, require('discord.js').MessageFlags.Ephemeral);
  assert.equal(response.components.length, 2, 'le menu privé contient un sélecteur de catégorie et une pagination');
  assert.equal(response.files[0].name, 'music-bot-emblem.png');
});

test('le menu d’aide privé sépare les catégories, pagine et refuse les interactions d’un autre utilisateur', async () => {
  const command = require('./help');
  const registered = new Map();
  for (let index = 0; index < 10; index += 1) {
    registered.set(`track${index}`, {
      slash: true,
      helpCategory: 'music',
      data: { name: `track${String(index).padStart(2, '0')}`, description: `Piste ${index}` },
      execute() {},
    });
  }
  registered.set('kick', {
    slash: true,
    helpCategory: 'moderation',
    data: { name: 'kick', description: 'Expulse un membre', defaultMemberPermissions: '2' },
    execute() {},
  });
  registered.set('owner-tool', {
    slash: true,
    ownerOnly: true,
    helpCategory: 'setup',
    data: { name: 'owner-tool', description: 'Outil privé' },
    execute() {},
  });
  const deps = { commands: registered, langFor: () => 'fr', isOwner: (id) => id === 'owner-user' };

  let firstPage;
  await command.execute({
    user: { id: 'user-1' },
    isChatInputCommand: () => true,
    reply: async (payload) => { firstPage = payload; },
  }, [], deps);
  const firstPageEmbed = firstPage.embeds[0].toJSON();
  assert.match(firstPageEmbed.title, /Musique/);
  assert.match(firstPageEmbed.footer.text, /Page 1\/2/);
  assert.match(firstPageEmbed.description, /track07/);
  assert.doesNotMatch(firstPageEmbed.description, /track08|owner-tool/);
  assert.equal(firstPage.flags, require('discord.js').MessageFlags.Ephemeral);
  const menu = firstPage.components[0].components[0].toJSON();
  assert.equal(menu.custom_id, 'helpui:category:user-1');
  assert.deepEqual(menu.options.map((option) => option.value), ['music', 'moderation']);

  let denied;
  await command.handleInteraction({
    customId: 'helpui:category:user-1',
    user: { id: 'other-user' },
    reply: async (payload) => { denied = payload; },
  }, deps);
  assert.equal(denied.flags, require('discord.js').MessageFlags.Ephemeral);
  assert.match(denied.content, /réservé/);

  let selectedPage;
  await command.handleInteraction({
    customId: 'helpui:category:user-1',
    user: { id: 'user-1' },
    guildId: 'guild-1',
    isStringSelectMenu: () => true,
    values: ['moderation'],
    message: { attachments: { values: () => [] } },
    update: async (payload) => { selectedPage = payload; },
  }, deps);
  assert.match(selectedPage.embeds[0].toJSON().title, /Modération/);
  assert.match(selectedPage.embeds[0].toJSON().description, /kick/);

  let secondPage;
  await command.handleInteraction({
    customId: 'helpui:page:user-1:music:1',
    user: { id: 'user-1' },
    guildId: 'guild-1',
    isButton: () => true,
    message: { attachments: { values: () => [{ id: 'art-id', name: 'music-bot-emblem.png' }] } },
    update: async (payload) => { secondPage = payload; },
  }, deps);
  assert.match(secondPage.embeds[0].toJSON().footer.text, /Page 2\/2/);
  assert.match(secondPage.embeds[0].toJSON().description, /track08[\s\S]*track09/);
  assert.deepEqual(secondPage.attachments, [{ id: 'art-id', filename: 'music-bot-emblem.png' }]);
  assert.equal(secondPage.files, undefined, 'la pagination conserve l’illustration sans la renvoyer à chaque clic');
});

test('help par préfixe envoie le menu en DM sans publier la liste dans le salon', async () => {
  const command = require('./help');
  let directMessage;
  let channelReply = false;
  await command.execute({
    author: { id: 'user-1', send: async (payload) => { directMessage = payload; } },
    guild: { id: 'guild-1' },
    reply: async () => { channelReply = true; },
  }, [], {
    commands: new Map([['ping', {
      data: { name: 'ping', description: 'Mesure la latence' },
      execute() {},
    }]]),
    langFor: () => 'fr',
  });
  assert.ok(directMessage.embeds.length);
  assert.ok(directMessage.components.length);
  assert.equal(channelReply, false);
});

test('/24-7 est une commande serveur réservée à la permission Gérer le serveur et bascule son réglage', async () => {
  const { PermissionFlagsBits } = require('discord.js');
  const command = require('./24-7');
  const json = serializeCommand(command);
  assert.equal(json.name, '24-7');
  assert.equal(json.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());

  let enabled = false;
  const saved = [];
  const calls = [];
  const player = {
    connection: { connected: true, channelId: 'voice-1' },
    _clearIdleTimer: () => calls.push('clear-idle'),
    _clearAloneTimer: () => calls.push('clear-alone'),
    _scheduleIdleLeave: () => calls.push('schedule-idle'),
    _scheduleAloneLeave: (channelId) => calls.push(`schedule-alone:${channelId}`),
  };
  const replies = [];
  const ctx = {
    guildId: 'guild-1',
    guild: { name: 'Serveur test' },
    memberPermissions: { has: (permission) => permission === PermissionFlagsBits.ManageGuild },
    isChatInputCommand: () => true,
    reply: async (payload) => { replies.push(payload); return payload; },
  };
  const deps = {
    database: {
      getGuildSetting: (_guildId, key, fallback) => { assert.equal(key, 'music24_7'); return enabled ?? fallback; },
      setGuildSetting: (guildId, key, value) => { saved.push([guildId, key, value]); enabled = value; },
    },
    getPlayer: (guildId) => { assert.equal(guildId, 'guild-1'); return player; },
  };

  await command.execute(ctx, [], deps);
  assert.deepEqual(saved[0], ['guild-1', 'music24_7', true]);
  assert.deepEqual(calls, ['clear-idle', 'clear-alone']);
  assert.match(replies[0].embeds[0].data.title, /24\/7 activé/);

  await command.execute(ctx, [], deps);
  assert.deepEqual(saved[1], ['guild-1', 'music24_7', false]);
  assert.deepEqual(calls.slice(2), ['schedule-idle', 'schedule-alone:voice-1']);
  assert.match(replies[1].embeds[0].data.title, /Déconnexion automatique activée/);
});

test('/24-7 refuse de changer le réglage sans permission Gérer le serveur', async () => {
  const { PermissionFlagsBits } = require('discord.js');
  const command = require('./24-7');
  let persisted = false;
  let response;
  await command.execute({
    guildId: 'guild-2', guild: { name: 'Serveur privé' },
    memberPermissions: { has: () => false },
    isChatInputCommand: () => true,
    reply: async (payload) => { response = payload; },
  }, [], {
    database: {
      getGuildSetting: () => persisted,
      setGuildSetting: () => { persisted = true; },
    },
    getPlayer: () => { throw new Error('ne doit pas être appelé'); },
  });
  assert.equal(persisted, false);
  assert.equal(response.flags, require('discord.js').MessageFlags.Ephemeral);
  assert.match(response.content, /Gérer le serveur/);
  assert.ok(PermissionFlagsBits.ManageGuild);
});

test('/controller renvoie l’adresse publique hébergée et jamais localhost', async () => {
  const command = require('./controller');
  const previous = process.env.WEB_PUBLIC_URL;
  let response;
  process.env.WEB_PUBLIC_URL = 'https://music.example.org';
  try {
    await command.execute({
      guildId: '123456789012345678',
      isChatInputCommand: () => true,
      reply: async (payload) => { response = payload; },
    });
  } finally {
    if (previous === undefined) delete process.env.WEB_PUBLIC_URL;
    else process.env.WEB_PUBLIC_URL = previous;
  }
  assert.equal(response.flags, require('discord.js').MessageFlags.Ephemeral);
  assert.match(response.embeds[0].data.description, /https:\/\/music\.example\.org\//i);
  assert.doesNotMatch(response.embeds[0].data.description, /localhost|127\.0\.0\.1/);
});

test('les suggestions /play ont un format lisible et gardent morceaux et playlists', () => {
  const { formatDuration, formatChoiceName, toAutocompleteChoice, selectAutocompleteItems } = require('../features/music/catalogAutocomplete');
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
  const { getWorldTopTracks } = require('../features/music/musicCatalog');
  const { formatChoiceName, selectAutocompleteItems, toAutocompleteChoice } = require('../features/music/catalogAutocomplete');
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

  const playCommand = require('./play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => '' },
    respond: async (choices) => { assert.ok(Array.isArray(choices)); response = choices; },
  });
  assert.deepEqual(response, choices);
});

test('/play affiche query immédiatement tout en gardant le Top 25 comme autocomplétion vide', async () => {
  const playCommand = require('./play');
  const option = playCommand.data.options.find((entry) => entry.name === 'query');
  assert.equal(option.required, true);

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
  assert.equal(response.embeds[0].data.title, '🎵 🌍 Top 25 mondial');
  assert.equal(response.components.length, 2);
  assert.equal(response.components[0].components[0].toJSON().options.length, 25);

  const { WORLD_CHART_FALLBACK_VALUE, toSearchFallbackChoice } = require('../features/music/catalogAutocomplete');
  const fallback = toSearchFallbackChoice('', { worldChart: true });
  assert.equal(fallback.value, WORLD_CHART_FALLBACK_VALUE);
  assert.deepEqual(playCommand.autocompleteFallback({ options: { getFocused: () => '' } }), [fallback]);
  const fallbackCtx = { ...ctx, async editReply(payload) { response = payload; return payload; } };
  await playCommand.execute(fallbackCtx, [fallback.value], {
    getWorldTopTracks: async () => items,
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.equal(response.embeds[0].data.title, '🎵 🌍 Top 25 mondial');
});

test('l’autocomplétion répond avec un choix de secours si un fournisseur dépasse le délai', async () => {
  const playCommand = require('./play');
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
  const playCommand = require('./play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => '' },
    respond: async (choices) => { assert.ok(Array.isArray(choices)); response = choices; },
  }, {
    autocompleteTimeoutMs: 5,
    getWorldTopTracks: () => new Promise(() => {}),
  });

  assert.deepEqual(response, [{ name: '🌍 Rechercher « Top mondial »', value: 'music-chart:world-top' }]);
});

test('une exception d’autocomplétion du Top mondial renvoie aussi une option réessayable', async () => {
  const playCommand = require('./play');
  let response;
  await playCommand.autocomplete({
    options: { getFocused: () => '' },
    respond: async (choices) => { response = choices; },
  }, {
    autocompleteTimeoutMs: 20,
    getWorldTopTracks: async () => { throw new Error('API indisponible'); },
  });
  assert.equal(response.length, 1);
  assert.equal(response[0].name, '🌍 Rechercher « Top mondial »');
  assert.equal(response[0].value, 'music-chart:world-top');
});

test('l’autocomplétion d’un lien YouTube recherche le titre et affiche les noms, pas les URL', async () => {
  const playCommand = require('./play');
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
  const playCommand = require('./play');
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

test('un lien /play est résolu et mis en file sans ouvrir de liste de sélection', async () => {
  const playCommand = require('./play');
  let resolvedQuery;
  let queued;
  let edited;
  const ctx = {
    user: { id: 'user-link', username: 'Adam', tag: 'Adam#0001' },
    member: { displayName: 'Adam', voice: { channel: { id: 'voice-link', name: 'Général' } } },
    guildId: 'guild-link',
    guild: { id: 'guild-link', name: 'Test' },
    channel: { id: 'text-link', guildId: 'guild-link' },
    isChatInputCommand: () => true,
    async deferReply() {},
    async editReply(payload) { edited = payload; return payload; },
    async reply(payload) { edited = payload; return payload; },
  };
  const player = {
    async enqueueSongs(songs, options) {
      queued = { songs, options };
      return { added: songs.length, queued: false, player: this };
    },
  };
  const logs = [];
  await playCommand.execute(ctx, [
    'https://open.spotify.com/intl-fr/track/518c5Dr5EmpzACX268Aeqs?si=PRIVATE',
  ], {
    logger: { info: (line) => logs.push(line), warn: (line) => logs.push(line), error: (line) => logs.push(line) },
    fetch: async () => ({ ok: true, json: async () => ({ title: 'Dracula (with JENNIE) - Tame Impala' }) }),
    resolveQuery: async (query) => {
      resolvedQuery = query;
      return [{ title: 'Dracula (with JENNIE) - Tame Impala', url: 'https://youtu.be/abcdefghijk', duration: 200 }];
    },
    searchCatalog: async () => { throw new Error('Un lien ne doit pas ouvrir le sélecteur catalogue.'); },
    getPlayer: () => player,
  });
  assert.equal(resolvedQuery, 'Dracula (with JENNIE) - Tame Impala');
  assert.equal(queued.songs[0].title, 'Dracula (with JENNIE) - Tame Impala');
  assert.equal(queued.options.requesterId, 'user-link');
  assert.match(edited.content, /lecture lancée/);
  assert.match(logs.join('\n'), /entrée=lien plateforme=Spotify/);
  assert.match(logs.join('\n'), /Tame Impala/);
  assert.doesNotMatch(logs.join('\n'), /PRIVATE/);
});

test('un texte libre /play affiche une liste interactive au lieu de lancer un résultat arbitraire', async () => {
  const playCommand = require('./play');
  let searched;
  let edited;
  const ctx = {
    user: { id: 'user-text', username: 'Adam' },
    member: { voice: { channel: { id: 'voice-text', name: 'Général' } } },
    guildId: 'guild-text', guild: { id: 'guild-text', name: 'Test' },
    channel: { id: 'text-text', guildId: 'guild-text' },
    isChatInputCommand: () => true,
    async deferReply() {},
    async editReply(payload) { edited = payload; return payload; },
  };
  await playCommand.execute(ctx, ['Niska'], {
    logger: { info() {}, warn() {}, error() {} },
    searchCatalog: async (query) => {
      searched = query;
      return [{ kind: 'track', provider: 'youtube', title: "Chasse à l'homme", subtitle: 'Niska', url: 'https://music.test/track/niska' }];
    },
  });
  assert.equal(searched, 'Niska');
  assert.ok(edited.components.some((row) => row.components.some((component) => component.toJSON().type === 3)));
  assert.match(edited.embeds[0].data.title, /Résultats · Niska/);
});
