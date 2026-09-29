/** Métadonnées publiques des liens musicaux et journalisation sans secrets. */
const play = require('play-dl');
const { cleanMediaQuery } = require('./mediaQuery');

const PROVIDER_LABELS = Object.freeze({
  youtube: 'YouTube',
  spotify: 'Spotify',
  deezer: 'Deezer',
  soundcloud: 'SoundCloud',
  other: 'inconnu',
});

function extractLink(input) {
  const cleaned = cleanMediaQuery(input);
  const spotifyUri = cleaned.match(/^spotify:(?:track|album|playlist|artist):[A-Za-z0-9]+(?:\?[A-Za-z0-9_=&%-]+)?$/i);
  if (spotifyUri) return { value: cleaned, spotifyUri: true };

  const candidate = cleaned.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.!?;]+$/, '');
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return { value: url.toString(), url };
  } catch (_) {
    return null;
  }
}

function identifyProvider(link) {
  if (link?.spotifyUri) return 'spotify';
  const host = link?.url?.hostname?.toLowerCase().replace(/^www\./, '') || '';
  if (host === 'youtu.be' || /(^|\.)youtube\.com$/.test(host) || host === 'youtube-nocookie.com') return 'youtube';
  if (host === 'spotify.com' || host.endsWith('.spotify.com')) return 'spotify';
  if (host === 'deezer.com' || host.endsWith('.deezer.com') || host === 'dzr.page.link') return 'deezer';
  if (host === 'snd.sc' || host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) return 'soundcloud';
  return 'other';
}

function getMusicInputInfo(input) {
  const value = String(input || '').trim();
  const link = extractLink(value);
  if (!link) return { kind: 'name', provider: null, value, safe: cleanLogText(value, 180) };
  const provider = identifyProvider(link);
  return {
    kind: 'link',
    provider,
    providerLabel: PROVIDER_LABELS[provider],
    value: link.value,
    safe: safeLinkForLog(link, provider),
  };
}

function cleanLogText(value, maxLength = 240) {
  const cleaned = String(value || '')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[lien retiré]')
    .replace(/\b(access_token|refresh_token|client_secret|secret_token|token|sig|signature|cookie)=([^\s&]+)/gi, '$1=[masqué]')
    .replace(/[\r\n\t\u0000-\u001f]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

function sanitizeDiagnosticText(value) {
  const redacted = String(value || '')
    .replace(/https?:\/\/[^\s<>"']+/gi, (rawUrl) => {
      try {
        const link = extractLink(rawUrl.replace(/[),.!?;]+$/, ''));
        return link ? safeLinkForLog(link, identifyProvider(link)) : '[lien masqué]';
      } catch (_) { return '[lien masqué]'; }
    })
    .replace(/spotify:(track|album|playlist|artist):([A-Za-z0-9]+)(?:\?[^\s"']*)?/gi, 'spotify:$1:$2')
    .replace(/\b(access_token|refresh_token|client_secret|secret_token|token|sig|signature|cookie)=([^\s&]+)/gi, '$1=[masqué]');
  return cleanLogText(redacted, 600);
}

function safeLinkForLog(link, provider) {
  if (link.spotifyUri) {
    const match = link.value.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)/i);
    return match ? `spotify:${match[1].toLowerCase()}:${match[2]}` : 'spotify:[lien]';
  }
  const url = new URL(link.value);
  url.username = '';
  url.password = '';
  url.hash = '';
  const safeParams = new URLSearchParams();
  if (provider === 'youtube') {
    for (const key of ['v', 'list']) {
      const value = url.searchParams.get(key);
      if (value && /^[A-Za-z0-9_-]{1,64}$/.test(value)) safeParams.set(key, value);
    }
  }
  url.search = safeParams.toString();
  let hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (provider === 'youtube' && hostname === 'youtube-nocookie.com') hostname = 'youtube.com';
  let pathname = url.pathname || '/';
  try { pathname = decodeURIComponent(pathname); } catch (_) { /* conserver le chemin encodé */ }
  // Les URL privées SoundCloud peuvent contenir un jeton secret dans le chemin.
  pathname = pathname.replace(/\/s-[A-Za-z0-9_-]+/g, '/s-[masqué]');
  const result = `${hostname}${pathname}${url.search}`.replace(/\/{2,}/g, '/');
  return cleanLogText(result, 200);
}

function spotifyTarget(value) {
  const uri = String(value).match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };
  const link = extractLink(value);
  const host = link?.url?.hostname?.toLowerCase().replace(/^www\./, '');
  if (!host || !(host === 'spotify.com' || host.endsWith('.spotify.com'))) return null;
  const match = link.url.pathname.match(/\/(?:intl-[a-z]{2,3}(?:-[a-z]{2})?\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/i);
  return match ? { type: match[1].toLowerCase(), id: match[2] } : null;
}

function youtubeTarget(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtu.be') return { id: url.pathname.split('/').filter(Boolean)[0] || null, playlist: url.searchParams.get('list') };
  if (!/(^|\.)youtube\.com$/.test(host) && host !== 'youtube-nocookie.com') return null;
  const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/i)?.[1] || null;
  return { id, playlist: url.searchParams.get('list') };
}

async function requestOEmbed(endpoint, targetUrl, fetchImpl, timeoutMs) {
  const url = new URL(endpoint);
  url.searchParams.set('url', targetUrl);
  url.searchParams.set('format', 'json');
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) return null;
  return response.json();
}

async function resolveBeforeTimeout(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function makeMetadata(provider, title, artist = '', kind = 'track') {
  const rawTitle = String(title || '').trim();
  if (/https?:\/\//i.test(rawTitle)) return null;
  const cleanTitle = cleanLogText(rawTitle, 200);
  const cleanArtist = cleanLogText(artist, 120);
  if (!cleanTitle) return null;
  const searchQuery = kind === 'track' && cleanArtist
    && !cleanTitle.toLocaleLowerCase().includes(cleanArtist.toLocaleLowerCase())
    ? `${cleanArtist} - ${cleanTitle}`
    : cleanTitle;
  return { provider, kind, title: cleanTitle, artist: cleanArtist, searchQuery: cleanLogText(searchQuery, 240) };
}

async function resolveMusicLinkMetadata(input, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 2_500,
} = {}) {
  if (typeof fetchImpl !== 'function') return null;
  const link = extractLink(input);
  if (!link) return null;
  const provider = identifyProvider(link);
  const requestTimeout = Math.max(100, Math.min(5_000, Number(timeoutMs) || 2_500));

  if (provider === 'spotify') {
    const target = spotifyTarget(link.value);
    if (!target) return null;
    const canonical = `https://open.spotify.com/${target.type}/${target.id}`;
    const data = await requestOEmbed('https://open.spotify.com/oembed', canonical, fetchImpl, requestTimeout).catch(() => null);
    return data?.title ? makeMetadata(provider, data.title, '', target.type) : null;
  }

  if (provider === 'youtube') {
    const target = youtubeTarget(link.url);
    if (!target) return null;
    if (target.id) {
      const canonical = `https://www.youtube.com/watch?v=${encodeURIComponent(target.id)}`;
      const data = await requestOEmbed('https://www.youtube.com/oembed', canonical, fetchImpl, requestTimeout).catch(() => null);
      if (data?.title) return makeMetadata(provider, data.title, data.author_name || '', 'track');
    }
    if (target.playlist) {
      const listUrl = new URL('https://www.youtube.com/playlist');
      listUrl.searchParams.set('list', target.playlist);
      const playlist = await resolveBeforeTimeout(
        () => play.playlist_info(listUrl.toString(), { incomplete: true }).catch(() => null),
        requestTimeout,
      );
      const title = playlist?.title || playlist?.name;
      if (title) return makeMetadata(provider, title, '', 'playlist');
    }
    return null;
  }

  if (provider === 'soundcloud') {
    const data = await requestOEmbed('https://soundcloud.com/oembed', link.value, fetchImpl, requestTimeout).catch(() => null);
    return data?.title ? makeMetadata(provider, data.title, data.author_name || '', 'track') : null;
  }

  if (provider === 'deezer') {
    const match = link.url.pathname.match(/\/(track|album|playlist|artist)\/(\d+)/i);
    if (match) {
      const kind = match[1].toLowerCase();
      const response = await fetchImpl(`https://api.deezer.com/${kind}/${match[2]}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(requestTimeout),
      }).catch(() => null);
      if (response?.ok) {
        const data = await response.json().catch(() => null);
        const title = kind === 'artist' ? data?.name : data?.title || data?.name;
        const artist = data?.artist?.name || data?.creator?.name || '';
        if (title) return makeMetadata(provider, title, artist, kind);
      }
    }
    // play-dl sait suivre les liens Deezer courts lorsque l'API publique ne suffit pas.
    const entry = await resolveBeforeTimeout(() => play.deezer(link.value).catch(() => null), requestTimeout);
    if (!entry) return null;
    const kind = entry.type === 'track' ? 'track' : entry.type === 'album' ? 'album' : entry.type === 'playlist' ? 'playlist' : 'artist';
    const title = entry.title || entry.name;
    const artist = entry.artist?.name || entry.user?.name || entry.creator?.name || '';
    return title ? makeMetadata(provider, title, artist, kind) : null;
  }

  return null;
}

function formatMusicAttempt(input) {
  const info = getMusicInputInfo(input);
  if (info.kind === 'name') return `entrée=nom recherche=${JSON.stringify(info.safe || '(vide)')}`;
  return `entrée=lien plateforme=${info.providerLabel} adresse=${JSON.stringify(info.safe)}`;
}

module.exports = {
  getMusicInputInfo,
  formatMusicAttempt,
  resolveMusicLinkMetadata,
  cleanLogText,
  sanitizeDiagnosticText,
};
