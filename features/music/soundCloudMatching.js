/** Comparaison SoundCloud stricte, indépendante de l'ordre des résultats. */
const { candidateTitle, candidateArtist, fallbackSearchQuery } = require('./trackMatching');
const { canonicalArtistText } = require('./artistAliases');

const VERSIONS = [
  /\bremix\b|\bbootleg\b|\brework\b/, /\blive\b|\bconcert\b/,
  /\bcover\b|\breprise\b/, /\binstrumental\b|\bkaraoke\b/,
  /\bslowed\b/, /\bsped up\b|\bspeed up\b|\bnightcore\b/,
  /\bmashup\b|\bmedley\b/, /\bacoustic\b|\bacoustique\b/,
  /\bradio edit\b/, /\bextended\b/, /\b8d\b/,
  /\bparodie\b|\bparody\b/, /\bbass boosted\b|\bbass boost\b/,
  /\bdub\b|\bflip\b|\bedit\b/, /\bextrait\b|\bexcerpt\b|\bsnippet\b/, /\btype beat\b/,
  /\bcompilation\b|\bplaylist\b|\bfull album\b|\bbest of\b/,
];

function text(value) {
  return canonicalArtistText(String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/\.(?:mp3|wav|flac|m4a|ogg|opus)\b/g, ' ')
    .replace(/#[\p{L}\p{N}_]+(?:\s+\d+)?/gu, ' ')
    .replace(/\b(?:official|officiel(?:le)?|audio|video|clip|lyrics|paroles|visualizer|vevo|topic|hd|hq|4k)\b/g, ' ')
    .replace(/(\d)[.\s]+(?=\d)/g, '$1')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim());
}

function artistPattern(artist) {
  const letters = text(artist).replace(/\s/g, '');
  if (!letters) return null;
  return new RegExp(`(?:^|\\s)${[...letters].join('\\s*')}(?=\\s|$)`, 'u');
}

function requestArtist(query, expectedTitle) {
  const parts = String(query || '').split(/\s+[-–—]\s+/u);
  const source = parts.length > 1 ? parts[0]
    : String(expectedTitle || query || '').split(/\s+[-–—]\s+/u)[0];
  // Une collaboration peut être créditée seulement sur le titre SoundCloud.
  // Les duos avec « & » restent une identité entière (Djadja & Dinaz).
  return source.split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+|,/iu)[0].trim();
}

function coreTitle(value, artist) {
  const identity = artistPattern(artist);
  const parts = String(value || '').split(/\s+[-–—]\s+/u);
  const title = parts.length > 1
    ? parts.filter(part => !identity?.test(text(part))).join(' ')
    : value;
  return text(title).split(/\s+(?:feat|ft|featuring|with)\s+/u)[0]
    .replace(identity || /$^/, ' ').replace(/\s+/g, ' ').trim();
}

function soundCloudMatchScore(track, { query, expectedTitle, expectedDuration } = {}) {
  if (!track || typeof track !== 'object') return 0;
  const title = candidateTitle(track);
  const artist = requestArtist(query, expectedTitle);
  const identity = artistPattern(artist);
  if (!title || !identity) return 0;
  const declared = [track.metadata_artist, track.artist?.name,
    typeof track.artist === 'string' ? track.artist : '',
    track.publisher_metadata?.artist, track.publisher?.artist].filter(value => typeof value === 'string' && value.trim());
  const declaredIdentity = declared.some(value => identity.test(text(value)));
  const uploaderIdentity = identity.test(text(candidateArtist(track)));
  const titleIdentity = identity.test(text(title));
  // Le compte qui publie n'est pas forcément l'artiste. Un titre attribué
  // exactement peut servir de preuve secondaire, jamais un simple titre nu.
  // Des crédits artiste explicitement contradictoires restent un refus.
  if (!declaredIdentity && declared.length) return 0;
  if (!declaredIdentity && !uploaderIdentity && !titleIdentity) return 0;

  const requested = expectedTitle || query;
  const requestedVersion = text(requested);
  const candidateVersion = text(title);
  if (VERSIONS.some(pattern => pattern.test(requestedVersion) !== pattern.test(candidateVersion))) return 0;
  const expectedCore = coreTitle(requested, artist);
  const actualCore = coreTitle(title, artist);
  if (!expectedCore || expectedCore !== actualCore) return 0;

  const expected = Number(expectedDuration);
  const duration = Number(track.durationInSec ?? track.duration);
  if (!declaredIdentity && !uploaderIdentity && !(duration >= 45)) return 0;
  const tolerance = Math.min(30, Math.max(12, expected * 0.12));
  if (expected >= 45 && duration > 0 && Math.abs(expected - duration) > tolerance) return 0;
  const durationScore = expected >= 45 && duration > 0
    ? 20 * (1 - Math.abs(expected - duration) / tolerance) : 0;
  return 100 + (declaredIdentity ? 40 : uploaderIdentity ? 20 : 10) + durationScore;
}

function soundCloudSearchQueries(query, expectedTitle) {
  const artist = requestArtist(query, expectedTitle);
  const title = coreTitle(expectedTitle || query, artist);
  return [...new Set([
    fallbackSearchQuery(query, expectedTitle),
    `${text(artist)} ${title}`.trim(),
    `${title} ${text(artist)}`.trim(),
  ].filter(value => value.length >= 2).map(value => value.slice(0, 200)))].slice(0, 3);
}

module.exports = { soundCloudMatchScore, soundCloudSearchQueries };
