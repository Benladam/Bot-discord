/**
 * Commande: shuffle (!shuffle / /shuffle)
 * Mélange la file d'attente.
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../utils/embedI18n');

module.exports = {
  data: { name: 'shuffle', description: 'Mélange la file d\'attente' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    if (player.queue.length < 2) {
      return ctx.reply({
        embeds: [new EmbedBuilder().setTitle(T.errorTitle).setDescription(T.shuffleFew).setColor('#FF0000')],
      });
    }
    player.shuffleQueue();
    return ctx.reply({
      embeds: [new EmbedBuilder().setTitle(T.shuffleTitle).setDescription(T.shuffleDesc(player.queue.length)).setColor('#00FF00')],
    });
  },
};
