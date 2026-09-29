/**
 * Commande: help (!help / /help)
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('../shared/i18n/embedI18n');

module.exports = {
  data: { name: 'help', description: 'Affiche la liste des commandes' },
  slash: true,

  async execute(ctx, args, deps) {
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const p = deps.prefix;
    const loaded = (name) => !deps.commands || deps.commands.has(name);
    const extraFields = [];
    const moderation = ['warn', 'warnings', 'unwarn', 'timeout', 'clear', 'kick', 'ban'].filter(loaded);
    const utilities = ['ping', 'userinfo', 'serverinfo', 'avatar', 'poll'].filter(loaded);
    const settings = ['controller', 'link', 'language', 'updatelog', 'update', 'about', 'presence'].filter(loaded);
    const describeCommand = (name) => `/${name} — ${deps.commands?.get(name)?.data?.description || name}`;
    if (moderation.length) extraFields.push({ name: '🛡️ Modération', value: moderation.map(describeCommand).join('\n') });
    if (utilities.length) extraFields.push({ name: '🧰 Outils serveur', value: utilities.map(describeCommand).join('\n') });
    if (settings.length) extraFields.push({ name: '⚙️ Réglages et crédits', value: `${settings.map(describeCommand).join('\n')}\n/presence est réservé au propriétaire du bot.` });
    const embed = new EmbedBuilder()
      .setTitle(T.helpTitle)
      .setDescription(T.helpIntro(p))
      .setColor('#0000FF')
      .addFields(
        { name: `${p}play  ou  /play [lien/recherche]`, value: T.helpPlay },
        { name: `${p}pause  /  /pause`, value: T.helpPause },
        { name: `${p}resume  /  /resume`, value: T.helpResume },
        { name: `${p}skip  /  /skip`, value: T.helpSkip },
        { name: `${p}stop  /  /stop`, value: T.helpStop },
        { name: `${p}queue  /  /queue`, value: T.helpQueue },
        { name: `${p}now  /  /now`, value: T.helpNow },
        { name: `${p}volume  /  /volume [0-100]`, value: T.helpVolume },
        { name: `${p}loop  /  /loop [off|song|queue]`, value: T.helpLoop },
        { name: `${p}shuffle  /  /shuffle`, value: T.helpShuffle },
        { name: `${p}playlist  /  /playlist`, value: 'Crée et gère les playlists partagées du serveur.' },
        { name: `${p}leave  /  /leave`, value: T.helpLeave },
        { name: `${p}help  /  /help`, value: T.helpHelp },
        ...extraFields,
      )
      .setFooter({ text: T.helpFooter });

    return ctx.reply({ embeds: [embed] });
  },
};
