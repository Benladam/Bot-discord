/**
 * Commande: play (!play / /play)
 * Joue un lien YouTube, un lien Spotify (track/album/playlist) ou une recherche.
 * Supporte l'autocomplétion live (Discord propose les musiques pendant la frappe).
 */

const { resolveQuery } = require('../utils/resolve');
const { cleanMediaQuery } = require('../utils/mediaQuery');
const { searchSpotify } = require('../utils/spotify');
const embeds = require('../utils/embeds');
const { tr } = require('../utils/embedI18n');
const play = require('play-dl');

// Recherche play-dl avec retry (bug YouTube intermittent renvoie parfois une erreur).
async function searchWithRetry(q, limit = 10) {
  let results = [];
  for (let i = 0; i < 3 && results.length === 0; i++) {
    try { results = await play.search(q, { limit }); } catch (_) { results = []; }
  }
  return results;
}

module.exports = {
  data: {
    name: 'play',
    description: 'Joue un lien YouTube/Spotify ou une recherche',
    options: [
      { name: 'query', description: 'Nom ou lien YouTube/Spotify', type: 3, required: true, autocomplete: true },
      { name: 'insert-first', description: 'Mettre la musique en haut de la file', type: 5, required: false },
    ],
  },
  // Renvoie true si la commande doit être enregistrée comme slash command
  slash: true,

  // Autocomplétion : renvoie les résultats de recherche à Discord pendant la frappe.
  async autocomplete(interaction, deps) {
    const q = interaction.options.getFocused().toString().trim();
    if (!q) return interaction.respond({ choices: [] });
    const [youtube, spotify] = await Promise.all([
      searchWithRetry(q, 10).catch(() => []),
      searchSpotify(q, 10).catch((error) => {
        if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
          console.warn('[spotify] recherche indisponible:', error.message);
        }
        return [];
      }),
    ]);
    const choices = [
      ...youtube.map((r) => ({ name: `▶ YouTube · ${r.title}`.slice(0, 100), value: r.url })),
      ...spotify.map((r) => ({ name: `🟢 Spotify · ${r.title}`.slice(0, 100), value: r.url })),
    ].filter((choice) => typeof choice.value === 'string' && choice.value.length <= 100).slice(0, 25);
    return interaction.respond({ choices });
  },

  async execute(ctx, args, deps) {
    const { getPlayer } = deps;
    const query = cleanMediaQuery(args.join(' '));
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);

    // Répond ou édite selon le type de commande (slash a editReply, préfixe non).
    const reply = (o) => ctx.reply(o);
    const edit = (o) => (typeof ctx.editReply === 'function' ? ctx.editReply(o) : ctx.reply(o));

    const member = ctx.member;
    if (!member || !member.voice || !member.voice.channel) {
      return reply({ embeds: [embeds.errorEmbed(T.needVoice, lang)] });
    }
    if (!query) {
      return reply({ embeds: [embeds.errorEmbed(T.specifySong, lang)] });
    }

    const searchMsg = await reply({ embeds: [embeds.searchEmbed(query, lang)] });

    try {
      const player = getPlayer(ctx.guildId);
      player.lastChannel = ctx.channel;
      // Seuls les liens YouTube peuvent être envoyés directement au lecteur.
      // Un lien Spotify doit d'abord être résolu en une vidéo YouTube équivalente.
      const isYoutubeUrl = /(?:youtube\.com|youtu\.be)/i.test(query);
      const songs = isYoutubeUrl
        ? [{ title: query, url: query, source: 'youtube' }]
        : await resolveQuery(query);

      for (const song of songs) player.addToQueue(song);

      // Infos pour l'embed "Now playing" (style FlaviBot).
      player.addedBy = member.displayName || member.user?.username || '?';
      player.voiceChannelName = member.voice.channel.name || '?';

      if (!player.isPlaying) {
        await player.ensureConnection(member.voice.channel);
        const song = await player.playNext((s) => edit({ embeds: [embeds.playingEmbed(s, player, lang)] }));
        if (!song) {
          return edit({ embeds: [embeds.endedEmbed(lang)] });
        }
      } else {
        if (songs.length > 1) {
          return edit({ embeds: [embeds.addedSpotifyEmbed(songs.length, songs[0], player.queue.length, lang)] });
        }
        return edit({ embeds: [embeds.addedEmbed(songs[0], player.queue.length, player.queue.length, lang)] });
      }
    } catch (error) {
      console.error('Erreur play:', error);
      if (error && error.code === 'VOCAL_UNAVAILABLE') {
        return edit({ embeds: [embeds.notFoundEmbed(lang)] });
      }
      return edit({ embeds: [embeds.errorEmbed(error.message, lang)] });
    }
  },
};
