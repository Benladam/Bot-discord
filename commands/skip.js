/**
 * Commande: skip (!skip / /skip)
 */

const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { tr } = require('../shared/i18n/embedI18n');
const { requireGuildContext } = require('../shared/discord/commandHelpers');
const { MessageFlags } = require('discord.js');

module.exports = {
  data: { name: 'skip', description: 'Passe à la musique suivante' },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    if (!player.isPlaying) {
      return ctx.reply({
        embeds: [createThemedEmbed('danger').setTitle(`⚠️ ${T.errorTitle}`).setDescription(T.notPlaying).setTimestamp()],
      });
    }
    if (ctx.isChatInputCommand?.() && !ctx.deferred && !ctx.replied) {
      await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    }
    await player.skip();
    const payload = { embeds: [createThemedEmbed('primary').setTitle(`⏭️ ${T.nextTitle}`).setTimestamp()] };
    return ctx.deferred ? ctx.editReply(payload) : ctx.reply(payload);
  },
};
