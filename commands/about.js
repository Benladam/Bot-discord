const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { withBrandArtwork } = require('../shared/discord/brandArtwork');
const { isSlash } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'about', description: 'Affiche les crédits et la licence du bot' },
  slash: true,
  helpCategory: 'setup',
  async execute(ctx) {
    const embed = createThemedEmbed('primary').setTitle('🎛️ À propos du bot')
      .setDescription('Un bot Discord open source pour la musique, la modération et les outils de serveur.')
      .addFields(
        { name: '🎵 Fonctionnalités', value: 'Lecteur indépendant par serveur, file d’attente et commandes interactives.', inline: true },
        { name: '🛡️ Personnalisation', value: 'Configuration et données conservées sur ton propre hébergement.', inline: true },
        { name: '📄 Licence', value: '[MIT](https://opensource.org/license/mit) — réutilisation et modifications autorisées en conservant la licence.', inline: false },
      )
      .setFooter({ text: 'Projet communautaire · contributions bienvenues' })
      .setTimestamp();
    const payload = withBrandArtwork(embed);
    if (isSlash(ctx)) return ctx.reply({ ...payload, ephemeral: true });
    return ctx.reply(payload);
  },
};
