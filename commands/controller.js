/**
 * Commande: controller (!controller / /controller)
 * Affiche l’URL publique du panneau musical hébergé avec le bot.
 */

const { EmbedBuilder, MessageFlags } = require('discord.js');
const { getWebPanelPublicUrl } = require('../features/web/server');

module.exports = {
  data: {
    name: 'controller',
    description: 'Ouvre le panneau web de contrôle musical du bot',
  },
  slash: true,

  async execute(ctx) {
    const url = getWebPanelPublicUrl();
    const embed = new EmbedBuilder()
      .setColor(url ? 0x7d9c4f : 0xe0a642)
      .setTitle(url ? '🖥️ Panneau musical' : '🛠️ Panneau non configuré')
      .setDescription(url
        ? `Panneau hébergé avec le bot : ${url}\n\nConnecte-toi avec le jeton d’accès configuré par le propriétaire du bot. Les états et commandes affichés sont séparés par serveur Discord.`
        : 'Le panneau web n’a pas encore d’adresse publique. L’administrateur doit configurer WEB_PUBLIC_URL et WEB_ADMIN_TOKEN sur l’hébergement, puis redémarrer le bot. Aucun lien localhost ne fonctionnera depuis ton appareil.')
      .addFields(
        { name: '🎵 Lecture', value: 'Voir la musique et la file; pause, reprise, skip et arrêt.', inline: true },
        { name: '🔊 Serveur', value: 'Choisir un serveur et régler son mode vocal 24/7.', inline: true },
      )
      .setFooter({ text: 'Pour rechercher ou ajouter une piste, utilise /play sur Discord.' });

    const payload = { embeds: [embed] };
    if (ctx.isChatInputCommand?.() && ctx.guildId) payload.flags = MessageFlags.Ephemeral;
    return ctx.reply(payload);
  },
};
