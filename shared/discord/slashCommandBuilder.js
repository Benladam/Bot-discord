const { SlashCommandBuilder } = require('discord.js');

const OPTION_METHODS = new Map([
  [3, 'addStringOption'],
  [4, 'addIntegerOption'],
  [5, 'addBooleanOption'],
  [6, 'addUserOption'],
  [7, 'addChannelOption'],
  [8, 'addRoleOption'],
  [9, 'addMentionableOption'],
  [10, 'addNumberOption'],
  [11, 'addAttachmentOption'],
]);

function configureOption(option, definition) {
  option.setName(definition.name);
  option.setDescription(definition.description);
  option.setRequired(Boolean(definition.required));

  if (definition.choices) option.addChoices(...definition.choices);
  if (definition.autocomplete) option.setAutocomplete(true);
  if (definition.channelTypes) option.addChannelTypes(...definition.channelTypes);
  if (Number.isInteger(definition.minValue)) option.setMinValue(definition.minValue);
  if (Number.isInteger(definition.maxValue)) option.setMaxValue(definition.maxValue);
  if (typeof definition.minValue === 'number' && !Number.isInteger(definition.minValue)) option.setMinValue(definition.minValue);
  if (typeof definition.maxValue === 'number' && !Number.isInteger(definition.maxValue)) option.setMaxValue(definition.maxValue);
  if (Number.isInteger(definition.minLength)) option.setMinLength(definition.minLength);
  if (Number.isInteger(definition.maxLength)) option.setMaxLength(definition.maxLength);
  return option;
}

function addOptions(builder, definitions = []) {
  for (const definition of definitions) {
    if (definition.type === 1) {
      builder.addSubcommand((subcommand) => {
        subcommand.setName(definition.name).setDescription(definition.description);
        addOptions(subcommand, definition.options);
        return subcommand;
      });
      continue;
    }
    if (definition.type === 2) {
      builder.addSubcommandGroup((group) => {
        group.setName(definition.name).setDescription(definition.description);
        addOptions(group, definition.options);
        return group;
      });
      continue;
    }

    const method = OPTION_METHODS.get(definition.type);
    if (!method || typeof builder[method] !== 'function') {
      throw new TypeError(`Type d’option Discord inconnu (${definition.type}) pour « ${definition.name} ».`);
    }
    builder[method]((option) => configureOption(option, definition));
  }
  return builder;
}

function buildSlashCommand(command) {
  if (!command?.slash || !command.data?.name || typeof command.execute !== 'function') {
    throw new TypeError('Une commande slash doit définir slash, data.name et execute().');
  }
  const data = command.data;
  let builder = new SlashCommandBuilder()
    .setName(data.name)
    .setDescription(data.description);

  if (data.defaultMemberPermissions !== undefined) {
    builder.setDefaultMemberPermissions(data.defaultMemberPermissions);
  }
  addOptions(builder, data.options);
  return builder.toJSON();
}

function buildSlashCommands(commands) {
  const list = [...commands.values()].filter((command) => command.slash);
  const names = new Set();
  return list.map((command) => {
    if (names.has(command.data.name)) throw new Error(`Commande slash en double : ${command.data.name}`);
    names.add(command.data.name);
    return buildSlashCommand(command);
  });
}

module.exports = { buildSlashCommand, buildSlashCommands };
