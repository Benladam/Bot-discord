const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SlashCommandBuilder } = require('discord.js');

function serializeCommand(command) {
  let builder = new SlashCommandBuilder()
    .setName(command.data.name)
    .setDescription(command.data.description || 'Commande');

  for (const option of command.data.options || command.options || []) {
    if (option.type === 4) {
      builder = builder.addIntegerOption((item) => item
        .setName(option.name).setDescription(option.description || '').setRequired(!!option.required));
    } else if (option.type === 5) {
      builder = builder.addBooleanOption((item) => item
        .setName(option.name).setDescription(option.description || '').setRequired(!!option.required));
    } else if (option.type === 3) {
      builder = builder.addStringOption((item) => {
        item.setName(option.name).setDescription(option.description || '').setRequired(!!option.required);
        if (option.choices) item.addChoices(...option.choices);
        else if (option.autocomplete) item.setAutocomplete(true);
        return item;
      });
    }
  }

  return builder.toJSON();
}

test('les commandes play et playlist se sérialisent pour l’API Discord', () => {
  for (const name of ['play', 'playlist']) {
    const command = require(`../commands/${name}`);
    const json = serializeCommand(command);
    assert.equal(json.name, name);
    assert.ok(json.options.length > 0);
  }
});
