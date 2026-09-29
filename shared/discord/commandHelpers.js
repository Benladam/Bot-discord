const { MessageFlags } = require('discord.js');

function isSlash(ctx) {
  return typeof ctx?.isChatInputCommand === 'function' && ctx.isChatInputCommand();
}

function sendReply(ctx, content, { ephemeral = true, embeds } = {}) {
  const payload = { content, embeds };
  if (isSlash(ctx)) {
    if (ctx.deferred || ctx.replied) return ctx.editReply(payload);
    return ctx.reply(ephemeral ? { ...payload, flags: MessageFlags.Ephemeral } : payload);
  }
  return ctx.reply(payload);
}

async function deferReply(ctx, { ephemeral = true } = {}) {
  if (isSlash(ctx) && !ctx.deferred && !ctx.replied) {
    await ctx.deferReply(ephemeral ? { flags: MessageFlags.Ephemeral } : {});
  }
}

function requireGuildContext(ctx) {
  if (!ctx?.guildId || !ctx?.guild) throw new Error('Cette commande doit être utilisée dans un serveur Discord.');
  return ctx.guild;
}

function hasPermission(ctx, permission) {
  const permissions = ctx.memberPermissions || ctx.member?.permissions;
  return Boolean(permissions?.has?.(permission));
}

function requirePermission(ctx, permission, name) {
  if (!hasPermission(ctx, permission)) throw new Error(`Il te faut la permission **${name}** pour utiliser cette commande.`);
}

function getOptionUser(ctx, optionName) {
  if (!ctx.options?.getUser) return null;
  try { return ctx.options.getUser(optionName); } catch (_) { return null; }
}

async function resolveMember(ctx, args, optionName = 'membre', { optional = false } = {}) {
  if (!ctx.guild) throw new Error('Cette commande doit être utilisée dans un serveur.');
  if (isSlash(ctx)) {
    let selectedMember = null;
    try { selectedMember = ctx.options.getMember(optionName); } catch (_) {}
    const selectedId = selectedMember?.user?.id || selectedMember?.id;
    if (selectedId) return ctx.guild.members.cache.get(selectedId) || ctx.guild.members.fetch(selectedId);
    const user = getOptionUser(ctx, optionName);
    if (user) return ctx.guild.members.fetch(user.id);
    if (optional) return null;
    throw new Error('Choisis un membre du serveur.');
  }

  const mentioned = ctx.mentions?.members?.first?.();
  if (mentioned) return mentioned;
  const token = String(args?.[0] || '').trim();
  const id = token.match(/^<@!?(\d{15,22})>$/)?.[1] || (/^\d{15,22}$/.test(token) ? token : null);
  if (!id) {
    if (optional) return null;
    throw new Error('Mentionne un membre ou indique son identifiant Discord en premier argument.');
  }
  return ctx.guild.members.cache.get(id) || ctx.guild.members.fetch(id).catch(() => {
    throw new Error('Ce membre est introuvable sur le serveur.');
  });
}

async function resolveUser(ctx, args, optionName = 'utilisateur') {
  if (isSlash(ctx)) return getOptionUser(ctx, optionName) || ctx.user;
  const mentioned = ctx.mentions?.users?.first?.();
  if (mentioned) return mentioned;
  const token = String(args?.[0] || '').trim();
  const id = token.match(/^<@!?(\d{15,22})>$/)?.[1] || (/^\d{15,22}$/.test(token) ? token : null);
  if (id) return ctx.client.users.fetch(id).catch(() => null);
  return ctx.author;
}

function getStringOption(ctx, name) {
  try { return ctx.options?.getString?.(name) ?? null; } catch (_) { return null; }
}

function getIntegerOption(ctx, name) {
  try { return ctx.options?.getInteger?.(name) ?? null; } catch (_) { return null; }
}

module.exports = { isSlash, sendReply, deferReply, requireGuildContext, hasPermission, requirePermission, resolveMember, resolveUser, getStringOption, getIntegerOption };
