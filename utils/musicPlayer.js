/**
 * MusicPlayer — gestion de la lecture audio via notre connexion vocale maison
 * (utils/voice.js) : WebSocket vocal + UDP + IP discovery forcee sur IP publique
 * + RTP/Opus DAVE (AES-256-GCM, natif Node crypto). Envoie audio via audioSender.
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
    this.connecting = null;  // Promise de connexion en cours (evite 3 connexions paralleles sur spam !play)
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
    // Si deja connecte (meme en cours de 1ere connexion), on reutilise.
    if (this.connection && this.connection.connected) return this.connection;
    // Mutex : si une connexion est deja en cours (spam !play), on attend le meme promise
    // au lieu d'ouvrir 3 WS vocaux en parallele (ce qui casse le son).
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      try {
        this.connection = await this._connectOnce(voiceChannel);
        return this.connection;
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  async _connectOnce(voiceChannel) {
    // 0) Forcer la deconnexion vocale via le GATEWAY (opcode 4 channel_id null)
    //    MEME si discord.js ne voit pas le bot connecte (etat pas resynchro
    //    apres redemarrage). Ca ferme la session residuelle cote serveur et
    //    evite le 4006 "Session is no longer valid" au join suivant.
    try {
      const leavePayload = { op: 4, d: { guild_id: this.guildId, channel_id: null, self_mute: false, self_deaf: false } };
      if (typeof this.client.ws.send === 'function') this.client.ws.send(leavePayload);
      else { const sh = this.client.ws.shards && this.client.ws.shards.first(); if (sh && sh.send) sh.send(leavePayload); }
      await new Promise((r) => setTimeout(r, 1000));
      console.log('[voice] deconnexion vocale gateway envoyee (leave)');
    } catch (_) { /* ignore */ }

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
    // Si le bot est kické ou quitte le salon (WS fermé), on oublie la connexion
    // morte pour que le prochain !play en recrée une propre (avec leave gateway).
    conn.on('close', () => {
      if (this.connection === conn) this.connection = null;
      if (this.connecting === null || this.connecting === undefined) this.connecting = null;
    });

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
          // Plus de delai : envoyer l'IDENTIFY au plus vite pour eviter
          // le 4006 "Session is no longer valid" (session vocale expiree).
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
        console.log('[voice] raw event recu: ' + (pkt.t || '?'));
        if (pkt.t === 'VOICE_SERVER_UPDATE') {
          // On prend le dernier endpoint/token valide (Discord envoie parfois
          // un 1er event avec endpoint null puis un vrai).
          if (pkt.d && pkt.d.endpoint) {
            server = { endpoint: pkt.d.endpoint, token: pkt.d.token };
            console.log('[voice] VOICE_SERVER_UPDATE: endpoint=' + pkt.d.endpoint);
            check();
          }
        } else if (pkt.t === 'VOICE_STATE_UPDATE') {
          console.log('[voice] VOICE_STATE_UPDATE: user=' + pkt.d.user_id + ' session=' + (pkt.d.session_id || 'aucun'));
          if (pkt.d.session_id && pkt.d.user_id === this.client.user.id) {
            state = { session_id: pkt.d.session_id }; // dernier session_id (apres leave+join, c'est la session active)
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
