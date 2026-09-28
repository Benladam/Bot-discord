/** Lecteur vocal maison : WebSocket vocal + UDP/RTP + Opus. */
const { VoiceConnection } = require('./voice');
const { OpusSender } = require('./audioSender');

class MusicPlayer {
  constructor(guildId, client) {
    this.guildId = guildId; this.client = client; this.queue = [];
    this.current = null; this.isPlaying = false; this.isPaused = false;
    this.loopMode = 0; this.volume = 1; this.connection = null;
    this.connecting = null; this.sender = null; this.lastChannel = null;
    this.addedBy = '?'; this.voiceChannelName = '?'; this._generation = 0;
  }
  addToQueue(song) { this.queue.push(song); }
  getNextSong() { if (this.loopMode === 2 && this.current) this.queue.push(this.current); return this.queue.shift(); }
  clearQueue() { this.queue = []; }

  async ensureConnection(channel) {
    if (this.connection?.connected && this.connection.channelId === channel.id) return this.connection;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      if (this.connection) this.connection.destroy();
      const info = await this._requestVoice(channel.id);
      const conn = new VoiceConnection({ ...info, serverId: this.guildId, userId: this.client.user.id });
      conn.channelId = channel.id;
      conn.on('error', (e) => console.error('[voice] Erreur:', e.message));
      await conn.connect(); this.connection = conn;
      console.log('✅ Connexion vocale maison prête.'); return conn;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }

  _requestVoice(channelId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.client.removeListener('raw', onRaw); reject(new Error('VOCAL_UNAVAILABLE')); }, 15_000);
      let state, server;
      const done = () => { if (!state || !server) return; clearTimeout(timer); this.client.removeListener('raw', onRaw); resolve({ endpoint: server.endpoint, token: server.token, sessionId: state }); };
      const onRaw = (pkt) => {
        if (pkt.t === 'VOICE_STATE_UPDATE' && pkt.d?.user_id === this.client.user.id && pkt.d.channel_id === channelId) { state = pkt.d.session_id; done(); }
        if (pkt.t === 'VOICE_SERVER_UPDATE' && pkt.d?.endpoint && pkt.d?.token) { server = { endpoint: pkt.d.endpoint, token: pkt.d.token }; done(); }
      };
      this.client.on('raw', onRaw);
      const send = { op: 4, d: { guild_id: this.guildId, channel_id: channelId, self_mute: false, self_deaf: false } };
      const shard = this.client.ws.shards?.first?.();
      if (typeof this.client.ws.send === 'function') this.client.ws.send(send); else if (shard?.send) shard.send(send); else reject(new Error('Gateway Discord indisponible'));
    });
  }

  async playNext(onEmbed) {
    if (this.loopMode === 1 && this.current) this.queue.unshift(this.current);
    const song = this.getNextSong();
    if (!song) { this.isPlaying = false; this.current = null; this._activity(); return null; }
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
  stop() { ++this._generation; this.clearQueue(); this.sender?.stop(); this.sender = null; this.current = null; this.isPlaying = false; this.isPaused = false; this._activity(); }
  destroy() { this.stop(); this.connection?.destroy(); this.connection = null; }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value) || 0)); this.sender?.setVolume?.(this.volume); return Math.round(this.volume * 100); }
  _activity() {
    const info = this.isPlaying && this.current ? { title: this.current.title } : null;
    try {
      if (typeof this.onActivityChange === 'function') this.onActivityChange(info);
      else this.client.user.setActivity(info?.title || '🎵 En attente', { type: 2 });
    } catch (_) { /* ignore */ }
  }
  getState() { const f = (s) => s && ({ title: s.title, url: s.url, thumbnail: s.thumbnail || null, source: s.source || 'youtube', duration: s.duration || 0 }); return { current: f(this.current), queue: this.queue.map(f), isPlaying: this.isPlaying, isPaused: this.isPaused, loopMode: this.loopMode, volume: this.volume }; }
}
module.exports = { MusicPlayer };
