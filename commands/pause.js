/**
 * Commande: pause (!pause / /pause)
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../shared/i18n/embedI18n');

module.exports = {
  data: { name: 'pause', description: 'Met la lecture en pause' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    if (!player.isPlaying || player.isPaused) {
      return ctx.reply({
        embeds: [new EmbedBuilder().setTitle(T.errorTitle).setDescription(T.notPlaying).setColor('#FF0000')],
      });
    }
    player.pause();
    return ctx.reply({ embeds: [new EmbedBuilder().setTitle('⏸️').setDescription(T.paused).setColor('#FFA500')] });
  },
};
