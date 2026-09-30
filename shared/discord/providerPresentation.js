const PROVIDERS = Object.freeze({
  youtube: { name: 'YouTube', iconURL: 'attachment://provider-youtube.png' },
  spotify: { name: 'Spotify', iconURL: 'attachment://provider-spotify.png' },
  deezer: { name: 'Deezer', iconURL: 'attachment://provider-deezer.png' },
  soundcloud: { name: 'SoundCloud', iconURL: 'attachment://provider-soundcloud.png' },
  apple_music: { name: 'Apple Music', iconURL: 'attachment://provider-apple_music.png' },
  amazon_music: { name: 'Amazon Music', iconURL: 'attachment://provider-amazon_music.png' },
  tidal: { name: 'Tidal', iconURL: 'attachment://provider-tidal.png' },
  bandcamp: { name: 'Bandcamp', iconURL: 'attachment://provider-bandcamp.png' },
  audiomack: { name: 'Audiomack', iconURL: 'attachment://provider-audiomack.png' },
  mixcloud: { name: 'Mixcloud', iconURL: 'attachment://provider-mixcloud.png' },
  audius: { name: 'Audius', iconURL: 'attachment://provider-audius.png' },
  qobuz: { name: 'Qobuz', iconURL: 'attachment://provider-qobuz.png' },
  pandora: { name: 'Pandora', iconURL: 'attachment://provider-pandora.png' },
  napster: { name: 'Napster', iconURL: 'attachment://provider-napster.png' },
});

function normalizeProviderUrl(provider, value) {
  const raw = String(value || '').trim();
  const spotify = raw.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/i);
  if (spotify) return `https://open.spotify.com/${spotify[1].toLowerCase()}/${spotify[2]}`;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    // Les embeds ne doivent jamais publier une URL de flux signée ou interne.
    const domains = ['youtube.com', 'youtu.be', 'youtube-nocookie.com', 'spotify.com', 'spotify.link',
      'deezer.com', 'dzr.page.link', 'soundcloud.com', 'snd.sc', 'music.apple.com',
      'music.amazon.com', 'music.amazon.fr', 'music.amazon.co.uk', 'music.amazon.de',
      'tidal.com', 'bandcamp.com', 'audiomack.com', 'mixcloud.com', 'audius.co',
      'qobuz.com', 'pandora.com', 'napster.com'];
    if (!domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
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
