/** Reprises bornées du même morceau, indépendantes de la file et de la guilde. */
const RECOVERABLE = new Set(['AUDIO_PREMATURE_END', 'AUDIO_HTTP_FORBIDDEN', 'AUDIO_STALLED', 'FFMPEG_FAILED', 'YOUTUBE_AUTH_BLOCKED']);
const { closeMedia } = require('./temporaryAudio');

async function startRecoveringPlayback({ startAttempt, prepareRecovery, shouldStart = () => true,
  onStart, onEnd, onError, onRecovery = () => {}, initialVolume = 1, initialFilter = 'none', maxRecoveries = 2 }) {
  let sender = null;
  let generation = 0;
  let finished = false;
  let announced = false;
  let paused = false;
  let volume = initialVolume;
  let filter = initialFilter;
  let recoveries = 0;
  let position = 0;
  const alive = () => !finished && shouldStart();
  const fail = error => {
    if (!alive()) return;
    finished = true;
    generation++;
    sender?.stop?.();
    onError?.(error);
  };
  const launch = async (preparedMedia, resumeAt = 0) => {
    const attempt = ++generation;
    const result = await startAttempt({ preparedMedia, resumeAt, initialVolume: volume, initialFilter: filter,
      shouldStart: () => alive() && attempt === generation,
      onStart: () => { if (alive() && attempt === generation && !announced) { announced = true; onStart?.(); } },
      onEnd: () => {
        if (!alive() || attempt !== generation) return;
        finished = true;
        generation++;
        onEnd?.();
      },
      onError: error => {
        if (!alive() || attempt !== generation) return;
        recover(error).catch(fail);
      },
    });
    if (!alive() || attempt !== generation) { result?.stop?.(); return; }
    sender = result;
    sender?.setVolume?.(volume);
    sender?.setFilter?.(filter);
    if (paused) sender?.pause?.();
  };
  const recover = async error => {
    if (!alive()) return;
    position = Math.max(position, Number(error.playbackPosition) || 0);
    if (!RECOVERABLE.has(error.code) || recoveries >= maxRecoveries) { fail(error); return; }
    recoveries++;
    let pending = ++generation;
    sender?.stop?.();
    sender = null;
    onRecovery({ attempt: recoveries, position, code: error.code });
    let media;
    try {
      media = await prepareRecovery(error, recoveries);
      if (!alive() || pending !== generation) { closeMedia(media); return; }
      // launch owns the next generation; a synchronous FFmpeg failure must
      // still enter the retry handler, unlike a stop/skip from the caller.
      pending = generation + 1;
      await launch(media, position);
    } catch (cause) {
      closeMedia(media);
      if (!alive() || pending !== generation) return;
      if (recoveries < maxRecoveries) {
        const next = new Error('La réouverture de la source audio a échoué.', { cause });
        next.code = 'AUDIO_PREMATURE_END';
        next.playbackPosition = position;
        next.sourceUrl = error.sourceUrl;
        await recover(next);
      } else fail(cause);
    }
  };
  await launch();
  return {
    pause() { paused = true; sender?.pause?.(); },
    resume() { paused = false; sender?.resume?.(); },
    setVolume(value) { volume = value; sender?.setVolume?.(value); },
    setFilter(name) { filter = name; sender?.setFilter?.(name); },
    stop() { finished = true; generation++; sender?.stop?.(); sender = null; },
  };
}

module.exports = { startRecoveringPlayback };
