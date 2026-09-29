/** Lecteur vocal maison : WebSocket vocal + UDP/RTP + Opus. */
const { VoiceConnection } = require('./voice');
const { OpusSender } = require('./audioSender');

const VOICE_REQUEST_TIMEOUT_MS = 15_000;
const configuredIdleMinutes = Number(process.env.VOICE_IDLE_TIMEOUT_MINUTES);
const VOICE_IDLE_TIMEOUT_MINUTES = configuredIdleMinutes === 1 || configuredIdleMinutes === 2
  ? configuredIdleMinutes
  : 2;
const VOICE_IDLE_TIMEOUT_MS = VOICE_IDLE_TIMEOUT_MINUTES * 60_000;

function gatewayShardForGuild(client, guildId) {
  const guild = client.guilds?.cache?.get?.(String(guildId));
  const shard = guild?.shard;
  if (!shard || typeof shard.send !== 'function') {
    throw new Error(`Serveur Discord ${guildId} absent du cache ou shard indisponible.`);
  }
  return shard;
}

class MusicPlayer {
  constructor(guildId, client) {
    this.guildId = guildId; this.client = client; this.queue = [];
    this.current = null; this.isPlaying = false; this.isPaused = false;
    this.loopMode = 0; this.volume = 1; this.connection = null;
    this.connecting = null; this.sender = null; this.lastChannel = null;
    this.addedBy = '?'; this.voiceChannelName = '?'; this._generation = 0;
    this._idleTimer = null; this._aloneTimer = null;
  }
  addToQueue(song) { this._clearIdleTimer(); this.queue.push(song); }
  getNextSong() { if (this.loopMode === 2 && this.current) this.queue.push(this.current); return this.queue.shift(); }
  clearQueue() { this.queue = []; }

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

  _scheduleIdleLeave() {
    this._clearIdleTimer();
    if (!this.connection?.connected || this.isPlaying || this.current || this.queue.length) return;
    const connection = this.connection;
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (this.connection !== connection || this.isPlaying || this.current || this.queue.length) return;
      console.info(`[voice] Déconnexion après ${VOICE_IDLE_TIMEOUT_MINUTES} min sans musique (serveur ${this.guildId}).`);
      this.destroy();
    }, VOICE_IDLE_TIMEOUT_MS);
    this._idleTimer.unref?.();
  }

  _scheduleAloneLeave(channelId) {
    this._clearAloneTimer();
    const connection = this.connection;
    if (!connection?.connected || String(connection.channelId) !== String(channelId)) return;
    this._aloneTimer = setTimeout(() => {
      this._aloneTimer = null;
      if (this.connection !== connection
          || String(connection.channelId) !== String(channelId)
          || this._hasHumanMembers(channelId)) return;
      console.info(`[voice] Déconnexion après ${VOICE_IDLE_TIMEOUT_MINUTES} min sans membre humain (serveur ${this.guildId}).`);
      this.destroy();
    }, VOICE_IDLE_TIMEOUT_MS);
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
      conn.on('error', (e) => console.error('[voice] Erreur:', e.message));
      await conn.connect(); this.connection = conn;
      console.log('✅ Connexion vocale maison prête.');
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

  async playNext(onEmbed) {
    this._clearIdleTimer();
    if (this.loopMode === 1 && this.current) this.queue.unshift(this.current);
    const song = this.getNextSong();
    if (!song) { this.isPlaying = false; this.current = null; this._activity(); this._scheduleIdleLeave(); return null; }
    if (!this.connection?.connected) throw new Error("Le bot n'est connecté à aucun canal vocal.");
    if (this.sender) this.sender.stop();
    this.current = song; this.isPlaying = true; this.isPaused = false;
    const generation = ++this._generation;
    try {
      this.sender = await OpusSender.start(this.connection, song.url, () => console.log('🔊 SON ÉMIS — lecture maison active.'), async () => {
        if (generation === this._generation && this.isPlaying) await this.playNext();
      }, async (error) => {
        if (generation !== this._generation || !this.isPlaying) return;
        console.error('[audio] lecture impossible:', error.message);
        this.isPlaying = false;
        this.isPaused = false;
        this.current = null;
        this.sender = null;
        this._activity();
        if (this.queue.length) {
          this.playNext().catch(nextError => console.error('[audio] piste suivante:', nextError.message));
        } else {
          this._scheduleIdleLeave();
        }
        try {
          await this.lastChannel?.send(`❌ Lecture impossible : ${error.message}`);
        } catch (_) { /* salon supprimé ou permissions manquantes */ }
      }, song.fallbackQuery);
    } catch (error) {
      // L'extraction du flux peut échouer avant que le processus audio existe.
      // Réinitialiser l'état évite qu'une tentative ratée bloque toute la file.
      if (generation === this._generation) {
        this.isPlaying = false;
        this.isPaused = false;
        this.current = null;
        this.sender = null;
        this._activity();
        this._scheduleIdleLeave();
      }
      throw error;
    }
    this.sender.setVolume(this.volume);
    if (onEmbed) await onEmbed(song);
    this._activity(); return song;
  }
  pause() { this.sender?.pause?.(); this.isPaused = true; }
  resume() { this.sender?.resume?.(); this.isPaused = false; }
  skip() {
    if (!this.isPlaying) return Promise.resolve(null);
    ++this._generation;
    this.sender?.stop();
    this.sender = null;
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    return this.playNext().catch((e) => { console.error('[audio] skip:', e.message); return null; });
  }
  stop() {
    ++this._generation; this._clearIdleTimer(); this.clearQueue(); this.sender?.stop();
    this.sender = null; this.current = null; this.isPlaying = false; this.isPaused = false;
    this._activity(); this._scheduleIdleLeave();
  }
  destroy() {
    const connection = this.connection;
    this.connection = null;
    this._clearIdleTimer(); this._clearAloneTimer(); this.stop(); this._clearIdleTimer();
    connection?.destroy();
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value) || 0)); this.sender?.setVolume?.(this.volume); return Math.round(this.volume * 100); }
  _activity() {
    const info = this.isPlaying && this.current ? { title: this.current.title } : null;
    try {
      if (typeof this.onActivityChange === 'function') this.onActivityChange(info);
      else this.client.user.setActivity(info ? '🎵 Lecture en cours' : '🎵 En attente', { type: 2 });
    } catch (_) { /* ignore */ }
  }
  getState() { const f = (s) => s && ({ title: s.title, url: s.url, thumbnail: s.thumbnail || null, source: s.source || 'youtube', duration: s.duration || 0 }); return { current: f(this.current), queue: this.queue.map(f), isPlaying: this.isPlaying, isPaused: this.isPaused, loopMode: this.loopMode, volume: this.volume }; }
}
module.exports = { MusicPlayer };
