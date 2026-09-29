/**
 * Commande: stop (!stop / /stop)
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../shared/i18n/embedI18n');

module.exports = {
  data: { name: 'stop', description: 'Arrête la lecture et vide la file' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    player.destroy();
    return ctx.reply({ embeds: [new EmbedBuilder().setTitle(T.stopTitle).setDescription(T.stopDesc).setColor('#FF0000')] });
  },
};
