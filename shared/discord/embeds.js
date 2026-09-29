/**
 * Constructeurs d'embeds (messages enrichis) réutilisés par les commandes.
 * Tous les libellés sont traduits selon la langue (fr, en, es, ar).
 */

const { tr } = require('../i18n/embedI18n');
const { createThemedEmbed } = require('./embedTheme');
const { providerPresentation } = require('./providerPresentation');

function setSafeThumbnail(embed, value) {
  if (typeof value === 'string' && /^https:\/\//i.test(value)) embed.setThumbnail(value);
  return embed;
}

function formatDuration(seconds) {
  if (!seconds) return tr('fr').durLabel === 'Durée' ? 'Inconnue' : 'Unknown';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function searchEmbed(query, lang = 'fr') {
  const T = tr(lang);
  return createThemedEmbed('primary')
    .setTitle(T.searchTitle)
    .setDescription(T.searchDesc(query))
    .setTimestamp();
}

function addedEmbed(song, position, remaining, lang = 'fr') {
  const T = tr(lang);
  return setSafeThumbnail(createThemedEmbed('success')
    .setTitle(T.addedTitle)
    .setDescription(`**${song.title}**`)
    .addFields(
      { name: T.posLabel, value: `${position}`, inline: true },
      { name: T.durLabel, value: formatDuration(song.duration), inline: true }
    ), song.thumbnail).setTimestamp();
}

function addedSpotifyEmbed(count, first, remaining, lang = 'fr') {
  const T = tr(lang);
  return setSafeThumbnail(createThemedEmbed('success')
    .setTitle(T.addedSpotifyTitle)
    .setDescription(T.addedSpotifyDesc(count, first.title))
    .addFields(
      { name: T.tracksLabel, value: `${count}`, inline: true },
      { name: T.remainingLabel, value: `${remaining}`, inline: true }
    ), first.thumbnail).setTimestamp();
}

function playingEmbed(song, player, lang = 'fr') {
  const T = tr(lang);
  const remaining = player ? player.queue.length : 0;
  const loopName = player ? T.loopModes[player.loopMode] : 'Off';
  const vol = player ? Math.round((player.volume || 0.5) * 100) : 100;
  const source = providerPresentation(song.provider || song.source, song.sourceUrl || song.url);
  const e = setSafeThumbnail(createThemedEmbed('primary')
    .setTitle(T.playingTitle)
    .setDescription(`**${song.title}**${song.source === 'spotify' ? T.spotifyTag : ''}`)
    .setAuthor({ name: source.name, iconURL: source.iconURL, ...(source.url ? { url: source.url } : {}) }), song.thumbnail);
  if (source.url) e.setURL(source.url);
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
  return createThemedEmbed('neutral')
    .setTitle(T.endedTitle)
    .setDescription(T.endedDesc)
    .setTimestamp();
}

function errorEmbed(message, lang = 'fr') {
  const T = tr(lang);
  return createThemedEmbed('danger')
    .setTitle(T.errorTitle)
    .setDescription(String(message))
    .setTimestamp();
}

function notFoundEmbed(lang = 'fr') {
  const T = tr(lang);
  return createThemedEmbed('danger')
    .setTitle(T.notFoundTitle || '❌ Son introuvable')
    .setDescription(T.notFoundDesc || 'Je n\'ai pas pu trouver votre son.')
    .setTimestamp();
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
  const e = createThemedEmbed('primary')
    .setTitle(T.queueTitle)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: T.volumeLabel, value: `${player.getQueueInfo().volume}%`, inline: true },
      { name: T.loopLabel, value: T.loopModes[player.loopMode], inline: true }
    );
  return e;
}

function nowEmbed(player, lang = 'fr') {
  const T = tr(lang);
  if (!player.current) {
    return createThemedEmbed('neutral')
      .setTitle(T.nowTitle)
      .setDescription(T.nowNone)
      .setTimestamp();
  }
  const s = player.current;
  const source = providerPresentation(s.provider || s.source, s.sourceUrl || s.url);
  const embed = setSafeThumbnail(createThemedEmbed('primary')
    .setTitle(T.nowTitle)
    .setDescription(`**${s.title}**${s.source === 'spotify' ? T.spotifyTag : ''}`)
    .addFields(
      { name: T.durLabel, value: formatDuration(s.duration), inline: true },
      { name: T.remainingLabel, value: `${player.queue.length}`, inline: true }
    ).setAuthor({ name: source.name, iconURL: source.iconURL, ...(source.url ? { url: source.url } : {}) }), s.thumbnail);
  if (source.url) embed.setURL(source.url);
  return embed.setTimestamp();
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
