const { EmbedBuilder } = require('discord.js');
const play = require('play-dl');

module.exports = {
  data: {
    name: 'play',
    description: 'Joue une musique',
  },

  async execute(message, args, client, getPlayer) {
    // Vérifier que l'utilisateur est dans un canal vocal
    if (!message.member.voice.channel) {
      return message.reply('❌ Vous devez être dans un canal vocal !');
    }

    const voiceChannel = message.member.voice.channel;
    const query = args.join(' ');

    if (!query) {
      return message.reply('❌ Veuillez spécifier une musique à jouer !');
    }

    // Afficher "Recherche en cours..."
    const searchEmbed = new EmbedBuilder()
      .setTitle('🔍 Recherche')
      .setDescription(`Recherche de: \`${query}\``)
      .setColor('#FFA500');
    
    const searchMsg = await message.reply({ embeds: [searchEmbed] });

    try {
      const player = getPlayer(message.guildId);

      // Rechercher la musique
      let result;
      try {
        // Vérifier si c'est un lien YouTube
        if (query.includes('youtube.com') || query.includes('youtu.be')) {
          result = await play.validate(query);
          if (result) {
            result = await play.video_info(query);
          }
        } else {
          // Rechercher sur YouTube
          const searchResults = await play.search(query, { limit: 1 });
          if (searchResults.length === 0) {
            return searchMsg.edit({
              embeds: [new EmbedBuilder()
                .setTitle('❌ Erreur')
                .setDescription(`Aucun résultat trouvé pour: \`${query}\``)
                .setColor('#FF0000')
              ]
            });
          }
          result = searchResults[0];
        }
      } catch (error) {
        console.error('Erreur recherche:', error);
        return searchMsg.edit({
          embeds: [new EmbedBuilder()
            .setTitle('❌ Erreur')
            .setDescription(`Impossible de trouver la musique: ${error.message}`)
            .setColor('#FF0000')
          ]
        });
      }

      const song = {
        title: result.video_details?.title || result.title || 'Musique inconnue',
        url: result.video_details?.url || result.url || query,
        duration: result.video_details?.durationInSec || result.durationInSec || 0,
        thumbnail: result.video_details?.thumbnail?.url || result.thumbnail || null,
      };

      // Ajouter à la queue
      const position = player.addToQueue(song);

      // Si rien ne joue, lancer la lecture
      if (!player.isPlaying) {
        await playNext(message, player, voiceChannel, client);
      } else {
        // Envoyer une embed "Ajouté à la queue"
        const addedEmbed = new EmbedBuilder()
          .setTitle('➕ Ajouté à la queue')
          .setDescription(`**${song.title}**`)
          .addFields(
            { name: 'Position', value: `${position}`, inline: true },
            { name: 'Durée', value: formatDuration(song.duration), inline: true }
          )
          .setThumbnail(song.thumbnail)
          .setColor('#00FF00');

        await searchMsg.edit({ embeds: [addedEmbed] });
      }
    } catch (error) {
      console.error('Erreur play:', error);
      await searchMsg.edit({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription(`Erreur: ${error.message}`)
          .setColor('#FF0000')
        ]
      });
    }
  }
};

// Fonction pour jouer la prochaine chanson
async function playNext(message, player, voiceChannel, client) {
  try {
    const song = player.getNextSong();

    if (!song) {
      player.isPlaying = false;
      const endEmbed = new EmbedBuilder()
        .setTitle('🎵 Fin de la playlist')
        .setDescription('La file d\'attente est vide')
        .setColor('#808080');
      
      await message.reply({ embeds: [endEmbed] });
      return;
    }

    player.current = song;
    player.isPlaying = true;

    // Rejoindre le canal vocal
    if (!player.connection || player.connection.state.status !== 'ready') {
      const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require('@discordjs/voice');
      
      player.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guildId,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      player.audioPlayer = createAudioPlayer();

      player.connection.subscribe(player.audioPlayer);

      player.connection.on(VoiceConnectionStatus.Disconnected, () => {
        player.isPlaying = false;
      });
    }

    try {
      // Créer la ressource audio
      const stream = await play.stream(song.url);
      const resource = require('@discordjs/voice').createAudioResource(stream.stream, {
        inputType: stream.type,
        metadata: { title: song.title },
      });

      player.dispatcher = resource;

      // Jouer la ressource
      player.audioPlayer.play(resource);

      // Event: Quand la chanson se termine
      player.audioPlayer.once(require('@discordjs/voice').AudioPlayerStatus.Idle, async () => {
        await playNext(message, player, voiceChannel, client);
      });

      // Envoyer embed "En cours de lecture"
      const playingEmbed = new EmbedBuilder()
        .setTitle('🎵 En cours de lecture')
        .setDescription(`**${song.title}**`)
        .addFields(
          { name: 'Durée', value: formatDuration(song.duration), inline: true },
          { name: 'Queue restante', value: `${player.queue.length}`, inline: true }
        )
        .setThumbnail(song.thumbnail)
        .setColor('#0000FF');

      await message.reply({ embeds: [playingEmbed] });
    } catch (error) {
      console.error('Erreur stream:', error);
      await message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur de lecture')
          .setDescription(`${error.message}`)
          .setColor('#FF0000')
        ]
      });
      await playNext(message, player, voiceChannel, client);
    }
  } catch (error) {
    console.error('Erreur playNext:', error);
  }
}

function formatDuration(seconds) {
  if (!seconds) return 'Inconnue';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
