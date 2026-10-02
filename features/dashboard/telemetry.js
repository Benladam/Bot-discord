'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { format } = require('node:util');

function createTelemetry({ database, env = process.env, maxRows = 50000, retentionDays = 14 }) {
  const context = new AsyncLocalStorage();
  let writes = 0;
  let initialized = false;
  let restoring = null;
  const tracks = new Map();

  function redact(value) {
    let text = String(value ?? '');
    const secrets = Object.entries(env)
      .filter(([key, secret]) => /TOKEN|SECRET|PASSWORD|API_KEY/i.test(key) && String(secret || '').length >= 8)
      .map(([, secret]) => String(secret));
    for (const secret of secrets) text = text.split(secret).join('[secret masqué]');
    return text.replace(/(Bearer\s+)[\w.-]+/gi, '$1[masqué]')
      .replace(/((?:token|secret|password|api[_-]?key|signature|sig)=)[^\s&]+/gi, '$1[masqué]')
      .replace(/https?:\/\/[^\s/]+:[^\s@]+@/gi, 'https://[masqué]@');
  }

  function db() {
    const connection = database.getDatabase();
    if (!initialized) {
      connection.exec(`CREATE TABLE IF NOT EXISTS diagnostic_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL,
        category TEXT NOT NULL,
        guild_id TEXT,
        user_id TEXT,
        command TEXT,
        message TEXT NOT NULL,
        stack TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS diagnostic_logs_guild ON diagnostic_logs(guild_id, id);
      CREATE INDEX IF NOT EXISTS diagnostic_logs_time ON diagnostic_logs(timestamp);
      CREATE INDEX IF NOT EXISTS diagnostic_logs_level ON diagnostic_logs(level, id);`);
      initialized = true;
    }
    return connection;
  }

  function record(entry) {
    const inherited = context.getStore() || {};
    const message = redact(entry.message).slice(0, 8000);
    const inferredGuild = message.match(/(?:guildId=|serveur[=\s]+)(\d{17,20})/i)?.[1];
    const guildId = entry.guildId ?? inferredGuild ?? inherited.guildId ?? null;
    const category = entry.category
      || (/\[voice\]/i.test(message) ? 'voice' : /\[audio\]|\[now-playing\]|musique|vocal/i.test(message) ? 'music'
        : /a utilisé|❯/i.test(message) ? 'command' : inherited.category || 'system');
    const metadata = JSON.stringify(entry.metadata || inherited.metadata || {}, (_, value) =>
      typeof value === 'string' ? redact(value) : value).slice(0, 16000);
    const level = ['info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
    const result = db().prepare(`INSERT INTO diagnostic_logs
      (timestamp,level,category,guild_id,user_id,command,message,stack,metadata_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      new Date().toISOString(), level, category, guildId ? String(guildId) : null,
      entry.userId ?? inherited.userId ?? null, entry.command ?? inherited.command ?? null,
      message, entry.stack ? redact(entry.stack).slice(0, 16000) : null, metadata,
    );
    // A bounded diagnostic history keeps log storage from filling the host's disk.
    if (++writes === 1 || writes % 200 === 0) {
      db().prepare('DELETE FROM diagnostic_logs WHERE timestamp < ?')
        .run(new Date(Date.now() - retentionDays * 86400000).toISOString());
      db().prepare('DELETE FROM diagnostic_logs WHERE id <= (SELECT MAX(id) - ? FROM diagnostic_logs)').run(maxRows);
    }
    return Number(result.lastInsertRowid);
  }

  function query({ guildId, level, category, search, since, before, limit = 150 } = {}) {
    const where = [];
    const params = [];
    if (guildId === 'global') where.push('guild_id IS NULL');
    else if (guildId) { where.push('guild_id = ?'); params.push(String(guildId)); }
    if (level) { where.push('level = ?'); params.push(String(level)); }
    if (category) { where.push('category = ?'); params.push(String(category)); }
    if (search) {
      where.push("(message LIKE ? ESCAPE '\\' OR COALESCE(stack,'') LIKE ? ESCAPE '\\')");
      const pattern = `%${String(search).slice(0, 200).replace(/[\\%_]/g, '\\$&')}%`;
      params.push(pattern, pattern);
    }
    if (since) { where.push('timestamp >= ?'); params.push(String(since)); }
    if (Number.isSafeInteger(Number(before)) && Number(before) > 0) { where.push('id < ?'); params.push(Number(before)); }
    const boundedLimit = Math.max(1, Math.min(300, Math.floor(Number(limit) || 150)));
    const rows = db().prepare(`SELECT * FROM diagnostic_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY id DESC LIMIT ?`).all(...params, boundedLimit + 1);
    const hasMore = rows.length > boundedLimit;
    return {
      logs: rows.slice(0, boundedLimit).map((row) => {
        let metadata = {};
        try { metadata = JSON.parse(row.metadata_json); } catch (_) {}
        return { id: row.id, timestamp: row.timestamp, level: row.level, category: row.category,
          guildId: row.guild_id, userId: row.user_id, command: row.command,
          message: row.message, stack: row.stack, metadata };
      }),
      hasMore,
    };
  }

  function stats(guildId) {
    const params = [new Date(Date.now() - 86400000).toISOString()];
    const filter = guildId ? ' AND guild_id = ?' : '';
    if (guildId) params.push(String(guildId));
    const row = db().prepare(`SELECT COUNT(*) AS logs24h,
      COALESCE(SUM(level = 'error'),0) AS errors24h,
      COALESCE(SUM(category = 'command' AND level = 'info'),0) AS commands24h,
      COALESCE(SUM(category = 'history'),0) AS tracks24h
      FROM diagnostic_logs WHERE timestamp >= ?${filter}`).get(...params);
    return { ...row, retentionDays, maxRows };
  }

  function installConsole() {
    if (restoring) return restoring;
    const originals = {};
    for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
      originals[method] = console[method];
      console[method] = (...args) => {
        originals[method].apply(console, args);
        try {
          const error = args.find((arg) => arg instanceof Error);
          record({ level: method === 'warn' ? 'warn' : method === 'error' ? 'error' : 'info',
            message: format(...args), stack: error?.stack });
        } catch (_) { /* Logging failure must never break the bot or recurse. */ }
      };
    }
    restoring = () => { for (const method of Object.keys(originals)) console[method] = originals[method]; restoring = null; };
    return restoring;
  }

  function musicActivity(guildId, state) {
    const key = state.current ? `${state.playbackId}:${state.current.title}` : null;
    const previous = tracks.get(guildId);
    if (previous?.key === key && previous?.paused === state.isPaused) return;
    const started = key && previous?.key !== key;
    tracks.set(guildId, { key, paused: state.isPaused });
    record({ guildId, userId: state.requesterId || null,
      category: started ? 'history' : 'music', level: 'info',
      message: started ? `Lecture : ${state.current.title}`
        : !key ? 'File musicale terminée ou arrêtée.' : state.isPaused ? 'Lecture en pause.' : 'Lecture reprise.',
      metadata: { title: state.current?.title || null, source: state.current?.provider || null,
        voiceChannel: state.voiceChannelName, queueLength: state.queueLength, playbackId: state.playbackId },
    });
  }

  return { record, query, stats, redact, installConsole, musicActivity,
    run: (scope, callback) => context.run(scope, callback) };
}

module.exports = { createTelemetry };
