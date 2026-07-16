const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'volume',
    description: 'Ajuste le volume',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!args[0]) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🔊 Volume actuel')
          .setDescription(`${Math.round(player.volume * 100)}%`)
          .setColor('#0000FF')
        ]
      });
    }

    const volume = parseInt(args[0]);

    if (isNaN(volume) || volume < 0 || volume > 100) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Le volume doit être entre 0 et 100')
          .setColor('#FF0000')
        ]
      });
    }

    player.volume = volume / 100;

    // Appliquer le volume si une chanson joue
    if (player.audioPlayer && player.dispatcher) {
      try {
        player.dispatcher.volume = player.volume;
      } catch (e) {
        // Le volume ne peut pas être changé en direct avec certaines sources
      }
    }

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🔊 Volume')
        .setDescription(`Volume réglé à ${volume}%`)
        .setColor('#0000FF')
      ]
    });
  }
};
