const store = require('./database');
const MAX_WARNINGS_PER_USER = 50;

function listWarnings(guildId, userId) {
  const value = store.getGuildSetting(guildId, `warnings:${userId}`, []);
  return Array.isArray(value) ? value : [];
}

function addWarning(guildId, userId, moderatorId, reason) {
  const warnings = listWarnings(guildId, userId);
  warnings.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    moderatorId: String(moderatorId),
    reason: String(reason).trim().slice(0, 500),
    createdAt: new Date().toISOString(),
  });
  if (warnings.length > MAX_WARNINGS_PER_USER) warnings.splice(0, warnings.length - MAX_WARNINGS_PER_USER);
  store.setGuildSetting(guildId, `warnings:${userId}`, warnings);
  return warnings[warnings.length - 1];
}

function removeWarning(guildId, userId, number) {
  const warnings = listWarnings(guildId, userId);
  if (!Number.isInteger(number) || number < 1 || number > warnings.length) {
    throw new Error(`Numéro invalide. Ce membre a ${warnings.length} avertissement(s) enregistré(s).`);
  }
  const [removed] = warnings.splice(number - 1, 1);
  store.setGuildSetting(guildId, `warnings:${userId}`, warnings);
  return removed;
}

module.exports = { listWarnings, addWarning, removeWarning };
