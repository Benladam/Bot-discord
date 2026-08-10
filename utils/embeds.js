/**
 * Constructeurs d'embeds (messages enrichis) réutilisés par les commandes.
 * Tous les libellés sont traduits selon la langue (fr, en, es, ar).
 */

const { EmbedBuilder } = require('discord.js');
const { tr } = require('./embedI18n');

function formatDuration(seconds) {
  if (!seconds) return tr('fr').durLabel === 'Durée' ? 'Inconnue' : 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function searchEmbed(query, lang = 'fr') {
  const T = tr(lang);
  return new EmbedBuilder()
    .setTitle(T.searchTitle)
    .setDescription(T.searchDesc(query))
    .setColor('#FFA500');
}

function addedEmbed(song, position, remaining, lang = 'fr') {
  const T = tr(lang);
  return new EmbedBuilder()
    .setTitle(T.addedTitle)
    .setDescription(`**${song.title}**`)
    .addFields(
      { name: T.posLabel, value: `${position}`, inline: true },
      { name: T.durLabel, value: formatDuration(song.duration), inline: true }
    )
    .setThumbnail(song.thumbnail)
    .setColor('#00FF00');
}

function addedSpotifyEmbed(count, first, remaining, lang = 'fr') {
  const T = tr(lang);
  return new EmbedBuilder()
    .setTitle(T.addedSpotifyTitle)
    .setDescription(T.addedSpotifyDesc(count, first.title))
    .addFields(
      { name: T.tracksLabel, value: `${count}`, inline: true },
      { name: T.remainingLabel, value: `${remaining}`, inline: true }
    )
    .setThumbnail(first.thumbnail)
    .setColor('#00FF00');
}

function playingEmbed(song, player, lang = 'fr') {
  const T = tr(lang);
  const remaining = player ? player.queue.length : 0;
  const loopName = player ? T.loopModes[player.loopMode] : 'Off';
  const vol = player ? Math.round((player.volume || 0.5) * 100) : 100;
  const e = new EmbedBuilder()
    .setTitle(T.playingTitle)
    .setDescription(`**${song.title}**${song.source === 'spotify' ? T.spotifyTag : ''}`)
    .setThumbnail(song.thumbnail)
    .setColor('#5865F2');
  const fields = [
    { name: T.durLabel, value: formatDuration(song.duration), inline: true },
    { name: T.remainingLabel, value: `${remaining}`, inline: true },
    { name: T.volumeLabel, value: `${vol}%`, inline: true },
    { name: T.loopLabel, value: loopName, inline: true },
  ];
  if (player && player.addedBy) fields.push({ name: T.addedByLabel, value: `${player.addedBy}`, inline: true });
  if (player && player.voiceChannelName) fields.push({ name: T.voiceLabel, value: `${player.voiceChannelName}`, inline: true });
  e.addFields(fields);
  return e;
}

function endedEmbed(lang = 'fr') {
  const T = tr(lang);
  return new EmbedBuilder()
    .setTitle(T.endedTitle)
    .setDescription(T.endedDesc)
    .setColor('#808080');
}

function errorEmbed(message, lang = 'fr') {
  const T = tr(lang);
  return new EmbedBuilder()
    .setTitle(T.errorTitle)
    .setDescription(String(message))
    .setColor('#FF0000');
}

function notFoundEmbed(lang = 'fr') {
  const T = tr(lang);
  return new EmbedBuilder()
    .setTitle(T.notFoundTitle || '❌ Son introuvable')
    .setDescription(T.notFoundDesc || 'Je n\'ai pas pu trouver votre son.')
    .setColor('#FF0000');
}

function queueEmbed(player, prefix, lang = 'fr') {
  const T = tr(lang);
  const lines = [];
  if (player.current) {
    lines.push(`${T.queueNow} ${player.current.title}`);
  }
  if (player.queue.length === 0) {
    lines.push(T.queueEmpty);
  } else {
    player.queue.slice(0, 10).forEach((s, i) => {
      lines.push(`**${i + 1}.** ${s.title} — ${formatDuration(s.duration)}`);
    });
    if (player.queue.length > 10) {
      lines.push(T.queueMore(player.queue.length - 10));
    }
  }
  const e = new EmbedBuilder()
    .setTitle(T.queueTitle)
    .setDescription(lines.join('\n'))
    .setColor('#0099FF')
    .addFields(
      { name: T.volumeLabel, value: `${player.getQueueInfo().volume}%`, inline: true },
      { name: T.loopLabel, value: T.loopModes[player.loopMode], inline: true }
    );
  return e;
}

function nowEmbed(player, lang = 'fr') {
  const T = tr(lang);
  if (!player.current) {
    return new EmbedBuilder()
      .setTitle(T.nowTitle)
      .setDescription(T.nowNone)
      .setColor('#808080');
  }
  const s = player.current;
  return new EmbedBuilder()
    .setTitle(T.nowTitle)
    .setDescription(`**${s.title}**${s.source === 'spotify' ? T.spotifyTag : ''}`)
    .addFields(
      { name: T.durLabel, value: formatDuration(s.duration), inline: true },
      { name: T.remainingLabel, value: `${player.queue.length}`, inline: true }
    )
    .setThumbnail(s.thumbnail)
    .setColor('#0000FF');
}

module.exports = {
  formatDuration,
  searchEmbed,
  addedEmbed,
  addedSpotifyEmbed,
  playingEmbed,
  endedEmbed,
  errorEmbed,
  notFoundEmbed,
  queueEmbed,
  nowEmbed,
};
