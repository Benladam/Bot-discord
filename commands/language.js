const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { t: botT, LANGS } = require('../core/i18n/botI18n');
const { isSlash, hasPermission, getStringOption } = require('../shared/discord/commandHelpers');

function replyMessage(ctx, text) {
  if (isSlash(ctx)) return ctx.reply({ content: text, flags: MessageFlags.Ephemeral });
  if (ctx.channel?.send) return Promise.resolve(ctx.channel.send(text));
  if (typeof ctx.reply === 'function') return ctx.reply(text);
  return undefined;
}

module.exports = {
  data: {
    name: 'language', description: 'Choisit la langue personnelle ou celle de ce serveur',
    options: [
      { name: 'langue', description: 'Langue à utiliser', type: 3, required: true, choices: [
        { name: 'Français', value: 'fr' }, { name: 'English', value: 'en' },
        { name: 'Español', value: 'es' }, { name: 'العربية', value: 'ar' },
      ] },
      { name: 'portee', description: 'Préférence personnelle ou réglage du serveur', type: 3, required: false, choices: [
        { name: 'Ma préférence personnelle', value: 'personal' },
        { name: 'Tout le serveur (permission Gérer le serveur)', value: 'server' },
      ] },
    ],
  },
  slash: true,
  helpCategory: 'setup',

  async execute(ctx, args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    const guildId = ctx.guild?.id;
    const lang = isSlash(ctx)
      ? String(getStringOption(ctx, 'langue') || '').toLowerCase()
      : String(args?.[0] || '').toLowerCase();
    const scope = isSlash(ctx)
      ? (getStringOption(ctx, 'portee') || 'personal')
      : (/^(server|serveur|#all)$/i.test(args?.[0] || '') ? 'server' : /^(server|serveur|#all)$/i.test(args?.[1] || '') ? 'server' : 'personal');
    const selectedLanguage = scope === 'server' && !isSlash(ctx) && /^(server|serveur|#all)$/i.test(args?.[0] || '')
      ? String(args?.[1] || '').toLowerCase()
      : lang;

    if (!LANGS.includes(selectedLanguage)) {
      const STR = botT(deps.langFor ? deps.langFor(userId, guildId) : 'fr');
      return replyMessage(ctx, `${STR.langList}\n${STR.langUnknown(selectedLanguage || '')}`);
    }

    const STR = botT(selectedLanguage);
    if (scope === 'server') {
      if (!guildId) return replyMessage(ctx, 'Le réglage de langue du serveur doit être utilisé dans un serveur Discord.');
      if (!hasPermission(ctx, PermissionFlagsBits.ManageGuild)) {
        return replyMessage(ctx, 'Il te faut la permission « Gérer le serveur » pour changer la langue de ce serveur.');
      }
      deps.langStore.setServer(guildId, selectedLanguage, true);
      return replyMessage(ctx, STR.langSetServer(selectedLanguage));
    }

    deps.langStore.setUser(userId, selectedLanguage);
    return replyMessage(ctx, STR.langSetPersonal(selectedLanguage));
  },
};
