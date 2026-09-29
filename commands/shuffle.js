/**
 * Commande: shuffle (!shuffle / /shuffle)
 * Mélange la file d'attente.
 */

const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { tr } = require('../shared/i18n/embedI18n');
const { requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'shuffle', description: 'Mélange la file d\'attente' },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    if (player.queue.length < 2) {
      return ctx.reply({
        embeds: [createThemedEmbed('warning').setTitle(`⚠️ ${T.errorTitle}`).setDescription(T.shuffleFew).setTimestamp()],
      });
    }
    player.shuffleQueue();
    return ctx.reply({
      embeds: [createThemedEmbed('success').setTitle(`🔀 ${T.shuffleTitle}`).setDescription(T.shuffleDesc(player.queue.length)).setTimestamp()],
    });
  },
};
