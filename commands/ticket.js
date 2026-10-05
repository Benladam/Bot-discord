const { PermissionFlagsBits: P, ChannelType } = require('discord.js');
const { isSlash, requireGuildContext, requirePermission, deferReply, sendReply, getStringOption } = require('../shared/discord/commandHelpers');
const { openTicket, closeTicket } = require('../features/tickets/ticketService');
const { createThemedEmbed } = require('../shared/discord/embedTheme');
module.exports = {
  data: { name: 'ticket', description: 'Ouvre, ferme ou configure les tickets privés du serveur', options: [
    { name: 'action', description: 'Action du ticket', type: 3, required: true, choices: [
      { name: 'Ouvrir', value: 'open' }, { name: 'Fermer (archiver)', value: 'close' }, { name: 'Configurer', value: 'setup' }] },
    { name: 'support', description: 'Rôle du support (setup seulement)', type: 8, required: false },
    { name: 'categorie', description: 'Catégorie privée (setup seulement)', type: 7, required: false, channelTypes: [ChannelType.GuildCategory] },
  ] }, slash: true, helpCategory: 'server',
  async execute(ctx, args, deps) {
    requireGuildContext(ctx); await deferReply(ctx);
    const action = isSlash(ctx) ? getStringOption(ctx, 'action') : args[0];
    const db = deps.database || require('../core/database');
    const settings = db.getGuildSetting(ctx.guildId, 'tickets', null);
    if (action === 'setup') {
      requirePermission(ctx, P.ManageGuild, 'Gérer le serveur');
      const roleId = isSlash(ctx) ? ctx.options.getRole('support')?.id : String(args[1] || '').replace(/[<@&>]/g, '');
      const categoryId = isSlash(ctx) ? ctx.options.getChannel('categorie')?.id : String(args[2] || '').replace(/[<#>]/g, '') || null;
      const role = /^\d{15,22}$/.test(roleId || '') ? await ctx.guild.roles.fetch(roleId) : null;
      if (!role || role.id === ctx.guildId) throw new Error('Choisis un rôle de support, autre que everyone.');
      if (categoryId && (await ctx.guild.channels.fetch(categoryId))?.type !== ChannelType.GuildCategory) throw new Error('Choisis une catégorie valide.');
      db.setGuildSetting(ctx.guildId, 'tickets', { supportRoleId: role.id, categoryId });
      return sendReply(ctx, '🎫 Tickets configurés pour ce serveur.');
    }
    if (action === 'open') {
      const channel = await openTicket(ctx.guild, ctx.user?.id || ctx.author?.id, settings);
      return sendReply(ctx, `🎫 Ton ticket privé : <#${channel.id}>.`);
    }
    if (action === 'close') {
      await closeTicket(ctx, settings);
      await ctx.channel.send({ embeds: [createThemedEmbed('neutral').setTitle('🎫 Ticket fermé').setDescription('L’historique est conservé. Le demandeur peut le consulter, mais ne peut plus écrire.')], allowedMentions: { parse: [] } });
      return sendReply(ctx, 'Ticket fermé · historique conservé.');
    }
    throw new Error('Actions disponibles : open, close, setup.');
  },
};
