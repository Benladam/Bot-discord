/**
 * audioSender.js — Envoi audio vocal Discord SANS @discordjs/voice.
 *
 * On récupère la session vocale (ssrc, ip, port, secret_key) fournie par
 * discord.js (connection.state), et on envoie nous-mêmes le flux Opus en
 * RTP via un socket UDP natif (dgram). ffmpeg encode l'Opus (déjà présent).
 *
 * Ça contourne le bug "Cannot perform IP discovery - socket closed" de
 * @discordjs/voice (qui échoue à monter le tunnel UDP sur certains réseaux).
 */

const dgram = require('dgram');
const { spawn } = require('child_process');

/**
 * Envoie une musique (url YouTube) dans le salon vocal.
 * @param {object} connection - VoiceConnection de discord.js (joinVoiceChannel)
 * @param {string} url
 * @param {function} onStart - appelé quand l'envoi commence
 * @returns {Promise<{stop:function}>}
 */
async function sendAudio(connection, url, onStart) {
  // 1) Récupérer la session vocale
  const state = connection.state;
  if (!state || !state.sessionId || !state.channel) {
    throw new Error('Session vocale pas prête (state manquant).');
  }
  const { guildId, channelId, sessionId, selfIp, selfPort, secretKey, ssrc } = state;
  if (!secretKey || !ssrc) {
    throw new Error('secretKey/ssrc pas encore disponibles (attends la connexion).');
  }
  // endpoint ex: "amsterdam123.discord.media:443" -> host/port
  const endpoint = connection.state.endpoint || (state.channel && state.channel.connection && state.channel.connection.state && state.channel.connection.state.endpoint);
  if (!endpoint) throw new Error('endpoint vocal inconnu.');
  const [host, portStr] = endpoint.split(':');
  const port = parseInt(portStr, 10) || 443;

  // 2) Socket UDP vers Discord
  const socket = dgram.createSocket('udp4');
  await new Promise((res, rej) => {
    socket.once('error', rej);
    socket.connect(port, host, () => { socket.removeListener('error', rej); res(); });
  });

  // 3) ffmpeg -> Opus brut (packets RTP-ready, 20ms, 48k, stéréo)
  const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio', '-o', '-', '--quiet', '--no-warnings', url], { stdio: ['ignore', 'pipe', 'ignore'] });
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-frame_duration', '20', '-f', 'data', '-loglevel', 'error', '-',
  ], { stdio: ['pipe', 'pipe', 'ignore'] });
  ytdlp.stdout.pipe(ffmpeg.stdin);

  // 4) Encapsulation RTP + Opus (sérialisation Discord) avec libsodium-wrappers-sumo (wasm inline)
  const sodium = require('libsodium-wrappers-sumo');
  await sodium.ready; // charger le wasm
  const key = Buffer.from(secretKey);
  const SECRET_LEN = key.length; // 32
  let seq = 0;
  let timestamp = 0;
  let buffer = Buffer.alloc(0);
  const OPUS_FRAME = 960; // 20ms @ 48kHz

  function sendOpusPacket(opusData) {
    seq = (seq + 1) & 0xffff;
    timestamp = (timestamp + OPUS_FRAME) & 0xffffffff;
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = 0x78;
    header.writeUInt16BE(seq, 2);
    header.writeUInt32BE(timestamp, 4);
    header.writeUInt32BE(ssrc, 8);
    const nonceBuf = Buffer.alloc(24);
    header.copy(nonceBuf, 0, 0, 12);
    const encrypted = sodium.crypto_secretbox_easy(opusData, nonceBuf, key);
    const packet = Buffer.concat([header, Buffer.from(encrypted)]);
    socket.send(packet, (err) => { if (err) console.error('[sender] send err', err.message); });
  }

  // On lit le flux Opus brut et on découpe en paquets de ~960 frames
  ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    // Opus en -f data = packets de 4 octets (length BE) + données
    while (buffer.length > 4) {
      const len = buffer.readUInt32BE(0);
      if (buffer.length < 4 + len) break;
      const opusData = buffer.slice(4, 4 + len);
      buffer = buffer.slice(4 + len);
      sendOpusPacket(opusData);
    }
  });

  ffmpeg.stdout.on('end', () => { /* fin de chanson */ });
  ytdlp.on('error', (e) => console.error('[sender] yt-dlp', e.message));
  ffmpeg.on('error', (e) => console.error('[sender] ffmpeg', e.message));

  if (onStart) onStart();

  return {
    stop() {
      try { ytdlp.kill(); ffmpeg.kill(); socket.close(); } catch (_) {}
    },
  };
}

module.exports = { sendAudio };