/** Télécharge et vérifie le binaire officiel yt-dlp quand l'hôte n'en fournit pas. */
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const RELEASE_BASE = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;

function isMuslRuntime(platform) {
  if (platform !== 'linux' || platform !== process.platform || !process.report?.getReport) return false;
  try { return !process.report.getReport().header.glibcVersionRuntime; } catch { return false; }
}

function releaseAsset(platform = process.platform, arch = process.arch, musl = isMuslRuntime(platform)) {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'yt-dlp_arm64.exe';
    if (arch === 'x64') return 'yt-dlp.exe';
  }
  if (platform === 'linux') {
    if (musl && arch === 'arm64') return 'yt-dlp_musllinux_aarch64';
    if (musl && arch === 'x64') return 'yt-dlp_musllinux';
    if (arch === 'arm64') return 'yt-dlp_linux_aarch64';
    if (arch === 'x64') return 'yt-dlp_linux';
  }
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return 'yt-dlp_macos';
  throw new Error(`Installation automatique de yt-dlp non prise en charge sur ${platform}/${arch}. Configure YTDLP_PATH.`);
}

function getDataDirectory({ env = process.env, platform = process.platform, homeDir = os.homedir() } = {}) {
  if (env.BOT_DATA_DIR) return path.resolve(env.BOT_DATA_DIR);
  if (platform === 'win32') {
    return path.join(env.APPDATA || env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'bot-discord');
  }
  return path.resolve(__dirname, '..', '..', 'data');
}

function parseChecksum(manifest, asset) {
  for (const line of String(manifest).split(/\r?\n/)) {
    const match = line.trim().match(/^([a-f\d]{64})\s+\*?(.+)$/i);
    if (match && path.posix.basename(match[2].trim()) === asset) return match[1].toLowerCase();
  }
  throw new Error(`Le checksum SHA-256 officiel de ${asset} est absent.`);
}

async function fetchBytes(fetchImpl, url, maxBytes) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: { 'user-agent': 'Bot-discord yt-dlp bootstrap' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Téléchargement yt-dlp refusé (HTTP ${response.status}).`);

  const finalUrl = new URL(response.url || url);
  if (finalUrl.protocol !== 'https:'
      || (finalUrl.hostname !== 'github.com' && !finalUrl.hostname.endsWith('.githubusercontent.com'))) {
    throw new Error('Le téléchargement yt-dlp a quitté les hôtes GitHub autorisés.');
  }

  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error('Le fichier yt-dlp dépasse la taille autorisée.');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Réponse de téléchargement yt-dlp vide ou trop volumineuse.');
  return bytes;
}

async function ensureManagedYtDlp({
  platform = process.platform,
  arch = process.arch,
  musl,
  dataDir = getDataDirectory({ platform }),
  fetchImpl = globalThis.fetch,
} = {}) {
  const asset = releaseAsset(platform, arch, musl);
  const binaryName = platform === 'win32' ? asset : 'yt-dlp';
  const directory = path.join(dataDir, '.cache', 'yt-dlp');
  const destination = path.join(directory, binaryName);

  try {
    const existing = await fs.stat(destination);
    if (existing.isFile() && existing.size > 0) return destination;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (typeof fetchImpl !== 'function') throw new Error('Node.js fetch indisponible : impossible d’installer yt-dlp automatiquement.');

  const assetUrl = `${RELEASE_BASE}/${asset}`;
  const sumsUrl = `${RELEASE_BASE}/SHA2-256SUMS`;
  const [manifestBytes, binaryBytes] = await Promise.all([
    fetchBytes(fetchImpl, sumsUrl, 1024 * 1024),
    fetchBytes(fetchImpl, assetUrl, MAX_DOWNLOAD_BYTES),
  ]);
  const expectedHash = parseChecksum(manifestBytes.toString('utf8'), asset);
  const actualHash = crypto.createHash('sha256').update(binaryBytes).digest('hex');
  if (actualHash !== expectedHash) throw new Error('Le checksum du binaire yt-dlp téléchargé ne correspond pas au checksum officiel.');

  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  if (platform !== 'win32') await fs.chmod(directory, 0o700);
  const temporary = path.join(directory, `${binaryName}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.writeFile(temporary, binaryBytes, { flag: 'wx', mode: 0o755 });
    if (platform !== 'win32') await fs.chmod(temporary, 0o755);
    try {
      await fs.rename(temporary, destination);
    } catch (error) {
      // Un autre processus peut avoir terminé le même téléchargement entre-temps.
      const concurrent = await fs.stat(destination).catch(() => null);
      if (!concurrent?.isFile() || concurrent.size === 0) throw error;
      await fs.rm(temporary, { force: true });
    }
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }

  return destination;
}

module.exports = { ensureManagedYtDlp, getDataDirectory, parseChecksum, releaseAsset };
