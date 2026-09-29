const { EmbedBuilder } = require('discord.js');

const COLORS = Object.freeze({
  primary: 0x7257f5,
  success: 0x2ebd85,
  warning: 0xf0b232,
  danger: 0xe55361,
  neutral: 0x667085,
});

function createThemedEmbed(variant = 'primary') {
  return new EmbedBuilder().setColor(COLORS[variant] || COLORS.primary);
}

module.exports = { COLORS, createThemedEmbed };
