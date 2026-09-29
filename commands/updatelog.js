const { PermissionFlagsBits } = require('discord.js');

function isAdministrator(ctx) {
  const permissions = ctx.memberPermissions || ctx.member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator));
}

function reply(ctx, content) {
  return ctx.reply({ content, ephemeral: true });
}

module.exports = {
  data: {
    name: 'updatelog',
    description: 'Choisit ce salon pour les annonces de mise à jour',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  },
  slash: true,
  helpCategory: 'setup',

  async execute(ctx, _args, deps) {
    if (!ctx.guildId || !ctx.guild) return reply(ctx, 'Cette commande doit être utilisée dans un serveur.');
    if (!isAdministrator(ctx)) return reply(ctx, 'Seuls les administrateurs peuvent configurer le salon de mise à jour.');
    if (typeof ctx.channel?.send !== 'function') return reply(ctx, 'Utilise cette commande dans un salon texte où le bot peut écrire.');
    if (String(process.env.MINECRAFT_CHANNEL_ID || '').trim() === String(ctx.channelId || ctx.channel.id)) {
      return reply(ctx, 'Le salon Minecraft est réservé aux changelogs Minecraft. Choisis un autre salon pour les nouvelles du bot Discord.');
    }

    const botMember = ctx.guild.members.me;
    const permissions = botMember && ctx.channel.permissionsFor?.(botMember);
    if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
      return reply(ctx, 'Je ne peux pas écrire dans ce salon. Autorise-moi à envoyer des messages puis réessaie.');
    }

    deps.database.setGuildSetting(ctx.guildId, 'updateLogChannelId', ctx.channelId || ctx.channel.id);
    await reply(ctx, `Ce salon est maintenant le journal des mises à jour du bot pour **${ctx.guild.name}**.`);

    const status = deps.updater.getLastStatus();
    if (status?.hasUpdate) {
      const announced = await deps.updater.announceGuild(ctx.guild, status).catch(() => false);
      if (announced) deps.updater.scheduleAutomaticInstall(status);
    }
  },
};
