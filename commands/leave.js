const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'leave',
    description: 'Le bot quitte le canal vocal',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!player.connection) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Le bot n\'est pas connecté')
          .setColor('#FF0000')
        ]
      });
    }

    player.clearQueue();
    player.isPlaying = false;

    if (player.audioPlayer) {
      player.audioPlayer.stop();
    }

    player.connection.destroy();
    player.connection = null;

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('👋 Déconnecté du canal vocal')
        .setColor('#808080')
      ]
    });
  }
};
