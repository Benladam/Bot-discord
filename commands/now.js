/**
 * Commande: now (!now / /now)
 */

const embeds = require('../shared/discord/embeds');
const { requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'now', description: 'Affiche la musique en cours' },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    return ctx.reply({ embeds: [embeds.nowEmbed(player, lang)] });
  },
};
