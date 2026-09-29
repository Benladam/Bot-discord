const { MessageFlags, PermissionFlagsBits } = require('discord.js');

function isAdministrator(ctx) {
  const permissions = ctx.memberPermissions || ctx.member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator));
}

async function reply(ctx, content) {
  if (ctx.deferred || ctx.replied) return ctx.editReply({ content });
  return ctx.reply({ content, flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: {
    name: 'update',
    description: 'Installe la dernière version GitHub puis redémarre le bot',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  },
  slash: true,

  async execute(ctx, _args, deps) {
    if (!ctx.guildId || !ctx.guild) return reply(ctx, 'Cette commande doit être utilisée dans un serveur.');
    if (!isAdministrator(ctx)) return reply(ctx, 'Seuls les administrateurs peuvent mettre à jour le bot.');

    if (typeof ctx.deferReply === 'function') await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    else await ctx.reply('Vérification de GitHub et installation de la mise à jour…');

    try {
      const result = await deps.updater.applyUpdate();
      if (!result.updated) {
        if (result.codeUpdated) {
          return reply(ctx, `Le code a été mis à jour vers \`${result.newSha.slice(0, 7)}\`, mais l’installation des dépendances a échoué. Consulte les logs du bot, corrige npm puis redémarre-le manuellement.`);
        }
        if (!result.status.hasUpdate && result.status.localAhead) return reply(ctx, `La branche locale est en avance sur GitHub (${result.status.localSha.slice(0, 7)}); aucun commit distant à installer.`);
        if (!result.status.hasUpdate) return reply(ctx, `Le bot est déjà à jour (${result.status.localSha.slice(0, 7)}).`);
        if (result.reason === 'diverged') return reply(ctx, 'La branche locale a divergé de GitHub. Aucune modification n’a été appliquée; une mise à jour manuelle est nécessaire.');
        if (result.reason === 'local-changes') return reply(ctx, 'Des changements locaux sont présents. Je n’ai rien écrasé; sauvegarde-les ou applique la mise à jour manuellement.');
        return reply(ctx, 'Aucune mise à jour n’a été appliquée.');
      }

      const countdownMessage = `⏳ Mise à jour du bot Discord installée (${result.newSha.slice(0, 7)}). `
        + 'Motif : nouvelle version du bot. Redémarrage du bot dans 10 secondes; Minecraft reste en ligne.';
      await reply(ctx, countdownMessage);
      await deps.updater.announceGuild(ctx.guild, result.status, countdownMessage).catch(() => false);
      setTimeout(() => {
        deps.updater.restartProcess().catch((error) => {
          console.error(`[updater] Redémarrage impossible: ${error.message}`);
        });
      }, 10_000).unref?.();
    } catch (error) {
      console.error(`[updater] Mise à jour impossible: ${error.message}`);
      return reply(ctx, 'La mise à jour a échoué. Consulte les logs du bot; le processus n’a pas été redémarré.');
    }
  },
};
