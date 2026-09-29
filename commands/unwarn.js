const { PermissionFlagsBits } = require('discord.js');
const { isSlash, sendReply, deferReply, requirePermission, resolveMember, getIntegerOption } = require('../shared/discord/commandHelpers');
const { removeWarning } = require('../features/moderation/warningStore');

module.exports = {
  data: {
    name: 'unwarn', description: 'Retire un avertissement enregistré', defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    options: [
      { name: 'membre', description: 'Membre concerné', type: 6, required: true },
      { name: 'numero', description: 'Numéro affiché par /warnings', type: 4, required: true, minValue: 1 },
    ],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.ManageMessages, 'Gérer les messages');
    const member = await resolveMember(ctx, args, 'membre');
    const number = isSlash(ctx) ? getIntegerOption(ctx, 'numero') : Number(args[1]);
    const removed = removeWarning(ctx.guildId, member.id, number);
    return sendReply(ctx, `✅ Avertissement **${number}** retiré pour **${member.user.tag}** : ${removed.reason}`);
  },
};
