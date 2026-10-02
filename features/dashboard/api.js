'use strict';

const crypto = require('node:crypto');

function send(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' });
  response.end(JSON.stringify(payload));
}

function equal(left, right) {
  const digest = (value) => crypto.createHash('sha256').update(String(value)).digest();
  return crypto.timingSafeEqual(digest(left), digest(right));
}

function publicTrack(track) {
  if (!track) return null;
  return { title: String(track.title || 'Titre inconnu').slice(0, 300),
    duration: Number(track.duration) || 0, source: String(track.source || track.provider || 'youtube'),
    requesterId: track.requesterId || null };
}

function createDashboardApi({ client, database, telemetry, restartBot, env = process.env }) {
  const token = String(env.DASHBOARD_API_TOKEN || '');
  const controlToken = String(env.DASHBOARD_CONTROL_TOKEN || '');
  const canRestart = Buffer.byteLength(controlToken) >= 32 && controlToken !== token && env.BOT_SUPERVISED === '1' && typeof restartBot === 'function';
  let restartPending = false;
  let cpuAt = performance.now();
  let cpuUsage = process.cpuUsage();
  let cpuPercent = null;

  function music(guildId) {
    const player = client.musicPlayers?.get?.(guildId);
    return { connected: Boolean(player?.connection?.connected), playing: Boolean(player?.isPlaying),
      paused: Boolean(player?.isPaused), current: publicTrack(player?.current),
      queue: (player?.queue || []).slice(0, 100).map(publicTrack), queueLength: player?.queue?.length || 0,
      volume: Math.round((player?.volume ?? database.getGuildSetting(guildId, 'defaultVolume', 1)) * 100),
      loopMode: player?.loopMode || 0, voiceChannel: player?.voiceChannelName || null,
      alwaysOn: database.getGuildSetting(guildId, 'music24_7', false) === true };
  }

  function guildInfo(guild) {
    const state = music(guild.id);
    return { id: String(guild.id), name: guild.name, icon: guild.iconURL?.({ size: 128 }) || null,
      members: Number(guild.memberCount) || 0, available: guild.available !== false,
      music: { connected: state.connected, playing: state.playing, paused: state.paused,
        title: state.current?.title || null, queueLength: state.queueLength, voiceChannel: state.voiceChannel } };
  }

  function status() {
    const now = performance.now();
    if (now - cpuAt >= 1000) {
      const current = process.cpuUsage();
      cpuPercent = Math.round(((current.user - cpuUsage.user + current.system - cpuUsage.system) / 1000) / (now - cpuAt) * 1000) / 10;
      cpuAt = now; cpuUsage = current;
    }
    const guilds = [...client.guilds.cache.values()].map(guildInfo).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return { protocolVersion: 1, timestamp: new Date().toISOString(), capabilities: { restart: canRestart }, bot: {
      id: client.user?.id || null, name: client.user?.username || 'Bot Discord',
      avatar: client.user?.displayAvatarURL?.({ size: 128 }) || null, ready: Boolean(client.isReady?.()),
      uptimeMs: client.uptime || 0, processUptimeSeconds: process.uptime(),
      pingMs: Number.isFinite(client.ws?.ping) && client.ws.ping >= 0 ? client.ws.ping : null,
      memoryBytes: process.memoryUsage().rss, heapBytes: process.memoryUsage().heapUsed, cpuPercent,
      nodeVersion: process.version },
      totals: { guilds: guilds.length, members: guilds.reduce((sum, g) => sum + g.members, 0),
        activeVoice: guilds.filter((g) => g.music.connected).length, ...telemetry.stats() }, guilds };
  }

  async function handle(request, response, pathname) {
    if (!pathname.startsWith('/api/dashboard/')) return false;
    if (pathname === '/api/dashboard/restart' && request.method === 'POST') {
      const provided = String(request.headers.authorization || '').replace(/^Bearer /i, '');
      if (!canRestart || !provided || !equal(provided, controlToken)) {
        send(response, 403, { error: 'Redémarrage réservé à la clé administrateur distincte, sur un bot lancé avec npm start.' }); return true;
      }
      if (restartPending) { send(response, 409, { error: 'Redémarrage déjà demandé.' }); return true; }
      restartPending = true;
      telemetry.record({ category: 'system', message: 'Redémarrage demandé par un administrateur via le dashboard local.' });
      response.once('finish', () => {
        setTimeout(() => { void Promise.resolve().then(restartBot).catch(() => {
          restartPending = false;
          telemetry.record({ level: 'error', category: 'system', message: 'Échec du redémarrage demandé depuis le dashboard.' });
        }); }, 1500);
      });
      send(response, 202, { accepted: true, message: 'Redémarrage accepté. La connexion sera rétablie automatiquement.' }); return true;
    }
    if (request.method !== 'GET') { send(response, 405, { error: 'API de diagnostic en lecture seule.' }); return true; }
    if (Buffer.byteLength(token) < 32) { send(response, 503, { error: 'DASHBOARD_API_TOKEN doit être configuré sur le bot (32 caractères minimum).' }); return true; }
    const provided = String(request.headers.authorization || '').replace(/^Bearer /i, '');
    if (!provided || !equal(provided, token)) { send(response, 401, { error: 'Clé de diagnostic incorrecte.' }); return true; }
    const url = new URL(request.url, 'http://dashboard.invalid');
    if (pathname === '/api/dashboard/status') { send(response, 200, status()); return true; }
    if (pathname === '/api/dashboard/logs' || pathname === '/api/dashboard/history') {
      const scope = url.searchParams.get('guildId');
      if (scope && scope !== 'global' && !client.guilds.cache.has(scope)) { send(response, 404, { error: 'Serveur inconnu.' }); return true; }
      const since = url.searchParams.get('since');
      if (since && !Number.isFinite(Date.parse(since))) { send(response, 400, { error: 'Période invalide.' }); return true; }
      const result = telemetry.query({ guildId: scope, level: url.searchParams.get('level'),
        category: pathname.endsWith('/history') ? 'history' : url.searchParams.get('category'),
        search: url.searchParams.get('search'), since: since ? new Date(since).toISOString() : null,
        before: url.searchParams.get('before'), limit: url.searchParams.get('limit') });
      send(response, 200, result); return true;
    }
    const match = pathname.match(/^\/api\/dashboard\/guilds\/(\d{17,20})(?:\/playlists\/([^/]+))?$/);
    if (match) {
      const guild = client.guilds.cache.get(match[1]);
      if (!guild) { send(response, 404, { error: 'Serveur inconnu.' }); return true; }
      if (match[2]) {
        let name;
        try { name = decodeURIComponent(match[2]); } catch (_) { send(response, 400, { error: 'Nom invalide.' }); return true; }
        let playlist;
        try { playlist = database.getPlaylist(guild.id, name); } catch (_) { send(response, 400, { error: 'Nom de playlist invalide.' }); return true; }
        if (!playlist) { send(response, 404, { error: 'Playlist introuvable.' }); return true; }
        send(response, 200, { name: playlist.name, ownerId: playlist.ownerId,
          tracks: playlist.tracks.map((track) => ({ position: track.position, ...publicTrack(track), addedBy: track.addedBy })) });
      } else {
        send(response, 200, { guild: guildInfo(guild), music: music(guild.id),
          playlists: database.listPlaylists(guild.id), stats: telemetry.stats(guild.id) });
      }
      return true;
    }
    send(response, 404, { error: 'Route de diagnostic inconnue.' }); return true;
  }
  return { handle, status, enabled: Buffer.byteLength(token) >= 32 };
}

module.exports = { createDashboardApi, send };
