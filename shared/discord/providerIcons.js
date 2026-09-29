const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const { PROVIDERS } = require('./providerPresentation');

const ICON_DIRECTORY = path.resolve(__dirname, '../../assets/discord/providers');
const ICON_NAMES = new Set(Object.keys(PROVIDERS).map(key => `provider-${key}.png`));

/** Joint seulement les PNG nécessaires au message, sans requête externe. */
function withProviderIcons(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.embeds)) return payload;
  const names = new Set();
  for (const embed of payload.embeds) {
    const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
    for (const url of [data?.author?.icon_url, data?.footer?.icon_url]) {
      const name = String(url || '').replace(/^attachment:\/\//, '');
      if (ICON_NAMES.has(name)) names.add(name);
    }
  }
  if (!names.size) return payload;
  const files = [...(payload.files || [])];
  for (const name of names) {
    if (!files.some(file => file.name === name)) {
      files.push(new AttachmentBuilder(path.join(ICON_DIRECTORY, name), { name }));
    }
  }
  // Remplacer les anciennes pièces jointes lors d'une modification : les
  // changements de titre/plateforme ne doivent pas accumuler les logos.
  return { ...payload, attachments: [], files };
}

module.exports = { ICON_DIRECTORY, withProviderIcons };
