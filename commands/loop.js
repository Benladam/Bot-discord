/**
 * Commande: loop (!loop / /loop) [off|song|queue]
 * Mode de boucle : désactivé, chanson en cours, ou toute la file.
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../utils/embedI18n');

module.exports = {
  data: { name: 'loop', description: 'Active/désactive la boucle (off, song, queue)' },
  slash: true,
  options: [
    { name: 'mode', description: 'off, song ou queue', type: 3, required: false },
  ],

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    const arg = (args[0] || '').toLowerCase();
    const labels = { off: 0, song: 1, queue: 2 };
    if (!arg) {
      const current = T.loopModes[player.loopMode];
      return ctx.reply({
        embeds: [new EmbedBuilder().setTitle(T.loopTitle).setDescription(T.loopCurrent(current)).setColor('#0099FF')],
      });
    }
    if (!(arg in labels)) {
      return ctx.reply({
        embeds: [new EmbedBuilder().setTitle(T.errorTitle).setDescription(T.loopInvalid).setColor('#FF0000')],
      });
    }
    player.loopMode = labels[arg];
    player._activity?.();
    const current = T.loopModes[player.loopMode];
    return ctx.reply({
      embeds: [new EmbedBuilder().setTitle(T.loopTitle).setDescription(T.loopSet2(current)).setColor('#0099FF')],
    });
  },
};
