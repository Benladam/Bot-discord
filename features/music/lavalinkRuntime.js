/** Lavalink privé et optionnel : ne télécharge rien au démarrage du bot. */
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { getDataDirectory } = require('./ytDlp');
const { helperEnvironment } = require('./youtubePoToken');

const VERSION = '4.2.2';
const PLUGIN_VERSION = '1.18.2';
const PORT = 2333;
function installationPaths(env = process.env) {
  const root = path.join(getDataDirectory({ env }), '.cache', 'lavalink', VERSION);
  return { root, jar: path.join(root, 'Lavalink.jar'), manifest: path.join(root, 'installed.json'),
    config: path.join(root, 'connection.json'), application: path.join(root, 'application.yml') };
}
function readLocalConnection(env) {
  const files = installationPaths(env);
  try {
    const record = JSON.parse(fs.readFileSync(files.manifest, 'utf8'));
    const config = JSON.parse(fs.readFileSync(files.config, 'utf8'));
    if (record.version !== VERSION || record.pluginVersion !== PLUGIN_VERSION || !fs.existsSync(files.jar)
        || !fs.existsSync(path.join(files.root, 'plugins', `youtube-plugin-${PLUGIN_VERSION}.jar`))
        || typeof config.password !== 'string' || config.password.length < 32) return null;
    return { url: `http://127.0.0.1:${PORT}`, password: config.password, java: config.java };
  } catch { return null; }
}
function connectionConfig(env = process.env) {
  if (env.LAVALINK_MODE === 'off') return null;
  if (env.LAVALINK_URL) {
    const url = new URL(env.LAVALINK_URL);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
        || !['http:', 'https:'].includes(url.protocol) || url.protocol === 'http:' && !local
        || !env.LAVALINK_PASSWORD) throw new Error('Lavalink : URL HTTPS et mot de passe requis (HTTP réservé au loopback).');
    return { url: url.origin, password: env.LAVALINK_PASSWORD, external: true };
  }
  return readLocalConnection(env);
}

class LavalinkRuntime {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, forkImpl = fork, log = console.info } = {}) {
    Object.assign(this, { env, fetchImpl, forkImpl, log });
    this.child = null; this.pending = null; this.retryAt = 0;
  }
  configured() { return Boolean(connectionConfig(this.env)); }
  async ping(config) {
    try {
      const response = await this.fetchImpl(`${config.url}/v4/info`, { headers: { Authorization: config.password },
        signal: AbortSignal.timeout(1000), redirect: 'error' });
      const info = response.ok ? await response.json() : null;
      return info?.version?.semver?.startsWith('4.') && info.plugins?.some(plugin => plugin.name === 'youtube-plugin');
    } catch { return false; }
  }
  async ensure() {
    const config = connectionConfig(this.env);
    if (!config) throw Object.assign(new Error('Lavalink non configuré. Lance musiccheck setup-lavalink sur cet hôte.'), { code: 'LAVALINK_NOT_CONFIGURED' });
    if (this.pending) return this.pending;
    if (Date.now() < this.retryAt) throw Object.assign(new Error('Lavalink temporairement indisponible.'), { code: 'LAVALINK_UNAVAILABLE' });
    this.pending = this.start(config).finally(() => { this.pending = null; });
    return this.pending;
  }
  async start(config) {
    if (await this.ping(config)) return config;
    if (config.external) throw Object.assign(new Error('Le serveur Lavalink ne répond pas ou son plugin YouTube est absent.'), { code: 'LAVALINK_UNAVAILABLE' });
    if (!this.child) {
      const files = installationPaths(this.env);
      const cipherFiles = require('./youtubeCipher').installationPaths(this.env);
      this.child = this.forkImpl(path.resolve(__dirname, '../../tools/setup/lavalinkWorker.js'),
        [files.root, config.java || 'java', cipherFiles.root], {
        windowsHide: true, execArgv: [], env: helperEnvironment(this.env), stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      const child = this.child;
      child.on('error', () => { if (this.child === child) this.child = null; });
      child.on('exit', () => { if (this.child === child) this.child = null; });
      child.on('message', message => {
        if (message?.type === 'oauth-device' && typeof message.url === 'string'
            && /^https:\/\/(?:[a-z0-9-]+\.)*(?:google\.com|youtube\.com)\//i.test(message.url)
            && /^[A-Z0-9-]{6,20}$/.test(message.code || '')) {
          this.log(`[youtube-oauth] Ouvre ${message.url} et saisis le code ${message.code} avec ton compte jetable.`);
          return;
        }
        if (message?.type === 'diagnostic' && /^[A-Z0-9_ :.-]{1,120}$/.test(message.text || '')) {
          const detail = typeof message.detail === 'string'
            && /^[A-Za-z0-9_.: -]{1,140}$/.test(message.detail) ? `: ${message.detail}` : '';
          this.log(`[lavalink] ${message.text}${detail}`);
        }
      });
    }
    const deadline = Date.now() + 60_000;
    while (this.child && Date.now() < deadline) {
      if (await this.ping(config)) {
        this.log(`[lavalink] Lavalink ${VERSION} et plugin YouTube prêts sur loopback; lecture à vérifier.`);
        return config;
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    this.stop(); this.retryAt = Date.now() + 30_000;
    throw Object.assign(new Error('Démarrage Lavalink impossible. Vérifie Java 17+ et la mémoire disponible sur cet hôte.'), { code: 'LAVALINK_START_FAILED' });
  }
  async restart() {
    const config = connectionConfig(this.env);
    if (!config || config.external) throw new Error('OAuth Lavalink exige le service privé installé sur cet hôte.');
    const child = this.child;
    if (child) {
      this.child = null;
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && await this.ping(config)) await new Promise(resolve => setTimeout(resolve, 200));
      if (await this.ping(config)) throw new Error('L’ancien processus Lavalink répond encore; OAuth n’a pas été redémarré.');
    }
    this.retryAt = 0;
    return this.ensure();
  }
  stop() { const child = this.child; this.child = null; child?.kill(); }
}
const runtime = new LavalinkRuntime();
process.once('exit', () => runtime.stop());
module.exports = { VERSION, PLUGIN_VERSION, PORT, installationPaths, connectionConfig, LavalinkRuntime,
  lavalinkConfigured: () => runtime.configured(), ensureLavalink: () => runtime.ensure(), restartLavalink: () => runtime.restart() };
