/**
 * Commande: language (!language / /language)
 *
 * Sémantique (demandée par l'utilisateur) :
 *   /language #all fr        -> langue FORCÉE du serveur (tous les users + GUI). Irrévocable par un user.
 *   /language fr             -> langue PERSONNELLE (ce user, et son terminal/GUI s'il est l'opérateur)
 *   Sur Discord, un user ne change QUE sa propre langue (sauf #all réservé propriétaire).
 *
 * Langues supportées : fr, en, es, ar
 */
const { t: botT } = require('../core/i18n/botI18n');
const { LANGS } = require('../core/i18n/botI18n');

function replyMessage(ctx, text) {
  if (typeof ctx.reply === 'function') return ctx.reply({ content: text, ephemeral: true });
  if (ctx.channel?.send) return Promise.resolve(ctx.channel.send(text));
  return undefined;
}

module.exports = {
  data: { name: 'language', description: 'Change la langue (perso ou #all pour le serveur)' },
  slash: true,
  async execute(ctx, args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    const guildId = ctx.guild?.id;
    const isOwner = deps.isOwner ? deps.isOwner(userId) : false;

    // args peut venir du slash (tableau) ou du préfixe (tableau aussi, see bot.js)
    let raw = (args && args.join(' ')) || '';
    raw = raw.trim();

    // Forme slash : si l'option "all" a été fournie
    if (ctx.options && ctx.options.get) {
      const optAll = ctx.options.get('all')?.value;
      const optLang = ctx.options.get('lang')?.value;
      if (optAll || optLang) raw = `${optAll ? '#all ' : ''}${optLang || ''}`.trim();
    }

    if (!raw) {
      const STR = botT(deps.langFor ? deps.langFor(userId, guildId) : 'fr');
      return replyMessage(ctx, STR.langList);
    }

    const forcedServer = /\b#all\b/i.test(raw);
    const lang = raw.replace(/\B#all\b/i, '').trim().toLowerCase();

    if (!LANGS.includes(lang)) {
      const STR = botT(deps.langFor ? deps.langFor(userId, guildId) : 'fr');
      return replyMessage(ctx, STR.langUnknown(lang));
    }

    const STR = botT(lang);

    if (forcedServer) {
      // #all réservé au propriétaire
      if (!isOwner) return replyMessage(ctx, STR.linkOnlyOwner.replace('🔗', '🌐').replace('lien de configuration', 'langue du serveur'));
      deps.langStore.setServer(guildId, lang, true);
      return replyMessage(ctx, STR.langSetServer(lang));
    }

    // Langue personnelle
    deps.langStore.setUser(userId, lang);
    return replyMessage(ctx, STR.langSetPersonal(lang));
  },
};
