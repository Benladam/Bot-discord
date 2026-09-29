const { PermissionFlagsBits } = require('discord.js');
const { isSlash, sendReply, deferReply, requirePermission, getIntegerOption } = require('../shared/discord/commandHelpers');

module.exports = {
  data: {
    name: 'clear', description: 'Supprime plusieurs messages récents', defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    options: [{ name: 'nombre', description: 'Nombre de messages à supprimer (1 à 100)', type: 4, required: true, minValue: 1, maxValue: 100 }],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    requirePermission(ctx, PermissionFlagsBits.ManageMessages, 'Gérer les messages');
    const amount = isSlash(ctx) ? getIntegerOption(ctx, 'nombre') : Number(args[0]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100) throw new Error('Indique un nombre de messages compris entre 1 et 100.');
    if (!ctx.channel?.bulkDelete) throw new Error('Cette commande nécessite un salon textuel qui autorise la suppression groupée.');
    const deleted = await ctx.channel.bulkDelete(amount, true);
    const summary = `🧹 ${deleted.size} message(s) supprimé(s). Discord ne supprime pas les messages de plus de 14 jours.`;
    return isSlash(ctx) ? sendReply(ctx, summary) : ctx.channel.send(summary);
  },
};
