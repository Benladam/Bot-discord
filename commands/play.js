/** Recherche et lecture YouTube, Spotify, Deezer et playlists publiques. */
const crypto = require('crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { resolveQuery } = require('../utils/resolve');
const { cleanMediaQuery } = require('../utils/mediaQuery');
const { searchCatalog, getArtistAlbums } = require('../utils/musicCatalog');
const embeds = require('../utils/embeds');
const { tr } = require('../utils/embedI18n');
const play = require('play-dl');

const PAGE_SIZE = 25;
const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function providerLabel(provider) { return provider === 'spotify' ? '🟢 Spotify' : provider === 'deezer' ? '🟣 Deezer' : '▶ YouTube'; }
function userIdOf(ctx) { return ctx.user?.id || ctx.author?.id; }
function isSlash(ctx) { return typeof ctx.isChatInputCommand === 'function' && ctx.isChatInputCommand(); }
function spotifyArtistId(value) {
  const match = String(value).match(/(?:open\.)?spotify\.com\/(?:intl-[a-z]{2}\/)?artist\/([A-Za-z0-9]+)/i)
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
        const detail = `${providerLabel(item.provider)} · ${kind}${item.subtitle ? ` · ${item.subtitle}` : ''}`.slice(0, 100);
        return new StringSelectMenuOptionBuilder().setLabel(String(item.title).slice(0, 100)).setDescription(detail).setValue(String(index));
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
  player.lastChannel = ctx.channel;
  player.addedBy = member.displayName || member.user?.username || ctx.user?.username || '?';
  player.voiceChannelName = member.voice.channel.name || '?';
  const wasPlaying = player.isPlaying;
  if (!wasPlaying) await player.ensureConnection(member.voice.channel);
  for (const song of songs) player.addToQueue(song);
  if (!wasPlaying) await player.playNext();
  return { added: songs.length, queued: wasPlaying ? songs.length : Math.max(0, songs.length - 1), player };
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
    if (item.kind === 'artist') {
      const albums = await getArtistAlbums(item.artistId || spotifyArtistId(item.url));
      if (!albums.length) throw new Error('Aucun album public trouvé pour cet artiste.');
      session.items = albums;
      session.title = `Discographie · ${item.title}`;
      session.page = 0;
      await interaction.editReply(renderSession(id, session));
      return true;
    }
    const songs = await resolveQuery(item.url);
    const { added, queued } = await queueSongs(interaction, deps, songs);
    await interaction.editReply({
      content: `${added} titre${added === 1 ? '' : 's'} ajouté${added === 1 ? '' : 's'}${queued ? ' à la file d’attente' : ' · lecture lancée'}.`,
      embeds: [], components: [],
    });
    sessions.delete(id);
  } catch (error) {
    await interaction.editReply({ content: `❌ ${String(error.message).slice(0, 1500)}`, embeds: [], components: [] });
  }
  return true;
}

module.exports = {
  data: {
    name: 'play',
    description: 'Cherche et joue musique sur YouTube, Spotify et Deezer',
    options: [
      { name: 'query', description: 'Titre, artiste, album, playlist ou lien', type: 3, required: true, autocomplete: true },
      { name: 'insert-first', description: 'Mettre la musique en haut de la file', type: 5, required: false },
    ],
  },
  slash: true,
  handleCatalogInteraction,

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toString().trim();
    if (query.length < 2) return interaction.respond({ choices: [] });
    const items = await searchCatalog(query, { limit: 5 }).catch(() => []);
    const choices = items.map((item) => ({
      name: `${providerLabel(item.provider)} · ${item.kind} · ${item.title}`.slice(0, 100), value: item.url,
    })).filter((item) => item.value?.length <= 100).slice(0, 25);
    return interaction.respond({ choices });
  },

  async execute(ctx, args, deps) {
    const query = cleanMediaQuery(args.join(' '));
    const lang = deps.langFor ? deps.langFor(userIdOf(ctx), ctx.guild?.id) : 'fr';
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
    if (!query) return reply({ embeds: [embeds.errorEmbed(tr(lang).specifySong, lang)] });

    // Une recherche en texte ouvre le catalogue paginé; un lien choisi joue directement.
    if (isSlash(ctx) && !/^https?:\/\//i.test(query) && !/^spotify:/i.test(query)) {
      await ctx.deferReply({ ephemeral: true });
      try {
        const items = await searchCatalog(query);
        if (!items.length) return edit({ content: `Aucun résultat trouvé pour « ${query.slice(0, 150)} ».`, embeds: [], components: [] });
        const { id, session } = makeSession({ userId: userIdOf(ctx), guildId: ctx.guildId, query, title: `Résultats · ${query.slice(0, 230)}`, items });
        return edit(renderSession(id, session));
      } catch (error) {
        return edit({ content: `Recherche impossible : ${String(error.message).slice(0, 1200)}`, embeds: [], components: [] });
      }
    }

    const artistId = spotifyArtistId(query);
    if (isSlash(ctx) && artistId) {
      await ctx.deferReply({ ephemeral: true });
      try {
        const items = await getArtistAlbums(artistId);
        if (!items.length) return edit({ content: 'Aucun album public trouvé pour cet artiste.', embeds: [], components: [] });
        const { id, session } = makeSession({ userId: userIdOf(ctx), guildId: ctx.guildId, query, title: 'Discographie Spotify', items });
        return edit(renderSession(id, session));
      } catch (error) {
        return edit({ content: `Discographie indisponible : ${String(error.message).slice(0, 1200)}`, embeds: [], components: [] });
      }
    }

    if (!ctx.member?.voice?.channel) return reply({ embeds: [embeds.errorEmbed(tr(lang).needVoice, lang)] });
    await reply({ embeds: [embeds.searchEmbed(query, lang)] });
    try {
      const validation = /(?:youtube\.com|youtu\.be)/i.test(query) ? await play.validate(query) : null;
      const songs = validation === 'yt_video'
        ? [{ title: query, url: query, source: 'youtube' }]
        : await resolveQuery(query);
      const { queued, player } = await queueSongs(ctx, deps, songs);
      if (queued) return edit({ embeds: [embeds.addedEmbed(songs[0], player.queue.length, player.queue.length, lang)] });
      return edit({ embeds: [embeds.playingEmbed(songs[0], player, lang)] });
    } catch (error) {
      console.error('Erreur play:', error);
      if (error?.code === 'VOCAL_UNAVAILABLE') return edit({ embeds: [embeds.notFoundEmbed(lang)] });
      return edit({ embeds: [embeds.errorEmbed(error.message, lang)] });
    }
  },
};
