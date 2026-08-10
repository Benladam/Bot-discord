/**
 * streamer.js — Lecture audio pour @discordjs/voice.
 *
 * play-dl (1.9.7) ne sait plus faire de streaming YouTube (« Invalid URL »).
 * On recupere donc le flux audio avec yt-dlp (deja installe) + ffmpeg,
 * et on le passe a discordjs/voice en Opus PUR (StreamType.Opus).
 *
 * Important : en StreamType.Opus, discordjs/voice envoie les packets Opus
 * tels quels a Discord SANS les re-encoder. On n'a donc PAS besoin de
 * l'encodeur @discordjs/opus (qui n'est pas installable ici car npm est
 * bloque). ffmpeg (deja present) encode deja l'Opus ; il suffit de lui
 * demander un flux Opus brut (packets concaténés, -f data).
 *
 * Le volume n'est pas ajustable en direct (inlineVolume desactive) car
 * l'encodeur opus (@discordjs/opus) n'est pas installe ; on reglera le
 * volume via le controle de volume Discord du serveur.
 */

const { spawn } = require('child_process');
const { createAudioResource, StreamType } = require('@discordjs/voice');

/**
 * Cree une AudioResource lisible par discordjs/voice a partir d'une URL
 * YouTube (ou autre source que yt-dlp gere).
 * @param {string} url
 * @returns {Promise<AudioResource>}
 */
async function createStream(url) {
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio',
    '-o', '-',        // sortie sur stdout
    '--quiet',
    '--no-warnings',
    url,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // ffmpeg-free Opus encoding: use ffmpeg to encode Opus directly into a
  // container discord.js understands. `-f opus` produces a standard .opus
  // file (Ogg Opus) with proper headers at 48kHz stereo, 20ms frames.
  // discord.js reads OggOpus natively (no re-encode, no @discordjs/opus needed).
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-c:a', 'libopus',
    '-b:a', '128k',
    '-ar', '48000',
    '-ac', '2',
    '-frame_duration', '20',
    '-f', 'opus',
    '-loglevel', 'error',
    'pipe:1',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ytdlp.stdout.pipe(ffmpeg.stdin);

  ytdlp.on('error', (e) => console.error('[streamer] yt-dlp:', e.message));
  ffmpeg.on('error', (e) => console.error('[streamer] ffmpeg:', e.message));

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.OggOpus,
    metadata: { title: url },
  });
  return resource;
}

module.exports = { createStream };
