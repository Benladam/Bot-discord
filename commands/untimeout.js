const { PermissionFlagsBits: P } = require('discord.js');
const { requireGuildContext, requirePermission, deferReply, resolveMember, sendReply } = require('../shared/discord/commandHelpers');
module.exports = {
  data: { name: 'untimeout', description: 'Retire la sourdine temporaire d’un membre', defaultMemberPermissions: P.ModerateMembers, options: [
    { name: 'membre', description: 'Membre à rétablir', type: 6, required: true },
  ] }, slash: true, helpCategory: 'moderation',
  async execute(ctx, args) {
    requireGuildContext(ctx); requirePermission(ctx, P.ModerateMembers, 'Modérer les membres'); await deferReply(ctx);
    const member = await resolveMember(ctx, args);
    if (!member.moderatable) throw new Error('Permission ou hiérarchie insuffisante pour ce membre.');
    await member.timeout(null, `Sourdine retirée par ${ctx.user?.id || ctx.author?.id}`);
    return sendReply(ctx, '🔊 Sourdine temporaire retirée.');
  },
};
