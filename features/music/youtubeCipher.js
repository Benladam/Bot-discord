/** Versioned, private yt-cipher sidecar used only by the local Lavalink worker. */
const fs = require('node:fs');
const path = require('node:path');
const { getDataDirectory } = require('./ytDlp');

const VERSION = '1e1fd8e2f34ca90cf23545be72e46307bd3d3d2a';
const EJS_COMMIT = 'cd4e87f52e87ab6d8b318fd3a817adda6fafa8dc';
const DENO_VERSION = '2.9.7';
const PORT = 8001;
const URL = `http://127.0.0.1:${PORT}`;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const LAVALINK_VERSION = '4.2.2';

function installationPaths(env = process.env) {
  const root = path.join(getDataDirectory({ env }), '.cache', 'youtube-cipher', VERSION);
  return { root, source: path.join(root, 'source'), ejs: path.join(root, 'source', 'ejs'),
    deno: path.join(root, 'deno'), denoCache: path.join(root, 'deno-cache'), cache: path.join(root, 'cache'),
    connection: path.join(root, 'connection.json'), manifest: path.join(root, 'installed.json') };
}

function safeRoot(root) {
  const resolved = path.resolve(String(root || ''));
  if (!path.isAbsolute(String(root || '')) || path.basename(resolved) !== VERSION
      || path.basename(path.dirname(resolved)) !== 'youtube-cipher'
      || path.basename(path.dirname(path.dirname(resolved))) !== '.cache') {
    throw new Error('Chemin yt-cipher privé invalide.');
  }
  return resolved;
}

function lavalinkConfigPath(root) {
  const resolved = path.resolve(String(root || ''));
  if (!path.isAbsolute(String(root || '')) || path.basename(resolved) !== LAVALINK_VERSION
      || path.basename(path.dirname(resolved)) !== 'lavalink'
      || path.basename(path.dirname(path.dirname(resolved))) !== '.cache') {
    throw new Error('Chemin d’installation Lavalink invalide.');
  }
  const configPath = path.join(resolved, 'application.yml');
  if (!fs.statSync(configPath).isFile()) throw new Error('Configuration Lavalink introuvable.');
  return configPath;
}

function readConnection(root) {
  let resolved;
  try { resolved = safeRoot(root); } catch { return null; }
  const paths = installationPaths({ BOT_DATA_DIR: path.resolve(resolved, '..', '..', '..') });
  if (paths.root !== resolved) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(paths.manifest, 'utf8'));
    const connection = JSON.parse(fs.readFileSync(paths.connection, 'utf8'));
    if (manifest.commit !== VERSION || manifest.ejsCommit !== EJS_COMMIT || manifest.denoVersion !== DENO_VERSION
        || !/^[a-f0-9]{64}$/.test(manifest.denoSha256 || '')
        || connection.port !== PORT || !TOKEN_PATTERN.test(connection.password || '')
        || !fs.statSync(paths.deno).isFile() || !fs.statSync(path.join(paths.source, 'server.ts')).isFile()
        || !fs.statSync(path.join(paths.ejs, 'src', 'yt', 'solver', 'solvers.ts')).isFile()) return null;
    return { password: connection.password, port: PORT };
  } catch { return null; }
}

function installed(env = process.env) {
  const paths = installationPaths(env);
  return Boolean(readConnection(paths.root));
}

function readRemoteCipherBlock(lines) {
  const index = lines.indexOf('    remoteCipher:');
  if (index < 0) return null;
  const endIndex = lines.findIndex((line, row) => row > index && /^    [A-Za-z][A-Za-z0-9_-]*:/.test(line));
  const end = endIndex < 0 ? lines.length : endIndex;
  const block = lines.slice(index + 1, end);
  const field = name => {
    const line = block.find(value => new RegExp(`^      ${name}:`).test(value));
    if (!line) return null;
    const value = line.replace(new RegExp(`^      ${name}:\\s*`), '');
    try { return JSON.parse(value); } catch { return value.replace(/^['"]|['"]$/g, ''); }
  };
  return { index, end, url: field('url'), password: field('password') };
}

function canConfigureLavalinkCipher(lavalinkRoot) {
  const configPath = lavalinkConfigPath(lavalinkRoot);
  const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
  const block = readRemoteCipherBlock(lines);
  return !block || (block.url === URL && typeof block.password === 'string' && TOKEN_PATTERN.test(block.password));
}

function enableLavalinkRemoteCipher(lavalinkRoot, password) {
  if (!TOKEN_PATTERN.test(password || '')) throw new Error('Secret yt-cipher invalide; configuration Lavalink conservée.');
  const configPath = lavalinkConfigPath(lavalinkRoot);
  const original = fs.readFileSync(configPath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const pluginIndex = lines.indexOf('plugins:');
  if (pluginIndex < 0 || lines[pluginIndex + 1] !== '  youtube:') {
    throw new Error('Structure YouTube inattendue; configuration privée conservée.');
  }
  const pluginEnd = lines.findIndex((line, index) => index > pluginIndex && line && !/^\s|^#/.test(line));
  const end = pluginEnd < 0 ? lines.length : pluginEnd;
  const existing = readRemoteCipherBlock(lines.slice(0, end));
  if (existing) {
    if (existing.url === URL && existing.password === password) {
      return { configPath, changed: false, alreadyConfigured: true };
    }
    throw new Error('Un autre remoteCipher est déjà configuré; il a été conservé sans modification.');
  }
  const enabledIndex = lines.findIndex((line, index) => index > pluginIndex && index < end && line === '    enabled: true');
  if (enabledIndex < 0) throw new Error('Source YouTube introuvable; configuration privée conservée.');
  lines.splice(enabledIndex + 1, 0,
    '    remoteCipher:',
    `      url: ${JSON.stringify(URL)}`,
    `      password: ${JSON.stringify(password)}`,
    '      userAgent: "HeussBot"');
  const updated = lines.join(eol) + eol;
  const temp = `${configPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temp, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.chmodSync(temp, 0o600);
    fs.renameSync(temp, configPath);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch {}
    throw error;
  }
  return { configPath, changed: true, alreadyConfigured: false };
}

function isConfigured(lavalinkRoot, cipherRoot) {
  try {
    const resolvedRoot = safeRoot(cipherRoot);
    const connection = readConnection(resolvedRoot);
    if (!connection) return false;
    const lines = fs.readFileSync(lavalinkConfigPath(lavalinkRoot), 'utf8').split(/\r?\n/);
    const block = readRemoteCipherBlock(lines);
    return block?.url === URL && block.password === connection.password;
  } catch { return false; }
}

function runtimeEnvironment(root, password, env = process.env) {
  const resolved = safeRoot(root);
  const paths = installationPaths({ BOT_DATA_DIR: path.resolve(resolved, '..', '..', '..') });
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|LANG|LC_ALL|SSL_CERT_FILE|SSL_CERT_DIR)$/i;
  const base = Object.fromEntries(Object.entries(env).filter(([key]) => allowed.test(key)));
  return { ...base, API_TOKEN: password, HOST: '127.0.0.1', PORT: String(PORT), MAX_THREADS: '1',
    PREPROCESSED_CACHE_SIZE: '32', OVERRIDE_SCRIPT_VARIANT: 'IAS',
    DENO_DIR: paths.denoCache, XDG_CACHE_HOME: paths.cache };
}

function runtimeArgs(root) {
  const resolved = safeRoot(root);
  const paths = installationPaths({ BOT_DATA_DIR: path.resolve(resolved, '..', '..', '..') });
  return ['run', '--cached-only', `--allow-net=127.0.0.1:${PORT},www.youtube.com`,
    `--allow-read=${paths.source},${paths.denoCache},${paths.cache}`, `--allow-write=${paths.cache}`,
    '--allow-env=API_TOKEN,HOST,PORT,MAX_THREADS,PREPROCESSED_CACHE_SIZE,OVERRIDE_SCRIPT_VARIANT,XDG_CACHE_HOME,DENO_DIR',
    'server.ts'];
}

module.exports = { VERSION, EJS_COMMIT, DENO_VERSION, PORT, URL, installationPaths, safeRoot, lavalinkConfigPath,
  readConnection, installed, canConfigureLavalinkCipher, enableLavalinkRemoteCipher, isConfigured,
  runtimeEnvironment, runtimeArgs };
