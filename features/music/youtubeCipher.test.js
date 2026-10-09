const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applicationConfig } = require('../../tools/setup/installLavalink');
const cipher = require('./youtubeCipher');

function roots() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-cipher-config-'));
  const env = { BOT_DATA_DIR: path.join(parent, 'data') };
  const helper = cipher.installationPaths(env);
  const lavalink = path.join(env.BOT_DATA_DIR, '.cache', 'lavalink', '4.2.2');
  fs.mkdirSync(path.join(helper.ejs, 'src', 'yt', 'solver'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(lavalink, { recursive: true, mode: 0o700 });
  fs.writeFileSync(helper.deno, 'fake-deno', { mode: 0o700 });
  fs.writeFileSync(path.join(helper.source, 'server.ts'), '');
  fs.writeFileSync(path.join(helper.ejs, 'src', 'yt', 'solver', 'solvers.ts'), '');
  const password = 'ab'.repeat(32);
  fs.writeFileSync(helper.connection, JSON.stringify({ port: cipher.PORT, password }), { mode: 0o600 });
  fs.writeFileSync(helper.manifest, JSON.stringify({ commit: cipher.VERSION, ejsCommit: cipher.EJS_COMMIT,
    denoVersion: cipher.DENO_VERSION, denoSha256: '0'.repeat(64) }), { mode: 0o600 });
  fs.writeFileSync(path.join(lavalink, 'application.yml'), applicationConfig('lavalink-password'), { mode: 0o600 });
  return { parent, env, helper, lavalink, password };
}

test('yt-cipher accepte seulement son arborescence privée attendue', () => {
  const { parent, helper } = roots();
  try {
    assert.equal(cipher.safeRoot(helper.root), helper.root);
    assert.throws(() => cipher.safeRoot(path.join(parent, 'outside')), /invalide/);
    assert.deepEqual(cipher.readConnection(helper.root), { password: 'ab'.repeat(32), port: cipher.PORT });
    assert.equal(cipher.installed({ BOT_DATA_DIR: path.dirname(path.dirname(path.dirname(helper.root))) }), true);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('Lavalink cible uniquement le secret yt-cipher local et refuse de remplacer un résolveur existant', () => {
  const { parent, helper, lavalink, password } = roots();
  try {
    assert.equal(cipher.canConfigureLavalinkCipher(lavalink), true);
    const result = cipher.enableLavalinkRemoteCipher(lavalink, password);
    assert.equal(result.changed, true);
    let text = fs.readFileSync(path.join(lavalink, 'application.yml'), 'utf8');
    assert.match(text, /remoteCipher:\n      url: "http:\/\/127\.0\.0\.1:8001"\n      password: "(?:ab){32}"\n      userAgent: "HeussBot"/);
    assert.equal(cipher.isConfigured(lavalink, helper.root), true);
    assert.equal(cipher.enableLavalinkRemoteCipher(lavalink, password).alreadyConfigured, true);
    assert.equal((text.match(/    remoteCipher:/g) || []).length, 1);

    text = text.replace('http://127.0.0.1:8001', 'https://cipher.example');
    fs.writeFileSync(path.join(lavalink, 'application.yml'), text, { mode: 0o600 });
    assert.equal(cipher.canConfigureLavalinkCipher(lavalink), false);
    assert.throws(() => cipher.enableLavalinkRemoteCipher(lavalink, password), /a été conservé/);
    assert.ok(fs.readFileSync(path.join(lavalink, 'application.yml'), 'utf8').includes('https://cipher.example'));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('worker Deno a des droits limités, écoute en loopback et ne reçoit aucun secret du bot', () => {
  const { parent, helper, password } = roots();
  try {
    const env = cipher.runtimeEnvironment(helper.root, password, { PATH: '/usr/bin', DISCORD_TOKEN: 'not-forwarded', BOT_DATA_DIR: '/private' });
    const args = cipher.runtimeArgs(helper.root);
    assert.equal(env.API_TOKEN, password);
    assert.equal(env.HOST, '127.0.0.1');
    assert.equal(env.MAX_THREADS, '1');
    assert.equal(env.DISCORD_TOKEN, undefined);
    assert.equal(args.includes('--cached-only'), true);
    assert.ok(args.includes('--allow-net=127.0.0.1:8001,www.youtube.com'));
    const envPermission = args.find(value => value.startsWith('--allow-env='));
    assert.ok(envPermission);
    assert.deepEqual(envPermission.slice('--allow-env='.length).split(','), cipher.DENO_ENV_ALLOWLIST);
    assert.ok(args.some(value => value.startsWith('--allow-write=') && value.endsWith(`${path.sep}cache`)));
    assert.ok(!args.some(value => value.includes('cipher.kikkia.dev')));
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('les diagnostics du résolveur classifient la cause sans exposer la sortie brute', () => {
  assert.equal(cipher.helperFailureCode('error: Could not find "astring" in a node_modules folder', 1), 'YOUTUBE_CIPHER_DEPENDENCY_MISSING');
  assert.equal(cipher.helperFailureCode('PermissionDenied: Requires net access', 1), 'YOUTUBE_CIPHER_PERMISSION_DENIED');
  assert.equal(cipher.helperFailureCode('NotCapable: Requires env access to IGNORE_SCRIPT_REGION', 1), 'YOUTUBE_CIPHER_PERMISSION_DENIED');
  assert.equal(cipher.helperFailureCode('Address already in use', 1), 'YOUTUBE_CIPHER_PORT_IN_USE');
  assert.equal(cipher.helperFailureCode('', null, 'SIGKILL'), 'YOUTUBE_CIPHER_RESOURCE_LIMIT');
  assert.equal(cipher.helperFailureCode('unexpected failure', 1), 'YOUTUBE_CIPHER_PROCESS_EXIT');
});

test('le détail de démarrage est expurgé avant son apparition dans la console', () => {
  const detail = cipher.helperFailureDetail('error: API_TOKEN=private https://youtube.com/watch?v=private\n    at file:///home/container/private.ts:10:2');
  assert.match(detail, /error/);
  assert.doesNotMatch(detail, /private|youtube\.com|home\/container/);
});
