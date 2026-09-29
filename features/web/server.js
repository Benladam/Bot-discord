'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const WEB_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'discord_music_panel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_BODY_BYTES = 8 * 1024;
const DISCORD_ID = /^\d{17,20}$/;
const ACTIONS = new Set(['pause', 'resume', 'skip', 'stop', 'leave', 'shuffle', 'volume', 'toggle-24-7']);

function normalizeBasePath(value) {
  const input = String(value || '').trim();
  if (!input || input === '/') return '';
  const candidate = input.startsWith('/') ? input : `/${input}`;
  const normalized = candidate.replace(/\/+$/, '');
  if (!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(normalized)) {
    throw new Error('WEB_BASE_PATH doit être un chemin simple, par exemple /music.');
  }
  return normalized;
}

function parsePublicUrl(env = process.env) {
  const configured = String(env.WEB_PUBLIC_URL || '').trim();
  if (!configured) return null;
  let url;
  try { url = new URL(configured); }
  catch { throw new Error('WEB_PUBLIC_URL doit être une URL publique valide.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('WEB_PUBLIC_URL doit utiliser http(s), sans identifiant, paramètres ni fragment.');
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
  if (url.protocol !== 'https:' && !localHost) {
    throw new Error('WEB_PUBLIC_URL doit utiliser HTTPS pour tout domaine public.');
  }
  return url;
}

function getWebPanelPublicUrl(env = process.env) {
  try {
    const url = parsePublicUrl(env);
    if (!url) return null;
    const basePath = normalizeBasePath(env.WEB_BASE_PATH || url.pathname);
    return `${url.origin}${basePath}/`;
  } catch {
    return null;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function secureEqual(left, right) {
  return crypto.timingSafeEqual(sha256(left), sha256(right));
}

function parseCookie(request, name) {
  const cookieHeader = String(request.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { return null; }
  }
  return null;
}

function json(response, status, payload, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (tooLarge) return;
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) {
        const error = new Error('La requête est trop volumineuse.');
        error.statusCode = 413;
        reject(error);
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Objet JSON attendu.');
        resolve(parsed);
      } catch (error) {
        error.statusCode ||= 400;
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function exactKeys(object, expected) {
  return Object.keys(object).length === expected.length && expected.every((key) => Object.hasOwn(object, key));
}

function boolEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ''));
}

function createWebPanel({ client, getPlayer, database, logger = console, env = process.env }) {
  const adminToken = String(env.WEB_ADMIN_TOKEN || '').trim();
  const trustProxy = boolEnv(env.WEB_TRUST_PROXY);
  const sessions = new Map();
  const loginFailures = new Map();
  let publicUrl = null;
  let publicOrigin = null;
  let basePath = '';
  let configurationError = null;

  try {
    const parsed = parsePublicUrl(env);
    basePath = normalizeBasePath(env.WEB_BASE_PATH || parsed?.pathname);
    if (parsed) {
      publicOrigin = parsed.origin;
      publicUrl = `${parsed.origin}${basePath}/`;
    }
  } catch (error) {
    configurationError = error;
  }

  const explicitSecureCookie = String(env.WEB_COOKIE_SECURE || '').trim();
  const secureCookie = Boolean(publicOrigin?.startsWith('https://')) || boolEnv(explicitSecureCookie);
  const panelConfigured = Buffer.byteLength(adminToken, 'utf8') >= 32
    && !configurationError;

  function log(level, message) {
    const method = logger?.[level] || console[level] || console.log;
    try { method.call(logger, message); } catch (_) { /* journal indisponible */ }
  }

  function requestOrigin(request) {
    try {
      let protocol = request.socket?.encrypted ? 'https:' : 'http:';
      let requestHost = request.headers.host;
      if (trustProxy) {
        const forwardedProtocol = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
        const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
        if (forwardedProtocol === 'http' || forwardedProtocol === 'https') protocol = `${forwardedProtocol}:`;
        if (forwardedHost) requestHost = forwardedHost;
      }
      if (!requestHost || /[\r\n\s]/.test(requestHost)) return null;
      return new URL(`${protocol}//${requestHost}`).origin;
    } catch { return null; }
  }

  function originAllowed(request) {
    const origin = request.headers.origin;
    if (!origin) return request.headers['sec-fetch-site'] !== 'cross-site';
    if (origin === 'null') return false;
    try {
      const parsed = new URL(origin);
      return parsed.origin === (publicOrigin || requestOrigin(request));
    } catch { return false; }
  }

  function clientAddress(request) {
    if (trustProxy) {
      const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (forwarded && forwarded.length <= 100) return forwarded;
    }
    return String(request.socket?.remoteAddress || 'unknown').slice(0, 100);
  }

  function getSession(request) {
    const id = parseCookie(request, SESSION_COOKIE);
    const session = id && sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(id);
      return null;
    }
    return { id, ...session };
  }

  function setCommonHeaders(response) {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    if (publicOrigin?.startsWith('https://')) response.setHeader('strict-transport-security', 'max-age=15552000');
  }

  function routePath(request) {
    let pathname;
    try { pathname = new URL(request.url || '/', 'http://panel.invalid').pathname; }
    catch { return null; }
    if (!basePath) return pathname;
    if (pathname === basePath || pathname === `${basePath}/`) return '/';
    if (!pathname.startsWith(`${basePath}/`)) return null;
    return pathname.slice(basePath.length) || '/';
  }

  function guildById(guildId) {
    if (!DISCORD_ID.test(guildId)) return null;
    return client?.guilds?.cache?.get?.(guildId) || null;
  }

  function getMusicState(guild) {
    const player = getPlayer(guild.id);
    const current = player.current;
    return {
      guild: { id: guild.id, name: guild.name },
      connected: Boolean(player.connection?.connected),
      voiceChannel: player.connection?.channelId
        ? { id: String(player.connection.channelId), name: player.voiceChannelName || 'Salon vocal' }
        : null,
      current: current ? {
        title: String(current.title || 'Titre inconnu').slice(0, 300),
        duration: Math.max(0, Number(current.duration) || 0),
        source: String(current.source || 'youtube').slice(0, 30),
        paused: Boolean(player.isPaused),
      } : null,
      playing: Boolean(player.isPlaying),
      queue: (player.queue || []).slice(0, 100).map((song) => ({
        title: String(song?.title || 'Titre inconnu').slice(0, 300),
        duration: Math.max(0, Number(song?.duration) || 0),
      })),
      queueLength: (player.queue || []).length,
      volume: Math.round(Math.max(0, Math.min(1, Number(player.volume) || 0)) * 100),
      loopMode: Number(player.loopMode) || 0,
      alwaysOn: database?.getGuildSetting?.(guild.id, 'music24_7', false) === true,
    };
  }

  function respondError(response, status, message) {
    json(response, status, { error: message });
  }

  async function applyMusicAction(guild, input) {
    if (!input || typeof input.action !== 'string' || !ACTIONS.has(input.action)
        || (input.action === 'volume' ? !exactKeys(input, ['action', 'value']) : !exactKeys(input, ['action']))) {
      const error = new Error('Action inconnue ou paramètres supplémentaires refusés.');
      error.statusCode = 400;
      throw error;
    }
    const player = getPlayer(guild.id);
    switch (input.action) {
      case 'pause':
        if (!player.current || !player.isPlaying) throw Object.assign(new Error('Aucune musique en cours de lecture.'), { statusCode: 409 });
        await player.pause();
        break;
      case 'resume':
        if (!player.current || !player.isPaused) throw Object.assign(new Error('Aucune musique en pause.'), { statusCode: 409 });
        await player.resume();
        break;
      case 'skip':
        if (!player.current) throw Object.assign(new Error('Aucune musique à passer.'), { statusCode: 409 });
        await player.skip();
        break;
      case 'stop':
        await player.stop();
        break;
      case 'leave':
        await player.leave();
        break;
      case 'shuffle':
        if (player.queue.length < 2) throw Object.assign(new Error('Ajoute au moins deux titres avant de mélanger la file.'), { statusCode: 409 });
        player.shuffleQueue();
        await player._activity?.();
        break;
      case 'volume':
        if (!Number.isInteger(input.value) || input.value < 0 || input.value > 100) {
          throw Object.assign(new Error('Le volume doit être un nombre entier de 0 à 100.'), { statusCode: 400 });
        }
        player.setVolume(input.value / 100);
        database?.setGuildSetting?.(guild.id, 'defaultVolume', input.value / 100);
        break;
      case 'toggle-24-7': {
        const enabled = database.getGuildSetting(guild.id, 'music24_7', false) !== true;
        database.setGuildSetting(guild.id, 'music24_7', enabled);
        if (enabled) {
          player._clearIdleTimer?.();
          player._clearAloneTimer?.();
        } else if (player.connection?.connected) {
          player._scheduleIdleLeave?.();
          if (player.connection.channelId) player._scheduleAloneLeave?.(player.connection.channelId);
        }
        break;
      }
      default:
        throw Object.assign(new Error('Action non disponible.'), { statusCode: 400 });
    }
    return getMusicState(guild);
  }

  async function handle(request, response) {
    setCommonHeaders(response);
    if (!panelConfigured) return respondError(response, 503, 'Le panneau web n’est pas configuré.');
    const pathname = routePath(request);
    if (!pathname) return respondError(response, 404, 'Page introuvable.');

    if (request.method === 'GET' && pathname === '/') {
      const page = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8')
        .replaceAll('__WEB_BASE_PATH__', basePath);
      const body = Buffer.from(page);
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && (pathname === '/app.js' || pathname === '/style.css')) {
      const filename = pathname === '/app.js' ? 'app.js' : 'style.css';
      const body = fs.readFileSync(path.join(WEB_DIR, filename));
      response.writeHead(200, {
        'content-type': filename.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
      });
      response.end(body);
      return;
    }

    if (request.method === 'GET' && pathname === '/api/auth') {
      const session = getSession(request);
      return json(response, 200, session
        ? { authenticated: true, csrfToken: session.csrfToken }
        : { authenticated: false });
    }

    if (request.method === 'POST' && pathname === '/api/auth/login') {
      if (!originAllowed(request)) return respondError(response, 403, 'Origine de connexion refusée.');
      const ip = clientAddress(request);
      const now = Date.now();
      let failure = loginFailures.get(ip);
      if (failure && failure.resetAt <= now) failure = null;
      if (failure?.blockedUntil > now) return respondError(response, 429, 'Trop de tentatives. Réessaie dans quelques minutes.');
      if (!failure && loginFailures.size >= 1000) {
        for (const [address, state] of loginFailures) {
          if (state.resetAt <= now) loginFailures.delete(address);
        }
        if (loginFailures.size >= 1000) return respondError(response, 503, 'Connexion temporairement indisponible. Réessaie plus tard.');
      }

      const input = await readJson(request);
      if (!exactKeys(input, ['token']) || typeof input.token !== 'string' || input.token.length > 512) {
        return respondError(response, 400, 'Le corps doit contenir uniquement un jeton d’accès.');
      }
      if (!secureEqual(input.token, adminToken)) {
        const next = failure || { count: 0, resetAt: now + LOGIN_WINDOW_MS, blockedUntil: 0 };
        next.count += 1;
        if (next.count >= MAX_LOGIN_FAILURES) next.blockedUntil = now + LOGIN_WINDOW_MS;
        loginFailures.set(ip, next);
        return respondError(response, next.blockedUntil ? 429 : 401, next.blockedUntil
          ? 'Trop de tentatives. Réessaie dans quelques minutes.'
          : 'Jeton d’accès incorrect.');
      }
      loginFailures.delete(ip);
      for (const [sessionId, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(sessionId);
      }
      if (sessions.size >= 1000) return respondError(response, 503, 'Trop de sessions ouvertes. Réessaie plus tard.');
      const id = crypto.randomBytes(32).toString('base64url');
      const csrfToken = crypto.randomBytes(32).toString('base64url');
      sessions.set(id, { csrfToken, expiresAt: now + SESSION_TTL_MS });
      const cookie = `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=${basePath || '/'}; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secureCookie ? '; Secure' : ''}`;
      return json(response, 200, { authenticated: true, csrfToken }, { 'set-cookie': cookie });
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      const session = getSession(request);
      if (!session) return respondError(response, 401, 'Session expirée.');
      if (!originAllowed(request) || !secureEqual(request.headers['x-csrf-token'] || '', session.csrfToken)) {
        return respondError(response, 403, 'Vérification de sécurité refusée.');
      }
      sessions.delete(session.id);
      const cookie = `${SESSION_COOKIE}=; Path=${basePath || '/'}; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? '; Secure' : ''}`;
      return json(response, 200, { authenticated: false }, { 'set-cookie': cookie });
    }

    if (request.method === 'GET' && (pathname === '/api/status' || /^\/api\/guilds\/\d{17,20}\/music$/.test(pathname))) {
      const session = getSession(request);
      if (!session) return respondError(response, 401, 'Authentification requise.');
      if (!client?.isReady?.()) return respondError(response, 503, 'Le bot Discord n’est pas encore connecté.');
      if (pathname === '/api/status') {
        const guilds = [...(client.guilds?.cache?.values?.() || [])]
          .map((guild) => ({ id: String(guild.id), name: String(guild.name || 'Serveur').slice(0, 100) }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json(response, 200, { botReady: true, guilds });
      }
      const guildId = pathname.split('/')[3];
      const guild = guildById(guildId);
      if (!guild) return respondError(response, 404, 'Serveur Discord introuvable.');
      return json(response, 200, getMusicState(guild));
    }

    const actionMatch = pathname.match(/^\/api\/guilds\/(\d{17,20})\/music\/action$/);
    if (request.method === 'POST' && actionMatch) {
      const session = getSession(request);
      if (!session) return respondError(response, 401, 'Authentification requise.');
      if (!originAllowed(request) || !secureEqual(request.headers['x-csrf-token'] || '', session.csrfToken)) {
        return respondError(response, 403, 'Vérification de sécurité refusée.');
      }
      if (!client?.isReady?.()) return respondError(response, 503, 'Le bot Discord n’est pas encore connecté.');
      const guild = guildById(actionMatch[1]);
      if (!guild) return respondError(response, 404, 'Serveur Discord introuvable.');
      const input = await readJson(request);
      try {
        const state = await applyMusicAction(guild, input);
        return json(response, 200, { state });
      } catch (error) {
        return respondError(response, error.statusCode || 400, error.message || 'Action impossible.');
      }
    }

    return respondError(response, 404, 'Route introuvable.');
  }

  async function handleHttp(request, response) {
    try {
      await handle(request, response);
    } catch (error) {
      if (!response.headersSent) respondError(response, error.statusCode || 500,
        error.statusCode ? error.message : 'Erreur interne du panneau.');
      else response.destroy();
      log('error', `[web] ${error.message}`);
    }
  }

  return {
    handleHttp,
    enabled: panelConfigured,
    publicUrl,
    async start() {
      if (!panelConfigured) {
        const reason = configurationError?.message
          || 'WEB_ADMIN_TOKEN doit contenir au moins 32 octets.';
        log('warn', `[web] Panneau désactivé : ${reason}`);
        return false;
      }
      log('info', `[web] Panneau authentifié activé sur le serveur HTTP du bot${publicUrl ? ` · URL publique ${publicUrl}` : ''}`);
      return true;
    },
    close() {
      sessions.clear();
    },
  };
}

module.exports = { createWebPanel, getWebPanelPublicUrl, normalizeBasePath };
