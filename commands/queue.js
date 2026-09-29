/**
 * Commande: queue (!queue / /queue)
 */

const embeds = require('../shared/discord/embeds');
const { requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'queue', description: 'Affiche la file d\'attente' },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    return ctx.reply({ embeds: [embeds.queueEmbed(player, deps.prefix, lang)] });
  },
};
