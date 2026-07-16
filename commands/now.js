const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'now',
    description: 'Affiche la musique en cours de lecture',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!player.current) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('Aucune musique en cours de lecture')
          .setColor('#FF0000')
        ]
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎵 Maintenant en lecture')
      .setDescription(`**${player.current.title}**`)
      .addFields({
        name: 'Durée',
        value: formatDuration(player.current.duration),
        inline: true
      })
      .setThumbnail(player.current.thumbnail)
      .setColor('#0000FF');

    message.reply({ embeds: [embed] });
  }
};

function formatDuration(seconds) {
  if (!seconds) return 'Inconnue';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
