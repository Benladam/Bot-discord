const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hasGitCheckout } = require('./updater');

const PROJECT_ROOT = path.resolve(__dirname, '..');

test('un dossier déployé sans .git est reconnu sans erreur', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-no-git-'));
  try {
    assert.equal(await hasGitCheckout(root), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('les outils de diagnostic sont optionnels, authentifiés et liés à localhost', async () => {
  const botSource = await fs.readFile(path.join(PROJECT_ROOT, 'bot.js'), 'utf8');
  const bridgeSource = await fs.readFile(path.join(PROJECT_ROOT, 'tools', 'diagnostics', 'wsBridge.js'), 'utf8');
  assert.match(botSource, /ENABLE_DIAGNOSTIC_HOOKS/);
  assert.match(botSource, /Buffer\.byteLength\(DIAGNOSTIC_BRIDGE_TOKEN, 'utf8'\) >= 32/);
  assert.match(bridgeSource, /host: HOST/);
  assert.match(bridgeSource, /const HOST = '127\.0\.0\.1'/);
  assert.match(bridgeSource, /crypto\.timingSafeEqual/);
});

test('les tests cohabitent avec le code sans dossier de tests racine dédié', async () => {
  await assert.rejects(fs.access(path.join(PROJECT_ROOT, 'tests')), { code: 'ENOENT' });
  const commandLoaderSource = await fs.readFile(path.join(PROJECT_ROOT, 'core', 'commandFiles.js'), 'utf8');
  assert.ok(commandLoaderSource.includes('\\.(?:test|spec)\\.js'));
});

test('le contexte Docker exclut les secrets et les données locales de diagnostic', async () => {
  const dockerIgnore = await fs.readFile(path.join(PROJECT_ROOT, '.dockerignore'), 'utf8');
  assert.match(dockerIgnore, /^\.env\.\*/m);
  assert.match(dockerIgnore, /^data$/m);
  await fs.access(path.join(PROJECT_ROOT, 'docs', 'diagnostics.md'));
  await fs.access(path.join(PROJECT_ROOT, 'tools', 'diagnostics', 'wsBridge.js'));
});
