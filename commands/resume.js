const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'resume',
    description: 'Reprend la musique',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!player.isPaused) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Aucune musique en pause')
          .setColor('#FF0000')
        ]
      });
    }

    player.audioPlayer.unpause();
    player.isPaused = false;

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('▶️ Musique reprise')
        .setColor('#00FF00')
      ]
    });
  }
};
