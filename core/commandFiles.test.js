'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { listCommandFiles } = require('./commandFiles');

test('le chargeur ne prend que les commandes JavaScript et ignore les tests co-localisés', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-command-files-'));
  try {
    await Promise.all([
      fs.writeFile(path.join(directory, 'play.js'), ''),
      fs.writeFile(path.join(directory, 'help.test.js'), ''),
      fs.writeFile(path.join(directory, 'help.spec.js'), ''),
      fs.mkdir(path.join(directory, 'nested.js')),
    ]);
    assert.deepEqual(listCommandFiles(directory), ['play.js']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
