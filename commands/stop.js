const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'stop',
    description: 'Arrête la musique et vide la queue',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!player.isPlaying && !player.audioPlayer) {
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

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('⏹️ Musique arrêtée')
        .setDescription('Queue vidée')
        .setColor('#FF0000')
      ]
    });
  }
};
