const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createThemedEmbed } = require('../shared/discord/embedTheme');

const SETTING_KEY = 'music24_7';

function canManageGuild(ctx) {
  const permissions = ctx.memberPermissions || ctx.member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.ManageGuild));
}

function inactivityMinutes() {
  const configured = Number(process.env.VOICE_IDLE_TIMEOUT_MINUTES);
  return configured === 1 || configured === 2 ? configured : 2;
}

module.exports = {
  data: {
    name: '24-7',
    description: 'Garde le bot dans le vocal même quand il n’y a plus d’activité',
    defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
  },
  slash: true,
  helpCategory: 'music',

  async execute(ctx, _args, deps) {
    if (!ctx.guildId || !ctx.guild) {
      return ctx.reply({ content: 'Cette commande doit être utilisée dans un serveur.', flags: MessageFlags.Ephemeral });
    }
    if (!canManageGuild(ctx)) {
      return ctx.reply({ content: 'Tu dois avoir la permission « Gérer le serveur » pour modifier ce réglage.', flags: MessageFlags.Ephemeral });
    }

    const { database, getPlayer } = deps;
    if (typeof database?.getGuildSetting !== 'function' || typeof database?.setGuildSetting !== 'function') {
      return ctx.reply({ content: 'Le réglage 24/7 n’est pas disponible : la base de données du serveur est inaccessible.', flags: MessageFlags.Ephemeral });
    }

    try {
      const enabled = database.getGuildSetting(ctx.guildId, SETTING_KEY, false) !== true;
      database.setGuildSetting(ctx.guildId, SETTING_KEY, enabled);

      const player = getPlayer(ctx.guildId);
      if (enabled) {
        player?._clearIdleTimer?.();
        player?._clearAloneTimer?.();
      } else if (player?.connection?.connected) {
        player._scheduleIdleLeave?.();
        if (player.connection.channelId) player._scheduleAloneLeave?.(player.connection.channelId);
      }

      const minutes = inactivityMinutes();
      const embed = createThemedEmbed(enabled ? 'success' : 'warning')
        .setTitle(enabled ? '🌙 Mode 24/7 activé' : '⏱️ Déconnexion automatique activée')
        .setDescription(enabled
          ? 'Le bot restera dans le salon vocal même sans musique ou sans membre. Relance `/24-7` pour désactiver ce mode.'
          : `Le bot quittera le vocal après ${minutes} min sans activité ou sans membre. Relance la commande 24-7 pour le garder connecté.`)
        .setFooter({ text: `Réglage enregistré uniquement pour ${ctx.guild.name || 'ce serveur'}` });
      const payload = { embeds: [embed] };
      if (typeof ctx.isChatInputCommand === 'function') payload.flags = MessageFlags.Ephemeral;
      return ctx.reply(payload);
    } catch (error) {
      console.error(`[music] réglage 24/7 impossible pour le serveur ${ctx.guildId}:`, error);
      return ctx.reply({ content: 'Impossible d’enregistrer le réglage 24/7. Consulte les logs du bot.', flags: MessageFlags.Ephemeral });
    }
  },
};
