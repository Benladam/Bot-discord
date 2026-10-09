/** Installation explicite sur l'hôte du bot, artefacts et secrets hors Git. */
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { VERSION, PLUGIN_VERSION, PORT, installationPaths, connectionConfig } = require('../../features/music/lavalinkRuntime');
const { helperEnvironment } = require('../../features/music/youtubePoToken');
const ASSETS = {
  lavalink: { url: `https://github.com/lavalink-devs/Lavalink/releases/download/${VERSION}/Lavalink.jar`,
    sha256: '8cb801e591072c3689fafd71ccf571a95a4ead3cc35dfc045e157d763d89119a' },
  youtube: { url: `https://github.com/lavalink-devs/youtube-source/releases/download/${PLUGIN_VERSION}/youtube-plugin-${PLUGIN_VERSION}.jar`,
    sha256: 'dd4b3bce50dbc7582c80776bad47bad87bef1dc683c69d66ab4a084aa3006238' },
  jre: { url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz',
    sha256: '2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500' },
};
async function download(asset, target, fetchImpl) {
  const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(120_000), redirect: 'follow' });
  const resolved = new URL(response.url || asset.url);
  if (!response.ok || !response.body || resolved.protocol !== 'https:'
      || !(resolved.hostname === 'github.com' || resolved.hostname.endsWith('.githubusercontent.com'))) {
    throw new Error('Téléchargement officiel Lavalink refusé.');
  }
  const hash = crypto.createHash('sha256'); let size = 0;
  await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _encoding, next) {
    size += chunk.length;
    if (size > 200 * 1024 * 1024) return next(new Error('Artefact Lavalink trop volumineux.'));
    hash.update(chunk); next(null, chunk);
  } }), createWriteStream(target, { flags: 'wx', mode: 0o600 }));
  if (hash.digest('hex') !== asset.sha256) throw new Error('Checksum officiel Lavalink incorrect.');
}
function run(command, args, cwd, env, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: helperEnvironment(env), windowsHide: true });
    let output = ''; let settled = false;
    const finish = (error) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(output);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('Installation Java : délai dépassé.')); }, 120_000);
    for (const source of [child.stdout, child.stderr]) source.on('data', chunk => {
      if (capture) output = (output + chunk.toString()).slice(0, 2048);
    });
    child.once('error', () => finish(new Error('Java ou tar indisponible sur cet hôte.')));
    child.once('exit', code => finish(code === 0 ? null : new Error('Installation Java refusée.')));
  });
}
function applicationConfig(password) {
  return `server:
  port: ${PORT}
  address: 127.0.0.1
lavalink:
  pluginsDir: ./plugins
  server:
    password: ${JSON.stringify(password)}
    sources:
      youtube: false
      soundcloud: false
      http: false
      local: false
      bandcamp: false
      twitch: false
      vimeo: false
      nico: false
    opusEncodingQuality: 10
    resamplingQuality: HIGH
    timeouts:
      connectTimeoutMs: 3000
      connectionRequestTimeoutMs: 3000
      socketTimeoutMs: 10000
plugins:
  youtube:
    enabled: true
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: false
    clients:
      - MUSIC
      - ANDROID_VR
      - WEB
      - WEBEMBEDDED
logging:
  level:
    root: WARN
  request:
    enabled: false
`;
}
let pending;
async function install({ env = process.env, fetchImpl = globalThis.fetch, runImpl = run, log = console.info } = {}) {
  if (env.LAVALINK_MODE === 'off') throw new Error('LAVALINK_MODE=off : retire ce réglage pour essayer Lavalink.');
  if (connectionConfig(env)) return { installed: true, version: VERSION };
  const files = installationPaths(env);
  const parent = path.dirname(files.root);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const free = await fs.statfs(parent);
  if (Number(free.bavail) * Number(free.bsize) < 600 * 1024 * 1024) throw new Error('Installation Lavalink : 600 MiB libres nécessaires.');
  const staging = await fs.mkdtemp(path.join(parent, 'install-'));
  let published = false;
  try {
    let java = env.LAVALINK_JAVA_PATH || 'java'; let validJava = false;
    try {
      const version = await runImpl(java, ['-version'], staging, env, { capture: true });
      validJava = Number(version.match(/version "(\d+)/)?.[1]) >= 17;
    } catch { /* Une JRE portable peut être installée sur Linux. */ }
    if (!validJava) {
      if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Installe Java 17+ ou configure LAVALINK_JAVA_PATH sur cet hôte.');
      log('[lavalink-setup] Installation de Java 21 portable, sans root ni changement du conteneur.');
      const archive = path.join(staging, 'jre.tar.gz');
      await download(ASSETS.jre, archive, fetchImpl);
      await fs.mkdir(path.join(staging, 'jre'), { mode: 0o700 });
      await runImpl('tar', ['-xzf', archive, '--strip-components=1', '-C', path.join(staging, 'jre')], staging, env);
      await fs.unlink(archive);
      await runImpl(path.join(staging, 'jre/bin/java'), ['-version'], staging, env, { capture: true });
      java = path.join(files.root, 'jre/bin/java');
    }
    log(`[lavalink-setup] Téléchargement Lavalink ${VERSION} et youtube-plugin ${PLUGIN_VERSION}; checksums SHA-256 vérifiés.`);
    await fs.mkdir(path.join(staging, 'plugins'), { mode: 0o700 });
    await download(ASSETS.lavalink, path.join(staging, 'Lavalink.jar'), fetchImpl);
    await download(ASSETS.youtube, path.join(staging, 'plugins', `youtube-plugin-${PLUGIN_VERSION}.jar`), fetchImpl);
    const password = crypto.randomBytes(32).toString('hex');
    await fs.writeFile(path.join(staging, 'application.yml'), applicationConfig(password), { mode: 0o600 });
    await fs.writeFile(path.join(staging, 'connection.json'), JSON.stringify({ password, java }), { mode: 0o600 });
    await fs.writeFile(path.join(staging, 'installed.json'), JSON.stringify({ version: VERSION, pluginVersion: PLUGIN_VERSION }), { mode: 0o600 });
    await fs.rename(staging, files.root); published = true;
    log('[lavalink-setup] Installation privée terminée; aucun cookie transmis, port accessible seulement sur loopback.');
    return { installed: true, version: VERSION };
  } finally {
    // Suppression limitée au répertoire unique créé par cette invocation.
    if (!published && path.dirname(staging) === parent && path.basename(staging).startsWith('install-')) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}
function installLavalink(options) {
  if (!pending) pending = install(options).finally(() => { pending = null; });
  return pending;
}
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  installLavalink().catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { installLavalink, applicationConfig, ASSETS };
