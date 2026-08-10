/**
 * Commande: volume (!volume / /volume) [0-100]
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../utils/embedI18n');

module.exports = {
  data: { name: 'volume', description: 'Règle le volume (0-100)' },
  slash: true,
  options: [
    { name: 'niveau', description: 'Volume de 0 à 100', type: 4, required: true },
  ],

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const { getPlayer } = deps;
    const player = getPlayer(ctx.guildId);
    const raw = parseInt(args[0], 10);
    if (isNaN(raw) || raw < 0 || raw > 100) {
      return ctx.reply({
        embeds: [new EmbedBuilder().setTitle(T.errorTitle).setDescription(T.volumeRange).setColor('#FF0000')],
      });
    }
    const vol = player.setVolume(raw);
    return ctx.reply({
      embeds: [new EmbedBuilder().setTitle(T.volTitle).setDescription(T.volumeSet(vol)).setColor('#0099FF')],
    });
  },
};
