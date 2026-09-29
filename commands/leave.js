/**
 * Commande: leave (!leave / /leave)
 * Le bot quitte le canal vocal et vide la file.
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../shared/i18n/embedI18n');

module.exports = {
  data: { name: 'leave', description: 'Le bot quitte le canal vocal' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    player.destroy();
    return ctx.reply({ embeds: [new EmbedBuilder().setTitle(T.leaveTitle).setDescription(T.leaveDesc).setColor('#808080')] });
  },
};
