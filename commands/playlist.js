/** Playlists personnalisées persistantes et isolées par serveur Discord. */
const { resolveQuery } = require('../features/music/resolve');
const store = require('../core/database');
const playCommand = require('./play');

const ACTIONS = [
  { name: 'Créer une playlist', value: 'create' },
  { name: 'Ajouter un morceau', value: 'add' },
  { name: 'Écouter', value: 'play' },
  { name: 'Lister', value: 'list' },
  { name: 'Retirer un morceau', value: 'remove' },
  { name: 'Supprimer', value: 'delete' },
];

function slash(ctx) { return typeof ctx.isChatInputCommand === 'function' && ctx.isChatInputCommand(); }

module.exports = {
  data: {
    name: 'playlist',
    description: 'Crée et partage des playlists persistantes sur ce serveur',
    options: [
      { name: 'action', description: 'Opération à effectuer', type: 3, required: true, choices: ACTIONS },
      { name: 'name', description: 'Nom de la playlist', type: 3, required: false },
      { name: 'song', description: 'Titre ou lien musical', type: 3, required: false, autocomplete: true },
      { name: 'position', description: 'Numéro du titre à retirer (visible avec list)', type: 4, required: false },
    ],
  },
  slash: true,
  async autocomplete(interaction, deps) { return playCommand.autocomplete(interaction, deps); },

  async execute(ctx, args, deps) {
    if (!ctx.guildId) return ctx.reply('Les playlists sont propres à un serveur Discord.');
    const slashCommand = slash(ctx);
    const action = slashCommand ? ctx.options.getString('action') : String(args[0] || '').toLowerCase();
    let name = slashCommand ? ctx.options.getString('name') : '';
    let query = slashCommand ? ctx.options.getString('song') : '';
    let position = slashCommand ? ctx.options.getInteger('position') : Number(args[2]);
    if (!slashCommand) {
      if (action === 'add') { name = args[1]; query = args.slice(2).join(' '); }
      else if (action === 'remove') name = args[1];
      else name = args.slice(1).join(' ');
    }
    const userId = ctx.user?.id || ctx.author?.id;
    const reply = (content) => ctx.reply(slashCommand ? { content, ephemeral: true } : content);

    try {
      if (action === 'list') {
        const lists = store.listPlaylists(ctx.guildId);
        if (!lists.length) return reply('Aucune playlist enregistrée sur ce serveur. Crée-en une avec `/playlist action:create`.');
        const lines = lists.slice(0, 30).map((item, i) => `${i + 1}. **${item.name}** — ${item.trackCount} titre(s) — <@${item.ownerId}>`);
        return reply(`Playlists de ce serveur :\n${lines.join('\n')}`);
      }
      if (action === 'create') {
        store.createPlaylist(ctx.guildId, userId, name);
        return reply(`Playlist **${name.trim()}** créée pour ce serveur. Ajoute des titres avec l’action « add ».`);
      }
      if (action === 'add') {
        if (!query) throw new Error('Indique le titre ou le lien d’un seul morceau.');
        const songs = await resolveQuery(query);
        if (songs.length !== 1) throw new Error('Ajoute les titres un par un à une playlist personnalisée.');
        const count = store.addTrack(ctx.guildId, userId, name, songs[0]);
        return reply(`**${songs[0].title}** ajouté à **${name}** (position ${count}).`);
      }
      if (action === 'remove') {
        if (!Number.isInteger(position) || position < 1) throw new Error('Indique le numéro du morceau à retirer.');
        store.removeTrack(ctx.guildId, userId, name, position);
        return reply(`Morceau ${position} retiré de **${name}**.`);
      }
      if (action === 'delete') {
        store.deletePlaylist(ctx.guildId, userId, name);
        return reply(`Playlist **${name}** supprimée.`);
      }
      if (action === 'play') {
        const playlist = store.getPlaylist(ctx.guildId, name);
        if (!playlist) throw new Error('Playlist introuvable sur ce serveur.');
        if (!playlist.tracks.length) throw new Error('Cette playlist ne contient aucun titre.');
        if (!ctx.member?.voice?.channel) throw new Error('Rejoins un salon vocal pour écouter cette playlist.');
        if (slashCommand) await ctx.deferReply({ ephemeral: true });
        const songs = playlist.tracks.slice(0, 100).map((track) => ({
          title: track.title, url: track.url, source: track.source || 'youtube', duration: 0,
        }));
        const player = deps.getPlayer(ctx.guildId);
        const result = await player.enqueueSongs(songs, {
          voiceChannel: ctx.member.voice.channel,
          lastChannel: ctx.channel,
          addedBy: ctx.member.displayName || ctx.user?.username || ctx.author?.username || '?',
          requesterId: userId,
          lang: deps.langFor ? deps.langFor(userId, ctx.guild?.id) : 'fr',
        });
        return slashCommand
          ? ctx.editReply(`${songs.length} titre(s) de **${playlist.name}** ajouté(s)${result.queued ? ' à la file d’attente' : ' · lecture lancée'}${playlist.tracks.length > songs.length ? ' (limite de 100 titres par lancement).' : '.'}`)
          : ctx.reply(`${songs.length} titre(s) de **${playlist.name}** ajouté(s)${playlist.tracks.length > songs.length ? ' (limite de 100 titres par lancement).' : '.'}`);
      }
      throw new Error(`Action inconnue. Choisis : ${ACTIONS.map((item) => item.value).join(', ')}.`);
    } catch (error) {
      const content = `❌ ${error.message}`;
      if (ctx.deferred || ctx.replied) return ctx.editReply({ content, embeds: [], components: [] });
      return reply(content);
    }
  },
};
