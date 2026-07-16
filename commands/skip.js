const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'skip',
    description: 'Passe à la prochaine musique',
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

    player.audioPlayer.stop();

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏭️ Passage à la prochaine musique...')
        .setColor('#0000FF')
      ]
    });
  }
};
