/** Fait rejoindre le bot au salon vocal de la personne qui lance la commande. */

const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { tr } = require('../shared/i18n/embedI18n');
const { isSlash, sendReply, deferReply, requireGuildContext } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'join', description: 'Fait rejoindre le bot à ton salon vocal' },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, _args, deps) {
    requireGuildContext(ctx);
    const lang = deps.langFor ? deps.langFor(ctx.user?.id || ctx.author?.id, ctx.guild?.id) : 'fr';
    const T = tr(lang);
    const channel = ctx.member?.voice?.channel;
    if (!channel) return sendReply(ctx, T.joinNeedVoice);
    if (channel.type !== ChannelType.GuildVoice) return sendReply(ctx, T.joinVoiceOnly);

    const botMember = ctx.guild.members?.me;
    const permissions = botMember ? channel.permissionsFor(botMember) : null;
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)
        || !permissions.has(PermissionFlagsBits.Connect)
        || !permissions.has(PermissionFlagsBits.Speak)) {
      return sendReply(ctx, T.joinMissingPermissions);
    }

    await deferReply(ctx, { ephemeral: true });
    try {
      await deps.getPlayer(ctx.guildId).ensureConnection(channel);
      const embed = createThemedEmbed('success')
        .setTitle(T.joinTitle)
        .setDescription(T.joinDesc(channel.name, deps.prefix || '!'))
        .setTimestamp();
      if (isSlash(ctx) && (ctx.deferred || ctx.replied)) return ctx.editReply({ embeds: [embed] });
      return ctx.reply({ embeds: [embed], ...(isSlash(ctx) ? { flags: MessageFlags.Ephemeral } : {}) });
    } catch (error) {
      deps.logger?.warn?.(`[join] connexion vocale impossible guildId=${ctx.guildId}: ${error?.message || 'erreur inconnue'}`);
      return sendReply(ctx, T.joinFailed);
    }
  },
};
