/** Valide les métadonnées avant de remplacer un fournisseur audio. */
const STOP_WORDS = new Set(['a', 'au', 'aux', 'de', 'des', 'du', 'en', 'et', 'l', 'la', 'le', 'les', 'the', 'of']);
const VERSION_PATTERNS = [
  /\bremix\b/, /\blive\b/, /\bcover\b/, /\binstrumental\b/, /\bkaraoke\b/,
  /\bslowed\b/, /\bsped\s*up\b|\bspeed\s*up\b/, /\bmashup\b/,
  /\bcompilation\b|\bplaylist\b|\bmedley\b|\bfull album\b|\bbest of\b/,
];

function normalizedText(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/#[\p{L}\p{N}_]+(?:\s+\d+)?/gu, ' ')
    .replace(/\b(?:official|officiel(?:le)?|audio|video|clip|lyrics|paroles|visualizer|vevo|topic|hd|hq|4k)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value) {
  return normalizedText(value).split(' ').filter((token) => token && !STOP_WORDS.has(token));
}

function candidateTitle(track) {
  return String(track?.title || track?.name || '').trim();
}

function candidateArtist(track) {
  return String(track?.artist?.name || track?.publisher?.artist || track?.channel?.name
    || track?.user?.username || track?.user?.name || track?.uploader || '').trim();
}

function matchesRequestedTrack(track, { query, expectedTitle, expectedDuration } = {}) {
  const title = candidateTitle(track);
  if (!title) return false;
  const requested = expectedTitle || query;
  const artist = String(query || '').split(/\s+[-–—]\s+/u);
  const required = new Set([
    ...tokens(requested),
    ...(artist.length > 1 ? tokens(artist[0]) : []),
  ]);
  const available = new Set(tokens(`${title} ${candidateArtist(track)}`));
  if (!required.size || [...required].some((token) => !available.has(token))) return false;

  const requestedVersion = normalizedText(requested);
  const candidateVersion = normalizedText(title);
  if (VERSION_PATTERNS.some((pattern) => pattern.test(requestedVersion) !== pattern.test(candidateVersion))) return false;

  const expected = Number(expectedDuration);
  const duration = Number(track.durationInSec ?? track.duration);
  if (expected >= 45 && duration > 0 && (duration < expected * 0.75 || duration > expected * 1.3)) return false;
  return true;
}

module.exports = { matchesRequestedTrack, candidateTitle, candidateArtist };
