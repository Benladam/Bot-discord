const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { createThemedEmbed } = require('../shared/discord/embedTheme');

function isAdministrator(ctx) {
  const permissions = ctx.memberPermissions || ctx.member?.permissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.Administrator));
}

async function reply(ctx, response) {
  const payload = typeof response === 'string' ? { content: response } : response;
  if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
  return ctx.reply({ ...payload, flags: payload.flags ?? MessageFlags.Ephemeral });
}

function updateEmbed(status, { title, color, commit, includeHistory = false }) {
  const selected = commit || status.remoteCommit || status.localCommit || {};
  const sha = String(selected.sha || status.remoteSha || status.localSha || 'inconnu');
  const shortSha = sha.slice(0, 7);
  const repo = String(status.repo || '');
  const commitUrl = /^[\w.-]+\/[\w.-]+$/.test(repo) && /^[a-f\d]{7,40}$/i.test(sha)
    ? `https://github.com/${repo}/commit/${sha}`
    : null;
  const branch = String(status.branch || 'inconnue').replace(/[`<>]/g, '').slice(0, 80);
  const subject = String(selected.subject || 'Message de commit indisponible')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/@/g, '@\u200b')
    .slice(0, 220);
  const variant = color === 0xF1C40F || color === 0xE67E22 ? 'warning' : color === 0x2ECC71 ? 'success' : 'primary';
  const embed = createThemedEmbed(variant)
    .setTitle(title)
    .setDescription(`${subject}\n\n${commitUrl ? `[Commit \`${shortSha}\`](${commitUrl})` : `Commit \`${shortSha}\``}`)
    .addFields({ name: 'Branche', value: `\`${branch}\``, inline: true });

  if (selected.author) {
    const author = String(selected.author).replace(/[\r\n]+/g, ' ').slice(0, 100);
    embed.addFields({ name: 'Auteur', value: author || 'Inconnu', inline: true });
  }
  if (includeHistory) {
    const changes = (status.commits || []).slice(0, 5).map((item) => {
      const itemSha = String(item.sha || '').slice(0, 7);
      const itemUrl = /^[\w.-]+\/[\w.-]+$/.test(repo) && /^[a-f\d]{7,40}$/i.test(String(item.sha || ''))
        ? `https://github.com/${repo}/commit/${item.sha}`
        : null;
      const itemSubject = String(item.subject || '(sans titre)').slice(0, 160);
      const linkedSha = itemUrl ? `[${itemSha}](${itemUrl})` : itemSha;
      return `• ${linkedSha} — ${itemSubject}`;
    });
    const remaining = Math.max(0, Number(status.aheadCount || 0) - changes.length);
    if (remaining) changes.push(`• … et ${remaining} autre(s) commit(s)`);
    embed.addFields(
      { name: 'Commits installés', value: String(status.aheadCount || 1), inline: true },
      { name: 'Historique récent', value: changes.join('\n').slice(0, 1024) || 'Aucun détail supplémentaire.', inline: false },
    );
  }

  const committedAt = new Date(selected.committedAt || '');
  if (!Number.isNaN(committedAt.getTime())) embed.setTimestamp(committedAt);
  return embed;
}

module.exports = {
  data: {
    name: 'update',
    description: 'Installe la dernière version GitHub puis redémarre le bot',
    defaultMemberPermissions: PermissionFlagsBits.Administrator,
  },
  slash: true,
  helpCategory: 'setup',

  async execute(ctx, _args, deps) {
    if (!ctx.guildId || !ctx.guild) return reply(ctx, 'Cette commande doit être utilisée dans un serveur.');
    if (!isAdministrator(ctx)) return reply(ctx, 'Seuls les administrateurs peuvent mettre à jour le bot.');

    if (typeof ctx.deferReply === 'function') await ctx.deferReply({ flags: MessageFlags.Ephemeral });
    else await ctx.reply('Vérification de GitHub et installation de la mise à jour…');

    try {
      const result = await deps.updater.applyUpdate();
      if (!result.updated) {
        if (result.codeUpdated) {
          return reply(ctx, {
            content: 'Le code a été appliqué, mais l’installation des dépendances a échoué. Consulte les logs, corrige npm puis redémarre le bot manuellement.',
            embeds: [updateEmbed(result.status, {
              title: 'Code mis à jour, dépendances en échec',
              color: 0xE67E22,
              commit: result.installedCommit || { sha: result.newSha },
              includeHistory: true,
            })],
          });
        }
        if (!result.status.hasUpdate) {
          const localAhead = Boolean(result.status.localAhead);
          const statusText = localAhead
            ? 'La branche locale est en avance sur GitHub ; aucun commit distant à installer.'
            : 'Le bot est déjà à jour.';
          return reply(ctx, {
            content: statusText,
            embeds: [updateEmbed(result.status, {
              title: localAhead ? 'Version locale en avance' : 'Bot déjà à jour',
              color: localAhead ? 0xF1C40F : 0x2ECC71,
              commit: localAhead ? result.status.localCommit : (result.status.remoteCommit || result.status.localCommit),
            })],
          });
        }
        if (result.reason === 'diverged') return reply(ctx, 'La branche locale a divergé de GitHub. Aucune modification n’a été appliquée; une mise à jour manuelle est nécessaire.');
        if (result.reason === 'local-changes') return reply(ctx, 'Des changements locaux sont présents. Je n’ai rien écrasé; sauvegarde-les ou applique la mise à jour manuellement.');
        return reply(ctx, 'Aucune mise à jour n’a été appliquée.');
      }

      const countdownMessage = '⏳ Nouvelle version du bot installée. Redémarrage dans 10 secondes.';
      const announcement = {
        content: countdownMessage,
        embeds: [updateEmbed(result.status, {
          title: 'Mise à jour du bot installée',
          color: 0x2ECC71,
          commit: result.installedCommit || result.status.remoteCommit,
          includeHistory: true,
        })],
      };
      await reply(ctx, announcement);
      await deps.updater.announceGuild(ctx.guild, result.status, announcement).catch(() => false);
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
