const { PermissionFlagsBits: P } = require('discord.js');
const { isSlash, getStringOption, requireGuildContext, requirePermission, deferReply, sendReply } = require('../shared/discord/commandHelpers');
module.exports = {
  data: { name: 'unban', description: 'Retire le bannissement d’un utilisateur de ce serveur', defaultMemberPermissions: P.BanMembers, options: [
    { name: 'id', description: 'Identifiant Discord de l’utilisateur', type: 3, required: true },
  ] }, slash: true, helpCategory: 'moderation',
  async execute(ctx, args) {
    requireGuildContext(ctx); requirePermission(ctx, P.BanMembers, 'Bannir des membres'); await deferReply(ctx);
    const id = isSlash(ctx) ? getStringOption(ctx, 'id') : args[0];
    if (!/^\d{15,22}$/.test(id || '')) throw new Error('Indique un identifiant Discord valide.');
    await ctx.guild.bans.remove(id, `Unban demandé par ${ctx.user?.id || ctx.author?.id}`);
    return sendReply(ctx, `🛡️ Bannissement retiré pour ${id}.`);
  },
};
