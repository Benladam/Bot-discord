const { requireGuildContext } = require('../../shared/discord/commandHelpers');
function controlledPlayer(ctx, deps) {
  requireGuildContext(ctx);
  const player = deps.getPlayer(ctx.guildId);
  const channelId = ctx.member?.voice?.channelId || ctx.member?.voice?.channel?.id;
  if (!channelId || !player.connection?.channelId || String(channelId) !== String(player.connection.channelId)) {
    throw new Error('Rejoins le salon vocal du bot sur ce serveur pour utiliser ce contrôle.');
  }
  return player;
}
module.exports = { controlledPlayer };
