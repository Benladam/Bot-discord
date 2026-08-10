/**
 * langStore.js — Stockage des préférences de langue du bot.
 *
 * Trois niveaux (priorité décroissante) :
 *   1. langue PERSONNELLE d'un utilisateur Discord (clé userId)
 *   2. langue FORCÉE du serveur (/language #all fr)  (clé guildId, forced)
 *   3. langue du TERMINAL / GUI de l'opérateur         (clé 'terminal')
 *
 * Stocké dans le dossier utilisateur (hors du dépôt protégé par Windows).
 * Structure du fichier :
 *   { users: { userId: 'fr' }, servers: { guildId: { lang:'fr', forced:true } }, terminal: 'fr' }
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILE = path.join(os.homedir(), '.bot-lang.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (_) {
    cache = { users: {}, servers: {}, terminal: null };
  }
  cache.users = cache.users || {};
  cache.servers = cache.servers || {};
  cache.terminal = cache.terminal || null;
  return cache;
}

function save() {
  try {
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8');
  } catch (_) { /* non bloquant */ }
}

/** Langue effective pour un utilisateur sur un serveur donné. */
function resolve(userId, guildId) {
  const d = load();
  if (guildId && d.servers[guildId] && d.servers[guildId].forced) {
    return d.servers[guildId].lang;
  }
  if (userId && d.users[userId]) return d.users[userId];
  if (d.terminal) return d.terminal;
  return 'fr';
}

/** Définit la langue personnelle d'un utilisateur. */
function setUser(userId, lang) {
  const d = load();
  d.users[userId] = lang;
  save();
}

/** Définit (ou retire) la langue forcée d'un serveur. */
function setServer(guildId, lang, forced = true) {
  const d = load();
  if (!forced) delete d.servers[guildId];
  else d.servers[guildId] = { lang, forced: true };
  save();
}

/** Langue du terminal / GUI de l'opérateur. */
function getTerminal() { return load().terminal; }
function setTerminal(lang) { const d = load(); d.terminal = lang; save(); }

module.exports = { resolve, setUser, setServer, getTerminal, setTerminal, load };
