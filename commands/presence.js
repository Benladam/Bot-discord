const { isSlash, sendReply, getStringOption, getIntegerOption } = require('../utils/commandHelpers');
const { MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS, MAX_MESSAGES } = require('../utils/presenceManager');

const STATUSES = new Set(['online', 'dnd', 'idle', 'invisible']);
const ACTIVITY_TYPES = new Set(['playing', 'listening', 'watching', 'competing']);
const STATUS_LABELS = { online: 'En ligne', dnd: 'Ne pas déranger', idle: 'Inactif', invisible: 'Invisible' };
const TYPE_LABELS = { playing: 'Joue à', listening: 'Écoute', watching: 'Regarde', competing: 'Participe à' };

function describe(config) {
  const allTexts = config.messages.length ? config.messages.map((line) => `• ${line}`).join('\n') : 'Aucun texte (activité masquée)';
  const texts = allTexts.length > 1200 ? `${allTexts.slice(0, 1180)}\n… liste abrégée` : allTexts;
  return `Présence : **${STATUS_LABELS[config.status]}**\n` +
    `Type d’activité : **${TYPE_LABELS[config.activityType]}**\n` +
    `Changement toutes les **${config.intervalSeconds} secondes**\n` +
    `Textes enregistrés (${config.messages.length}/${MAX_MESSAGES}) :\n${texts}\n\n` +
    `L’intervalle accepté va de ${MIN_INTERVAL_SECONDS} à ${MAX_INTERVAL_SECONDS} secondes. Les réglages sont globaux et restent après redémarrage.`;
}

module.exports = {
  data: {
    name: 'presence', description: 'Configure le statut et les textes visibles du bot (propriétaire)',
    options: [
      { name: 'statut', description: 'État en ligne du bot', type: 3, required: false, choices: [
        { name: 'En ligne', value: 'online' }, { name: 'Ne pas déranger', value: 'dnd' },
        { name: 'Inactif', value: 'idle' }, { name: 'Invisible', value: 'invisible' },
      ] },
      { name: 'intervalle', description: `Secondes entre les textes (${MIN_INTERVAL_SECONDS} à ${MAX_INTERVAL_SECONDS})`, type: 4, required: false, minValue: MIN_INTERVAL_SECONDS, maxValue: MAX_INTERVAL_SECONDS },
      { name: 'type', description: 'Type d’activité affichée', type: 3, required: false, choices: [
        { name: 'Joue à', value: 'playing' }, { name: 'Écoute', value: 'listening' },
        { name: 'Regarde', value: 'watching' }, { name: 'Participe à', value: 'competing' },
      ] },
      { name: 'textes', description: 'Textes séparés par | (maximum 20, 128 caractères chacun)', type: 3, required: false, maxLength: 2000 },
    ],
  },
  slash: true,
  ownerOnly: true,
  async execute(ctx, args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    if (!deps.isOwner?.(userId)) return sendReply(ctx, 'Cette commande est réservée au propriétaire du bot.');

    const patch = {};
    if (isSlash(ctx)) {
      const status = getStringOption(ctx, 'statut');
      const interval = getIntegerOption(ctx, 'intervalle');
      const type = getStringOption(ctx, 'type');
      const text = getStringOption(ctx, 'textes');
      if (status !== null) patch.status = status;
      if (interval !== null) patch.intervalSeconds = interval;
      if (type !== null) patch.activityType = type;
      if (text !== null) patch.messages = text.trim().toLowerCase() === 'off' ? [] : text;
    } else {
      let index = 0;
      const status = String(args[index] || '').toLowerCase();
      if (STATUSES.has(status)) { patch.status = status; index += 1; }
      if (/^\d+$/.test(String(args[index] || ''))) { patch.intervalSeconds = Number(args[index]); index += 1; }
      const type = String(args[index] || '').toLowerCase();
      if (ACTIVITY_TYPES.has(type)) { patch.activityType = type; index += 1; }
      if (args.length > index) {
        const text = args.slice(index).join(' ');
        patch.messages = text.toLowerCase() === 'off' ? [] : text;
      }
    }

    const config = Object.keys(patch).length ? deps.presence.update(patch) : deps.presence.getConfig();
    return sendReply(ctx, describe(config));
  },
};
