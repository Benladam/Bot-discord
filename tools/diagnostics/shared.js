'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function commandFileFor(projectRoot) {
  return path.join(projectRoot, 'data', 'diagnostics', 'commands.txt');
}

function migrateLegacyCommandFile(projectRoot = PROJECT_ROOT) {
  const legacyDirectory = path.join(projectRoot, 'Test');
  const legacyFile = path.join(legacyDirectory, 'cmd.txt');
  const commandFile = commandFileFor(projectRoot);
  let moved = false;
  let conflict = false;

  if (fs.existsSync(legacyFile)) {
    if (fs.existsSync(commandFile)) conflict = true;
    else {
      fs.mkdirSync(path.dirname(commandFile), { recursive: true });
      fs.renameSync(legacyFile, commandFile);
      moved = true;
    }
  }

  let removedEmptyDirectory = false;
  if (!conflict) {
    try {
      fs.rmdirSync(legacyDirectory);
      removedEmptyDirectory = true;
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
    }
  }

  return { moved, conflict, removedEmptyDirectory, leftover: fs.existsSync(legacyDirectory) };
}

function getCommandFilePath(projectRoot = PROJECT_ROOT) {
  const commandFile = commandFileFor(projectRoot);
  fs.mkdirSync(path.dirname(commandFile), { recursive: true });
  if (!fs.existsSync(commandFile)) {
    try { fs.writeFileSync(commandFile, '', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  return commandFile;
}

module.exports = { getCommandFilePath, migrateLegacyCommandFile };
