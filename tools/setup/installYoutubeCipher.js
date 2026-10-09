/** Installs pinned yt-cipher + Deno into private runtime data, never into Git. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inflateRawSync } = require('node:zlib');
const { spawn } = require('node:child_process');
const { VERSION, EJS_COMMIT, DENO_VERSION, installationPaths, installed, safeRoot } = require('../../features/music/youtubeCipher');
const { helperEnvironment } = require('../../features/music/youtubePoToken');

const DENO_ARCHIVE = {
  url: `https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip`,
  sha256: 'c6527f24f4b16031d3ae4fa9f658d5f11534c8d84ce7dc8502420280919c3490',
};
const CIPHER_REPOSITORY = 'https://github.com/kikkia/yt-cipher.git';
const EJS_REPOSITORY = 'https://github.com/yt-dlp/ejs.git';
const MAX_ARCHIVE_SIZE = 100 * 1024 * 1024;
const MAX_BINARY_SIZE = 160 * 1024 * 1024;
const MIN_FREE_BYTES = 300 * 1024 * 1024;
let pending;

function zipEntry(buffer, entryName = 'deno') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > MAX_ARCHIVE_SIZE) {
    throw new Error('Archive Deno invalide ou trop volumineuse.');
  }
  const eocdMin = Math.max(0, buffer.length - 65_557);
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < eocdMin || eocd + 22 > buffer.length) throw new Error('Archive Deno ZIP invalide.');
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entries !== 1 || centralOffset + 46 > eocd) throw new Error('Archive Deno inattendue.');
  const cursor = centralOffset;
  if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Archive Deno ZIP invalide.');
  const flags = buffer.readUInt16LE(cursor + 8);
  const method = buffer.readUInt16LE(cursor + 10);
  const compressedSize = buffer.readUInt32LE(cursor + 20);
  const uncompressedSize = buffer.readUInt32LE(cursor + 24);
  const nameLength = buffer.readUInt16LE(cursor + 28);
  const extraLength = buffer.readUInt16LE(cursor + 30);
  const commentLength = buffer.readUInt16LE(cursor + 32);
  const localOffset = buffer.readUInt32LE(cursor + 42);
  const nameEnd = cursor + 46 + nameLength;
  if (nameEnd + extraLength + commentLength > eocd || buffer.toString('utf8', cursor + 46, nameEnd) !== entryName
      || (flags & 1) || ![0, 8].includes(method) || !uncompressedSize || uncompressedSize > MAX_BINARY_SIZE
      || compressedSize > MAX_ARCHIVE_SIZE || localOffset + 30 > centralOffset
      || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Archive Deno contient une entrée inattendue.');
  const localNameLength = buffer.readUInt16LE(localOffset + 26);
  const localExtraLength = buffer.readUInt16LE(localOffset + 28);
  if (buffer.readUInt16LE(localOffset + 6) !== flags || buffer.readUInt16LE(localOffset + 8) !== method
      || buffer.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) !== entryName) {
    throw new Error('En-tête du binaire Deno incohérent.');
  }
  const dataStart = localOffset + 30 + localNameLength + localExtraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > centralOffset) throw new Error('Archive Deno tronquée.');
  const compressed = buffer.subarray(dataStart, dataEnd);
  let output;
  try { output = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: MAX_BINARY_SIZE }); }
  catch { throw new Error('Extraction du binaire Deno impossible.'); }
  if (output.length !== uncompressedSize) throw new Error('Taille du binaire Deno incorrecte.');
  return output;
}

async function downloadDeno(fetchImpl, asset = DENO_ARCHIVE) {
  const response = await fetchImpl(asset.url, { signal: AbortSignal.timeout(90_000), redirect: 'follow' });
  const finalUrl = new URL(response.url || asset.url);
  if (!response.ok || finalUrl.protocol !== 'https:'
      || !(finalUrl.hostname === 'github.com' || finalUrl.hostname.endsWith('.githubusercontent.com'))) {
    throw new Error('Téléchargement officiel du binaire Deno refusé.');
  }
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ARCHIVE_SIZE) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Archive Deno trop volumineuse.');
  }
  if (!response.body) throw new Error('Archive Deno vide.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARCHIVE_SIZE) {
        await reader.cancel().catch(() => {});
        throw new Error('Archive Deno trop volumineuse.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const archive = Buffer.concat(chunks, size);
  if (archive.length > MAX_ARCHIVE_SIZE || crypto.createHash('sha256').update(archive).digest('hex') !== asset.sha256) {
    throw new Error('Checksum officiel du binaire Deno incorrect.');
  }
  return zipEntry(archive);
}

function commandEnvironment(env, denoDir) {
  return { ...helperEnvironment(env), DENO_DIR: denoDir };
}

function run(command, args, cwd, env, { capture = false, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    let timedOut = false;
    let killTimer = null;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (error) reject(error); else resolve(output.trim());
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 3000);
      killTimer.unref();
    }, timeoutMs);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      if (capture) output = (output + chunk.toString('utf8')).slice(-1024);
    });
    child.once('error', () => finish(new Error('Git ou Deno indisponible sur cet hôte.')));
    child.once('exit', code => finish(timedOut
      ? new Error('Installation yt-cipher : délai dépassé.')
      : code === 0 ? null : new Error('Installation yt-cipher refusée; l’installation existante est conservée.')));
  });
}

async function checkoutPinnedRepository(repoPath, url, commit, staging, env, runImpl) {
  await fs.mkdir(repoPath, { recursive: false, mode: 0o700 });
  await runImpl('git', ['init', '--quiet', repoPath], staging, env);
  await runImpl('git', ['-C', repoPath, 'remote', 'add', 'origin', url], staging, env);
  await runImpl('git', ['-C', repoPath, 'fetch', '--quiet', '--depth=1', 'origin', commit], staging, env);
  await runImpl('git', ['-C', repoPath, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], staging, env);
  const actual = await runImpl('git', ['-C', repoPath, 'rev-parse', 'HEAD'], staging, env, { capture: true });
  if (actual !== commit) throw new Error('Le commit yt-cipher téléchargé ne correspond pas à la version approuvée.');
}

async function install({ env = process.env, fetchImpl = globalThis.fetch, runImpl = run, log = console.info,
  denoArchive = DENO_ARCHIVE,
  platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'linux' || arch !== 'x64') throw new Error('Le résolveur yt-cipher géré nécessite l’hôte Linux x64.');
  if (installed(env)) return { installed: true, version: VERSION, password: require('../../features/music/youtubeCipher').readConnection(installationPaths(env).root).password };
  const paths = installationPaths(env);
  const parent = path.dirname(paths.root);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  if (await fs.lstat(paths.root).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    throw new Error('Une installation yt-cipher partielle existe déjà; aucune donnée n’a été écrasée.');
  }
  const free = await fs.statfs(parent);
  if (Number(free.bavail) * Number(free.bsize) < MIN_FREE_BYTES) throw new Error('Installation yt-cipher : 300 MiB libres nécessaires.');
  const staging = await fs.mkdtemp(path.join(parent, 'yt-cipher-install-'));
  let published = false;
  try {
    const stagingSource = path.join(staging, 'source');
    const stagingEjs = path.join(stagingSource, 'ejs');
    const stagingDeno = path.join(staging, 'deno');
    const stagingDenoCache = path.join(staging, 'deno-cache');
    const stagingCache = path.join(staging, 'cache');
    await fs.mkdir(stagingDenoCache, { mode: 0o700 });
    await fs.mkdir(stagingCache, { mode: 0o700 });
    await fs.mkdir(path.join(staging, 'home'), { mode: 0o700 });
    log('[youtube-cipher-setup] Téléchargement du runtime Deno vérifié et des sources yt-cipher/EJS épinglées; données stockées hors Git.');
    const denoBinary = await downloadDeno(fetchImpl, denoArchive);
    await fs.writeFile(stagingDeno, denoBinary, { mode: 0o700, flag: 'wx' });
    await fs.chmod(stagingDeno, 0o700);

    const childEnv = commandEnvironment(env, stagingDenoCache);
    log('[youtube-cipher-setup] Runtime Deno téléchargé et vérifié; récupération de la source yt-cipher épinglée.');
    await checkoutPinnedRepository(stagingSource, CIPHER_REPOSITORY, VERSION, staging, childEnv, runImpl);
    log('[youtube-cipher-setup] Source yt-cipher récupérée; récupération de la dépendance EJS épinglée.');
    await checkoutPinnedRepository(stagingEjs, EJS_REPOSITORY, EJS_COMMIT, staging, childEnv, runImpl);
    await fs.access(path.join(stagingSource, 'server.ts'));
    await fs.access(path.join(stagingSource, 'scripts', 'patch-ejs.ts'));
    await fs.access(path.join(stagingEjs, 'src', 'yt', 'solver', 'solvers.ts'));

    const patchArgs = ['run', '--allow-net=deno.land', `--allow-read=${staging}`, `--allow-write=${staging}`,
      '--allow-env=DENO_DIR', 'scripts/patch-ejs.ts'];
    log('[youtube-cipher-setup] Application du correctif EJS requis par yt-cipher.');
    await runImpl(stagingDeno, patchArgs, stagingSource, childEnv, { timeoutMs: 120_000 });
    log('[youtube-cipher-setup] Préchargement des dépendances Deno avant le démarrage du bot.');
    await runImpl(stagingDeno, ['cache', 'server.ts', 'worker.ts'], stagingSource, childEnv, { timeoutMs: 180_000 });

    const password = crypto.randomBytes(32).toString('hex');
    await fs.writeFile(path.join(staging, 'connection.json'), JSON.stringify({ port: 8001, password }), { mode: 0o600, flag: 'wx' });
    await fs.writeFile(path.join(staging, 'installed.json'), JSON.stringify({ commit: VERSION, ejsCommit: EJS_COMMIT,
      denoVersion: DENO_VERSION, denoSha256: denoArchive.sha256 }), { mode: 0o600, flag: 'wx' });
    await fs.chmod(staging, 0o700);
    await fs.rename(staging, paths.root);
    published = true;
    log('[youtube-cipher-setup] Runtime installé. Secret privé généré; aucun cookie, refresh token ou flux audio n’a été transmis à un tiers.');
    return { installed: true, version: VERSION, password };
  } finally {
    if (!published && path.dirname(staging) === parent && path.basename(staging).startsWith('yt-cipher-install-')) {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function installYoutubeCipher(options) {
  if (!pending) pending = install(options).finally(() => { pending = null; });
  return pending;
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  installYoutubeCipher().then(() => console.info('yt-cipher installé dans les données privées.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { DENO_ARCHIVE, CIPHER_REPOSITORY, EJS_REPOSITORY, zipEntry, downloadDeno,
  checkoutPinnedRepository, installYoutubeCipher };
