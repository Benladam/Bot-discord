const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { hasGitCheckout } = require('../utils/updater');

test('un dossier déployé sans .git est reconnu sans erreur', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-no-git-'));
  try {
    assert.equal(await hasGitCheckout(root), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
