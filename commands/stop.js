/**
 * Commande: stop (!stop / /stop)
 */

const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { tr } = require('../shared/i18n/embedI18n');
const { requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'stop', description: 'Arrête la lecture et vide la file' },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    player.stop();
    return ctx.reply({ embeds: [createThemedEmbed('neutral').setTitle(`⏹️ ${T.stopTitle}`).setDescription(T.stopDesc).setTimestamp()] });
  },
};
