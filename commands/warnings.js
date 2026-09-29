const { PermissionFlagsBits } = require('discord.js');
const { requirePermission, resolveMember, sendReply, deferReply } = require('../shared/discord/commandHelpers');
const { listWarnings } = require('../features/moderation/warningStore');

module.exports = {
  data: {
    name: 'warnings', description: 'Affiche les avertissements d’un membre', defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    options: [{ name: 'membre', description: 'Membre concerné', type: 6, required: true }],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.ManageMessages, 'Gérer les messages');
    const member = await resolveMember(ctx, args, 'membre');
    const warnings = listWarnings(ctx.guildId, member.id);
    if (!warnings.length) return sendReply(ctx, `✅ **${member.user.tag}** n’a aucun avertissement enregistré.`);
    const lines = warnings.slice(-10).reverse().map((item, index) => {
      const date = new Date(item.createdAt).toLocaleDateString('fr-FR');
      const reason = item.reason.length > 120 ? `${item.reason.slice(0, 117)}…` : item.reason;
      return `**${warnings.length - index}.** ${reason} — <@${item.moderatorId}>, ${date}`;
    });
    return sendReply(ctx, `Avertissements de **${member.user.tag}** (${warnings.length} enregistrés) :\n${lines.join('\n')}`);
  },
};
