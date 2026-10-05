/** Explicit installation only; upstream GPL code stays in private runtime storage. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { VERSION, COMMIT, PLUGIN_SHA256, installationPaths, installed, helperEnvironment } = require('../../features/music/youtubePoToken');
let pending;
function run(command, args, cwd, env, timeoutMs = 240_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: helperEnvironment(env), windowsHide: true });
    // Never surface upstream output: it can include configuration or signed URLs.
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => { child.kill(); reject(new Error('Installation PO token : délai dépassé.')); }, timeoutMs);
    child.once('error', () => { clearTimeout(timer); reject(new Error('Installation PO token : git/npm indisponible.')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('Installation PO token : étape refusée. Vérifie git, npm et les dépendances natives canvas.')); });
  });
}
async function install({ env = process.env, fetchImpl = globalThis.fetch, runImpl = run, log = console.info } = {}) {
  if (installed(env)) return { installed: true, version: VERSION };
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Le fournisseur PO token nécessite Node.js 22 ou plus.');
  const paths = installationPaths(env);
  await fs.mkdir(path.dirname(paths.root), { recursive: true, mode: 0o700 });
  const free = await fs.statfs(path.dirname(paths.root));
  if (Number(free.bavail) * Number(free.bsize) < 250 * 1024 * 1024) throw new Error('Installation PO token : au moins 250 MiB libres sont nécessaires.');
  const staging = await fs.mkdtemp(path.join(path.dirname(paths.root), 'install-'));
  let published = false;
  try {
  const provider = path.join(staging, 'provider');
  log('[youtube-pot] Installation de la version vérifiée 2.0.1 dans les données privées.');
  await runImpl('git', ['clone', '--depth', '1', '--branch', VERSION, '--single-branch',
    'https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git', provider], staging, env);
  const head = (await fs.readFile(path.join(provider, '.git', 'HEAD'), 'utf8')).trim();
  if (head !== COMMIT) throw new Error('Le commit du fournisseur ne correspond pas à la version approuvée.');
  const server = path.join(provider, 'server');
  if (process.platform === 'win32') {
    // Fixed command only, never built from user input.
    await runImpl('cmd.exe', ['/d', '/s', '/c', 'npm ci --no-audit --no-fund'], server, env);
  } else await runImpl('npm', ['ci', '--no-audit', '--no-fund'], server, env);
  await runImpl(process.execPath, [path.join(server, 'node_modules/typescript/bin/tsc')], server, env);
  await fs.access(path.join(server, 'build/main.js'));
  const url = `https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${VERSION}/bgutil-ytdlp-pot-provider.zip`;
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
  const host = new URL(response.url || url).hostname;
  if (!response.ok || new URL(response.url || url).protocol !== 'https:' || !(host === 'github.com' || host.endsWith('.githubusercontent.com'))
      || Number(response.headers.get('content-length')) > 64_000) throw new Error('Téléchargement du plugin PO token refusé.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 64_000 || crypto.createHash('sha256').update(bytes).digest('hex') !== PLUGIN_SHA256) throw new Error('Checksum du plugin PO token incorrect.');
  await fs.mkdir(path.join(staging, 'plugins'), { mode: 0o700 });
  await fs.writeFile(path.join(staging, 'plugins/bgutil.zip'), bytes, { mode: 0o600 });
  await fs.writeFile(path.join(staging, 'installed.json'), JSON.stringify({ commit: COMMIT, pluginSha256: PLUGIN_SHA256 }), { mode: 0o600 });
  await fs.rename(staging, paths.root);
  published = true;
  log('[youtube-pot] Installation terminée. Aucun cookie ni token de compte Google enregistré.');
  return { installed: true, version: VERSION };
  } finally {
    // Only this invocation's freshly-created staging directory is removable.
    // Never touch data, audio caches, an installed version or another attempt.
    if (!published && path.dirname(staging) === path.dirname(paths.root) && path.basename(staging).startsWith('install-')) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}
function installPoToken(options) {
  if (!pending) pending = install(options).finally(() => { pending = null; });
  return pending;
}
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  installPoToken().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { installPoToken };
