/** Lecteur vocal maison : WebSocket vocal + UDP/RTP + Opus. */
const { VoiceConnection } = require('./voice');
const { OpusSender } = require('./audioSender');
const { createThemedEmbed } = require('../../shared/discord/embedTheme');
const { musicArtwork } = require('./artwork');
const { normalizeProviderUrl } = require('../../shared/discord/providerPresentation');

const VOICE_REQUEST_TIMEOUT_MS = 15_000;
const configuredIdleMinutes = Number(process.env.VOICE_IDLE_TIMEOUT_MINUTES);
const VOICE_IDLE_TIMEOUT_MINUTES = configuredIdleMinutes === 1 || configuredIdleMinutes === 2
  ? configuredIdleMinutes
  : 2;
const VOICE_IDLE_TIMEOUT_MS = VOICE_IDLE_TIMEOUT_MINUTES * 60_000;
const VOICE_NOTICE_SEND_TIMEOUT_MS = 1_500;
const VOICE_NOTICE_TTL_MS = 30_000;

function gatewayShardForGuild(client, guildId) {
  const guild = client.guilds?.cache?.get?.(String(guildId));
  const shard = guild?.shard;
  if (!shard || typeof shard.send !== 'function') {
    throw new Error(`Serveur Discord ${guildId} absent du cache ou shard indisponible.`);
  }
  return shard;
}

class MusicPlayer {
  constructor(guildId, client, { keepAlive, inactivityTimeoutMs = VOICE_IDLE_TIMEOUT_MS, noticeTtlMs = VOICE_NOTICE_TTL_MS } = {}) {
    this.guildId = guildId; this.client = client; this.queue = [];
    this.current = null; this.isPlaying = false; this.isPaused = false;
    this.loopMode = 0; this.volume = 1; this.connection = null;
    this.connecting = null; this.sender = null; this.lastChannel = null;
    this.addedBy = '?'; this.voiceChannelName = '?'; this._generation = 0;
    this._idleTimer = null; this._aloneTimer = null;
    this.keepAlive = typeof keepAlive === 'function' ? keepAlive : () => false;
    this.inactivityTimeoutMs = Math.max(1, Number(inactivityTimeoutMs) || VOICE_IDLE_TIMEOUT_MS);
    this.noticeTtlMs = Math.max(1, Number(noticeTtlMs) || VOICE_NOTICE_TTL_MS);
    this._enqueueOperation = Promise.resolve();
    this._queueEpoch = 0;
    this.onQueueEnd = null;
  }
  addToQueue(song) { this._clearIdleTimer(); this.queue.push(song); }
  getNextSong() { if (this.loopMode === 2 && this.current) this.queue.push(this.current); return this.queue.shift(); }
  clearQueue() { this.queue = []; }
  shuffleQueue() {
    for (let index = this.queue.length - 1; index > 0; index--) {
      const other = Math.floor(Math.random() * (index + 1));
      [this.queue[index], this.queue[other]] = [this.queue[other], this.queue[index]];
    }
    return this.queue;
  }

  enqueueSongs(songs, {
    voiceChannel,
    addedBy,
    requesterId,
    lastChannel,
    lang,
    insertFirst = false,
  } = {}) {
    const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
    if (!list.length) return Promise.reject(new Error('Aucune musique jouable à ajouter à la file.'));
    const epoch = this._queueEpoch;

    const enqueue = async () => {
      if (epoch !== this._queueEpoch) {
        const error = new Error('Demande musicale annulée par Stop ou déconnexion.');
        error.code = 'AUDIO_CANCELLED';
        throw error;
      }
      const connected = Boolean(this.connection?.connected);
      const active = connected && Boolean(this.isPlaying || this.current || this.sender);
      if (active && voiceChannel?.id && String(this.connection.channelId) !== String(voiceChannel.id)) {
        throw new Error('Le bot écoute déjà dans un autre salon vocal de ce serveur. Rejoins son salon pour ajouter une musique.');
      }
      if (!active) {
        if (!voiceChannel) throw new Error('Rejoins un salon vocal avant d’ajouter une musique.');
      }

      const entries = list.map((song) => ({
        ...song,
        thumbnail: musicArtwork(song),
        addedBy: addedBy || song.addedBy || '?',
        requesterId: requesterId || song.requesterId || null,
        voiceChannelName: voiceChannel?.name || song.voiceChannelName || this.voiceChannelName,
        requestChannel: lastChannel || song.requestChannel || null,
        nowPlayingLang: lang || song.nowPlayingLang || this.nowPlayingLang || 'fr',
      }));
      if (insertFirst) this.queue.unshift(...entries);
      else this.queue.push(...entries);
      this._clearIdleTimer();

      if (!active) await this.playNext(undefined, { voiceChannel });
      else await this._activity();
      if (epoch !== this._queueEpoch) {
        const error = new Error('Demande musicale annulée par Stop ou déconnexion.');
        error.code = 'AUDIO_CANCELLED';
        throw error;
      }

      return {
        added: entries.length,
        queued: active,
        queuedCount: active ? entries.length : Math.max(0, entries.length - 1),
        player: this,
      };
    };

    // Les demandes d’un même serveur sont sérialisées jusqu’au démarrage de
    // l’extraction audio : deux /play simultanés ne peuvent plus se remplacer.
    const operation = this._enqueueOperation.then(enqueue, enqueue);
    this._enqueueOperation = operation.catch(() => {});
    return operation;
  }

  _clearIdleTimer() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }

  _clearAloneTimer() {
    if (this._aloneTimer) clearTimeout(this._aloneTimer);
    this._aloneTimer = null;
  }

  _hasHumanMembers(channelId) {
    const guild = this.client.guilds?.cache?.get?.(String(this.guildId));
    const channel = guild?.channels?.cache?.get?.(String(channelId));
    // Si le salon n'est pas dans le cache, ne pas le déconnecter sur une supposition.
    if (!channel?.members) return true;
    return channel.members.some(member => !member.user?.bot);
  }

  _isAlwaysOn() {
    try { return Boolean(this.keepAlive()); }
    catch (error) {
      console.warn(`[voice] Lecture du réglage 24/7 impossible (serveur ${this.guildId}): ${error.message}`);
      return false;
    }
  }

  async _leaveForInactivity(connection, reason, channelId) {
    if (this.connection !== connection || this._isAlwaysOn()) return;
    const canLeave = () => {
      if (this.connection !== connection || this._isAlwaysOn()) return false;
      if (reason === 'idle') return !this.isPlaying && !this.current && this.queue.length === 0;
      return String(connection.channelId) === String(channelId) && !this._hasHumanMembers(channelId);
    };
    if (!canLeave()) return;

    // Une seule des deux échéances doit notifier/déconnecter le lecteur.
    this._clearIdleTimer();
    this._clearAloneTimer();
    const idle = reason === 'idle';
    const embed = createThemedEmbed('warning')
      .setTitle(idle ? '⏱️ Déconnexion pour inactivité' : '👋 Déconnexion du salon vocal')
      .setDescription(idle
        ? `Je quitte le salon vocal après ${VOICE_IDLE_TIMEOUT_MINUTES} min sans musique. Active **/24-7** pour rester connecté.`
        : `Je quitte le salon vocal car il n’y a plus de membre depuis ${VOICE_IDLE_TIMEOUT_MINUTES} min. Active **/24-7** pour rester connecté.`)
      .setTimestamp();

    const noticePromise = Promise.resolve()
      .then(() => this.lastChannel?.send?.({ embeds: [embed] }))
      .then((message) => {
        if (typeof message?.delete === 'function') {
          const timer = setTimeout(() => Promise.resolve(message.delete()).catch(() => {}), this.noticeTtlMs);
          timer.unref?.();
        }
        return message;
      })
      .catch((error) => {
        console.warn(`[voice] Notification d’inactivité impossible serveur=${this.guildId}: ${error.message}`, error);
        return null;
      });
    let sendTimeout;
    await Promise.race([
      noticePromise,
      new Promise((resolve) => { sendTimeout = setTimeout(resolve, VOICE_NOTICE_SEND_TIMEOUT_MS); }),
    ]);
    clearTimeout(sendTimeout);

    // La notification est asynchrone : une nouvelle chanson, un membre ou
    // l’activation du mode 24/7 pendant l’envoi doit annuler le départ.
    if (!canLeave()) return;
    console.info(`[voice] Déconnexion après ${VOICE_IDLE_TIMEOUT_MINUTES} min d’inactivité (${reason}, serveur ${this.guildId}).`);
    this.leave();
  }

  /** Demande au Gateway principal de quitter le vocal avant de fermer WS/UDP. */
  leave() {
    const connection = this.connection;
    if (connection?.connected) {
      try {
        const shard = gatewayShardForGuild(this.client, this.guildId);
        shard.send({ op: 4, d: {
          guild_id: String(this.guildId),
          channel_id: null,
          self_mute: false,
          self_deaf: false,
        } });
      } catch (error) {
        console.error(`[voice] Demande de sortie vocale au Gateway impossible serveur=${this.guildId}: ${error.message}`, error);
      }
    }
    return this.destroy();
  }

  _scheduleIdleLeave() {
    this._clearIdleTimer();
    if (this._isAlwaysOn() || !this.connection?.connected || this.isPlaying || this.current || this.queue.length) return;
    const connection = this.connection;
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      this._leaveForInactivity(connection, 'idle').catch(error => {
        console.error(`[voice] Déconnexion d’inactivité impossible serveur=${this.guildId}: ${error.message}`, error);
      });
    }, this.inactivityTimeoutMs);
    this._idleTimer.unref?.();
  }

  _scheduleAloneLeave(channelId) {
    this._clearAloneTimer();
    const connection = this.connection;
    if (this._isAlwaysOn() || !connection?.connected || String(connection.channelId) !== String(channelId)) return;
    this._aloneTimer = setTimeout(() => {
      this._aloneTimer = null;
      this._leaveForInactivity(connection, 'alone', channelId).catch(error => {
        console.error(`[voice] Déconnexion sans membre impossible serveur=${this.guildId}: ${error.message}`, error);
      });
    }, this.inactivityTimeoutMs);
    this._aloneTimer.unref?.();
  }

  handleVoiceStateUpdate(oldChannelId, newChannelId) {
    const channelId = this.connection?.channelId;
    if (!channelId) return;
    const watched = String(channelId);
    if (String(newChannelId || '') === watched) {
      this._clearAloneTimer();
    } else if (String(oldChannelId || '') === watched) {
      this._scheduleAloneLeave(watched);
    }
  }

  async ensureConnection(channel) {
    if (this.connection?.connected && this.connection.channelId === channel.id) {
      const channelBitrate = Number(channel.bitrate);
      if (Number.isFinite(channelBitrate) && channelBitrate > 0) this.connection.audioBitrate = channelBitrate;
      return this.connection;
    }
    if (this.connecting) return this.connecting;
    this._clearIdleTimer();
    this._clearAloneTimer();
    this.connecting = (async () => {
      if (this.connection) this.connection.destroy();
      const info = await this._requestVoice(channel.id);
      const conn = new VoiceConnection({ ...info, serverId: this.guildId, userId: this.client.user.id });
      conn.channelId = channel.id;
      const channelBitrate = Number(channel.bitrate);
      conn.audioBitrate = Number.isFinite(channelBitrate) && channelBitrate > 0 ? channelBitrate : 160_000;
      conn.on('error', (e) => console.error(`[voice] Erreur serveur=${this.guildId}:`, e.message, e));
      await conn.connect(); this.connection = conn;
      console.log(`✅ Connexion vocale maison prête serveur=${this.guildId}.`);
      this._scheduleIdleLeave();
      return conn;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  _requestVoice(channelId) {
    return new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      let state, server;
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.client.removeListener('raw', onRaw);
      };
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };
      const onRaw = (pkt) => {
        const data = pkt?.d;
        // Plusieurs guildes peuvent émettre ces événements en parallèle : les
        // combiner sans vérifier guild_id peut associer un token vocal erroné.
        if (String(data?.guild_id || '') !== String(this.guildId)) return;
        if (pkt.t === 'VOICE_STATE_UPDATE'
            && data.user_id === this.client.user.id
            && data.channel_id === channelId
            && data.session_id) {
          state = data.session_id;
        } else if (pkt.t === 'VOICE_SERVER_UPDATE' && data.endpoint && data.token) {
          server = { endpoint: data.endpoint, token: data.token };
        }
        if (state && server) finish(null, { endpoint: server.endpoint, token: server.token, sessionId: state });
      };
      try {
        const shard = gatewayShardForGuild(this.client, this.guildId);
        this.client.on('raw', onRaw);
        timer = setTimeout(() => {
          const error = new Error('La connexion vocale Discord n’a pas répondu à temps. Réessaie dans quelques secondes.');
          error.code = 'VOCAL_UNAVAILABLE';
          finish(error);
        }, VOICE_REQUEST_TIMEOUT_MS);
        shard.send({ op: 4, d: {
          guild_id: this.guildId,
          channel_id: channelId,
          self_mute: false,
          self_deaf: false,
        } });
      } catch (cause) {
        const error = new Error(cause?.message || 'Impossible de transmettre la demande au Gateway Discord.');
        error.code = 'VOCAL_UNAVAILABLE';
        finish(error);
      }
    });
  }

  async playNext(onEmbed, { notifyWhenEmpty = false, endedRequesterId = null, endedTrack = false, voiceChannel = null } = {}) {
    this._clearIdleTimer();
    if (this.loopMode === 1 && this.current) this.queue.unshift(this.current);
    const song = this.getNextSong();
    if (!song) {
      const requesterId = this.current?.requesterId || endedRequesterId || null;
      const hadCurrent = Boolean(this.current || endedTrack);
      this.isPlaying = false;
      this.current = null;
      this.sender = null;
      await this._activity();
      if (notifyWhenEmpty && hadCurrent) {
        try { await this.onQueueEnd?.(this, requesterId); }
        catch (error) { console.warn(`[now-playing] fin de file serveur=${this.guildId}: ${error.message}`, error); }
      }
      this._scheduleIdleLeave();
      return null;
    }
    if (!this.connection?.connected && !voiceChannel) throw new Error("Le bot n'est connecté à aucun canal vocal.");
    if (this.sender) this.sender.stop();
    this.current = song; this.isPlaying = true; this.isPaused = false;
    this.addedBy = song.addedBy || this.addedBy;
    this.voiceChannelName = song.voiceChannelName || this.voiceChannelName;
    this.nowPlayingLang = song.nowPlayingLang || this.nowPlayingLang || 'fr';
    if (Object.hasOwn(song, 'requestChannel')) this.lastChannel = song.requestChannel;
    const generation = ++this._generation;
    let preparedMedia = null;
    const failTrack = async (error) => {
      if (generation !== this._generation || !this.isPlaying) return;
      console.error(`[audio] piste « ${String(song.title || 'inconnue').slice(0, 120)} » interrompue (${error.code || 'AUDIO_ERROR'}) serveur=${this.guildId}: ${error.message}`, error);
      this.isPlaying = false;
      this.isPaused = false;
      this.current = null;
      this.sender = null;
      this._activity();
      // Une erreur de flux n'est pas une fin normale. Ne jamais remplacer
      // silencieusement la piste demandée par un ancien titre en attente.
      this.clearQueue();
      this._scheduleIdleLeave();
      try {
        await this.lastChannel?.send({ content: `❌ Lecture interrompue : ${error.message}\nLa file a été annulée pour éviter de lancer un autre titre involontairement.`, allowedMentions: { parse: [] } });
      } catch (_) { /* salon supprimé ou permissions manquantes */ }
    };
    try {
      // Résoudre le flux avant le handshake, sans stocker de flux entre guildes.
      // Stop/leave invalide cette préparation et ferme sa source asynchrone.
      if (voiceChannel && (!this.connection?.connected || this.connection.channelId !== voiceChannel.id)) {
        this.isPlaying = false;
        preparedMedia = await OpusSender.prepare(song.url, song.fallbackQuery, {
          expectedDuration: song.duration, expectedTitle: song.title, guildId: this.guildId,
        });
        if (generation !== this._generation) {
          preparedMedia.stream?.cleanup?.(); preparedMedia.stream?.destroy?.();
          return null;
        }
        await this.ensureConnection(voiceChannel);
        if (generation !== this._generation) {
          preparedMedia.stream?.cleanup?.(); preparedMedia.stream?.destroy?.();
          if (!this.current && !this.isPlaying) await this.leave();
          return null;
        }
        this.isPlaying = true;
      }
      if (preparedMedia?.stream?.errored || preparedMedia?.stream?.destroyed) {
        throw preparedMedia.stream.errored || new Error('Le flux audio a été fermé pendant la connexion vocale.');
      }
      console.info(`[audio] démarrage serveur=${this.guildId} session=${generation} titre=${JSON.stringify(song.title)} file=${this.queue.length}`);
      const sender = await OpusSender.start(this.connection, song.url, () => console.log(`🔊 SON ÉMIS — lecture maison active serveur=${this.guildId}.`), async () => {
        if (generation === this._generation && this.isPlaying) {
          this.sender = null;
          try { await this.playNext(undefined, { notifyWhenEmpty: true }); }
          catch (error) {
            console.error(`[audio] piste suivante serveur=${this.guildId}: ${error.message}`, error);
            try { await this.lastChannel?.send({ content: `❌ Impossible de lire le titre suivant : ${error.message}`, allowedMentions: { parse: [] } }); }
            catch (_) { /* salon inaccessible */ }
          }
        }
      }, failTrack, song.fallbackQuery, {
        expectedDuration: song.duration,
        expectedTitle: song.title,
        guildId: this.guildId,
        preparedMedia,
        initialVolume: this.volume,
        shouldStart: () => generation === this._generation && this.isPlaying,
      });
      if (generation !== this._generation) {
        sender?.stop?.();
        return null;
      }
      this.sender = sender;
      if (this.isPaused) this.sender?.pause?.();
    } catch (error) {
      preparedMedia?.stream?.cleanup?.(); preparedMedia?.stream?.destroy?.();
      if (generation !== this._generation) return null;
      // L'extraction du flux peut échouer avant que le processus audio existe.
      // Réinitialiser l'état évite qu'une tentative ratée bloque toute la file.
      if (generation === this._generation) {
        this.isPlaying = false;
        this.isPaused = false;
        this.current = null;
        this.sender = null;
        this.clearQueue();
        this._activity();
        this._scheduleIdleLeave();
      }
      throw error;
    }
    this.sender.setVolume(this.volume);
    if (onEmbed) await onEmbed(song);
    this._activity(); return song;
  }
  pause() { this.sender?.pause?.(); this.isPaused = true; return this._activity(); }
  resume() { this.sender?.resume?.(); this.isPaused = false; return this._activity(); }
  skip() {
    if (!this.isPlaying && !this.current) return Promise.resolve(null);
    const requesterId = this.current?.requesterId || null;
    ++this._generation;
    this.sender?.stop();
    this.sender = null;
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    return this.playNext(undefined, { notifyWhenEmpty: true, endedRequesterId: requesterId, endedTrack: true });
  }
  stop() {
    ++this._queueEpoch;
    ++this._generation; this._clearIdleTimer(); this.clearQueue(); this.sender?.stop();
    this.sender = null; this.current = null; this.isPlaying = false; this.isPaused = false;
    const update = this._activity();
    this._scheduleIdleLeave();
    return update;
  }
  destroy() {
    const connection = this.connection;
    this.connection = null;
    this._clearIdleTimer(); this._clearAloneTimer();
    const update = this.stop();
    this._clearIdleTimer();
    connection?.destroy();
    return update;
  }
  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    this.sender?.setVolume?.(this.volume);
    this._activity();
    return Math.round(this.volume * 100);
  }
  _activity() {
    const state = {
      current: this.isPlaying && this.current ? {
        title: this.current.title,
        thumbnail: musicArtwork(this.current),
        source: this.current.source || 'youtube',
        provider: this.current.provider || this.current.source || 'youtube',
        sourceUrl: normalizeProviderUrl(this.current.provider || this.current.source || 'youtube', this.current.sourceUrl || this.current.url),
        duration: Number(this.current.duration) || 0,
      } : null,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      queueLength: this.queue.length,
      volume: Math.round(this.volume * 100),
      addedBy: this.addedBy,
      requesterId: this.current?.requesterId || null,
      voiceChannelName: this.voiceChannelName,
      lang: this.nowPlayingLang || 'fr',
      loopMode: this.loopMode,
      playbackId: this._generation,
    };
    try {
      // Une présence Discord est commune à tous les serveurs. Le titre est
      // uniquement publié par le callback dans le salon de ce serveur.
      const update = this.onActivityChange?.(state);
      update?.catch?.((error) => console.warn(`[now-playing] serveur=${this.guildId}: ${error.message}`, error));
      return update;
    } catch (_) { /* ignore */ }
    return Promise.resolve(false);
  }
  getState() { const f = (s) => s && ({ title: s.title, url: s.url, thumbnail: s.thumbnail || null, source: s.source || 'youtube', duration: s.duration || 0 }); return { current: f(this.current), queue: this.queue.map(f), isPlaying: this.isPlaying, isPaused: this.isPaused, loopMode: this.loopMode, volume: this.volume }; }
}
module.exports = { MusicPlayer };
