/**
 * Helpers pour répondre de façon unifiée aux commandes
 * fonctionnant à la fois en mode "message" (!play) et "slash" (/play).
 */

function isInteraction(ctx) {
  return typeof ctx.isChatInputCommand === 'function';
}

// Envoie la première réponse. Pour un slash, on diffère (defer) puis on éditera.
async function startResponse(ctx, content) {
  if (isInteraction(ctx)) {
    if (!ctx.deferred && !ctx.replied) await ctx.deferReply();
    return ctx; // on utilisera ctx.editReply ensuite
  }
  return await ctx.reply(content);
}

// Met à jour la réponse initiale (editReply pour slash, edit pour message).
async function update(ctx, handle, content) {
  if (isInteraction(ctx)) return ctx.editReply(content);
  if (handle && typeof handle.edit === 'function') return handle.edit(content);
  return null;
}

// Répond avec une erreur, quel que soit le contexte.
async function replyError(ctx, message) {
  const content = {
    embeds: [{
      title: '❌ Erreur',
      description: String(message),
      color: 0xff0000,
    }],
  };
  if (isInteraction(ctx)) {
    if (ctx.deferred || ctx.replied) return ctx.editReply(content);
    return ctx.reply(content);
  }
  return ctx.reply(content);
}

// Réponse texte simple (fonctionne pour les deux contextes).
function reply(ctx, text) {
  return ctx.reply(text);
}

module.exports = { isInteraction, startResponse, update, replyError, reply };
