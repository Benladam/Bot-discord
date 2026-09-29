/**
 * Commande: volume (!volume / /volume) [0-100]
 */

const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { tr } = require('../shared/i18n/embedI18n');
const guildDatabase = require('../core/database');
const { isSlash, getIntegerOption, requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: {
    name: 'volume', description: 'Règle le volume de lecture (0 à 100 %)',
    options: [{ name: 'niveau', description: 'Pourcentage entre 0 et 100', type: 4, required: true, minValue: 0, maxValue: 100 }],
  },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    const raw = isSlash(ctx) ? getIntegerOption(ctx, 'niveau') : Number.parseInt(args[0], 10);
    if (isNaN(raw) || raw < 0 || raw > 100) {
      return ctx.reply({
        embeds: [createThemedEmbed('danger').setTitle(`⚠️ ${T.errorTitle}`).setDescription(T.volumeRange).setTimestamp()],
      });
    }
    const vol = player.setVolume(raw);
    if (ctx.guildId) guildDatabase.setGuildSetting(ctx.guildId, 'defaultVolume', raw / 100);
    return ctx.reply({
      embeds: [createThemedEmbed('success').setTitle(`🔉 ${T.volTitle}`).setDescription(T.volumeSet(vol)).setTimestamp()],
    });
  },
};
