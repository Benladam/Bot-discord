'use strict';

const fs = require('node:fs');

function listCommandFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && entry.name.endsWith('.js')
      && !/\.(?:test|spec)\.js$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

module.exports = { listCommandFiles };
