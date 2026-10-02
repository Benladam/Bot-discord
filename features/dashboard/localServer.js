'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const { send } = require('./api');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 8192;
const MAX_RESPONSE = 2 * 1024 * 1024;

function openBrowser(url) {
  const windows = process.platform === 'win32';
  const command = windows ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = [url];
  let fallbackStarted = false;
  const fallback = () => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    if (!windows) {
      console.warn(`[dashboard] Ouverture automatique impossible. Ctrl+clic : ${url}`);
      return;
    }
    // `Start-Process` peut être refusé lorsque le dashboard est lancé depuis
    // un raccourci ou une console protégée. Le gestionnaire Windows est plus
    // fiable et ce second mécanisme reste sans fenêtre supplémentaire.
    const fallbackChild = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      stdio: 'ignore',
      windowsHide: true,
    });
    fallbackChild.once('error', () => console.warn(`[dashboard] Ouverture automatique impossible. Ctrl+clic : ${url}`));
    fallbackChild.once('exit', (code) => { if (code) console.warn(`[dashboard] Ouverture automatique impossible. Ctrl+clic : ${url}`); });
    fallbackChild.unref();
  };
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: windows });
  child.once('error', fallback);
  child.once('exit', (code) => { if (code) fallback(); });
  child.unref();
}

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

async function remoteRequest(connection, resource, fetchImpl = fetch, options = {}) {
  const credential = options.control ? connection.controlToken : connection.token;
  let hostname = '';
  try { hostname = new URL(connection.url).hostname.toLowerCase(); } catch (_) { /* normalizeRemoteUrl valide déjà l’adresse */ }
  if (/^ptlc_/i.test(String(credential || '')) || hostname === 'kineticpanel.net') {
    throw Object.assign(new Error('Clé ou adresse KineticPanel détectée. Ce dashboard attend l’API du bot sur /api/dashboard/ avec DASHBOARD_API_TOKEN, pas la clé ptlc_ de KineticPanel. Utilise l’URL HTTPS du service HTTP du bot, sans /api/dashboard.'), { statusCode: 400 });
  }
  let response;
  try {
    response = await fetchImpl(`${connection.url}/api/dashboard/${resource}`, {
      method: options.method || 'GET',
      headers: { authorization: `Bearer ${credential}`, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const code = error.cause?.code || error.code;
    let message = 'API inaccessible. Vérifie l’adresse, le réseau et le certificat HTTPS du bot.';
    if (code === 'ECONNREFUSED' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname)) {
      message = 'Aucun bot ne répond sur ce port local. Lance le bot avec npm start ; pour son API locale, configure DASHBOARD_LOOPBACK_PORT=8081 sur le bot et l’adresse http://127.0.0.1:8081 ici.';
    } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      message = 'Adresse du bot introuvable (DNS). Vérifie son domaine ; pour un bot lancé sur ce PC, utilise son adresse locale.';
    } else if (['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED'].includes(code)) {
      message = 'Certificat HTTPS du bot refusé. Vérifie son certificat et son domaine ; sur ce PC, utilise l’API locale DASHBOARD_LOOPBACK_PORT.';
    }
    throw Object.assign(new Error(message), { statusCode: 502 });
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

function createLocalDashboard({ env = process.env, fetchImpl = fetch, pollIntervalMs = 3000, logger = console } = {}) {
  const requestedPort = Number(env.DASHBOARD_LOCAL_PORT ?? 3090);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) throw new Error('Port local invalide.');
  const root = path.join(__dirname, '..', '..');
  const dataDir = path.resolve(env.DASHBOARD_DATA_DIR || path.join(root, '.venv', 'local-dashboard'));
  const legacyDir = path.join(root, 'data', 'local-dashboard');
  if (!env.DASHBOARD_DATA_DIR && !fs.existsSync(path.join(dataDir, 'connections.json')) && fs.existsSync(path.join(legacyDir, 'connections.json'))) {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const name of ['connections.json', '.env']) {
      if (fs.existsSync(path.join(legacyDir, name))) fs.copyFileSync(path.join(legacyDir, name), path.join(dataDir, name), fs.constants.COPYFILE_EXCL);
    }
    logger.info('[dashboard] Connexions existantes importées dans .venv/local-dashboard.');
  }
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
      return { id, name: String(item.name), url: normalizeRemoteUrl(item.url), token,
        controlToken: String(dashboardSecrets[secretKey(id).replace(/_TOKEN$/, '_CONTROL_TOKEN')] || ''), locked: item.locked !== false };
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
  const observedLogs = new Map();
  let port = requestedPort;

  function save() {
    const nextSecrets = { ...dashboardSecrets };
    for (const key of Object.keys(nextSecrets)) if (key.startsWith(SECRET_PREFIX)) delete nextSecrets[key];
    for (const item of connections) {
      if (item.token) nextSecrets[secretKey(item.id)] = item.token;
      if (item.controlToken) nextSecrets[secretKey(item.id).replace(/_TOKEN$/, '_CONTROL_TOKEN')] = item.controlToken;
      const directory = path.join(dataDir, 'bots', item.id);
      fs.mkdirSync(directory, { recursive: true });
      writePrivateEnv(path.join(directory, '.env'), { DASHBOARD_REMOTE_URL: item.url, DASHBOARD_API_TOKEN: item.token, DASHBOARD_CONTROL_TOKEN: item.controlToken });
    }
    const botDir = path.join(dataDir, 'bots');
    if (fs.existsSync(botDir)) for (const id of fs.readdirSync(botDir)) {
      if (!connections.some((item) => item.id === id) && /^[\w-]+$/.test(id)) fs.rmSync(path.join(botDir, id), { recursive: true, force: true });
    }
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(connections.map(({ id, name, url, locked }) => ({ id, name, url, locked })), null, 2), { mode: 0o600 });
    writePrivateEnv(secretFile, nextSecrets);
    try { fs.renameSync(temporary, file); }
    catch (error) {
      try { fs.rmSync(file, { force: true }); fs.renameSync(temporary, file); }
      catch (_) { throw error; }
    }
    dashboardSecrets = nextSecrets;
    logger.info(`[dashboard] ${connections.length} connexion(s) synchronisée(s) dans le stockage privé.`);
  }
  function publicConnection(item) { return { id: item.id, name: item.name, url: item.url, locked: item.locked !== false, controlConfigured: Boolean(item.controlToken) }; }
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

  if (migrateSecrets || connections.length) save();

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
        try {
          const previous = observedLogs.get(connection.id);
          const events = await remoteRequest(connection, 'logs?limit=20', fetchImpl);
          const entries = [...(events.logs || [])].sort((a, b) => Number(a.id) - Number(b.id));
          for (const entry of entries) {
            if (previous !== undefined && Number(entry.id) <= previous) continue;
            let message = String(entry.message || '').replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 500);
            for (const secret of [connection.token, connection.controlToken]) if (secret) message = message.split(secret).join('[masqué]');
            message = message.replace(/https?:\/\/\S+/g, '[adresse masquée]').replace(/(Bearer\s+)\S+/gi, '$1[masqué]');
            logger.info(`[bot ${connection.id}] ${entry.level || 'info'} · ${entry.category || 'system'} · ${message}`);
          }
          if (entries.length) observedLogs.set(connection.id, Math.max(previous || 0, ...entries.map((entry) => Number(entry.id) || 0)));
        } catch (_) { /* Status remains available even when remote logs are unavailable. */ }
      } catch (error) {
        payload = { connected: false, source: publicConnection(connection), error: error.message,
          lastSeen: cached?.payload.connected ? cached.payload.data.timestamp : cached?.payload.lastSeen || null };
      }
      if (!cached || cached.payload.connected !== payload.connected || cached.payload.error !== payload.error) {
        logger.info(`[dashboard] Bot ${connection.id} : ${payload.connected ? `connecté, ${payload.data.guilds.length} serveur(s) reçu(s)` : payload.error}`);
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
      const controlToken = String(input.controlToken || '');
      if (controlToken && (Buffer.byteLength(controlToken) < 32 || controlToken.length > 512 || /[\r\n]/.test(controlToken))) {
        send(response, 400, { error: 'Clé administrateur invalide (32 caractères minimum).' }); return;
      }
      if (!name || Buffer.byteLength(token) < 32 || token.length > 512 || /[\r\n]/.test(token)) {
        send(response, 400, { error: 'Nom et clé de diagnostic (32 caractères minimum) requis.' }); return;
      }
      if (connections.length >= 20) { send(response, 400, { error: 'Limite de 20 bots atteinte.' }); return; }
      const connection = { id: crypto.randomUUID(), name, url: normalizeRemoteUrl(input.url), token, controlToken, locked: true };
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
      const controlToken = input.controlToken ? String(input.controlToken) : connection.controlToken;
      if (controlToken && (Buffer.byteLength(controlToken) < 32 || controlToken.length > 512 || /[\r\n]/.test(controlToken))) {
        send(response, 400, { error: 'Clé administrateur invalide.' }); return;
      }
      if (!name || Buffer.byteLength(token) < 32 || token.length > 512 || /[\r\n]/.test(token)) {
        send(response, 400, { error: 'Nom ou clé de diagnostic invalide.' }); return;
      }
      const replacement = { id: connection.id, name, url: normalizeRemoteUrl(input.url), token, controlToken, locked: true };
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
    const restart = url.pathname.match(/^\/api\/bots\/([\w-]+)\/restart$/);
    if (restart && request.method === 'POST') {
      const connection = source(restart[1]);
      if (!connection?.controlToken) { send(response, 403, { error: 'Configure la clé administrateur du bot pour redémarrer.' }); return; }
      logger.info(`[dashboard] Ordre de redémarrage envoyé au bot ${connection.id}.`);
      const result = await remoteRequest(connection, 'restart', fetchImpl, { method: 'POST', control: true });
      logger.info(`[dashboard] Bot ${connection.id} : ordre accepté.`);
      send(response, 202, result); return;
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
      logger.warn(`[dashboard] Requête refusée : ${error.statusCode || 400}.`);
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
  const monitor = setInterval(() => { for (const connection of connections) void snapshot(connection); }, pollIntervalMs);
  monitor.unref();
  ready.then(() => { for (const connection of connections) void snapshot(connection); }, () => clearInterval(monitor));
  return { server, ready, close: async () => {
    clearInterval(monitor);
    for (const response of streams) response.end();
    await new Promise((resolve) => { server.close(resolve); server.closeIdleConnections(); });
  } };
}

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
  const dashboard = createLocalDashboard();
  dashboard.ready.then(({ url }) => {
    console.log(`Dashboard local : ${url}\nCtrl+clic sur le lien pour ouvrir le navigateur.\nJournaux du serveur local · Ctrl+C pour arrêter.`);
    if (process.env.DASHBOARD_OPEN_BROWSER !== '0') openBrowser(url);
  })
    .catch(async (error) => {
      const url = `http://127.0.0.1:${process.env.DASHBOARD_LOCAL_PORT || 3090}`;
      if (error.code === 'EADDRINUSE') {
        try {
          const response = await fetch(`${url}/api/bootstrap`, { signal: AbortSignal.timeout(2000) });
          const data = await response.json();
          if (response.ok && typeof data.csrfToken === 'string' && Array.isArray(data.connections)) {
            console.log(`Dashboard déjà lancé : ${url}\nCtrl+clic pour ouvrir le navigateur. Les logs restent dans sa fenêtre d'origine.`);
            if (process.env.DASHBOARD_OPEN_BROWSER !== '0') openBrowser(url);
            return;
          }
        } catch (_) {}
      }
      console.error(`Dashboard indisponible : ${error.message}\nLien : ${url}`); process.exitCode = 1;
    });
  process.once('SIGINT', () => { void dashboard.close(); });
  process.once('SIGTERM', () => { void dashboard.close(); });
}

module.exports = { createLocalDashboard, normalizeRemoteUrl, remoteRequest };
