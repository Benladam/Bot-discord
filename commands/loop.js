/**
 * Commande: loop (!loop / /loop) [off|song|queue]
 * Mode de boucle : désactivé, chanson en cours, ou toute la file.
 */

const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { tr } = require('../shared/i18n/embedI18n');
const { requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: {
    name: 'loop', description: 'Configure la répétition de la musique ou de la file',
    options: [{
      name: 'mode', description: 'Mode de répétition', type: 3, required: false,
      choices: [
        { name: 'Désactivée', value: 'off' },
        { name: 'Musique actuelle', value: 'song' },
        { name: 'Toute la file', value: 'queue' },
      ],
    }],
  },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    const arg = String(ctx.isChatInputCommand?.() ? ctx.options.getString('mode') || '' : args[0] || '').toLowerCase();
    const labels = { off: 0, song: 1, queue: 2 };
    if (!arg) {
      const current = T.loopModes[player.loopMode];
      return ctx.reply({
        embeds: [createThemedEmbed('primary').setTitle(`🔁 ${T.loopTitle}`).setDescription(T.loopCurrent(current)).setTimestamp()],
      });
    }
    if (!(arg in labels)) {
      return ctx.reply({
        embeds: [createThemedEmbed('danger').setTitle(`⚠️ ${T.errorTitle}`).setDescription(T.loopInvalid).setTimestamp()],
      });
    }
    player.loopMode = labels[arg];
    player._activity?.();
    const current = T.loopModes[player.loopMode];
    return ctx.reply({
      embeds: [createThemedEmbed('success').setTitle(`🔁 ${T.loopTitle}`).setDescription(T.loopSet2(current)).setTimestamp()],
    });
  },
};
