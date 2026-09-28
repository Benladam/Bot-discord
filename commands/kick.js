const { PermissionFlagsBits } = require('discord.js');
const { isSlash, sendReply, deferReply, requirePermission, resolveMember, getStringOption } = require('../utils/commandHelpers');

module.exports = {
  data: {
    name: 'kick', description: 'Expulse un membre du serveur', defaultMemberPermissions: PermissionFlagsBits.KickMembers,
    options: [
      { name: 'membre', description: 'Membre à expulser', type: 6, required: true },
      { name: 'raison', description: 'Motif affiché dans le journal de modération', type: 3, required: false, maxLength: 500 },
    ],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.KickMembers, 'Expulser des membres');
    const member = await resolveMember(ctx, args, 'membre');
    if (member.id === ctx.client.user.id) throw new Error('Je ne peux pas m’expulser moi-même.');
    if (member.id === (ctx.user?.id || ctx.author?.id)) throw new Error('Tu ne peux pas t’expulser toi-même.');
    if (!member.kickable) throw new Error('Je ne peux pas expulser ce membre. Vérifie ma permission et la hiérarchie des rôles.');
    const reason = String(isSlash(ctx) ? (getStringOption(ctx, 'raison') || '') : args.slice(1).join(' ')).slice(0, 500);
    await member.kick(reason || 'Aucune raison indiquée');
    return sendReply(ctx, `👢 **${member.user.tag}** a été expulsé.${reason ? ` Motif : ${reason}` : ''}`);
  },
};
