/**
 * Commande: link (!link / /link)
 * Réservée AU PROPRIÉTAIRE du bot (voir bot.js qui bloque déjà les non-propriétaires).
 * Donne le lien public du panneau web hébergé avec le bot.
 */
const { t: botT } = require('../core/i18n/botI18n');
const { MessageFlags } = require('discord.js');
const { getWebPanelPublicUrl } = require('../features/web/server');

module.exports = {
  data: { name: 'link', description: 'Lien vers le panneau de configuration (propriétaire)' },
  slash: true,
  ownerOnly: true,

  async execute(ctx, args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    const guildId = ctx.guild?.id;
    const lang = deps.langFor ? deps.langFor(userId, guildId) : 'fr';
    const STR = botT(lang);
    const url = getWebPanelPublicUrl();
    const text = url
      ? `🔗 ${STR.linkTitle}\n${STR.linkOpen(url)}`
      : '🔗 Le panneau web n’est pas encore configuré. Définis WEB_PUBLIC_URL et WEB_ADMIN_TOKEN sur l’hébergement, puis redémarre le bot. Aucun lien localhost ne fonctionnera depuis ton appareil.';

    // Discord (interaction ou message) -> réponse éphémère/privée au propriétaire
    if (typeof ctx.reply === 'function') {
      const payload = { content: text };
      if (ctx.isChatInputCommand?.()) payload.flags = MessageFlags.Ephemeral;
      return ctx.reply(payload);
    }
    if (ctx.channel?.send) return Promise.resolve(ctx.channel.send(text));
    return undefined;
  },
};
