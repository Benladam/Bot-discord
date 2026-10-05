/** Message de lecture et contrôles persistants, isolés par serveur Discord. */
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { createThemedEmbed } = require('../../shared/discord/embedTheme');
const { providerPresentation } = require('../../shared/discord/providerPresentation');
const { withProviderIcons } = require('../../shared/discord/providerIcons');
const { getWebPanelPublicUrl } = require('../web/server');
const { musicArtwork } = require('./artwork');
const { FILTERS } = require('./audioFilters');

const SETTING_KEY = 'musicNowPlayingMessage';
const LOOP_LABELS = ['Désactivée', 'Titre', 'File'];

function statusEmbed(state, guildName = '') {
  const song = state?.isPlaying ? state.current : null;
  if (!song) {
    return createThemedEmbed('neutral')
      .setTitle('⏹️ Aucune musique en cours')
      .setDescription('Le lecteur de ce serveur est arrêté ou en attente.')
      .setFooter({ text: 'Statut musical propre à ce serveur' });
  }

  const title = String(song.title || 'Musique inconnue').replace(/[\r\n]+/g, ' ').slice(0, 240);
  const loop = LOOP_LABELS[Math.max(0, Math.min(2, Number(state.loopMode) || 0))];
  const source = providerPresentation(song.provider || song.source, song.sourceUrl || song.url);
  const embed = createThemedEmbed(state.isPaused ? 'warning' : 'primary')
    .setAuthor({ name: `${source.name} · ${state.isPaused ? 'En pause' : 'Lecture en cours'}`, iconURL: source.iconURL, ...(source.url ? { url: source.url } : {}) })
    .setTitle(`${state.isPaused ? '⏸️' : '🎶'} ${title}`)
    .setDescription('\u200b\nUtilise les boutons ci-dessous pour contrôler la lecture.\n\u200b')
    .setFooter({ text: 'Lecteur musical · synchronisé à ce serveur' });
  const fields = [];
  if (state.addedBy) fields.push({ name: '👤 Ajouté par', value: String(state.addedBy).slice(0, 100), inline: true });
  if (state.voiceChannelName) fields.push({ name: '🔊 Salon vocal', value: String(state.voiceChannelName).slice(0, 100), inline: true });
  fields.push({ name: '📜 File', value: `${Math.max(0, Number(state.queueLength) || 0)} titre(s)`, inline: true });
  fields.push({ name: '\u200b', value: '\u200b', inline: false });
  fields.push({ name: '🔉 Volume', value: `${Math.max(0, Math.min(100, Number(state.volume) || 0))}%`, inline: true });
  fields.push({ name: '🔁 Répétition', value: loop, inline: true });
  if (Number(song.duration) > 0) fields.push({ name: '⏱️ Durée', value: formatDuration(song.duration), inline: true });
  if (state.filter && state.filter !== 'none' && FILTERS[state.filter]) fields.push({ name: '🎚️ Filtre audio', value: FILTERS[state.filter], inline: false });
  embed.addFields(fields);
  const artwork = musicArtwork(song);
  if (artwork) embed.setThumbnail(artwork);
  if (source.url) embed.setURL(source.url);
  return embed;
}

function formatDuration(seconds) {
  const duration = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`;
}

function controlComponents(guildId, state = {}) {
  const active = Boolean(state.current && (state.isPlaying || state.isPaused));
  const loopMode = Math.max(0, Math.min(2, Number(state.loopMode) || 0));
  const button = (action, label, emoji, style, disabled = !active) => new ButtonBuilder()
    .setCustomId(`musicctl:${guildId}:${action}`)
    .setLabel(label)
    .setEmoji({ name: emoji })
    .setStyle(style)
    .setDisabled(disabled);

  const controls = [new ActionRowBuilder().addComponents(
    button('pause', state.isPaused ? 'Reprendre' : 'Pause', state.isPaused ? '▶️' : '⏸️', ButtonStyle.Primary),
    button('skip', 'Suivant', '⏭️', ButtonStyle.Secondary),
    button('stop', 'Stop', '⏹️', ButtonStyle.Danger),
    button('loop', `Boucle · ${LOOP_LABELS[loopMode]}`, loopMode === 1 ? '🔂' : '🔁', ButtonStyle.Secondary),
    button('queue', `File · ${Math.max(0, Number(state.queueLength) || 0)}`, '📜', ButtonStyle.Secondary),
  )];
  const dashboardButton = button('dashboard', 'Dashboard', '🎛️', ButtonStyle.Secondary, false);
  controls.push(new ActionRowBuilder().addComponents(
    button('shuffle', 'Mélanger', '🔀', ButtonStyle.Secondary, Number(state.queueLength) < 2),
    dashboardButton,
  ));
  return controls;
}

function startedPlayingEmbed(song) {
  const source = providerPresentation(song.provider || song.source, song.sourceUrl || song.url);
  const embed = createThemedEmbed('success')
    .setAuthor({ name: source.name, iconURL: source.iconURL, ...(source.url ? { url: source.url } : {}) })
    .setTitle(`Started playing · ${String(song.title || 'Musique inconnue').replace(/[\r\n]+/g, ' ').slice(0, 225)}`);
  if (source.url) embed.setURL(source.url);
  if (Number(song.duration) > 0) embed.setDescription(`⏱️ ${formatDuration(song.duration)}`);
  const artwork = musicArtwork(song);
  if (artwork) embed.setThumbnail(artwork);
  return embed;
}

function dashboardPayload(player) {
  const volume = Math.round(player.volume * 100);
  const embed = createThemedEmbed('primary')
    .setTitle('🎛️ Dashboard musical')
    .setDescription(`**${String(player.current?.title || 'Aucune musique en cours').slice(0, 250)}**\n\nRéglages synchronisés au lecteur de ce serveur.\nLes modifications s’appliquent immédiatement.`)
    .addFields(
      { name: '🔉 Volume', value: `**${volume}%**`, inline: true },
      { name: '📜 File', value: `${player.queue.length} titre(s)`, inline: true },
      { name: '🔁 Répétition', value: LOOP_LABELS[player.loopMode] || LOOP_LABELS[0], inline: true },
    );
  const button = (action, label, emoji, disabled = false) => new ButtonBuilder()
    .setCustomId(`musicctl:${player.guildId}:dash-${action}`).setLabel(label)
    .setEmoji({ name: emoji }).setStyle(ButtonStyle.Secondary).setDisabled(disabled);
  const rows = [new ActionRowBuilder().addComponents(
    button('down', '−10%', '🔉', volume <= 0), button('up', '+10%', '🔊', volume >= 100),
    button('mute', volume === 0 ? 'Rétablir' : 'Muet', '🔇'), button('reset', '100%', '🎚️'),
  ), new ActionRowBuilder().addComponents(
    button('loop', 'Répétition', '🔁'), button('shuffle', 'Mélanger', '🔀', player.queue.length < 2),
    button('refresh', 'Actualiser', '🔄'),
  )];
  const webUrl = getWebPanelPublicUrl();
  if (webUrl) {
    const url = new URL(webUrl);
    url.searchParams.set('guild', String(player.guildId));
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Panneau web').setStyle(ButtonStyle.Link).setURL(url.toString())));
  }
  return { embeds: [embed], components: rows };
}

function finishedQueueEmbed(guildName = '') {
  return createThemedEmbed('warning')
    .setTitle('📜 File d’attente terminée')
    .setDescription('Il n’y a plus de chansons dans la file. Vous pouvez en ajouter d’autres avec `/play`.')
    .setFooter({ text: `Merci d’avoir écouté${guildName ? ` sur ${String(guildName).slice(0, 100)}` : ''} 🎶` })
    .setTimestamp();
}

function queueEmbed(player) {
  const lines = [];
  if (player.current) lines.push(`🎶 **En cours :** ${String(player.current.title || 'Musique inconnue').slice(0, 180)}`);
  if (!player.queue.length) lines.push('La file est vide.');
  else player.queue.slice(0, 10).forEach((song, index) => {
    lines.push(`**${index + 1}.** ${String(song.title || 'Musique inconnue').slice(0, 160)}`);
  });
  if (player.queue.length > 10) lines.push(`… et ${player.queue.length - 10} autre(s) titre(s).`);
  return createThemedEmbed('primary')
    .setTitle(`📜 File d’attente · ${player.queue.length} titre(s)`)
    .setDescription(lines.join('\n\n').slice(0, 4000));
}

class GuildNowPlayingManager {
  constructor({ client, database, log = () => {}, noticeTtlMs = 30_000 }) {
    this.client = client;
    this.database = database;
    this.log = log;
    this.noticeTtlMs = noticeTtlMs;
    this.pending = new Map();
    this.finishedNotices = new Map();
    this.announcedPlayback = new Map();
    this.updateVersions = new Map();
  }

  _enqueueGuild(guildId, task) {
    const previous = this.pending.get(guildId) || Promise.resolve();
    const operation = previous.catch(() => {}).then(task).catch((error) => {
      this.log('warn', `[now-playing][guild=${guildId}] ${String(error.message || error).slice(0, 300)}`);
      return false;
    });
    this.pending.set(guildId, operation);
    return operation.finally(() => {
      if (this.pending.get(guildId) === operation) this.pending.delete(guildId);
    });
  }

  update(player, state) {
    const guildId = String(player?.guildId || '');
    if (!guildId) return Promise.resolve(false);
    const version = (this.updateVersions.get(guildId) || 0) + 1;
    this.updateVersions.set(guildId, version);
    return this._enqueueGuild(guildId, () => {
      if (this.updateVersions.get(guildId) !== version) return false;
      return this._update(player, state, guildId);
    });
  }

  finishQueue(player, requesterId = null) {
    const guildId = String(player?.guildId || '');
    if (!guildId) return Promise.resolve(false);
    return this._enqueueGuild(guildId, () => this._finishQueue(player, guildId, requesterId));
  }

  async _channelFromId(channelId) {
    if (!channelId) return null;
    let channel = this.client.channels?.cache?.get?.(String(channelId)) || null;
    if (!channel && typeof this.client.channels?.fetch === 'function') {
      channel = await this.client.channels.fetch(String(channelId)).catch(() => null);
    }
    return channel;
  }

  async _clearFinishedNotice(guildId) {
    const notice = this.finishedNotices.get(guildId);
    if (!notice) return;
    this.finishedNotices.delete(guildId);
    clearTimeout(notice.timer);
    let deleted = false;
    if (typeof notice.message?.delete === 'function') {
      try { await notice.message.delete(); deleted = true; }
      catch (_) { /* Ne jamais réutiliser un avis temporaire comme carte musicale. */ }
    }
    const saved = this.database.getGuildSetting(guildId, SETTING_KEY, null);
    if (saved?.finishedNotice && String(saved.messageId || '') === String(notice.message?.id || '')) {
      this.database.setGuildSetting(guildId, SETTING_KEY, {
        channelId: String(saved.channelId),
        messageId: null,
      });
    }
    return deleted;
  }

  async _update(player, state, guildId) {
    const active = Boolean(state?.isPlaying && state.current);
    if (active) await this._clearFinishedNotice(guildId);
    let saved = this.database.getGuildSetting(guildId, SETTING_KEY, null);
    // La carte durable représente seulement une chanson en lecture. Ne pas
    // toucher à l’avis « file terminée », qui possède son propre délai de 30 s.
    if (!active && saved?.finishedNotice) return true;
    if (active && saved?.finishedNotice) {
      // Avis hérité d'un redémarrage : aucune carte ne doit adopter son ID.
      const oldChannel = await this._channelFromId(saved.channelId);
      if (!oldChannel?.guildId || String(oldChannel.guildId) === guildId) {
        const oldMessage = await oldChannel?.messages?.fetch?.(String(saved.messageId)).catch(() => null);
        try { await oldMessage?.delete?.(); } catch (_) {}
      }
      saved = { channelId: saved.channelId, messageId: null };
      this.database.setGuildSetting(guildId, SETTING_KEY, saved);
    }
    let channel = saved?.channelId ? await this._channelFromId(saved.channelId) : null;
    if (!channel || (channel.guildId && String(channel.guildId) !== guildId)) channel = player.lastChannel || null;
    if (!channel || (channel.guildId && String(channel.guildId) !== guildId)) return false;

    let message = null;
    if (saved?.messageId && saved?.channelId && String(channel.id) === String(saved.channelId)) {
      if (typeof channel.messages?.fetch === 'function') {
        message = await channel.messages.fetch(String(saved.messageId)).catch(() => null);
      }
    }
    if (!active) {
      this.announcedPlayback.delete(guildId);
      if (message && typeof message.delete === 'function') {
        await Promise.resolve(message.delete()).catch(() => {});
      }
      if (saved?.messageId) {
        this.database.setGuildSetting(guildId, SETTING_KEY, {
          channelId: String(channel.id),
          messageId: null,
        });
      }
      return false;
    }
    const payload = withProviderIcons({
      embeds: [statusEmbed(state, channel.guild?.name)],
      components: controlComponents(guildId, state),
      allowedMentions: { parse: [] },
    });
    const playback = state.playbackId ?? JSON.stringify([state.current.sourceUrl, state.current.url, state.current.title]);
    if (this.announcedPlayback.get(guildId) !== playback) {
      // Historique durable : jamais enregistré dans l'emplacement des messages temporaires.
      await channel.send(withProviderIcons({ embeds: [startedPlayingEmbed(state.current)], allowedMentions: { parse: [] } }));
      this.announcedPlayback.set(guildId, playback);
    }
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

  async _finishQueue(player, guildId, requesterId) {
    if (player.isPlaying || player.current || player.queue?.length) return false;
    await this._clearFinishedNotice(guildId);
    const saved = this.database.getGuildSetting(guildId, SETTING_KEY, null);
    let channel = saved?.channelId ? await this._channelFromId(saved.channelId) : player.lastChannel || null;
    if (!channel || (channel.guildId && String(channel.guildId) !== guildId)) return false;

    let statusMessage = null;
    if (saved?.messageId && saved?.channelId && String(channel.id) === String(saved.channelId)) {
      if (typeof channel.messages?.fetch === 'function') {
        statusMessage = await channel.messages.fetch(String(saved.messageId)).catch(() => null);
      }
    }
    if (player.isPlaying || player.current || player.queue?.length) return false;

    let noticeMessage = null;
    if (statusMessage && typeof statusMessage.delete === 'function') {
      try { await statusMessage.delete(); }
      catch (_) {
        // Sans permission de suppression, on réutilise le statut comme avis
        // temporaire : il sera effacé ou remplacé au prochain /play.
        if (typeof statusMessage.edit === 'function') {
          try {
            await statusMessage.edit({
              content: '',
              embeds: [finishedQueueEmbed(channel.guild?.name)],
              components: [],
              allowedMentions: { parse: [], users: [], repliedUser: false },
            });
            noticeMessage = statusMessage;
          } catch (_) { /* tenter d’envoyer un nouveau message */ }
        }
      }
    }
    const becameActive = Boolean(player.isPlaying || player.current || player.queue?.length);
    this.database.setGuildSetting(guildId, SETTING_KEY, {
      channelId: String(channel.id),
      messageId: null,
    });
    if (becameActive) return false;

    if (!noticeMessage && typeof channel.send === 'function') {
      noticeMessage = await channel.send({
        embeds: [finishedQueueEmbed(channel.guild?.name)],
        components: [],
        allowedMentions: { parse: [], users: [], repliedUser: false },
      }).catch(() => null);
    }
    if (!noticeMessage) return false;

    const notice = { message: noticeMessage, timer: null };
    notice.timer = setTimeout(() => {
      this._enqueueGuild(guildId, async () => {
        if (this.finishedNotices.get(guildId) !== notice) return;
        this.finishedNotices.delete(guildId);
        let deleted = false;
        try {
          await notice.message.delete?.();
          deleted = typeof notice.message.delete === 'function';
        } catch (_) {
          try {
            await notice.message.edit?.({ content: '', embeds: [finishedQueueEmbed()], components: [], allowedMentions: { parse: [], users: [] } });
          } catch (_) { /* le message n’est plus modifiable */ }
        }
        const current = this.database.getGuildSetting(guildId, SETTING_KEY, null);
        if (current?.finishedNotice && String(current.messageId || '') === String(notice.message?.id || '')) {
          this.database.setGuildSetting(guildId, SETTING_KEY, {
            channelId: String(current.channelId),
            messageId: deleted ? null : String(notice.message?.id || '') || null,
          });
        }
      }).catch(() => {});
    }, this.noticeTtlMs);
    notice.timer.unref?.();
    this.finishedNotices.set(guildId, notice);
    this.database.setGuildSetting(guildId, SETTING_KEY, {
      channelId: String(channel.id),
      messageId: String(noticeMessage.id || ''),
      finishedNotice: true,
    });
    return true;
  }

  async resetAfterRestart(guildIds = []) {
    let removed = 0;
    for (const value of guildIds) {
      const guildId = String(value?.id || value || '');
      if (!guildId) continue;
      await this._clearFinishedNotice(guildId);
      const saved = this.database.getGuildSetting(guildId, SETTING_KEY, null);
      if (!saved) continue;
      const channel = saved?.channelId ? await this._channelFromId(saved.channelId) : null;
      let remainingMessageId = null;
      if (channel && (!channel.guildId || String(channel.guildId) === guildId)
          && saved?.messageId && typeof channel.messages?.fetch === 'function') {
        const message = await channel.messages.fetch(String(saved.messageId)).catch(() => null);
        if (message?.delete) {
          try { await message.delete(); removed += 1; }
          catch (error) {
            this.log('warn', `[now-playing][guild=${guildId}] ancien statut non supprimé : ${String(error.message || error).slice(0, 200)}`);
            try {
              await message.edit({ embeds: [statusEmbed(null, channel.guild?.name)], components: controlComponents(guildId) });
              remainingMessageId = String(message.id);
              removed += 1;
            } catch (_) { /* l’ancien message reste inaccessible à modifier */ }
          }
        }
      }
      this.database.setGuildSetting(guildId, SETTING_KEY, saved?.channelId
        ? { channelId: String(saved.channelId), messageId: remainingMessageId }
        : null);
    }
    return removed;
  }

  async handleControl(interaction, getPlayer) {
    if (!interaction.customId?.startsWith('musicctl:')) return false;
    const [, buttonGuildId, action] = interaction.customId.split(':');
    if (!buttonGuildId || String(interaction.guildId || '') !== buttonGuildId) {
      await interaction.reply({ content: 'Ce contrôle musical n’appartient pas à ce serveur.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const player = getPlayer(interaction.guildId);
    const memberVoiceId = interaction.member?.voice?.channelId || interaction.member?.voice?.channel?.id;
    const botVoiceId = player.connection?.connected ? player.connection.channelId : null;
    if (!memberVoiceId || !botVoiceId || String(memberVoiceId) !== String(botVoiceId)) {
      await interaction.reply({ content: 'Rejoins le même salon vocal que le bot pour utiliser ces contrôles.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'dashboard') {
      await interaction.reply({ ...dashboardPayload(player), flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action.startsWith('dash-')) {
      const change = action.slice(5);
      if (!['down', 'up', 'mute', 'reset', 'loop', 'shuffle', 'refresh'].includes(change)) return false;
      await interaction.deferUpdate();
      if (change === 'down' || change === 'up') player.setVolume(player.volume + (change === 'up' ? 0.1 : -0.1));
      if (change === 'reset') player.setVolume(1);
      if (change === 'mute') {
        if (player.volume > 0) { player._unmutedVolume = player.volume; player.setVolume(0); }
        else player.setVolume(player._unmutedVolume || 1);
      }
      if (change === 'loop') player.loopMode = (Number(player.loopMode) + 1) % 3;
      if (change === 'shuffle' && player.queue.length > 1) player.shuffleQueue();
      await player._activity?.();
      await interaction.editReply(dashboardPayload(player));
      return true;
    }

    if (action === 'queue') {
      await interaction.reply({ embeds: [queueEmbed(player)], flags: MessageFlags.Ephemeral });
      return true;
    }
    if (action === 'shuffle') {
      if (player.queue.length < 2) {
        await interaction.reply({ content: 'Ajoute au moins deux titres avant de mélanger la file.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.deferUpdate();
      player.shuffleQueue();
      await player._activity?.();
      return true;
    }
    if (!player.current || !player.isPlaying) {
      await interaction.reply({ content: 'Aucune musique n’est en cours sur ce serveur.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!['pause', 'skip', 'stop', 'loop'].includes(action)) {
      await interaction.reply({ content: 'Contrôle musical inconnu.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferUpdate();

    if (action === 'pause') {
      if (player.isPaused) await player.resume();
      else await player.pause();
    } else if (action === 'skip') {
      await player.skip();
    } else if (action === 'stop') {
      await player.stop();
    } else if (action === 'loop') {
      player.loopMode = (Number(player.loopMode) + 1) % 3;
      await player._activity?.();
    }
    return true;
  }
}

module.exports = {
  GuildNowPlayingManager,
  statusEmbed,
  controlComponents,
  dashboardPayload,
  finishedQueueEmbed,
  startedPlayingEmbed,
  SETTING_KEY,
};
