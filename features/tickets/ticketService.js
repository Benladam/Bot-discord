const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const locks = new Map();
const marker = (guildId, userId) => `bot-ticket:v1:${guildId}:${userId}`;
async function openTicket(guild, userId, settings) {
  if (!settings?.supportRoleId) throw new Error('Configure d’abord ticket setup avec un rôle de support.');
  const key = `${guild.id}:${userId}`;
  if (locks.has(key)) return locks.get(key);
  const work = (async () => {
    const role = await guild.roles.fetch(settings.supportRoleId);
    if (!role || role.id === guild.id) throw new Error('Le rôle de support est introuvable ou public.');
    if (!guild.members.me?.permissions.has(P.ManageChannels) || !guild.members.me?.permissions.has(P.ManageRoles)) throw new Error('Le bot doit avoir Gérer les salons et Gérer les rôles pour gérer les permissions privées.');
    const channels = await guild.channels.fetch();
    const existing = channels.find(channel => channel?.topic === marker(guild.id, userId) && !channel.name.startsWith('closed-'));
    if (existing) return existing;
    if (channels.filter(channel => channel?.topic?.startsWith(`bot-ticket:v1:${guild.id}:`) && !channel.name.startsWith('closed-')).size >= 100) throw new Error('Trop de tickets ouverts sur ce serveur.');
    if (settings.categoryId && channels.get(settings.categoryId)?.type !== ChannelType.GuildCategory) throw new Error('Catégorie de tickets introuvable.');
    return guild.channels.create({ name: `ticket-${userId}`, type: ChannelType.GuildText,
      parent: settings.categoryId || undefined, topic: marker(guild.id, userId), reason: 'Ticket demandé par le membre',
      permissionOverwrites: [
        { id: guild.id, deny: [P.ViewChannel] },
        { id: userId, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
        { id: role.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] },
        { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageChannels] },
      ] });
  })();
  locks.set(key, work);
  try { return await work; } finally { locks.delete(key); }
}
async function closeTicket(ctx, settings) {
  const channel = ctx.channel;
  const match = String(channel?.topic || '').match(/^bot-ticket:v1:(\d+):(\d+)$/);
  const userId = ctx.user?.id || ctx.author?.id;
  if (!match || match[1] !== ctx.guildId) throw new Error('Cette commande doit être utilisée dans un ticket créé par ce bot.');
  if (channel.name.startsWith('closed-')) throw new Error('Ce ticket est déjà fermé.');
  const support = ctx.member?.roles?.cache?.has(settings?.supportRoleId);
  if (userId !== match[2] && !support && !ctx.memberPermissions?.has(P.ManageChannels) && !ctx.member?.permissions?.has(P.ManageChannels)) throw new Error('Seul le demandeur ou le support peut fermer ce ticket.');
  await channel.permissionOverwrites.edit(match[2], { SendMessages: false }, { reason: 'Ticket fermé, historique conservé' });
  await channel.setName(`closed-${channel.name}`.slice(0, 100), 'Ticket fermé, historique conservé');
  return channel;
}
module.exports = { marker, openTicket, closeTicket };
