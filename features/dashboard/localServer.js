'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const { send } = require('./api');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8192;
const MAX_RESPONSE = 2 * 1024 * 1024;

function normalizeRemoteUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch (_) { throw new Error('Adresse de l’API invalide.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Utilise HTTPS pour un bot distant, ou HTTP pour une API sur localhost.');
  }
  if (url.username || url.password || url.search || url.hash) throw new Error('L’adresse ne doit contenir ni identifiants ni paramètres.');
  return url.toString().replace(/\/+$/, '');
}

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Requête trop volumineuse.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error();
    return body;
  } catch (_) { throw Object.assign(new Error('Corps JSON invalide.'), { statusCode: 400 }); }
}

async function remoteRequest(connection, resource, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(`${connection.url}/api/dashboard/${resource}`, {
      headers: { authorization: `Bearer ${connection.token}`, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
  } catch (_) {
    throw Object.assign(new Error('API inaccessible. Vérifie l’adresse, le réseau et le certificat HTTPS du bot.'), { statusCode: 502 });
  }
  if (!response.ok) {
    const messages = { 401: 'Clé de diagnostic refusée par le bot.', 403: 'Accès refusé par le bot.',
      404: 'API absente ou ressource introuvable. Installe la version du bot avec le dashboard.',
      503: 'L’API du bot n’est pas configurée. Ajoute DASHBOARD_API_TOKEN sur l’hôte distant.' };
    throw Object.assign(new Error(messages[response.status] || `Le bot a répondu HTTP ${response.status}.`),
      { statusCode: response.status === 404 ? 404 : 502 });
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE) throw new Error('Réponse du bot trop volumineuse.');
  const reader = response.body.getReader();
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_RESPONSE) { await reader.cancel(); throw new Error('Réponse du bot trop volumineuse.'); }
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch (_) { throw Object.assign(new Error('Réponse de l’API invalide ou trop volumineuse.'), { statusCode: 502 }); }
}

const SECRET_PREFIX = 'DASHBOARD_CONNECTION_';

function secretKey(id) {
  return `${SECRET_PREFIX}${String(id).replace(/[^A-Za-z0-9]/g, '_')}_TOKEN`;
}

function readSecretFile(file) {
  if (!fs.existsSync(file)) return {};
  try { return dotenv.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { throw new Error('Fichier .env du dashboard invalide.'); }
}

function encodeEnvValue(value) {
  const text = String(value ?? '');
  return /^[A-Za-z0-9._~+/=-]*$/.test(text) ? text : JSON.stringify(text);
}

function writePrivateEnv(file, values) {
  const lines = [
    '# Clés privées du dashboard local — ce fichier est ignoré par Git.',
    '# Une entrée DASHBOARD_CONNECTION_*_TOKEN correspond à connections.json.',
    '',
  ];
  for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
    if (value) lines.push(`${key}=${encodeEnvValue(value)}`);
  }
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o600 });
  try { fs.renameSync(temporary, file); }
  catch (error) {
    try { fs.rmSync(file, { force: true }); fs.renameSync(temporary, file); }
    catch (_) { throw error; }
  }
}

function indexedEnvConnections(values) {
  const groups = new Map();
  for (const [key, value] of Object.entries(values)) {
    const match = key.match(/^DASHBOARD_BOT_(\d+)_(NAME|URL|TOKEN)$/);
    if (!match) continue;
    const group = groups.get(match[1]) || {};
    group[match[2].toLowerCase()] = String(value);
    groups.set(match[1], group);
  }
  return [...groups.entries()].sort(([a], [b]) => Number(a) - Number(b)).map(([, item]) => item)
    .filter((item) => item.name && item.url && item.token);
}

function connectionFromIndexedEnv(item) {
  return {
    id: `env-${crypto.createHash('sha256').update(`${item.name}\0${item.url}`).digest('hex').slice(0, 24)}`,
    name: item.name, url: normalizeRemoteUrl(item.url), token: item.token, locked: true,
  };
}

function createLocalDashboard({ env = process.env, fetchImpl = fetch, pollIntervalMs = 3000 } = {}) {
  const requestedPort = Number(env.DASHBOARD_LOCAL_PORT ?? 3090);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Port local invalide.');
  const dataDir = path.resolve(env.DASHBOARD_DATA_DIR || path.join(__dirname, '..', '..', 'data', 'local-dashboard'));
  const file = path.join(dataDir, 'connections.json');
  const secretFile = path.resolve(env.DASHBOARD_LOCAL_ENV_FILE || path.join(dataDir, '.env'));
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  let dashboardSecrets = readSecretFile(secretFile);
  const importedConnections = indexedEnvConnections({ ...env, ...dashboardSecrets }).map(connectionFromIndexedEnv);
  let connections = [];
  let migrateSecrets = false;
  if (fs.existsSync(file)) {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(stored)) throw new Error('Fichier de connexions invalide.');
    connections = stored.map((item) => {
      const id = String(item.id || crypto.randomUUID());
      const legacyToken = String(item.token || '');
      const token = legacyToken || String(dashboardSecrets[secretKey(id)] || '');
      if (legacyToken) { dashboardSecrets[secretKey(id)] = legacyToken; migrateSecrets = true; }
      return { id, name: String(item.name), url: normalizeRemoteUrl(item.url), token, locked: item.locked !== false };
    });
  } else if (env.DASHBOARD_REMOTE_URL && env.DASHBOARD_API_TOKEN) {
    connections = [{ id: crypto.randomUUID(), name: 'Mon bot', url: normalizeRemoteUrl(env.DASHBOARD_REMOTE_URL),
      token: String(env.DASHBOARD_API_TOKEN), locked: true }];
    migrateSecrets = true;
  } else {
    connections = importedConnections;
  }
  for (const imported of importedConnections) {
    if (!connections.some((item) => item.url === imported.url)) {
      connections.push(imported);
      migrateSecrets = true;
    }
  }
  const nonce = crypto.randomBytes(32).toString('base64url');
  const streams = new Set();
  const cache = new Map();
  const pending = new Map();
  let port = requestedPort;

  function save() {
    const nextSecrets = { ...dashboardSecrets };
    for (const key of Object.keys(nextSecrets)) if (key.startsWith(SECRET_PREFIX)) delete nextSecrets[key];
    for (const item of connections) if (item.token) nextSecrets[secretKey(item.id)] = item.token;
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(connections.map(({ id, name, url, locked }) => ({ id, name, url, locked })), null, 2), { mode: 0o600 });
    writePrivateEnv(secretFile, nextSecrets);
    try { fs.renameSync(temporary, file); }
    catch (error) {
      try { fs.rmSync(file, { force: true }); fs.renameSync(temporary, file); }
      catch (_) { throw error; }
    }
    dashboardSecrets = nextSecrets;
  }
  function publicConnection(item) { return { id: item.id, name: item.name, url: item.url, locked: item.locked !== false }; }
  function source(id) { return connections.find((item) => item.id === id); }
  function localAllowed(request) {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(request.headers.host)) return false;
    if (request.headers['sec-fetch-site'] === 'cross-site') return false;
    return !request.headers.origin || hosts.some((host) => request.headers.origin === `http://${host}`);
  }
  function authenticated(request) {
    return String(request.headers.cookie || '').split(';').some((item) => item.trim() === `bot_dashboard_local=${nonce}`);
  }
  function headers(response) {
    response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('x-frame-options', 'DENY');
    response.setHeader('referrer-policy', 'no-referrer');
    response.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    response.setHeader('cache-control', 'no-store');
  }

  if (migrateSecrets) save();

  async function snapshot(connection) {
    if (pending.has(connection.id)) return pending.get(connection.id);
    const cached = cache.get(connection.id);
    if (cached && Date.now() - cached.checkedAt < Math.min(pollIntervalMs, 1000)) return cached.payload;
    const task = (async () => {
      let payload;
      try {
        const data = await remoteRequest(connection, 'status', fetchImpl);
        if (data.protocolVersion !== 1 || !Array.isArray(data.guilds) || !data.bot) throw new Error('Version de l’API incompatible.');
        payload = { connected: true, source: publicConnection(connection), data };
      } catch (error) {
        payload = { connected: false, source: publicConnection(connection), error: error.message,
          lastSeen: cached?.payload.connected ? cached.payload.data.timestamp : cached?.payload.lastSeen || null };
      }
      if (source(connection.id) === connection) cache.set(connection.id, { checkedAt: Date.now(), payload });
      return payload;
    })();
    pending.set(connection.id, task);
    try { return await task; } finally { if (pending.get(connection.id) === task) pending.delete(connection.id); }
  }

  async function stream(request, response, connection) {
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    response.write(': connected\n\n');
    streams.add(response);
    let stopped = false; let inFlight = false;
    const publish = async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const active = source(connection.id);
        const payload = active ? await snapshot(active) : { connected: false, error: 'Connexion retirée.' };
        if (!stopped) response.write(`event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`);
      } finally { inFlight = false; }
    };
    const timer = setInterval(() => { void publish(); }, pollIntervalMs);
    timer.unref();
    response.on('close', () => { stopped = true; clearInterval(timer); streams.delete(response); });
    void publish();
  }

  async function handle(request, response) {
    headers(response);
    if (!localAllowed(request)) { send(response, 403, { error: 'Accès réservé à localhost.' }); return; }
    const url = new URL(request.url, 'http://local.invalid');
    const staticFiles = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
    if (request.method === 'GET' && staticFiles[url.pathname]) {
      const [fileName, type] = staticFiles[url.pathname];
      response.writeHead(200, { 'content-type': `${type}; charset=utf-8` });
      response.end(fs.readFileSync(path.join(PUBLIC_DIR, fileName))); return;
    }
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      response.setHeader('set-cookie', `bot_dashboard_local=${nonce}; HttpOnly; SameSite=Strict; Path=/`);
      send(response, 200, { csrfToken: nonce, connections: connections.map(publicConnection), pollIntervalMs }); return;
    }
    if (!authenticated(request)) { send(response, 401, { error: 'Ouvre le dashboard local pour initialiser une session.' }); return; }
    if (request.method !== 'GET' && request.headers['x-dashboard-csrf'] !== nonce) {
      send(response, 403, { error: 'Session locale invalide. Actualise la page.' }); return;
    }
    if (url.pathname === '/api/connections' && request.method === 'POST') {
      const input = await readBody(request);
      const name = String(input.name || '').trim().slice(0, 60);
      const token = String(input.token || '');
      if (!name || Buffer.byteLength(token) < 32 || token.length > 512 || /[\r\n]/.test(token)) {
        send(response, 400, { error: 'Nom et clé de diagnostic (32 caractères minimum) requis.' }); return;
      }
      if (connections.length >= 20) { send(response, 400, { error: 'Limite de 20 bots atteinte.' }); return; }
      const connection = { id: crypto.randomUUID(), name, url: normalizeRemoteUrl(input.url), token, locked: true };
      if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(connection.url).hostname) && Number(new URL(connection.url).port) === port) {
        send(response, 400, { error: 'Indique l’adresse du bot, pas celle du dashboard local.' }); return;
      }
      connections.push(connection); save(); send(response, 201, publicConnection(connection)); return;
    }
    const deletion = url.pathname.match(/^\/api\/connections\/([\w-]+)$/);
    const lock = url.pathname.match(/^\/api\/connections\/([\w-]+)\/lock$/);
    if (lock && request.method === 'POST') {
      const connection = source(lock[1]);
      if (!connection) { send(response, 404, { error: 'Connexion inconnue.' }); return; }
      const input = await readBody(request);
      if (typeof input.locked !== 'boolean') { send(response, 400, { error: 'État de verrouillage invalide.' }); return; }
      connection.locked = input.locked; save();
      send(response, 200, publicConnection(connection)); return;
    }
    if (deletion && request.method === 'PUT') {
      const connection = source(deletion[1]);
      if (!connection) { send(response, 404, { error: 'Connexion inconnue.' }); return; }
      if (connection.locked !== false) { send(response, 409, { error: 'Déverrouille cette connexion avant de la modifier.' }); return; }
      const input = await readBody(request);
      const name = String(input.name || '').trim().slice(0, 60);
      const token = input.token ? String(input.token) : connection.token;
      if (!name || Buffer.byteLength(token) < 32 || token.length > 512 || /[\r\n]/.test(token)) {
        send(response, 400, { error: 'Nom ou clé de diagnostic invalide.' }); return;
      }
      const replacement = { id: connection.id, name, url: normalizeRemoteUrl(input.url), token, locked: true };
      if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(replacement.url).hostname) && Number(new URL(replacement.url).port) === port) {
        send(response, 400, { error: 'Indique l’adresse du bot, pas celle du dashboard local.' }); return;
      }
      connections = connections.map((item) => item.id === connection.id ? replacement : item);
      cache.delete(connection.id); pending.delete(connection.id); save(); send(response, 200, publicConnection(replacement)); return;
    }
    if (deletion && request.method === 'DELETE') {
      if (!source(deletion[1])) { send(response, 404, { error: 'Connexion inconnue.' }); return; }
      connections = connections.filter((item) => item.id !== deletion[1]); cache.delete(deletion[1]); save();
      send(response, 200, { removed: true }); return;
    }
    if (url.pathname === '/api/stream' && request.method === 'GET') {
      const connection = source(url.searchParams.get('botId'));
      if (!connection) { send(response, 404, { error: 'Connexion inconnue.' }); return; }
      await stream(request, response, connection); return;
    }
    const proxy = url.pathname.match(/^\/api\/bots\/([\w-]+)\/(status|logs|history|guilds\/\d{17,20}(?:\/playlists\/[^/]+)?)$/);
    if (proxy && request.method === 'GET') {
      const connection = source(proxy[1]);
      if (!connection) { send(response, 404, { error: 'Connexion inconnue.' }); return; }
      const data = proxy[2] === 'status' ? await snapshot(connection)
        : await remoteRequest(connection, `${proxy[2]}${url.search}`, fetchImpl);
      send(response, 200, data); return;
    }
    send(response, 404, { error: 'Route locale inconnue.' });
  }

  const server = http.createServer((request, response) => {
    void handle(request, response).catch((error) => {
      if (!response.headersSent) send(response, error.statusCode || 400, { error: error.message || 'Erreur du dashboard.' });
      else response.destroy();
    });
  });
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', () => {
      port = server.address().port;
      resolve({ port, url: `http://127.0.0.1:${port}` });
    });
  });
  return { server, ready, close: async () => {
    for (const response of streams) response.end();
    await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
  } };
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
  const dashboard = createLocalDashboard();
  dashboard.ready.then(({ url }) => console.log(`Dashboard local : ${url}\nLecture seule · aucun client Discord lancé.`))
    .catch((error) => { console.error(`Dashboard indisponible : ${error.message}`); process.exitCode = 1; });
  process.once('SIGINT', () => { void dashboard.close(); });
  process.once('SIGTERM', () => { void dashboard.close(); });
}

module.exports = { createLocalDashboard, normalizeRemoteUrl, remoteRequest };
