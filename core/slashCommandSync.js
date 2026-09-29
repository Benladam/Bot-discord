'use strict';

function normalizeOption(option = {}) {
  const result = {
    type: Number(option.type) || 1,
    name: String(option.name || ''),
    description: String(option.description || ''),
    required: option.required === true,
    autocomplete: option.autocomplete === true,
  };

  for (const key of ['choices', 'channel_types']) {
    if (Array.isArray(option[key])) {
      result[key] = key === 'choices'
        ? option[key].map(({ name, value }) => ({ name, value }))
        : [...option[key]];
    }
  }
  for (const key of ['min_value', 'max_value', 'min_length', 'max_length']) {
    if (option[key] !== undefined) result[key] = option[key];
  }
  if (Array.isArray(option.options)) result.options = option.options.map(normalizeOption);
  return result;
}

function normalizeCommand(command = {}) {
  return {
    type: Number(command.type) || 1,
    name: String(command.name || ''),
    description: String(command.description || ''),
    default_member_permissions: command.default_member_permissions == null
      ? null
      : String(command.default_member_permissions),
    options: Array.isArray(command.options) ? command.options.map(normalizeOption) : [],
  };
}

function sameCommandSet(current, desired) {
  if (!Array.isArray(current) || !Array.isArray(desired) || current.length !== desired.length) return false;
  const canonical = (commands) => commands
    .map(normalizeCommand)
    .sort((left, right) => left.type - right.type || left.name.localeCompare(right.name));
  return JSON.stringify(canonical(current)) === JSON.stringify(canonical(desired));
}

async function syncGlobalSlashCommands({ rest, route, body, logger = console }) {
  let current = null;
  try {
    current = await rest.get(route);
  } catch (error) {
    logger.warn?.(`Lecture des commandes slash globales impossible; synchronisation forcée : ${error.message}`);
  }

  // Discord peut temporairement refuser une interaction issue d'un cache de
  // commande global obsolète. Ne pas réécrire les mêmes commandes à chaque
  // redémarrage évite de relancer inutilement cette propagation.
  if (sameCommandSet(current, body)) {
    logger.info?.('Commandes slash globales déjà synchronisées; aucune mise à jour Discord nécessaire.');
    return { updated: false };
  }

  const registered = await rest.put(route, { body });
  if (Array.isArray(registered) && !sameCommandSet(registered, body)) {
    throw new Error('Discord a accepté la synchronisation, mais le schéma retourné diffère des commandes demandées.');
  }
  return { updated: true };
}

module.exports = { normalizeCommand, sameCommandSet, syncGlobalSlashCommands };
