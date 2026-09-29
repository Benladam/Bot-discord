const PROVIDERS = Object.freeze({
  youtube: { name: 'YouTube', iconURL: 'https://cdn.simpleicons.org/youtube/FF0000' },
  spotify: { name: 'Spotify', iconURL: 'https://cdn.simpleicons.org/spotify/1ED760' },
  deezer: { name: 'Deezer', iconURL: 'https://cdn.simpleicons.org/deezer/FEAA2D' },
  soundcloud: { name: 'SoundCloud', iconURL: 'https://cdn.simpleicons.org/soundcloud/FF5500' },
  apple_music: { name: 'Apple Music', iconURL: 'https://cdn.simpleicons.org/applemusic/FA243C' },
  amazon_music: { name: 'Amazon Music', iconURL: 'https://cdn.simpleicons.org/amazonmusic/00A8E0' },
  tidal: { name: 'Tidal', iconURL: 'https://cdn.simpleicons.org/tidal/FFFFFF' },
  bandcamp: { name: 'Bandcamp', iconURL: 'https://cdn.simpleicons.org/bandcamp/408294' },
  audiomack: { name: 'Audiomack', iconURL: 'https://cdn.simpleicons.org/audiomack/FFA200' },
  mixcloud: { name: 'Mixcloud', iconURL: 'https://cdn.simpleicons.org/mixcloud/5000FF' },
  audius: { name: 'Audius', iconURL: 'https://cdn.simpleicons.org/audius/CC0FE0' },
  qobuz: { name: 'Qobuz', iconURL: 'https://www.qobuz.com/favicon.ico' },
  pandora: { name: 'Pandora', iconURL: 'https://www.pandora.com/favicon.ico' },
  napster: { name: 'Napster', iconURL: 'https://www.napster.com/favicon.ico' },
});

function normalizeProviderUrl(provider, value) {
  const raw = String(value || '').trim();
  const spotify = raw.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/i);
  if (spotify) return `https://open.spotify.com/${spotify[1].toLowerCase()}/${spotify[2]}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (keyIsYoutube(provider)) {
      const original = new URLSearchParams(url.search);
      url.search = '';
      for (const name of ['v', 'list']) {
        const value = original.get(name);
        if (value && /^[A-Za-z0-9_-]{1,64}$/.test(value)) url.searchParams.set(name, value);
      }
    } else {
      url.search = '';
    }
    url.hash = '';
    return url.toString();
  } catch (_) {
    return null;
  }
}

function keyIsYoutube(provider) { return String(provider || '').toLowerCase() === 'youtube'; }

function providerPresentation(provider, url) {
  const key = String(provider || '').toLowerCase();
  const entry = PROVIDERS[key] || PROVIDERS.youtube;
  return { ...entry, url: normalizeProviderUrl(key, url) };
}

module.exports = { PROVIDERS, normalizeProviderUrl, providerPresentation };
