'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const result = spawnSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`[git-guard] Git est introuvable : ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status || 1;
} else {
  console.log('[git-guard] Protection activée pour ce checkout : .githooks/pre-commit et .githooks/pre-push.');
}
