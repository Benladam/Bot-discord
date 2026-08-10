/**
 * MusicPlayer — gestion de la lecture audio (maison, sans @discordjs/voice).
 * Connexion vocale 100% custom via utils/voice.js (WS vocal + UDP + IP discovery
 * forcee sur IP publique). Envoi RTP/Opus via utils/audioSender.
 */

const { VoiceConnection } = require('./voice');
const { OpusSender } = require('./audioSender');

function setActivityNow(player) {
  if (player && typeof player.setActivity === 'function') player.setActivity();
}

class MusicPlayer {
  constructor(guildId, client) {
    this.guildId = guildId;
    this.client = client;
    this.queue = [];
    this.current = null;
    this.connection = null;     // notre VoiceConnection maison
    this.sender = null;         // OpusSender { stop }
    this.volume = 0.5;
    this.isPlaying = false;
    this.isPaused = false;
    this.loopMode = 0;
    this.createdAt = Date.now();
  }

  addToQueue(song) {
    if (!song || !song.url) throw new Error('La chanson doit avoir une propriete url');
    this.queue.push(song);
    return this.queue.length;
  }

  getNextSong() {
    if (this.queue.length > 0) return this.queue.shift();
    return null;
  }

  clearQueue() { this.queue = []; }

  shuffleQueue() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  removeSong(index) {
    if (index < 0 || index >= this.queue.length) return null;
    return this.queue.splice(index, 1)[0];
  }

  setVolume(percent) {
    this.volume = Math.max(0, Math.min(100, percent)) / 100;
    if (this.sender && this.sender.setVolume) this.sender.setVolume(this.volume);
    return Math.round(this.volume * 100);
  }

  getQueueInfo() {
    return {
      current: this.current,
      queueLength: this.queue.length,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      volume: Math.round(this.volume * 100),
      loopMode: this.loopMode,
      uptime: Date.now() - this.createdAt,
    };
  }

  destroy() {
    this.clearQueue();
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    if (this.sender) { try { this.sender.stop(); } catch (_) {} }
    this.sender = null;
    setActivityNow(this);
    if (this.connection) { try { this.connection.destroy(); } catch (e) {} }
    this.connection = null;
  }

  /**
   * Rejoint le salon vocal et établit la connexion maison.
   * @param {VoiceChannel} voiceChannel
   */
  async ensureConnection(voiceChannel) {
    if (this.connection && this.connection.connected) return this.connection;

    // 1) Rejoindre le salon via l'API Discord (déclenche VOICE_SERVER_UPDATE / VOICE_STATE_UPDATE)
    console.log('🔌 Connexion au salon vocal en cours...');
    await voiceChannel.guild.members.me.voice.setChannel(voiceChannel.id);

    // 2) Capturer les infos vocales via les events gateway bruts
    const voiceInfo = await this._waitVoiceInfo();

    // 3) Créer notre connexion vocale maison
    this.connection = new VoiceConnection({
      endpoint: voiceInfo.endpoint,
      token: voiceInfo.token,
      sessionId: voiceInfo.sessionId,
      serverId: this.guildId,
      userId: this.client.user.id,
      publicIp: process.env.PUBLIC_IP || '87.91.140.78',
    });

    this.connection.on('ready', () => {
      console.log('✅ Connecté au salon vocal — prêt à émettre du son.');
      console.log('   [diag] status=ready ssrc=' + (this.connection.ssrc || '?') +
        ' secretKey=' + (this.connection.secretKey ? 'oui' : 'NON') +
        ' endpoint=' + (this.connection.endpoint || '?'));
    });
    this.connection.on('error', (e) => console.error('❌ Erreur connexion vocale:', e && e.message));

    await this.connection.connect();
    return this.connection;
  }

  /** Attend VOICE_SERVER_UPDATE + VOICE_STATE_UPDATE pour récupérer endpoint/token/sessionId. */
  _waitVoiceInfo() {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      let server = null, state = null;
      const check = () => {
        if (server && state) {
          this.client.removeListener('raw', onRaw);
          resolve({
            endpoint: server.endpoint,
            token: server.token,
            sessionId: state.session_id,
          });
        } else if (Date.now() > deadline) {
          this.client.removeListener('raw', onRaw);
          reject(new Error('VOCAL_UNAVAILABLE'));
        }
      };
      const onRaw = (pkt) => {
        if (pkt.t === 'VOICE_SERVER_UPDATE') {
          server = { endpoint: pkt.d.endpoint, token: pkt.d.token };
          check();
        } else if (pkt.t === 'VOICE_STATE_UPDATE') {
          if (pkt.d.session_id && pkt.d.user_id === this.client.user.id) {
            state = { session_id: pkt.d.session_id };
            check();
          }
        }
      };
      this.client.on('raw', onRaw);
    });
  }

  async playNext(onEmbed) {
    if (this.loopMode === 1 && this.current) {
      this.queue.unshift(this.current);
    }
    const song = this.getNextSong();
    if (!song) {
      this.isPlaying = false;
      this.current = null;
      return null;
    }
    if (!this.connection) {
      throw new Error('Le bot n\'est connecté à aucun canal vocal.');
    }
    this.current = song;
    this.isPlaying = true;
    this.isPaused = false;

    console.log('🔍 Recherche du son : ' + (song.title || song.url));

    // Attendre que la session vocale soit prête (secretKey)
    const ready = await new Promise((res) => {
      const deadline = Date.now() + 12000;
      const check = () => {
        if (this.connection && this.connection.connected && this.connection.secretKey) return res(true);
        if (Date.now() > deadline) return res(false);
        setTimeout(check, 200);
      };
      check();
    });
    if (!ready) {
      console.log('❌ Son introuvable — la connexion vocale n\'a pas pu s\'établir (UDP bloqué ?).');
      this.isPlaying = false;
      this.current = null;
      const err = new Error('VOCAL_UNAVAILABLE');
      err.code = 'VOCAL_UNAVAILABLE';
      throw err;
    }

    try {
      if (this.sender) { try { this.sender.stop(); } catch (_) {} }
      console.log('✅ Son trouvé — préparation du flux audio (yt-dlp + ffmpeg, Opus RTP natif)...');
      this.sender = await OpusSender.start(this.connection, song.url, () => {
        console.log('▶️ Lecture lancée : ' + (song.title || song.url));
        console.log('🔊 SON ÉMIS — le bot joue maintenant dans le salon vocal.');
      });
      if (this.sender.setVolume) this.sender.setVolume(this.volume);
    } catch (e) {
      console.error('❌ Erreur envoi audio:', e.message);
      console.log('❌ Son introuvable — impossible de lire le flux audio.');
      this.isPlaying = false;
      throw e;
    }

    if (onEmbed) await onEmbed(song);
    setActivityNow(this);
    return song;
  }

  pause() {
    if (this.sender) { try { this.sender.stop(); } catch (_) {} }
    this.isPaused = true;
    setActivityNow(this);
  }

  resume() {
    if (!this.current) return;
    this.playNext(() => {}).catch((e) => console.error('Erreur reprise:', e));
    this.isPaused = false;
  }

  skip() {
    if (this.sender) { try { this.sender.stop(); } catch (_) {} }
    return this.playNext(() => {}).catch((e) => console.error('Erreur skip:', e));
  }

  stop() {
    this.clearQueue();
    if (this.sender) { try { this.sender.stop(); } catch (_) {} }
    this.sender = null;
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    setActivityNow(this);
  }

  getState() {
    return {
      current: this.current ? {
        title: this.current.title,
        url: this.current.url,
        thumbnail: this.current.thumbnail || null,
        source: this.current.source || 'youtube',
        duration: this.current.duration || 0,
      } : null,
      queue: this.queue.map((s) => ({
        title: s.title, url: s.url, thumbnail: s.thumbnail || null,
        source: s.source || 'youtube', duration: s.duration || 0,
      })),
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      loopMode: this.loopMode,
      volume: this.volume,
    };
  }

  setActivity() {
    // Mise à jour de la présence (Rich Presence) si besoin
    try {
      const name = this.isPlaying && this.current ? this.current.title : 'En attente';
      this.client.user.setActivity(name, { type: 2 }).catch(() => {});
    } catch (_) {}
  }
}

module.exports = { MusicPlayer };
