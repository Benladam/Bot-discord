/**
 * Commande: now (!now / /now)
 */

const embeds = require('../utils/embeds');

module.exports = {
  data: { name: 'now', description: 'Affiche la musique en cours' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    return ctx.reply({ embeds: [embeds.nowEmbed(player, lang)] });
  },
};
