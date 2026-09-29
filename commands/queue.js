/**
 * Commande: queue (!queue / /queue)
 */

const embeds = require('../shared/discord/embeds');

module.exports = {
  data: { name: 'queue', description: 'Affiche la file d\'attente' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    return ctx.reply({ embeds: [embeds.queueEmbed(player, deps.prefix, lang)] });
  },
};
