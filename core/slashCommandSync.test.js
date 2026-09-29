'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sameCommandSet, syncGlobalSlashCommands } = require('./slashCommandSync');
const { buildSlashCommand } = require('../shared/discord/slashCommandBuilder');

const desired = [{
  type: 1,
  name: 'play',
  description: 'Jouer une musique',
  options: [
    { type: 3, name: 'query', description: 'Titre ou lien', required: true, autocomplete: true },
  ],
}];

test('/play conserve query obligatoire et son autocomplétion dans le payload Discord', () => {
  const command = buildSlashCommand(require('../commands/play'));
  const query = command.options.find((option) => option.name === 'query');
  assert.equal(query.required, true);
  assert.equal(query.autocomplete, true);
});

test('le comparateur ignore les métadonnées générées par Discord mais vérifie query et autocomplete', () => {
  const remote = [{
    ...desired[0],
    id: 'command-id',
    application_id: 'application-id',
    version: 'version-id',
    options: [{ ...desired[0].options[0], autocomplete: true }],
  }];
  assert.equal(sameCommandSet(remote, desired), true);
  assert.equal(sameCommandSet([{ ...remote[0], options: [{ ...remote[0].options[0], autocomplete: false }] }], desired), false);
  assert.equal(sameCommandSet([{ ...remote[0], options: [{ ...remote[0].options[0], required: false }] }], desired), false);
});

test('une commande globale identique ne déclenche aucun PUT inutile', async () => {
  let puts = 0;
  const logs = [];
  const rest = {
    async get() { return [{ ...desired[0], id: 'command-id', version: 'version-id' }]; },
    async put() { puts += 1; return desired; },
  };

  const result = await syncGlobalSlashCommands({
    rest, route: '/global', body: desired,
    logger: { info: (message) => logs.push(message), warn() {} },
  });

  assert.deepEqual(result, { updated: false });
  assert.equal(puts, 0);
  assert.match(logs[0], /déjà synchronisées/);
});

test('une définition globale obsolète est bien mise à jour et vérifiée', async () => {
  let puts = 0;
  const rest = {
    async get() { return [{ ...desired[0], options: [{ ...desired[0].options[0], autocomplete: false }] }]; },
    async put(_route, { body }) { puts += 1; return body; },
  };

  const result = await syncGlobalSlashCommands({ rest, route: '/global', body: desired, logger: { warn() {} } });
  assert.deepEqual(result, { updated: true });
  assert.equal(puts, 1);
});
