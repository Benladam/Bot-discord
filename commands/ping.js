const { EmbedBuilder } = require('discord.js');
const { isSlash } = require('../utils/commandHelpers');

module.exports = {
  data: { name: 'ping', description: 'Affiche la latence du bot et de Discord' },
  slash: true,
  async execute(ctx) {
    const latency = Number.isFinite(ctx.client.ws.ping) ? `${Math.round(ctx.client.ws.ping)} ms` : 'indisponible';
    const started = Date.now();
    const response = isSlash(ctx)
      ? (await ctx.reply({ content: 'Mesure en cours…', ephemeral: true }), await ctx.fetchReply())
      : await ctx.reply('Mesure en cours…');
    const roundTrip = response.createdTimestamp - started;
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🏓 Pong !')
      .addFields({ name: 'Passerelle Discord', value: latency, inline: true }, { name: 'Réponse', value: `${roundTrip} ms`, inline: true });
    if (isSlash(ctx)) return ctx.editReply({ content: '', embeds: [embed] });
    return response.edit({ content: '', embeds: [embed] });
  },
};
