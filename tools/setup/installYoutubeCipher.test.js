const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deflateRawSync } = require('node:zlib');
const cipher = require('../../features/music/youtubeCipher');
const { DENO_ARCHIVE, zipEntry, downloadDeno, installYoutubeCipher } = require('./installYoutubeCipher');

function zipSingleFile(name, content) {
  const filename = Buffer.from(name);
  const compressed = deflateRawSync(content);
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 6);
  local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(filename.length, 26); filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24); central.writeUInt16LE(filename.length, 28); filename.copy(central, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

test('archive Deno n’extrait que le binaire attendu et rejette un chemin ZIP dangereux', () => {
  const bytes = zipSingleFile('deno', Buffer.from('pinned binary'));
  assert.equal(zipEntry(bytes).toString(), 'pinned binary');
  assert.throws(() => zipEntry(zipSingleFile('../deno', Buffer.from('bad'))), /inattendue/);
  assert.throws(() => zipEntry(Buffer.from('not a zip')), /invalide/);
});

test('téléchargement Deno vérifie HTTPS, origine GitHub et SHA-256 avant extraction', async () => {
  const archive = zipSingleFile('deno', Buffer.from('verified test binary'));
  const asset = { url: 'https://github.com/denoland/deno/releases/download/test/deno.zip',
    sha256: crypto.createHash('sha256').update(archive).digest('hex') };
  const fetchImpl = async url => new Response(archive, { status: 200, headers: { 'content-length': String(archive.length) } });
  assert.equal((await downloadDeno(fetchImpl, asset)).toString(), 'verified test binary');
  await assert.rejects(downloadDeno(async () => new Response(archive), { ...asset, sha256: '0'.repeat(64) }), /Checksum/);
  await assert.rejects(downloadDeno(async url => new Response(archive, { status: 200,
    headers: { 'x-test': url }, }), { ...asset, url: 'https://downloads.example.test/deno.zip' }), /refusé/);
  assert.match(DENO_ARCHIVE.url, /^https:\/\/github\.com\/denoland\/deno\/releases\/download\/v2\.9\.7\//);
  assert.match(DENO_ARCHIVE.sha256, /^[a-f0-9]{64}$/);
});

test('installation Deno refuse une plateforme non prise en charge avant tout téléchargement', async () => {
  await assert.rejects(installYoutubeCipher({ platform: 'win32', arch: 'x64', fetchImpl: assert.fail }), /Linux x64/);
});

test('installation simulée épingle les deux dépôts, garde les fichiers hors Git et devient idempotente', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'yt-cipher-install-test-'));
  const env = { BOT_DATA_DIR: path.join(parent, 'data') };
  const archive = zipSingleFile('deno', Buffer.from('fake-deno-binary'));
  const denoArchive = { url: 'https://github.com/denoland/deno/releases/download/test/deno.zip',
    sha256: crypto.createHash('sha256').update(archive).digest('hex') };
  const calls = [];
  const fetchImpl = async () => new Response(archive, { status: 200 });
  const runImpl = async (command, args) => {
    calls.push({ command, args });
    if (command === 'git' && args[0] === '-C' && args[2] === 'checkout') {
      const repo = args[1];
      if (repo.endsWith(`${path.sep}source`)) {
        await fs.mkdir(path.join(repo, 'scripts'), { recursive: true });
        await fs.writeFile(path.join(repo, 'server.ts'), '');
        await fs.writeFile(path.join(repo, 'scripts', 'patch-ejs.ts'), '');
      } else {
        const solver = path.join(repo, 'src', 'yt', 'solver');
        await fs.mkdir(solver, { recursive: true });
        await fs.writeFile(path.join(solver, 'solvers.ts'), '');
      }
    }
    if (command === 'git' && args[0] === '-C' && args[2] === 'rev-parse') {
      return args[1].endsWith(`${path.sep}ejs`) ? cipher.EJS_COMMIT : cipher.VERSION;
    }
    return '';
  };
  try {
    const first = await installYoutubeCipher({ env, platform: 'linux', arch: 'x64', denoArchive, fetchImpl, runImpl, log() {} });
    const paths = cipher.installationPaths(env);
    assert.equal(first.installed, true);
    assert.match(first.password, /^[a-f0-9]{64}$/);
    assert.equal(cipher.installed(env), true);
    assert.ok(calls.some(call => call.command === 'git' && call.args.includes(cipher.VERSION)));
    assert.ok(calls.some(call => call.command === 'git' && call.args.includes(cipher.EJS_COMMIT)));
    assert.ok(calls.some(call => path.basename(call.command) === 'deno' && call.args[0] === 'cache'));
    assert.equal(JSON.parse(await fs.readFile(paths.manifest, 'utf8')).denoSha256, denoArchive.sha256);
    assert.equal(JSON.parse(await fs.readFile(paths.connection, 'utf8')).password, first.password);

    const second = await installYoutubeCipher({ env, platform: 'linux', arch: 'x64', fetchImpl: assert.fail, runImpl: assert.fail });
    assert.equal(second.password, first.password);
  } finally { await fs.rm(parent, { recursive: true, force: true }); }
});
