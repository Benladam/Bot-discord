const { EmbedBuilder } = require('discord.js');
const { isSlash } = require('../utils/commandHelpers');

module.exports = {
  data: { name: 'about', description: 'Affiche les crédits et la licence du bot' },
  slash: true,
  async execute(ctx) {
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('À propos du bot')
      .setDescription('Bot Discord multifonction : musique, outils serveur et modération.')
      .addFields(
        { name: 'Discord', value: 'lefauxmaghrebin', inline: true },
        { name: 'GitHub', value: 'Benladam', inline: true },
        { name: 'Licence', value: '[MIT](https://opensource.org/license/mit) — utilisation et modifications autorisées avec conservation de l’avis de copyright et du texte de licence.', inline: false },
      );
    if (isSlash(ctx)) return ctx.reply({ embeds: [embed], ephemeral: true });
    return ctx.reply({ embeds: [embed] });
  },
};
