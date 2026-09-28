const { PermissionFlagsBits } = require('discord.js');
const { isSlash, sendReply, deferReply, requirePermission, resolveMember, getStringOption } = require('../utils/commandHelpers');
const { addWarning } = require('../utils/moderationStore');

module.exports = {
  data: {
    name: 'warn', description: 'Ajoute un avertissement à un membre', defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    options: [
      { name: 'membre', description: 'Membre à avertir', type: 6, required: true },
      { name: 'raison', description: 'Motif de l’avertissement', type: 3, required: true, maxLength: 500 },
    ],
  },
  slash: true,
  async execute(ctx, args, deps) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.ManageMessages, 'Gérer les messages');
    const member = await resolveMember(ctx, args, 'membre');
    const reason = (isSlash(ctx) ? getStringOption(ctx, 'raison') : args.slice(1).join(' ')).trim().slice(0, 500);
    if (!reason) throw new Error('Indique la raison de l’avertissement.');
    if (member.user.bot) throw new Error('Les avertissements sont réservés aux membres humains.');
    const warning = addWarning(ctx.guildId, member.id, ctx.user?.id || ctx.author?.id, reason);
    await member.user.send(`⚠️ Tu as reçu un avertissement sur **${ctx.guild.name}** : ${reason}`).catch(() => {});
    const total = deps.database.getGuildSetting(ctx.guildId, `warnings:${member.id}`, []).length;
    return sendReply(ctx, `⚠️ **${member.user.tag}** a reçu un avertissement (#${warning.id}). Total enregistré : **${total}**.`);
  },
};
