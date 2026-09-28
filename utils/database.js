/** Stockage SQLite local, partagé par le processus et isolé par serveur Discord. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let database;

function databasePath() {
  if (process.env.BOT_DB_PATH) {
    const customPath = path.resolve(process.env.BOT_DB_PATH);
    fs.mkdirSync(path.dirname(customPath), { recursive: true });
    return customPath;
  }
  const dataDir = process.env.BOT_DATA_DIR
    || (process.platform === 'win32'
      ? path.join(process.env.APPDATA || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'bot-discord')
      : path.join(__dirname, '..', 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, 'bot.sqlite3');
}

function getDatabase() {
  if (database) return database;
  database = new DatabaseSync(databasePath());
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS guilds (
      guild_id TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS playlists (
      playlist_id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guild_id, name)
    );
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(guild_id, setting_key)
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      track_id INTEGER PRIMARY KEY AUTOINCREMENT,
      playlist_id INTEGER NOT NULL REFERENCES playlists(playlist_id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'youtube',
      added_by TEXT NOT NULL,
      added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(playlist_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_playlists_guild ON playlists(guild_id, name);
    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks(playlist_id, position);
  `);
  return database;
}

function closeDatabase() {
  if (!database) return;
  database.close();
  database = null;
}

function cleanName(name) {
  const value = String(name || '').trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 50) throw new Error('Le nom doit contenir entre 2 et 50 caractères.');
  return value;
}

function ensureGuild(db, guildId) {
  db.prepare('INSERT OR IGNORE INTO guilds(guild_id) VALUES (?)').run(String(guildId));
}

function getGuildSetting(guildId, key, fallback = null) {
  const db = getDatabase();
  ensureGuild(db, guildId);
  const row = db.prepare('SELECT value_json FROM guild_settings WHERE guild_id = ? AND setting_key = ?')
    .get(String(guildId), String(key));
  if (!row) return fallback;
  try { return JSON.parse(row.value_json); } catch (_) { return fallback; }
}

function setGuildSetting(guildId, key, value) {
  const db = getDatabase();
  ensureGuild(db, guildId);
  const settingKey = String(key).trim();
  if (!settingKey || settingKey.length > 80) throw new Error('Clé de configuration invalide.');
  const encoded = JSON.stringify(value);
  if (encoded === undefined || encoded.length > 16_384) throw new Error('Valeur de configuration invalide ou trop volumineuse.');
  db.prepare(`INSERT INTO guild_settings(guild_id, setting_key, value_json) VALUES (?, ?, ?)
    ON CONFLICT(guild_id, setting_key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`)
    .run(String(guildId), settingKey, encoded);
}

function createPlaylist(guildId, ownerId, name) {
  const db = getDatabase();
  ensureGuild(db, guildId);
  try {
    db.prepare('INSERT INTO playlists(guild_id, owner_id, name) VALUES (?, ?, ?)')
      .run(String(guildId), String(ownerId), cleanName(name));
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error.message)) throw new Error('Une playlist porte déjà ce nom sur ce serveur.');
    throw error;
  }
}

function listPlaylists(guildId) {
  return getDatabase().prepare(`
    SELECT p.name, p.owner_id AS ownerId, p.created_at AS createdAt, COUNT(t.track_id) AS trackCount
    FROM playlists p LEFT JOIN playlist_tracks t ON t.playlist_id = p.playlist_id
    WHERE p.guild_id = ? GROUP BY p.playlist_id ORDER BY p.name COLLATE NOCASE
  `).all(String(guildId));
}

function findPlaylist(db, guildId, name) {
  return db.prepare('SELECT playlist_id AS id, owner_id AS ownerId, name FROM playlists WHERE guild_id = ? AND name = ?')
    .get(String(guildId), cleanName(name));
}

function addTrack(guildId, ownerId, name, song) {
  const db = getDatabase();
  const playlist = findPlaylist(db, guildId, name);
  if (!playlist) throw new Error('Playlist introuvable sur ce serveur.');
  if (playlist.ownerId !== String(ownerId)) throw new Error('Seul le créateur peut modifier cette playlist.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const count = db.prepare('SELECT COUNT(*) AS count FROM playlist_tracks WHERE playlist_id = ?').get(playlist.id).count;
    if (count >= 500) throw new Error('Limite de 500 titres par playlist atteinte.');
    db.prepare(`INSERT INTO playlist_tracks(playlist_id, position, title, url, source, added_by)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      playlist.id, count + 1, String(song.title).slice(0, 200), String(song.url),
      String(song.source || 'youtube'), String(ownerId)
    );
    db.exec('COMMIT');
    return count + 1;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getPlaylist(guildId, name) {
  const db = getDatabase();
  const playlist = findPlaylist(db, guildId, name);
  if (!playlist) return null;
  const tracks = db.prepare(`SELECT position, title, url, source, added_by AS addedBy
    FROM playlist_tracks WHERE playlist_id = ? ORDER BY position`).all(playlist.id);
  return { ...playlist, tracks };
}

function removeTrack(guildId, ownerId, name, position) {
  const db = getDatabase();
  const playlist = findPlaylist(db, guildId, name);
  if (!playlist) throw new Error('Playlist introuvable sur ce serveur.');
  if (playlist.ownerId !== String(ownerId)) throw new Error('Seul le créateur peut modifier cette playlist.');
  const track = db.prepare('SELECT track_id AS id FROM playlist_tracks WHERE playlist_id = ? AND position = ?')
    .get(playlist.id, Number(position));
  if (!track) throw new Error('Aucun titre à cette position. Utilise `/playlist action:list` pour voir les numéros.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM playlist_tracks WHERE track_id = ?').run(track.id);
    // Décale d’abord les positions dans une plage libre pour respecter UNIQUE(playlist_id, position).
    db.prepare('UPDATE playlist_tracks SET position = position + 1000 WHERE playlist_id = ? AND position > ?')
      .run(playlist.id, Number(position));
    db.prepare('UPDATE playlist_tracks SET position = position - 1001 WHERE playlist_id = ? AND position > 1000')
      .run(playlist.id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function deletePlaylist(guildId, ownerId, name) {
  const db = getDatabase();
  const playlist = findPlaylist(db, guildId, name);
  if (!playlist) throw new Error('Playlist introuvable sur ce serveur.');
  if (playlist.ownerId !== String(ownerId)) throw new Error('Seul le créateur peut supprimer cette playlist.');
  db.prepare('DELETE FROM playlists WHERE playlist_id = ?').run(playlist.id);
}

module.exports = {
  getDatabase, closeDatabase, getGuildSetting, setGuildSetting,
  createPlaylist, listPlaylists, addTrack, getPlaylist, removeTrack, deletePlaylist,
};
