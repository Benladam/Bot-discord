const MAX_PREFIX_LENGTH = 8;

function normalizeCommandPrefix(value) {
  const prefix = String(value ?? '').trim();
  if (!prefix) return '';
  if (prefix.length > MAX_PREFIX_LENGTH || /\s/.test(prefix)) {
    throw new TypeError(`COMMAND_PREFIX doit contenir de 1 à ${MAX_PREFIX_LENGTH} caractères sans espace.`);
  }
  return prefix;
}

function getGatewayIntents(GatewayIntentBits, prefix, readMessageContent = false) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates];
  if (prefix || readMessageContent) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  if (readMessageContent) intents.push(GatewayIntentBits.DirectMessages);
  return intents;
}

function parsePrefixedCommand(content, prefix) {
  if (!prefix || typeof content !== 'string' || !content.startsWith(prefix)) return null;
  const input = content.slice(prefix.length).trim();
  if (!input) return null;
  const [name, ...args] = input.split(/\s+/);
  return { name: name.toLowerCase(), args };
}

module.exports = { MAX_PREFIX_LENGTH, normalizeCommandPrefix, getGatewayIntents, parsePrefixedCommand };
