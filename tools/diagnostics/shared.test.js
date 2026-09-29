'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { getCommandFilePath, migrateLegacyCommandFile } = require('./shared');

test('migre le fichier local historique et retire le dossier legacy quand il est vide', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-diagnostics-migration-'));
  const legacyDirectory = path.join(root, 'Test');
  try {
    await fs.mkdir(legacyDirectory);
    await fs.writeFile(path.join(legacyDirectory, 'cmd.txt'), 'play morceau\n');

    assert.deepEqual(migrateLegacyCommandFile(root), {
      moved: true, conflict: false, removedEmptyDirectory: true, leftover: false,
    });
    assert.equal(await fs.readFile(getCommandFilePath(root), 'utf8'), 'play morceau\n');
    await assert.rejects(fs.access(legacyDirectory), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('ne remplace jamais le nouveau fichier si les deux fichiers de commandes existent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-diagnostics-conflict-'));
  const legacyDirectory = path.join(root, 'Test');
  const commandFile = getCommandFilePath(root);
  try {
    await fs.mkdir(legacyDirectory);
    await fs.writeFile(path.join(legacyDirectory, 'cmd.txt'), 'ancienne commande');
    await fs.writeFile(commandFile, 'nouvelle commande');

    assert.deepEqual(migrateLegacyCommandFile(root), {
      moved: false, conflict: true, removedEmptyDirectory: false, leftover: true,
    });
    assert.equal(await fs.readFile(commandFile, 'utf8'), 'nouvelle commande');
    assert.equal(await fs.readFile(path.join(legacyDirectory, 'cmd.txt'), 'utf8'), 'ancienne commande');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('préserve les autres fichiers locaux présents dans l’ancien dossier', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-diagnostics-preserve-'));
  const legacyDirectory = path.join(root, 'Test');
  try {
    await fs.mkdir(legacyDirectory);
    await fs.writeFile(path.join(legacyDirectory, 'cmd.txt'), 'play morceau');
    await fs.writeFile(path.join(legacyDirectory, 'notes.txt'), 'à conserver');

    assert.deepEqual(migrateLegacyCommandFile(root), {
      moved: true, conflict: false, removedEmptyDirectory: false, leftover: true,
    });
    assert.equal(await fs.readFile(path.join(legacyDirectory, 'notes.txt'), 'utf8'), 'à conserver');
    assert.equal(await fs.readFile(getCommandFilePath(root), 'utf8'), 'play morceau');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
