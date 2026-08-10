/**
 * MusicPlayer — gestion de la lecture audio via notre connexion vocale maison
 * (utils/voice.js) : WebSocket vocal + UDP + IP discovery forcee sur IP publique
 * + RTP/Opus xsalsa20 (tweetnacl). Envoie audio via audioSender (Ogg Opus).
 */
const { VoiceConnection } = require('./voice');
const { OpusSender } = require('./audioSender');
const { resolveQuery } = require('./resolve');

function setActivityNow(player) {
  try {
    const name = player.isPlaying && player.current ? player.current.title : '🎵 En attente';
    player.client.user.setActivity(name, { type: 2 }).catch(() => {});
  } catch (_) {}
}

class MusicPlayer {
  constructor(guildId, client) {
    this.guildId = guildId;
    this.client = client;
    this.queue = [];
    this.current = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.loopMode = 0; // 0 off, 1 loop current, 2 loop queue
    this.volume = 1.0;
    this.connection = null; // notre VoiceConnection maison
    this.sender = null;
    this.lastChannel = null;
    this.addedBy = '?';
    this.voiceChannelName = '?';
  }

  addToQueue(song) {
    this.queue.push(song);
  }

  getNextSong() {
    if (this.loopMode === 2 && this.current) this.queue.push(this.current);
    return this.queue.shift();
  }

  clearQueue() {
    this.queue = [];
  }

  async ensureConnection(voiceChannel) {
    if (this.connection && this.connection.connected) return this.connection;

    let lastErr = null;
    const delays = [0, 1000, 2500];
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        console.log('⏳ Nouvelle tentative dans ' + delays[attempt - 1] + 'ms...');
        await new Promise((r) => setTimeout(r, delays[attempt - 1]));
      }
      try {
        this.connection = await this._connectOnce(voiceChannel);
        return this.connection;
      } catch (e) {
        lastErr = e;
        console.log('⚠️ Tentative ' + attempt + ' échouée: ' + (e && e.message));
        if (this.connection) { try { this.connection.destroy(); } catch (_) {} this.connection = null; }
      }
    }
    throw lastErr || new Error('VOCAL_UNAVAILABLE');
  }

  async _connectOnce(voiceChannel) {
    // 0) Vider toute session vocale residuelle (opcode 4 channel_id null)
    const leavePayload = { op: 4, d: { guild_id: this.guildId, channel_id: null, self_mute: false, self_deaf: false } };
    try {
      if (typeof this.client.ws.send === 'function') this.client.ws.send(leavePayload);
      else { const sh = this.client.ws.shards && this.client.ws.shards.first(); if (sh && sh.send) sh.send(leavePayload); }
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 300));

    console.log('🔌 Connexion au salon vocal en cours...');
    const payload = {
      op: 4,
      d: {
        guild_id: this.guildId,
        channel_id: voiceChannel.id,
        self_mute: false,
        self_deaf: false,
      },
    };
    if (typeof this.client.ws.send === 'function') {
      this.client.ws.send(payload);
    } else {
      const shard = this.client.ws.shards && this.client.ws.shards.first();
      if (shard && typeof shard.send === 'function') shard.send(payload);
      else throw new Error('Impossible d\'envoyer l\'opcode vocal au gateway');
    }

    const voiceInfo = await this._waitVoiceInfo();

    const conn = new VoiceConnection({
      endpoint: voiceInfo.endpoint,
      token: voiceInfo.token,
      sessionId: voiceInfo.sessionId,
      serverId: this.guildId,
      userId: this.client.user.id,
      publicIp: process.env.PUBLIC_IP || '87.91.140.78',
    });

    conn.on('ready', () => {
      console.log('✅ Connecté au salon vocal — prêt à émettre du son.');
      console.log('   [diag] status=ready ssrc=' + (conn.ssrc || '?') +
        ' secretKey=' + (conn.secretKey ? 'oui' : 'NON') +
        ' endpoint=' + (conn.endpoint || '?'));
    });
    conn.on('error', (e) => console.error('❌ Erreur connexion vocale:', e && e.message));

    await conn.connect();
    return conn;
  }

  _waitVoiceInfo() {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      let server = null, state = null;
      const check = () => {
        if (server && state) {
          this.client.removeListener('raw', onRaw);
          setTimeout(() => resolve({
            endpoint: server.endpoint,
            token: server.token,
            sessionId: state.session_id,
          }), 1500);
        } else if (Date.now() > deadline) {
          this.client.removeListener('raw', onRaw);
          reject(new Error('VOCAL_UNAVAILABLE'));
        }
      };
      const onRaw = (pkt) => {
        console.log('[voice] raw event recu: ' + (pkt.t || '?'));
        if (pkt.t === 'VOICE_SERVER_UPDATE') {
          server = { endpoint: pkt.d.endpoint, token: pkt.d.token };
          console.log('[voice] VOICE_SERVER_UPDATE: endpoint=' + pkt.d.endpoint);
          check();
        } else if (pkt.t === 'VOICE_STATE_UPDATE') {
          console.log('[voice] VOICE_STATE_UPDATE: user=' + pkt.d.user_id + ' session=' + (pkt.d.session_id || 'aucun'));
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
    try {
      const name = this.isPlaying && this.current ? this.current.title : 'En attente';
      this.client.user.setActivity(name, { type: 2 }).catch(() => {});
    } catch (_) {}
  }
}

module.exports = { MusicPlayer };
