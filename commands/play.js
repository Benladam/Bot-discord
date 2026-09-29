/** Recherche et lecture YouTube, Spotify, Deezer et playlists publiques. */
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { resolveQuery } = require('../features/music/resolve');
const { cleanMediaQuery } = require('../features/music/mediaQuery');
const { searchCatalog, getArtistAlbums, getWorldTopTracks } = require('../features/music/musicCatalog');
const { selectAutocompleteItems, toAutocompleteChoice, toSearchFallbackChoice, WORLD_CHART_FALLBACK_VALUE } = require('../features/music/catalogAutocomplete');
const { getMusicInputInfo, formatMusicAttempt, resolveMusicLinkMetadata, cleanLogText, sanitizeDiagnosticText } = require('../features/music/musicLinkMetadata');
const embeds = require('../shared/discord/embeds');
const { tr } = require('../shared/i18n/embedI18n');

const PAGE_SIZE = 25;
// Répond tôt pour garder une marge sous le délai d’interaction Discord,
// surtout lorsque l’hôte distant a une forte latence réseau.
const AUTOCOMPLETE_TIMEOUT_MS = 1_200;
const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;
const AUTOCOMPLETE_TIMEOUT = Symbol('autocomplete timeout');
const LINK_REFERENCE_TTL = 3 * 60 * 1000;
const linkReferences = new Map();
const autocompleteItems = new Map();

function loggerCall(deps, level, message) {
  const logger = deps?.logger;
  if (typeof logger?.[level] === 'function') logger[level](message);
  else if (level === 'error') console.error(message);
  else console.info(message);
}

function contextLabel(ctx) {
  const who = ctx.user?.tag || ctx.author?.tag || ctx.user?.username || ctx.author?.username || 'inconnu';
  const guild = ctx.guild?.name || 'serveur inconnu';
  return `utilisateur=${JSON.stringify(cleanLogText(who, 80))} serveur=${JSON.stringify(cleanLogText(guild, 80))} guildId=${ctx.guildId || 'DM'}`;
}

function autocompleteKey(userId, guildId, url) {
  return `${userId || ''}:${guildId || ''}:${url}`;
}

function rememberAutocompleteItems(items, interaction) {
  const selected = selectAutocompleteItems(items);
  const now = Date.now();
  for (const [key, entry] of autocompleteItems) if (entry.expiresAt <= now) autocompleteItems.delete(key);
  for (const item of selected) {
    autocompleteItems.set(autocompleteKey(interaction.user?.id, interaction.guildId, String(item.url)), {
      item,
      expiresAt: now + LINK_REFERENCE_TTL,
    });
  }
  while (autocompleteItems.size > 500) autocompleteItems.delete(autocompleteItems.keys().next().value);
  return selected.map(toAutocompleteChoice);
}

function getAutocompleteSelection(query, ctx) {
  const key = autocompleteKey(userIdOf(ctx), ctx.guildId, String(query));
  const entry = autocompleteItems.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    autocompleteItems.delete(key);
    return null;
  }
  return entry.item;
}

function makeLinkReference(query, interaction, providerLabel) {
  const token = `music-ref:${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();
  for (const [key, entry] of linkReferences) if (entry.expiresAt <= now) linkReferences.delete(key);
  linkReferences.set(token, {
    query,
    userId: interaction.user?.id,
    guildId: interaction.guildId,
    expiresAt: now + LINK_REFERENCE_TTL,
  });
  while (linkReferences.size > 200) linkReferences.delete(linkReferences.keys().next().value);
  return {
    name: `🔗 Lien ${providerLabel} — titre non récupéré, réessayer`,
    value: token,
  };
}

function takeLinkReference(value, ctx) {
  if (!String(value).startsWith('music-ref:')) return null;
  const entry = linkReferences.get(value);
  linkReferences.delete(value);
  if (!entry || entry.expiresAt <= Date.now()
      || entry.userId !== userIdOf(ctx)
      || String(entry.guildId || '') !== String(ctx.guildId || '')) {
    throw new Error('Cette référence de lien a expiré. Relance `/play` avec le lien ou le titre.');
  }
  return entry.query;
}

function autocompleteFallback(interaction) {
  const focused = interaction.options.getFocused().toString().trim();
  if (!focused) return [toSearchFallbackChoice('', { worldChart: true })];
  const inputInfo = getMusicInputInfo(focused);
  if (inputInfo.kind === 'link') {
    return [makeLinkReference(focused, interaction, inputInfo.providerLabel)];
  }
  return [toSearchFallbackChoice(focused)];
}

function withinAutocompleteBudget(task, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(AUTOCOMPLETE_TIMEOUT), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function providerLabel(provider) { return provider === 'spotify' ? '🟢 Spotify' : provider === 'deezer' ? '🟣 Deezer' : provider === 'soundcloud' ? '🟠 SoundCloud' : '▶ YouTube'; }
function userIdOf(ctx) { return ctx.user?.id || ctx.author?.id; }
function isSlash(ctx) { return typeof ctx.isChatInputCommand === 'function' && ctx.isChatInputCommand(); }
function spotifyArtistId(value) {
  const match = String(value).match(/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2,3}(?:-[a-z]{2})?\/)?artist\/([A-Za-z0-9]+)/i)
    || String(value).match(/^spotify:artist:([A-Za-z0-9]+)/i);
  return match?.[1] || null;
}

function makeSession(data) {
  const id = crypto.randomBytes(6).toString('hex');
  const session = { ...data, page: 0, expiresAt: Date.now() + SESSION_TTL };
  sessions.set(id, session);
  const timer = setTimeout(() => sessions.delete(id), SESSION_TTL);
  timer.unref?.();
  while (sessions.size > 200) sessions.delete(sessions.keys().next().value);
  return { id, session };
}

function renderSession(id, session) {
  const pages = Math.max(1, Math.ceil(session.items.length / PAGE_SIZE));
  session.page = Math.max(0, Math.min(session.page, pages - 1));
  const start = session.page * PAGE_SIZE;
  const pageItems = session.items.slice(start, start + PAGE_SIZE);
  let description = `Choisis un morceau, album, artiste ou une playlist. Page ${session.page + 1}/${pages} · ${session.items.length} résultats.`;
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    description += ' Spotify est désactivé : configure ses identifiants dans .env.';
  } else if (session.items.some((item) => item.provider === 'spotify' && item.kind === 'playlist')) {
    description += ' Les titres des playlists Spotify peuvent être bloqués par leurs droits d’accès.';
  }
  const embed = new EmbedBuilder().setColor('#5865F2').setTitle(session.title.slice(0, 256))
    .setDescription(description);
  const components = [];
  if (pageItems.length) {
    const menu = new StringSelectMenuBuilder().setCustomId(`playcat:${id}:select`).setPlaceholder('Sélectionner un résultat')
      .addOptions(pageItems.map((item, offset) => {
        const index = start + offset;
        const kind = { track: 'Morceau', artist: 'Artiste · discographie', album: 'Album', playlist: 'Playlist' }[item.kind] || 'Résultat';
        const subtitle = cleanLogText(String(item.subtitle || '').replace(/https?:\/\/\S+/gi, ''), 60);
        const detail = `${providerLabel(item.provider)} · ${kind}${subtitle ? ` · ${subtitle}` : ''}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder().setLabel(toAutocompleteChoice(item).name).setDescription(detail).setValue(String(index));
      }));
    components.push(new ActionRowBuilder().addComponents(menu));
  }
  components.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`playcat:${id}:prev`).setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(session.page === 0),
    new ButtonBuilder().setCustomId(`playcat:${id}:next`).setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(session.page >= pages - 1),
    new ButtonBuilder().setCustomId(`playcat:${id}:close`).setLabel('Fermer').setStyle(ButtonStyle.Danger),
  ));
  return { embeds: [embed], components };
}

async function queueSongs(ctx, deps, songs) {
  const member = ctx.member;
  if (!ctx.guildId || !member?.voice?.channel) throw new Error('Rejoins un salon vocal avant de choisir une musique.');
  if (!songs.length) throw new Error('Aucune musique jouable trouvée dans ce résultat.');
  const player = deps.getPlayer(ctx.guildId);
  return player.enqueueSongs(songs, {
    voiceChannel: member.voice.channel,
    addedBy: member.displayName || member.user?.username || ctx.user?.username || '?',
    requesterId: userIdOf(ctx),
    lastChannel: ctx.channel,
    lang: deps.langFor ? deps.langFor(userIdOf(ctx), ctx.guild?.id) : 'fr',
    insertFirst: isSlash(ctx) && ctx.options?.getBoolean?.('insert-first') === true,
  });
}

async function resolveCatalogItem(item) {
  if (item.provider === 'soundcloud') {
    return [{
      title: item.title || 'Musique SoundCloud',
      url: item.url,
      duration: item.duration || 0,
      thumbnail: item.thumbnail || null,
      source: 'soundcloud',
      fallbackQuery: [item.subtitle, item.title].filter(Boolean).join(' - '),
    }];
  }
  const songs = await resolveQuery(item.url);
  for (const song of songs) {
    const fallbackTitle = item.kind === 'track' ? item.title : song.title || item.title;
    song.fallbackQuery ||= [item.subtitle, fallbackTitle].filter(Boolean).join(' - ');
  }
  if (item.provider === 'youtube' && songs[0]) {
    songs[0] = { ...songs[0], title: item.title || songs[0].title, duration: item.duration || songs[0].duration };
  }
  return songs;
}

async function handleCatalogInteraction(interaction, deps) {
  if (!interaction.customId?.startsWith('playcat:')) return false;
  const [, id, action] = interaction.customId.split(':');
  const session = sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(id);
    await interaction.reply({ content: 'Cette recherche a expiré. Relance `/play`.', ephemeral: true });
    return true;
  }
  if (interaction.user.id !== session.userId || interaction.guildId !== session.guildId) {
    await interaction.reply({ content: 'Cette recherche appartient à une autre personne ou un autre serveur.', ephemeral: true });
    return true;
  }
  if (action === 'prev' || action === 'next') {
    session.page += action === 'next' ? 1 : -1;
    await interaction.update(renderSession(id, session));
    return true;
  }
  if (action === 'close') {
    sessions.delete(id);
    await interaction.update({ content: 'Recherche fermée.', embeds: [], components: [] });
    return true;
  }
  if (action !== 'select') return true;

  await interaction.deferUpdate();
  try {
    const item = session.items[Number(interaction.values?.[0])];
    if (!item) throw new Error('Résultat expiré. Relance la recherche.');
    loggerCall(deps, 'info', `[play] choix serveur=${interaction.guildId} utilisateur=${interaction.user.id} plateforme=${item.provider} type=${item.kind} titre=${JSON.stringify(cleanLogText(item.title, 150))}`);
    if (item.kind === 'artist') {
      const albums = await getArtistAlbums(item.artistId || spotifyArtistId(item.url));
      if (!albums.length) throw new Error('Aucun album public trouvé pour cet artiste.');
      session.items = albums;
      session.title = `Discographie · ${item.title}`;
      session.page = 0;
      await interaction.editReply(renderSession(id, session));
      return true;
    }
    const songs = await resolveCatalogItem(item);
    const { added, queued } = await queueSongs(interaction, deps, songs);
    await interaction.editReply({
      content: `${added} titre${added === 1 ? '' : 's'} ajouté${added === 1 ? '' : 's'}${queued ? ' à la file d’attente' : ' · lecture lancée'}.`,
      embeds: [], components: [],
    });
    sessions.delete(id);
  } catch (error) {
    loggerCall(deps, 'error', `[play] échec après sélection serveur=${interaction.guildId} code=${error?.code || 'n/a'} détail=${sanitizeDiagnosticText(error.message)}`);
    await interaction.editReply({ content: `❌ ${sanitizeDiagnosticText(error.message).slice(0, 1500)}`, embeds: [], components: [] });
  }
  return true;
}

module.exports = {
  data: {
    name: 'play',
    description: 'Cherche et joue musique sur YouTube, Spotify et Deezer',
    options: [
      { name: 'query', description: 'Titre, artiste, lien ou choix du Top 25 mondial', type: 3, required: true, autocomplete: true },
      { name: 'insert-first', description: 'Mettre la musique en haut de la file', type: 5, required: false },
    ],
  },
  slash: true,
  handleCatalogInteraction,
  autocompleteFallback,

  async autocomplete(interaction, deps = {}) {
    const query = interaction.options.getFocused().toString().trim();
    const timeoutMs = Number.isFinite(deps.autocompleteTimeoutMs)
      ? Math.max(1, Math.min(2500, deps.autocompleteTimeoutMs))
      : AUTOCOMPLETE_TIMEOUT_MS;
    if (!query) {
      const getChart = deps.getWorldTopTracks || getWorldTopTracks;
      const items = await withinAutocompleteBudget(() => getChart({ timeoutMs: Math.max(250, timeoutMs - 200) }), timeoutMs)
        .catch((error) => {
        console.warn(`[catalogue] Top mondial Deezer indisponible: ${error.message}`);
        return [];
      });
      if (items === AUTOCOMPLETE_TIMEOUT) {
        console.warn('[catalogue] Le Top 25 Deezer dépasse le délai d’autocomplétion Discord.');
        return interaction.respond([toSearchFallbackChoice('', { worldChart: true })]);
      }
      if (!items.length) return interaction.respond([toSearchFallbackChoice('', { worldChart: true })]);
      const choices = rememberAutocompleteItems(selectAutocompleteItems(items, 25), interaction);
      return interaction.respond(choices);
    }
    if (query.length < 2) return interaction.respond([]);
    const search = deps.searchCatalog || searchCatalog;
    const inputInfo = getMusicInputInfo(query);
    let metadata = null;
    let searchTerm = query;
    const startedAt = Date.now();
    const items = await withinAutocompleteBudget(async () => {
      if (inputInfo.kind === 'link') {
        if (inputInfo.provider === 'other') return [];
        const metadataBudget = Math.max(200, Math.min(900, Math.floor(timeoutMs * 0.4)));
        metadata = await resolveMusicLinkMetadata(query, {
          fetchImpl: deps.fetch || globalThis.fetch,
          timeoutMs: metadataBudget,
        });
        if (!metadata?.searchQuery) return [];
        searchTerm = metadata.searchQuery;
      }
      const remaining = Math.max(100, timeoutMs - (Date.now() - startedAt) - 150);
      return search(searchTerm, { limit: 10, sourceTimeoutMs: remaining });
    }, timeoutMs)
      .catch((error) => {
        console.warn(`[catalogue] Autocomplétion indisponible: ${sanitizeDiagnosticText(error.message)}`);
        return [];
      });
    if (items === AUTOCOMPLETE_TIMEOUT || !items?.length) {
      if (items === AUTOCOMPLETE_TIMEOUT) console.warn('[catalogue] Recherche musicale au-delà du délai d’autocomplétion Discord.');
      if (inputInfo.kind === 'link') {
        if (metadata?.searchQuery) return interaction.respond([toSearchFallbackChoice(metadata.searchQuery)]);
        return interaction.respond([makeLinkReference(query, interaction, inputInfo.providerLabel)]);
      }
      return interaction.respond([toSearchFallbackChoice(searchTerm)]);
    }
    const choices = rememberAutocompleteItems(selectAutocompleteItems(items), interaction);
    return interaction.respond(choices);
  },

  async execute(ctx, args, deps) {
    const typedInput = args.join(' ').trim();
    const worldChartFallback = typedInput === WORLD_CHART_FALLBACK_VALUE;
    let referencedInput = null;
    try { referencedInput = worldChartFallback ? null : takeLinkReference(typedInput, ctx); }
    catch (error) {
      return ctx.reply({ embeds: [embeds.errorEmbed(error.message)], ephemeral: isSlash(ctx) });
    }
    const rawInput = worldChartFallback ? '' : (referencedInput || typedInput);
    const query = cleanMediaQuery(rawInput);
    const lang = deps.langFor ? deps.langFor(userIdOf(ctx), ctx.guild?.id) : 'fr';
    loggerCall(deps, 'info', `[play] ${contextLabel(ctx)} ${formatMusicAttempt(query)}`);
    let responseMessage = null;
    const reply = async (options) => {
      responseMessage = await ctx.reply(options);
      return responseMessage;
    };
    const edit = (options) => {
      if (typeof ctx.editReply === 'function') return ctx.editReply(options);
      if (responseMessage?.edit) return responseMessage.edit(options);
      return ctx.reply(options);
    };
    if (!query && isSlash(ctx)) {
      await ctx.deferReply({ ephemeral: true });
      try {
        const getChart = deps.getWorldTopTracks || getWorldTopTracks;
        const items = await getChart({ fetchImpl: deps.fetch || globalThis.fetch });
        if (!items.length) throw new Error('Le Top 25 mondial est momentanément indisponible.');
        const { id, session } = makeSession({
          userId: userIdOf(ctx), guildId: ctx.guildId, query: '',
          title: '🌍 Top 25 mondial', items: selectAutocompleteItems(items, 25),
        });
        return ctx.editReply(renderSession(id, session));
      } catch (error) {
        loggerCall(deps, 'warn', `[play] Top 25 mondial indisponible: ${sanitizeDiagnosticText(error.message)}`);
        return ctx.editReply({ content: 'Le Top 25 mondial est indisponible pour le moment. Relance `/play` ou saisis un titre.', embeds: [], components: [] });
      }
    }
    if (!query) return reply({ embeds: [embeds.errorEmbed(tr(lang).specifySong, lang)] });
    if (isSlash(ctx)) await ctx.deferReply({ ephemeral: true });

    const selectedItem = getAutocompleteSelection(typedInput, ctx) || getAutocompleteSelection(query, ctx);
    const inputInfo = getMusicInputInfo(query);
    let metadata = null;
    let searchTerm = query;
    if (selectedItem) {
      const artist = selectedItem.kind === 'track' ? String(selectedItem.subtitle || '').split('·')[0].trim() : '';
      const title = selectedItem.title || 'Morceau sans titre';
      metadata = { provider: selectedItem.provider, title, artist, searchQuery: [artist, title].filter(Boolean).join(' - ') };
      searchTerm = metadata.searchQuery;
      loggerCall(deps, 'info', `[play] choix catalogue plateforme=${selectedItem.provider} terme=${JSON.stringify(cleanLogText(searchTerm, 180))}`);
    } else if (inputInfo.kind === 'link' && inputInfo.provider !== 'other') {
      try {
        metadata = await resolveMusicLinkMetadata(query, { fetchImpl: deps.fetch || globalThis.fetch });
      } catch (error) {
        loggerCall(deps, 'warn', `[play] métadonnées ${inputInfo.providerLabel} indisponibles: ${sanitizeDiagnosticText(error.message)}`);
      }
      if (metadata?.searchQuery) {
        searchTerm = metadata.searchQuery;
        loggerCall(deps, 'info', `[play] normalisé plateforme=${inputInfo.providerLabel} type=${metadata.kind} titre=${JSON.stringify(cleanLogText(metadata.title, 160))} recherche=${JSON.stringify(cleanLogText(searchTerm, 200))}`);
      } else {
        loggerCall(deps, 'warn', `[play] aucun titre public obtenu plateforme=${inputInfo.providerLabel} lien=${JSON.stringify(inputInfo.safe)}`);
      }
    } else if (inputInfo.kind === 'link') {
      loggerCall(deps, 'warn', `[play] lien non pris en charge adresse=${JSON.stringify(inputInfo.safe)}`);
    }

    const artistId = spotifyArtistId(query);
    if (isSlash(ctx) && artistId && !selectedItem) {
      try {
        const items = await getArtistAlbums(artistId);
        if (!items.length) return edit({ content: 'Aucun album public trouvé pour cet artiste.', embeds: [], components: [] });
        const { id, session } = makeSession({ userId: userIdOf(ctx), guildId: ctx.guildId, query, title: 'Discographie Spotify', items });
        return edit(renderSession(id, session));
      } catch (error) {
        loggerCall(deps, 'error', `[play] échec discographie Spotify: ${sanitizeDiagnosticText(error.message)}`);
        return edit({ content: `Discographie indisponible : ${sanitizeDiagnosticText(error.message).slice(0, 1200)}`, embeds: [], components: [] });
      }
    }

    if (isSlash(ctx) && selectedItem?.kind === 'artist') {
      try {
        const items = await getArtistAlbums(selectedItem.artistId || spotifyArtistId(selectedItem.url));
        if (!items.length) return edit({ content: 'Aucun album public trouvé pour cet artiste.', embeds: [], components: [] });
        const { id, session } = makeSession({ userId: userIdOf(ctx), guildId: ctx.guildId, query, title: `Discographie · ${selectedItem.title}`, items });
        return edit(renderSession(id, session));
      } catch (error) {
        loggerCall(deps, 'error', `[play] échec discographie Spotify: ${sanitizeDiagnosticText(error.message)}`);
        return edit({ content: `Discographie indisponible : ${sanitizeDiagnosticText(error.message).slice(0, 1200)}`, embeds: [], components: [] });
      }
    }

    if (isSlash(ctx) && selectedItem) {
      if (!ctx.member?.voice?.channel) return edit({ embeds: [embeds.errorEmbed(tr(lang).needVoice, lang)] });
      try {
        const songs = await resolveCatalogItem(selectedItem);
        const { added, queued } = await queueSongs(ctx, deps, songs);
        loggerCall(deps, 'info', `[play] lecture catalogue ${queued ? 'ajoutée à la file' : 'lancée'} plateforme=${selectedItem.provider} titre=${JSON.stringify(cleanLogText(songs[0]?.title, 160))} pistes=${added}`);
        return edit({ content: `${added} titre${added === 1 ? '' : 's'} ${queued ? 'ajouté(s) à la file' : 'ajouté(s) · lecture lancée'}.`, embeds: [], components: [] });
      } catch (error) {
        loggerCall(deps, 'error', `[play] échec choix autocomplete plateforme=${selectedItem.provider} code=${error?.code || 'n/a'} détail=${sanitizeDiagnosticText(error.message)}`);
        return edit({ embeds: [embeds.errorEmbed(sanitizeDiagnosticText(error.message), lang)], content: null });
      }
    }

    // Le texte libre ouvre la liste de résultats. Un lien, lui, doit partir en
    // résolution directe et ne jamais obliger l’utilisateur à choisir une 2e fois.
    if (isSlash(ctx) && !selectedItem && inputInfo.kind === 'name') {
      try {
        const search = deps.searchCatalog || searchCatalog;
        const items = await search(searchTerm);
        loggerCall(deps, 'info', `[play] recherche terminée terme=${JSON.stringify(cleanLogText(searchTerm, 180))} résultats=${items.length}`);
        if (items.length) {
          const cleanTerm = cleanLogText(searchTerm, 220) || 'musique';
          const { id, session } = makeSession({ userId: userIdOf(ctx), guildId: ctx.guildId, query: searchTerm, title: `Résultats · ${cleanTerm}`, items });
          return edit(renderSession(id, session));
        }
        if (inputInfo.kind === 'name') {
          return edit({ content: `Aucun résultat trouvé pour « ${cleanLogText(searchTerm, 150)} ».`, embeds: [], components: [] });
        }
        loggerCall(deps, 'warn', `[play] catalogue vide; repli sur la recherche audio du titre plateforme=${inputInfo.providerLabel}`);
      } catch (error) {
        loggerCall(deps, 'warn', `[play] recherche catalogue échouée terme=${JSON.stringify(cleanLogText(searchTerm, 160))}: ${sanitizeDiagnosticText(error.message)}`);
        if (inputInfo.kind === 'name') {
          return edit({ content: `Recherche impossible : ${sanitizeDiagnosticText(error.message).slice(0, 1200)}`, embeds: [], components: [] });
        }
      }
    }

    if (inputInfo.kind === 'link' && inputInfo.provider === 'other') {
      const message = 'Ce lien ne vient pas de YouTube, Spotify, Deezer ou SoundCloud. Essaie avec le titre de la musique.';
      loggerCall(deps, 'error', `[play] échec: lien musical non pris en charge (${inputInfo.safe})`);
      return edit({ embeds: [embeds.errorEmbed(message, lang)], content: isSlash(ctx) ? message : undefined });
    }
    if (!ctx.member?.voice?.channel) return edit({ embeds: [embeds.errorEmbed(tr(lang).needVoice, lang)] });
    if (!isSlash(ctx)) await reply({ embeds: [embeds.searchEmbed(searchTerm, lang)] });
    try {
      // Pour un morceau isolé, on recherche par son titre public. Pour un album,
      // une playlist ou des métadonnées indisponibles, on laisse le résolveur
      // traiter le lien d’origine afin de conserver tous les titres.
      const resolveInput = inputInfo.kind === 'link' && metadata?.kind === 'track'
        ? metadata.searchQuery
        : inputInfo.kind === 'link' ? query : searchTerm;
      const resolver = deps.resolveQuery || resolveQuery;
      const songs = await resolver(resolveInput, { fetchImpl: deps.fetch || globalThis.fetch });
      const { queued, player } = await queueSongs(ctx, deps, songs);
      loggerCall(deps, 'info', `[play] lecture ${queued ? 'ajoutée à la file' : 'lancée'} titre=${JSON.stringify(cleanLogText(songs[0]?.title, 160))} pistes=${songs.length}`);
      if (isSlash(ctx)) return edit({ content: `${songs.length} titre${songs.length === 1 ? '' : 's'} ${queued ? 'ajouté(s) à la file' : 'ajouté(s) · lecture lancée'}.`, embeds: [], components: [] });
      if (queued) return edit({ embeds: [embeds.addedEmbed(songs[0], player.queue.length, player.queue.length, lang)] });
      return edit({ embeds: [embeds.playingEmbed(songs[0], player, lang)] });
    } catch (error) {
      loggerCall(deps, 'error', `[play] échec code=${error?.code || 'n/a'} plateforme=${inputInfo.providerLabel || 'recherche'} terme=${JSON.stringify(cleanLogText(searchTerm, 160))} détail=${sanitizeDiagnosticText(error.message)}`);
      if (error?.code === 'VOCAL_UNAVAILABLE') return edit({ embeds: [embeds.notFoundEmbed(lang)] });
      return edit({ embeds: [embeds.errorEmbed(sanitizeDiagnosticText(error.message), lang)] });
    }
  },
};
