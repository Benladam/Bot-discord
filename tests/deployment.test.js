const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hasGitCheckout } = require('../core/updater');

const PROJECT_ROOT = path.resolve(__dirname, '..');

test('un dossier déployé sans .git est reconnu sans erreur', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-no-git-'));
  try {
    assert.equal(await hasGitCheckout(root), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('les hooks manuels Test exigent une activation explicite et un jeton fort', async () => {
  const botSource = await fs.readFile(path.join(PROJECT_ROOT, 'bot.js'), 'utf8');
  const bridgeSource = await fs.readFile(path.join(PROJECT_ROOT, 'Test', 'wsBridge.js'), 'utf8');
  assert.match(botSource, /ENABLE_TEST_HOOKS/);
  assert.match(botSource, /Buffer\.byteLength\(TEST_BRIDGE_TOKEN, 'utf8'\) >= 32/);
  assert.match(bridgeSource, /host: HOST/);
  assert.match(bridgeSource, /const HOST = '127\.0\.0\.1'/);
  assert.match(bridgeSource, /crypto\.timingSafeEqual/);
});

test('le contexte Docker conserve Test mais exclut secrets et fichier local de commandes', async () => {
  const dockerIgnore = await fs.readFile(path.join(PROJECT_ROOT, '.dockerignore'), 'utf8');
  assert.match(dockerIgnore, /^\.env\.\*/m);
  assert.match(dockerIgnore, /^Test\/cmd\.txt$/m);
  assert.doesNotMatch(dockerIgnore, /^Test\/?$/m);
  await fs.access(path.join(PROJECT_ROOT, 'Test', 'README.md'));
});
