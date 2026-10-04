/** Alias vérifiés uniquement : ne jamais deviner une identité par préfixe. */
const ARTIST_ALIASES = [
  // https://www.turismoroma.it/en/node/171992 (Mari Froes / Mariana Froes)
  [/\bmariana froes\b/gu, 'mari froes'],
];

// Reçoit du texte déjà normalisé (minuscules, accents et ponctuation retirés).
function canonicalArtistText(value) {
  return ARTIST_ALIASES.reduce((text, [pattern, name]) => text.replace(pattern, name), value);
}

module.exports = { canonicalArtistText };
