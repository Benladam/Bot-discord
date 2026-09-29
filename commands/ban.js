const { PermissionFlagsBits } = require('discord.js');
const { isSlash, sendReply, deferReply, requirePermission, resolveMember, getStringOption, getIntegerOption } = require('../shared/discord/commandHelpers');

module.exports = {
  data: {
    name: 'ban', description: 'Bannit un membre du serveur', defaultMemberPermissions: PermissionFlagsBits.BanMembers,
    options: [
      { name: 'membre', description: 'Membre à bannir', type: 6, required: true },
      { name: 'raison', description: 'Motif affiché dans le journal de modération', type: 3, required: false, maxLength: 500 },
      { name: 'jours', description: 'Jours de messages à supprimer (0 à 7)', type: 4, required: false, minValue: 0, maxValue: 7 },
    ],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.BanMembers, 'Bannir des membres');
    const member = await resolveMember(ctx, args, 'membre');
    if (member.id === ctx.client.user.id) throw new Error('Je ne peux pas me bannir moi-même.');
    if (member.id === (ctx.user?.id || ctx.author?.id)) throw new Error('Tu ne peux pas te bannir toi-même.');
    if (!member.bannable) throw new Error('Je ne peux pas bannir ce membre. Vérifie ma permission et la hiérarchie des rôles.');

    const trailingDays = !isSlash(ctx) && /^\d+$/.test(String(args.at(-1) || '')) ? Number(args.at(-1)) : null;
    const reason = String(isSlash(ctx) ? (getStringOption(ctx, 'raison') || '') : args.slice(1, trailingDays === null ? undefined : -1).join(' ')).slice(0, 500);
    const days = isSlash(ctx) ? (getIntegerOption(ctx, 'jours') ?? 0) : (trailingDays ?? 0);
    if (!Number.isInteger(days) || days < 0 || days > 7) throw new Error('Indique un nombre de jours compris entre 0 et 7.');
    await member.ban({ deleteMessageSeconds: days * 86_400, reason: reason || 'Aucune raison indiquée' });
    return sendReply(ctx, `🔨 **${member.user.tag}** a été banni.${reason ? ` Motif : ${reason}` : ''}`);
  },
};
