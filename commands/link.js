/**
 * Commande: link (!link / /link)
 * Réservée AU PROPRIÉTAIRE du bot (voir bot.js qui bloque déjà les non-propriétaires).
 * Donne le lien vers le panneau de contrôle local pour configurer davantage.
 */
const { t: botT } = require('../botI18n');

function guiUrl() {
  const port = process.env.GUI_PORT || 7790;
  return `http://localhost:${port}/`;
}

module.exports = {
  data: { name: 'link', description: 'Lien vers le panneau de configuration (propriétaire)' },
  slash: true,
  ownerOnly: true,

  async execute(ctx, args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    const guildId = ctx.guild?.id;
    const lang = deps.langFor ? deps.langFor(userId, guildId) : 'fr';
    const STR = botT(lang);
    const url = guiUrl();
    const text = `🔗 ${STR.linkTitle}\n${STR.linkOpen(url)}`;

    // Discord (interaction ou message) -> réponse éphémère/privée au propriétaire
    if (typeof ctx.reply === 'function') return ctx.reply({ content: text, ephemeral: true });
    if (ctx.channel?.send) return Promise.resolve(ctx.channel.send(text));
    return undefined;
  },
};
