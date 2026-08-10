/**
 * MusicPlayer — gère la lecture audio pour un serveur (guild).
 *
 * Connexion vocale via discord.js (joinVoiceChannel) mais ENVIRON audio
 * envoyé DIRECTEMENT en RTP/Opus via un socket UDP natif (utils/audioSender),
 * car @discordjs/voice échoue sur certains réseaux ("Cannot perform IP
 * discovery - socket closed"). ffmpeg encode l'Opus (déjà présent).
 */

const { joinVoiceChannel, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const play = require('play-dl');
const { sendAudio } = require('./audioSender');

/** Appelé par le player quand la lecture change, pour mettre à jour la présence. */
function setActivityNow(player) {
  if (player && typeof player.setActivity === 'function') player.setActivity();
}

class MusicPlayer {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.current = null;
    this.connection = null;
    this.sender = null; // { stop } de audioSender
    this.volume = 0.5;
    this.isPlaying = false;
    this.isPaused = false;
    this.loopMode = 0; // 0: off, 1: chanson, 2: file
    this.lastChannel = null;
    this.createdAt = Date.now();
  }

  addToQueue(song) {
    if (!song || !song.url) throw new Error('La chanson doit avoir une propriété url');
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

  async ensureConnection(voiceChannel) {
    if (!this.connection || this.connection.state.status !== VoiceConnectionStatus.Ready) {
      this.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        // On desactive l'IP discovery : sur une IP publique (VPS/Fly), le bot
        // utilise directement l'IP/port fournis par Discord sans attendre de
        // reponse UDP (qui echoue si l'UDP sortant est filtre).
        ipDiscoveryTimeout: 0,
      });
      this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(this.connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(this.connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch (e) { this.destroy(); }
      });
      this.connection.on(VoiceConnectionStatus.Ready, () => {
        const st = this.connection.state;
        console.log('✅ Connecté au salon vocal — prêt à émettre du son.');
        console.log('   [diag] status=' + st.status + ' ssrc=' + (st.ssrc || '?') + ' secretKey=' + (st.secretKey ? 'oui' : 'NON') + ' endpoint=' + (st.endpoint || '?'));
      });
      this.connection.on(VoiceConnectionStatus.Connecting, () => {
        console.log('🔌 Connexion au salon vocal en cours...');
      });
      this.connection.on('error', (e) => console.error('❌ Erreur connexion vocale:', e && e.message));
    }
    // Attendre que la session vocale (ssrc/secretKey) soit disponible.
    const s = this.connection.state;
    if (!s || !s.secretKey || !s.ssrc) {
      // forcer l'attente de l'état Ready+session
      await new Promise((res) => {
        const check = () => {
          const st = this.connection.state;
          if (st && st.secretKey && st.ssrc) return res();
          setTimeout(check, 200);
        };
        check();
      });
    }
    return this.connection;
  }

  /**
   * Joue la prochaine chanson. Renvoie la chanson jouée ou null.
   * @param {function} onEmbed callback(song)
   */
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

    // Attendre que la session vocale soit prête (ssrc/secretKey) — sinon le son
    // ne peut pas être émis. Timeout pour ne pas rester bloqué indéfiniment.
    const ready = await new Promise((res) => {
      const deadline = Date.now() + 12000;
      const check = () => {
        const st = this.connection && this.connection.state;
        if (st && st.secretKey && st.ssrc) return res(true);
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
      this.sender = await sendAudio(this.connection, song.url, () => {
        console.log('▶️ Lecture lancée : ' + (song.title || song.url));
        console.log('🔊 SON ÉMIS — le bot joue maintenant dans le salon vocal.');
      });
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

  /** État complet (pour le GUI). */
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

  /** Recherche multi-résultats (GUI + choix Discord). */
  static async search(query, limit = 8) {
    const results = await play.search(query, { limit });
    return results.map((r) => ({
      title: r.title, url: r.url,
      thumbnail: r.thumbnail && r.thumbnail.url ? r.thumbnail.url : null,
      duration: r.durationInSec || 0,
    }));
  }
}

module.exports = { MusicPlayer };