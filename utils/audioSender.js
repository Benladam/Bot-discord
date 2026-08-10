/**
 * audioSender.js — Envoi audio RTP/Opus via notre VoiceConnection maison.
 * Récupère le flux via yt-dlp + ffmpeg (Ogg Opus), parse le Ogg pour extraire
 * les frames Opus, et les envoie via connection.sendOpus() (RTP xsalsa20).
 */

const { spawn } = require('child_process');

/**
 * Démarre l'envoi audio pour une chanson.
 * @param {VoiceConnection} connection - notre connexion maison (sendOpus)
 * @param {string} url - URL YouTube/Spotify
 * @param {function} onStart - appelé quand la 1re frame est envoyée
 * @returns {{ stop: function, setVolume: function }}
 */
function start(connection, url, onStart) {
  let stopped = false;
  let proc = null;
  let volume = 1;
  let started = false;

  // Mode test local : lire un fichier Opus directement (pas de yt-dlp/YouTube).
  if (typeof url === 'string' && url.startsWith('local:')) {
    const filePath = url.slice('local:'.length);
    console.log('[audioSender] mode local: lecture de ' + filePath);
    proc = spawn('ffmpeg', [
      '-re', '-i', filePath,
      '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-f', 'opus', '-loglevel', 'error', '-',
    ], { windowsHide: true });
    const parser = new OggOpusParser();
    proc.stdout.on('data', (chunk) => {
      if (stopped) return;
      parser.feed(chunk, (frame) => {
        if (!connection.connected || !connection.secretKey) return;
        const f = applyVolume(frame, volume);
        const ok = connection.sendOpus(f);
        if (ok && !started) { started = true; if (onStart) onStart(); }
      });
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (/Error|invalid/i.test(s)) console.error('ffmpeg:', s.slice(0, 160));
    });
    return { stop, setVolume };
  }

  // 1) Obtenir l'URL directe du flux (yt-dlp)
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '-g', url,
  ], { windowsHide: true });

  let streamUrl = '';
  let ytdlpErr = '';
  ytdlp.stdout.on('data', (d) => { streamUrl += d.toString(); });
  ytdlp.stderr.on('data', (d) => { ytdlpErr += d.toString(); });
  ytdlp.on('close', (code) => {
    if (stopped) return;
    streamUrl = (streamUrl || '').trim().split('\n').pop();
    if (!streamUrl) {
      console.error('❌ yt-dlp: aucune URL de flux. ' + ytdlpErr.slice(0, 200));
      return;
    }
    launchFfmpeg(streamUrl);
  });

  // 2) ffmpeg -> Ogg Opus brut (stdout)
  function launchFfmpeg(src) {
    proc = spawn('ffmpeg', [
      '-re', '-i', src,
      '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
      '-f', 'opus', '-loglevel', 'error', '-',
    ], { windowsHide: true });

    const parser = new OggOpusParser();
    proc.stdout.on('data', (chunk) => {
      if (stopped) return;
      parser.feed(chunk, (frame) => {
        if (!connection.connected || !connection.secretKey) return;
        const f = applyVolume(frame, volume);
        const ok = connection.sendOpus(f);
        if (ok && !started) { started = true; if (onStart) onStart(); }
      });
    });
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      if (/Error|invalid/i.test(s)) console.error('ffmpeg:', s.slice(0, 160));
    });
    proc.on('close', () => { /* fin de chanson -> géré par musicPlayer */ });
  }

  function stop() {
    stopped = true;
    if (proc) try { proc.kill('SIGKILL'); } catch {}
    ytdlp.kill && ytdlp.kill('SIGKILL');
  }
  function setVolume(v) { volume = Math.max(0, Math.min(1, v)); }

  return { stop, setVolume };
}

/** Parser Ogg Opus -> émet chaque packet Opus (après les 2 entêtes Opus). */
class OggOpusParser {
  constructor() {
    this.buf = Buffer.alloc(0);
    this.packetCount = 0; // 0=OpusHead, 1=OpusTags, >=2 = frames audio
    this.inPacket = false;
    this.packetData = [];
    this.expectedSegs = 0;
    this.segIdx = 0;
    this.segSizes = [];
    this.leftover = 0;
    this.curPacket = [];
  }

  feed(chunk, onFrame) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this._parsePage(onFrame)) {}
  }

  _parsePage(onFrame) {
    const b = this.buf;
    if (b.length < 27) return false;
    if (b.toString('ascii', 0, 4) !== 'OggS') return false;
    const nsegs = b[26];
    const segsStart = 27;
    const segsEnd = segsStart + nsegs;
    if (b.length < segsEnd) return false;
    const segSizes = [];
    for (let i = 0; i < nsegs; i++) segSizes.push(b[segsStart + i]);
    // taille des données de la page
    let dataLen = 0;
    for (const s of segSizes) dataLen += s;
    const pageEnd = segsEnd + dataLen;
    if (b.length < pageEnd) return false;

    // Reconstituer les packets (segments de 255 continuent le packet)
    let pos = segsEnd;
    let packet = [];
    let continued = false;
    for (let i = 0; i < segSizes.length; i++) {
      const size = segSizes[i];
      packet.push(b.slice(pos, pos + size));
      pos += size;
      if (size < 255) {
        // fin de packet
        const full = Buffer.concat(packet);
        this._handlePacket(full, onFrame);
        packet = [];
      }
    }
    this.buf = b.slice(pageEnd);
    return true;
  }

  _handlePacket(pkt, onFrame) {
    this.packetCount++;
    if (this.packetCount <= 2) return; // skip OpusHead + OpusTags
    // pkt = frame Opus brute
    if (pkt.length > 0) onFrame(pkt);
  }
}

function applyVolume(frame, vol) {
  if (vol >= 0.99) return frame;
  // Le volume via Opus est complexe ; on utilise le gain RTP ? Pour l'instant
  // on ajuste via le champ "gain" de l'entête Opus si présent, sinon on laisse.
  // (Le réglage fin du volume se fera plus tard ; ici on garde le frame tel quel
  // pour ne pas casser le décodage.)
  return frame;
}

module.exports = { OpusSender: { start } };
