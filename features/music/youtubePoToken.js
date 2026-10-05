/** Private, opt-in bgutil helper. No account token is accepted or persisted here. */
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { getDataDirectory } = require('./ytDlp');

const VERSION = '2.0.1';
const COMMIT = '2df09aeaa71a4eec1e31901e84fbddbf0c7c54a9';
const PLUGIN_SHA256 = '6fc9d757578949ba3cad2f561f57dfbc16142dbf8d485fe1bf9f0733f23bf9e3';
function installationPaths(env = process.env) {
  const root = path.join(getDataDirectory({ env }), '.cache', 'youtube-pot', VERSION);
  return { root, entry: path.join(root, 'provider', 'server', 'build', 'main.js'),
    plugins: path.join(root, 'plugins'), manifest: path.join(root, 'installed.json') };
}
function installed(env = process.env) {
  const paths = installationPaths(env);
  try {
    const record = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
    return record.commit === COMMIT && record.pluginSha256 === PLUGIN_SHA256
      && fs.existsSync(paths.entry) && fs.existsSync(path.join(paths.plugins, 'bgutil.zip'));
  } catch { return false; }
}
function helperEnvironment(env) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL|SSL_CERT_FILE|SSL_CERT_DIR)$/i;
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.test(key)));
}
function poTokenArgs(config, playerClient) {
  if (!config?.ready) return [];
  return ['--no-plugin-dirs', '--plugin-dirs', config.plugins,
    '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
    ...(!playerClient ? ['--extractor-args', 'youtube:player_client=mweb'] : [])];
}

class PoTokenProvider {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, forkImpl = fork,
    isInstalled = installed, log = console.info } = {}) {
    Object.assign(this, { env, fetchImpl, forkImpl, isInstalled, log });
    this.child = null; this.pending = null; this.ready = false; this.retryAt = 0;
  }
  status() {
    return { enabled: this.env.YOUTUBE_PO_TOKEN_MODE !== 'off' && this.isInstalled(this.env), ready: this.ready, version: VERSION };
  }
  async ping() {
    try {
      const response = await this.fetchImpl('http://127.0.0.1:4416/ping', { signal: AbortSignal.timeout(800), redirect: 'error' });
      return response.ok && (await response.json()).version === VERSION;
    } catch { return false; }
  }
  async ensure() {
    if (!this.status().enabled || Date.now() < this.retryAt) return null;
    if (this.ready) return { ready: true, plugins: installationPaths(this.env).plugins };
    if (this.pending) return this.pending;
    this.pending = this.start().finally(() => { this.pending = null; });
    return this.pending;
  }
  async start() {
    const paths = installationPaths(this.env);
    try {
      if (!await this.ping()) {
        const worker = path.resolve(__dirname, '../../tools/setup/poTokenWorker.mjs');
        this.child = this.forkImpl(worker, [paths.entry], { windowsHide: true,
          execArgv: ['--max-old-space-size=256'], env: helperEnvironment(this.env),
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        const child = this.child;
        child.on('error', () => { if (this.child === child) this.ready = false; });
        child.on('exit', () => { if (this.child === child) { this.child = null; this.ready = false; } });
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline && this.child && !await this.ping()) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (!this.child || !await this.ping()) throw new Error('HELPER_UNAVAILABLE');
      }
      this.ready = true;
      this.log('[youtube-pot] Fournisseur privé prêt (loopback). Acceptation par YouTube non vérifiée.');
      return { ready: true, plugins: paths.plugins };
    } catch {
      this.stop(); this.retryAt = Date.now() + 30_000;
      this.log('[youtube-pot] Fournisseur indisponible; repli musical habituel conservé.');
      return null;
    }
  }
  stop() { this.ready = false; const child = this.child; this.child = null; child?.kill(); }
}
const provider = new PoTokenProvider();
process.once('exit', () => provider.stop());
module.exports = { VERSION, COMMIT, PLUGIN_SHA256, installationPaths, installed, helperEnvironment,
  poTokenArgs, PoTokenProvider, ensurePoToken: () => provider.ensure(), poTokenStatus: () => provider.status(),
  currentPoTokenConfig: () => provider.ready ? { ready: true, plugins: installationPaths().plugins } : null };
