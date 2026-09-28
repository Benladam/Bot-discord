/** Envoi audio maison : yt-dlp -> FFmpeg Ogg/Opus -> RTP/UDP. */
const fs = require('fs');
const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');

function bin(name, env) { if (process.env[env]) return process.env[env]; if (name === 'ffmpeg' && ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic; return process.platform === 'win32' ? `${name}.exe` : name; }
function isAudioUrl(value) {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:')
      && !/(^|\.)ytimg\.com$/i.test(parsed.hostname);
  } catch (_) { return false; }
}

function streamUrl(url) {
  return new Promise((resolve, reject) => {
    const list = [];
    if (process.env.YTDLP_PATH) list.push([process.env.YTDLP_PATH, []]);
    if (process.platform === 'win32') {
      // py -m yt_dlp permet de privilégier la version mise à jour par pip même
      // si un ancien yt-dlp.exe est encore prioritaire dans le PATH Windows.
      list.push(['py', ['-m', 'yt_dlp']], ['py', ['-3.12', '-m', 'yt_dlp']], ['yt-dlp.exe', []], [process.env.PYTHON || 'python', ['-m', 'yt_dlp']]);
    } else {
      list.push(['python3', ['-m', 'yt_dlp']], ['yt-dlp', []]);
    }
    let i = 0; let error = '';
    const next = () => {
      if (i >= list.length) return reject(new Error(error || 'Aucun flux audio valide renvoyé par yt-dlp. Mets à jour yt-dlp puis réessaie.'));
      const [cmd, pre] = list[i++];
      const p = spawn(cmd, [...pre, '--no-playlist', '-f', 'bestaudio/best', '-g', url], { windowsHide: true });
      let out = ''; let err = ''; let done = false;
      const retry = (message) => { if (done) return; done = true; error = message; next(); };
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', e => retry(e.message));
      p.on('close', c => {
        const u = out.trim().split(/\r?\n/).pop();
        if (c === 0 && isAudioUrl(u)) { done = true; resolve(u); return; }
        const reason = c === 0 && u && !isAudioUrl(u)
          ? 'yt-dlp a renvoyé une vignette au lieu du flux audio (version probablement obsolète).'
          : err.trim().slice(-300);
        retry(reason || `yt-dlp s'est arrêté avec le code ${c}.`);
      });
    };
    next();
  });
}

async function start(connection, url, onStart, onEnd, onError) {
  const source = await streamUrl(url);
  const ffmpeg = spawn(bin('ffmpeg', 'FFMPEG_PATH'), [
    '-hide_banner', '-loglevel', 'error', '-re', '-i', source, '-vn',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:a', 'libopus', '-application', 'audio', '-vbr', 'on', '-compression_level', '10',
    '-frame_duration', '20', '-ar', '48000', '-ac', '2', '-b:a', '160k',
    '-f', 'opus', 'pipe:1',
  ], { windowsHide: true });
  const parser = new OggParser(); let frames = []; let paused = false; let started = false; let stopped = false;
  let ffmpegError = ''; let errorReported = false;
  let readinessTimer = null;
  const reportFfmpegError = (error) => {
    if (stopped || errorReported) return;
    errorReported = true;
    stopped = true;
    clearInterval(tick);
    if (readinessTimer) clearTimeout(readinessTimer);
    try { ffmpeg.kill(); } catch (_) {}
    onError?.(error);
  };
  const tick = setInterval(() => {
    if (stopped || paused || !connection.connected || !frames.length) return;
    if (connection.daveRequired && (!connection.dave || !connection.dave.ready)) return;
    let ok;
    try { ok = connection.sendOpus(frames[0]); }
    catch (error) { reportFfmpegError(error); return; }
    if (!ok) return;
    frames.shift();
    if (readinessTimer) { clearTimeout(readinessTimer); readinessTimer = null; }
    if (!started) { started = true; onStart?.(); }
  }, 20);
  readinessTimer = setTimeout(() => {
    if (connection.daveRequired && (!connection.dave || !connection.dave.ready)) {
      reportFfmpegError(new Error('La session DAVE de Discord ne s’est pas initialisée. Réessaie de rejoindre le vocal.'));
    }
  }, 30_000);
  ffmpeg.stdout.on('data', chunk => parser.feed(chunk, frame => {
    frames.push(frame);
    if (frames.length > 250) frames.shift();
  }));
  ffmpeg.stderr.on('data', d => { ffmpegError = (ffmpegError + d.toString()).slice(-1000); });
  ffmpeg.on('error', e => {
    console.error('[ffmpeg] démarrage impossible:', e.message);
    reportFfmpegError(e);
  });
  ffmpeg.on('close', code => {
    if (stopped) return;
    if (code !== 0) {
      const message = ffmpegError.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ').replace(/https?:\/\/\S+/g, '[URL audio]').slice(-300);
      reportFfmpegError(new Error(message || `FFmpeg s'est arrêté avec le code ${code}.`));
      return;
    }
    const wait = setInterval(() => { if (!frames.length) { clearInterval(wait); if (!stopped) { if (readinessTimer) clearTimeout(readinessTimer); onEnd?.(); } } }, 100);
  });
  return { pause() { paused = true; }, resume() { paused = false; }, setVolume() {}, stop() { stopped = true; clearInterval(tick); if (readinessTimer) clearTimeout(readinessTimer); try { ffmpeg.kill(); } catch (_) {} } };
}

class OggParser {
  constructor() { this.buf = Buffer.alloc(0); this.count = 0; this.packet = []; }
  feed(chunk, emit) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 27) {
      if (this.buf.toString('ascii', 0, 4) !== 'OggS') { this.buf = this.buf.slice(1); continue; }
      const n = this.buf[26]; if (this.buf.length < 27 + n) return;
      const sizes = [...this.buf.slice(27, 27 + n)]; const total = sizes.reduce((a, b) => a + b, 0); const end = 27 + n + total; if (this.buf.length < end) return;
      let pos = 27 + n;
      for (const size of sizes) { this.packet.push(this.buf.slice(pos, pos + size)); pos += size; if (size < 255) { const full = Buffer.concat(this.packet); this.packet = []; this.count++; if (this.count > 2 && full.length) emit(full); } }
      this.buf = this.buf.slice(end);
    }
  }
}
module.exports = { OpusSender: { start } };
