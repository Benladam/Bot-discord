const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'pause',
    description: 'Met en pause la musique',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!player.isPlaying || !player.audioPlayer) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Aucune musique en cours de lecture')
          .setColor('#FF0000')
        ]
      });
    }

    if (player.isPaused) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('⏸️ Déjà en pause')
          .setColor('#FFA500')
        ]
      });
    }

    player.audioPlayer.pause();
    player.isPaused = true;

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏸️ Musique mise en pause')
        .setColor('#FFA500')
      ]
    });
  }
};
