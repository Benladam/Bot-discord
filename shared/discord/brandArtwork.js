const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');

const ART_PATH = path.resolve(__dirname, '../../assets/discord/music-bot-emblem.png');
const ART_NAME = 'music-bot-emblem.png';

function withBrandArtwork(embed) {
  if (!fs.existsSync(ART_PATH)) return { embeds: [embed] };
  embed.setThumbnail(`attachment://${ART_NAME}`);
  return { embeds: [embed], files: [new AttachmentBuilder(ART_PATH, { name: ART_NAME })] };
}

module.exports = { ART_PATH, ART_NAME, withBrandArtwork };
