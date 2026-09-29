/** Message de statut « en cours » stocké et modifié séparément par serveur. */
const { EmbedBuilder } = require('discord.js');

const SETTING_KEY = 'musicNowPlayingMessage';

function statusEmbed(state, guildName = '') {
  const song = state?.isPlaying ? state.current : null;
  if (!song) {
    return new EmbedBuilder()
      .setColor('#808080')
      .setTitle('⏹️ Aucune musique en cours')
      .setDescription('Le lecteur de ce serveur est arrêté ou en attente.')
      .setFooter({ text: 'Statut musical propre à ce serveur' });
  }

  const title = String(song.title || 'Musique inconnue').replace(/[\r\n]+/g, ' ').slice(0, 300);
  const embed = new EmbedBuilder()
    .setColor(state.isPaused ? '#FFA500' : '#5865F2')
    .setTitle(state.isPaused ? '⏸️ En pause sur ce serveur' : '🎵 En cours sur ce serveur')
    .setDescription(`**${title}**`)
    .setFooter({ text: `Statut musical propre à ${String(guildName || 'ce serveur').slice(0, 100)}` });
  const fields = [];
  if (state.voiceChannelName) fields.push({ name: 'Salon vocal', value: String(state.voiceChannelName).slice(0, 100), inline: true });
  fields.push({ name: 'File restante', value: String(Math.max(0, Number(state.queueLength) || 0)), inline: true });
  if (state.addedBy) fields.push({ name: 'Ajouté par', value: String(state.addedBy).slice(0, 100), inline: true });
  fields.push({ name: 'Volume', value: `${Math.max(0, Math.min(100, Number(state.volume) || 0))}%`, inline: true });
  embed.addFields(fields);
  if (song.thumbnail && /^https:\/\//i.test(String(song.thumbnail))) embed.setThumbnail(song.thumbnail);
  return embed;
}

class GuildNowPlayingManager {
  constructor({ client, database, log = () => {} }) {
    this.client = client;
    this.database = database;
    this.log = log;
    this.pending = new Map();
  }

  update(player, state) {
    const guildId = String(player?.guildId || '');
    if (!guildId) return Promise.resolve(false);
    const previous = this.pending.get(guildId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this._update(player, state, guildId)).catch((error) => {
      this.log('warn', `[now-playing][guild=${guildId}] ${String(error.message || error).slice(0, 300)}`);
      return false;
    });
    this.pending.set(guildId, operation);
    return operation.finally(() => {
      if (this.pending.get(guildId) === operation) this.pending.delete(guildId);
    });
  }

  async _channelFromId(channelId) {
    if (!channelId) return null;
    let channel = this.client.channels?.cache?.get?.(String(channelId)) || null;
    if (!channel && typeof this.client.channels?.fetch === 'function') {
      channel = await this.client.channels.fetch(String(channelId)).catch(() => null);
    }
    return channel;
  }

  async _update(player, state, guildId) {
    const saved = this.database.getGuildSetting(guildId, SETTING_KEY, null);
    let channel = saved?.channelId ? await this._channelFromId(saved.channelId) : null;
    if (!channel || (channel.guildId && String(channel.guildId) !== guildId)) channel = player.lastChannel || null;
    if (!channel || (channel.guildId && String(channel.guildId) !== guildId)) return false;

    let message = null;
    if (saved?.messageId && saved?.channelId && String(channel.id) === String(saved.channelId)) {
      if (typeof channel.messages?.fetch === 'function') {
        message = await channel.messages.fetch(String(saved.messageId)).catch(() => null);
      }
    }
    const active = Boolean(state?.isPlaying && state.current);
    const payload = { embeds: [statusEmbed(state, channel.guild?.name)] };
    if (message) {
      await message.edit(payload);
      return true;
    }
    if (!active || typeof channel.send !== 'function') return false;

    message = await channel.send(payload);
    if (message?.id) {
      this.database.setGuildSetting(guildId, SETTING_KEY, {
        channelId: String(channel.id),
        messageId: String(message.id),
      });
    }
    return Boolean(message);
  }
}

module.exports = { GuildNowPlayingManager, statusEmbed, SETTING_KEY };
