'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const required = [
  'DIAGNOSTIC_GUILD_ID',
  'DIAGNOSTIC_VOICE_CHANNEL_ID',
  'DIAGNOSTIC_REQUESTER_ID',
  'DIAGNOSTIC_MUSIC_QUERY',
];
const missing = required.filter((name) => !String(process.env[name] || '').trim());
if (missing.length) {
  throw new Error(`Variables requises pour le diagnostic vocal : ${missing.join(', ')}.`);
}

const { Events } = require('discord.js');
const { client, deps } = require('../../bot');

async function runPlaybackDiagnostic() {
  const guild = await client.guilds.fetch(process.env.DIAGNOSTIC_GUILD_ID.trim());
  const voiceChannel = await guild.channels.fetch(process.env.DIAGNOSTIC_VOICE_CHANNEL_ID.trim());
  const requester = await guild.members.fetch(process.env.DIAGNOSTIC_REQUESTER_ID.trim());
  const textChannelId = String(process.env.DIAGNOSTIC_TEXT_CHANNEL_ID || '').trim();
  const textChannel = textChannelId ? await guild.channels.fetch(textChannelId) : voiceChannel;

  if (!voiceChannel?.isVoiceBased?.()) throw new Error('DIAGNOSTIC_VOICE_CHANNEL_ID ne désigne pas un salon vocal valide.');
  if (!textChannel?.isTextBased?.() || typeof textChannel.send !== 'function') {
    throw new Error('DIAGNOSTIC_TEXT_CHANNEL_ID doit désigner un salon textuel accessible au bot.');
  }
  if (requester.voice?.channelId !== voiceChannel.id) {
    throw new Error('Le membre DIAGNOSTIC_REQUESTER_ID doit être présent dans le salon vocal indiqué.');
  }

  const play = client.commands.get('play');
  if (!play?.execute) throw new Error('La commande play n’a pas été chargée.');

  let lastMessage = null;
  const ctx = {
    guild,
    guildId: guild.id,
    channel: textChannel,
    member: requester,
    user: requester.user,
    author: requester.user,
    reply: async (payload) => {
      lastMessage = await textChannel.send(payload);
      return lastMessage;
    },
    editReply: async (payload) => {
      if (lastMessage?.edit) return lastMessage.edit(payload);
      lastMessage = await textChannel.send(payload);
      return lastMessage;
    },
  };

  const query = process.env.DIAGNOSTIC_MUSIC_QUERY.trim();
  console.info(`[diagnostic] lancement audio dans ${guild.name} : ${JSON.stringify(query)}`);
  await play.execute(ctx, [query], deps);
  console.info('[diagnostic] commande terminée; le bot reste connecté pour permettre la vérification audio.');
}

client.once(Events.ClientReady, () => {
  runPlaybackDiagnostic().catch((error) => {
    console.error(`[diagnostic] échec : ${error.stack || error.message}`);
    client.destroy();
    process.exitCode = 1;
  });
});
