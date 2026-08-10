/**
 * MusicPlayer — gestion de la lecture audio via @discordjs/voice
 * (connexion + handshake vocaux officiels, qui reussissent l'IDENTIFY),
 * avec IP discovery FORCEE sur l'IP publique pour contourner le NAT/Bbox
 * (qui bloque l'UDP local et empechait le secretKey d'etre recu).
 *
 * L'envoi audio se fait via createAudioResource (flux Opus Ogg) -> conn.play(),
 * sans re-encodage (@discordjs/opus pas installe).
 */
const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  VoiceConnection,
  createAudioResource,
  StreamType,
} = require('@discordjs/voice');
const { createStream } = require('./streamer');
const { resolveQuery } = require('./resolve');

// === FORCE IP PUBLIQUE DANS LA DECOUVERTE IP (contourne NAT/Bbox) ===
// Discord nous renvoie sinon l'IP locale (192.168.x.x) qui n'est pas
// joignable par ses serveurs -> secretKey jamais recu (UDP bloque).
const PUBLIC_IP = process.env.PUBLIC_IP || '87.91.140.78';
VoiceConnection.prototype.performIPDiscovery = async function (ssrc) {
  let port = 50000;
  try {
    if (this.udp && typeof this.udp.localPort === 'number') port = this.udp.localPort;
    else if (typeof this.localPort === 'number') port = this.localPort;
  } catch (_) {}
  console.log('[bypass] IP discovery forcee : ' + PUBLIC_IP + ':' + port + ' (ssrc ' + ssrc + ')');
  return { address: PUBLIC_IP, port, family: 'IPv4' };
};

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
    this.connection = null; // VoiceConnection @discordjs/voice
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
    let conn = getVoiceConnection(this.guildId);
    if (conn && conn.state.status === VoiceConnectionStatus.Ready) return conn;
    if (conn) { try { conn.destroy(); } catch (_) {} }
    conn = joinVoiceChannel({
      guildId: this.guildId,
      channelId: voiceChannel.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
    });
    console.log('🔌 Connexion au salon vocal en cours...');
    // Patch de l'IP discovery : on intercepte des que l'UDP interne existe.
    let patchedProto = false;
    conn.on('stateChange', (oldState, newState) => {
      const udpRef = newState.udp || conn.udp || (conn.state && conn.state.udp) || (newState.networking && newState.networking.udp);
      console.log('[diag] stateChange: ' + oldState.status + ' -> ' + newState.status + ' udp=' + (udpRef ? 'present' : 'null'));
      if (!patchedProto && udpRef && udpRef.performIPDiscovery) {
        patchedProto = true;
        const proto = Object.getPrototypeOf(udpRef);
        proto.performIPDiscovery = async function (ssrc) {
          let port = 50000;
          try { port = this.localPort || 50000; } catch (_) {}
          console.log('[bypass] IP discovery forcee : ' + PUBLIC_IP + ':' + port + ' (ssrc ' + ssrc + ')');
          return { address: PUBLIC_IP, port, family: 'IPv4' };
        };
      }
    });
    await entersState(conn, VoiceConnectionStatus.Ready, 20000);
    this.connection = conn;
    console.log('✅ Connecté au salon vocal — prêt à émettre du son.');
    console.log('   [diag] status=ready ssrc=' + (conn.state?.ssrc || '?') +
      ' secretKey=' + (conn.state?.secretKey ? 'oui' : 'NON') +
      ' endpoint=' + (conn.state?.address || '?'));
    return conn;
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
        if (this.connection && this.connection.state?.secretKey) return res(true);
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
      console.log('✅ Son trouvé — préparation du flux audio (yt-dlp + ffmpeg, Opus)...');
      const resource = await createStream(song.url);
      this.connection.play(resource, { type: StreamType.OggOpus });
      console.log('▶️ Lecture lancée : ' + (song.title || song.url));
      console.log('🔊 SON ÉMIS — le bot joue maintenant dans le salon vocal.');
    } catch (e) {
      console.error('❌ Erreur envoi audio:', e.message);
      this.isPlaying = false;
      throw e;
    }

    if (onEmbed) await onEmbed(song);
    setActivityNow(this);
    return song;
  }

  pause() {
    if (this.connection) this.connection.pause();
    this.isPaused = true;
    setActivityNow(this);
  }

  resume() {
    if (!this.current) return;
    if (this.connection) this.connection.resume();
    this.isPaused = false;
    setActivityNow(this);
  }

  skip() {
    if (this.connection) { try { this.connection.pause(); } catch (_) {} }
    return this.playNext(() => {}).catch((e) => console.error('Erreur skip:', e));
  }

  stop() {
    this.clearQueue();
    if (this.connection) { try { this.connection.pause(); } catch (_) {} }
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
