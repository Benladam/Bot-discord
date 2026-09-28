const { PermissionFlagsBits } = require('discord.js');
const { isSlash, sendReply, deferReply, requirePermission, resolveMember, getStringOption } = require('../utils/commandHelpers');

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
function parseDuration(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*(s|m|h|d|w)$/i);
  if (!match) throw new Error('Durée invalide. Utilise un nombre suivi de s, m, h, d ou w, par exemple `30m` ou `2h`.');
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[match[2].toLowerCase()];
  const duration = Number(match[1]) * unit;
  if (duration < 1_000 || duration > MAX_TIMEOUT_MS) throw new Error('La durée doit être comprise entre 1 seconde et 28 jours.');
  return duration;
}

module.exports = {
  data: {
    name: 'timeout', description: 'Met temporairement un membre en sourdine', defaultMemberPermissions: PermissionFlagsBits.ModerateMembers,
    options: [
      { name: 'membre', description: 'Membre à mettre en sourdine', type: 6, required: true },
      { name: 'duree', description: 'Exemple : 30m, 2h, 1d (maximum 28 jours)', type: 3, required: true },
      { name: 'raison', description: 'Motif affiché dans le journal de modération', type: 3, required: false, maxLength: 500 },
    ],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.ModerateMembers, 'Modérer les membres');
    const member = await resolveMember(ctx, args, 'membre');
    if (member.id === ctx.client.user.id) throw new Error('Je ne peux pas me mettre en sourdine.');
    if (member.id === (ctx.user?.id || ctx.author?.id)) throw new Error('Tu ne peux pas te mettre en sourdine.');
    if (!member.moderatable) throw new Error('Je ne peux pas modérer ce membre. Vérifie ma permission et la hiérarchie des rôles.');
    const durationText = isSlash(ctx) ? getStringOption(ctx, 'duree') : args[1];
    const reason = String(isSlash(ctx) ? (getStringOption(ctx, 'raison') || '') : args.slice(2).join(' ')).slice(0, 500);
    const duration = parseDuration(durationText);
    await member.timeout(duration, reason || 'Aucune raison indiquée');
    return sendReply(ctx, `🔇 **${member.user.tag}** est en sourdine pour **${durationText}**.${reason ? ` Motif : ${reason}` : ''}`);
  },
};
