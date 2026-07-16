const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'help',
    description: 'Affiche l\'aide',
  },

  execute(message, args, client, getPlayer) {
    const PREFIX = process.env.COMMAND_PREFIX || '!';

    const embed = new EmbedBuilder()
      .setTitle('🎵 Aide du Bot Musique')
      .setDescription(`Préfixe des commandes: \`${PREFIX}\``)
      .setColor('#0000FF')
      .addFields(
        { name: `${PREFIX}play [lien/recherche]`, value: 'Joue une musique (YouTube, URL, texte)' },
        { name: `${PREFIX}pause`, value: 'Met en pause' },
        { name: `${PREFIX}resume`, value: 'Reprend la lecture' },
        { name: `${PREFIX}skip`, value: 'Passe à la suivante' },
        { name: `${PREFIX}stop`, value: 'Arrête et vide la queue' },
        { name: `${PREFIX}queue`, value: 'Affiche la file d\'attente' },
        { name: `${PREFIX}volume [0-100]`, value: 'Ajuste le volume' },
        { name: `${PREFIX}now`, value: 'Affiche la musique en cours' },
        { name: `${PREFIX}leave`, value: 'Le bot quitte le canal' },
        { name: `${PREFIX}help`, value: 'Affiche cette aide' }
      )
      .setFooter({ text: 'Bon amusement! 🎶' });

    message.reply({ embeds: [embed] });
  }
};
