const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'queue',
    description: 'Affiche la file d\'attente',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (!player.isPlaying && player.queue.length === 0) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('🎵 La queue est vide')
          .setColor('#808080')
        ]
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 File d\'attente')
      .setColor('#800080');

    // Chanson en cours
    if (player.current) {
      embed.addFields({
        name: '▶️ En cours',
        value: `**${player.current.title}**`,
        inline: false
      });
    }

    // Queue
    if (player.queue.length > 0) {
      let queueText = '';
      const displayLimit = Math.min(10, player.queue.length);
      
      for (let i = 0; i < displayLimit; i++) {
        const song = player.queue[i];
        queueText += `${i + 1}. ${song.title.substring(0, 50)}\n`;
      }

      if (player.queue.length > 10) {
        queueText += `\n... et ${player.queue.length - 10} autres`;
      }

      embed.addFields({
        name: `Prochaines (${player.queue.length})`,
        value: queueText || 'Aucune',
        inline: false
      });
    }

    message.reply({ embeds: [embed] });
  }
};
