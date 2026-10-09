/** Adaptateur HTTP SoundCloud, indépendant des bibliothèques YouTube. */

function getSoundCloudClientId(env = process.env) {
  return String(env.SOUNDCLOUD_CLIENT_ID || '').trim();
}

function configureSoundCloud(env = process.env) {
  const clientId = getSoundCloudClientId(env);
  if (!clientId) return false;
  return true;
}

function safeUrl(value, hosts) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Adresse SoundCloud invalide.');
  return url;
}

async function requestSoundCloud(value, { fetchImpl = globalThis.fetch, env = process.env, timeoutMs = 5000 } = {}) {
  const url = safeUrl(value, ['api-v2.soundcloud.com']);
  const clientId = getSoundCloudClientId(env);
  if (!clientId) throw new Error('Le repli API SoundCloud nécessite SOUNDCLOUD_CLIENT_ID.');
  url.searchParams.set('client_id', clientId);
  const response = await fetchImpl(url.href, { redirect: 'error', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`API SoundCloud indisponible (HTTP ${response.status}).`);
  return response.json();
}

function normalizeTrack(track) {
  return { ...track, type: 'track', title: track.title,
    url: track.permalink_url, permalink: track.permalink_url,
    durationInSec: (Number(track.duration) || 0) / 1000,
    // Les résultats de recherche ont toujours une durée exprimée en secondes.
    duration: (Number(track.duration) || 0) / 1000,
    thumbnail: track.artwork_url || track.user?.avatar_url,
    formats: track.media?.transcodings || [],
  };
}

async function searchSoundCloud(query, { limit = 25, ...options } = {}) {
  const url = new URL('https://api-v2.soundcloud.com/search/tracks');
  url.searchParams.set('q', String(query).trim().slice(0, 200));
  url.searchParams.set('limit', String(Math.max(1, Math.min(25, Number(limit) || 25))));
  const data = await requestSoundCloud(url.href, options);
  return (data.collection || []).map(normalizeTrack);
}

async function resolveSoundCloud(value, options = {}) {
  const link = safeUrl(value, ['soundcloud.com', 'snd.sc']);
  const endpoint = new URL('https://api-v2.soundcloud.com/resolve');
  endpoint.searchParams.set('url', link.href);
  const data = await requestSoundCloud(endpoint.href, options);
  if (data.kind === 'track') return [normalizeTrack(data)];
  if (data.kind !== 'playlist') return [];
  const tracks = [];
  for (const item of (data.tracks || []).slice(0, 100)) {
    const track = item.title ? item : await requestSoundCloud(`https://api-v2.soundcloud.com/tracks/${encodeURIComponent(item.id)}`, options);
    tracks.push(normalizeTrack(track));
  }
  return tracks;
}

async function getSoundCloudTrack(value, options = {}) {
  const tracks = await resolveSoundCloud(value, options);
  if (tracks.length !== 1) throw new Error('Indique une piste SoundCloud pour ouvrir un flux.');
  return tracks[0];
}

async function streamSoundCloudInfo(track, options = {}) {
  const formats = (track.formats || []).filter(format => !format.snipped && !/preview|\/playlist\/0\/30\//i.test(format.url || ''));
  // Les extraits ne sont jamais acceptés, même si le catalogue annonce un titre complet.
  if (!formats.length) throw Object.assign(new Error('SoundCloud ne fournit aucun flux complet.'), { code: 'SOUNDCLOUD_PREVIEW_ONLY' });
  let lastError;
  for (const format of formats) {
    try {
      const endpoint = safeUrl(format.url, ['api-v2.soundcloud.com']);
      if (track.track_authorization) endpoint.searchParams.set('track_authorization', track.track_authorization);
      const data = await requestSoundCloud(endpoint.href, options);
      const media = safeUrl(data.url, ['sndcdn.com']);
      return { url: media.href };
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error('Flux SoundCloud indisponible.');
}

module.exports = { configureSoundCloud, getSoundCloudClientId, searchSoundCloud, resolveSoundCloud, getSoundCloudTrack, streamSoundCloudInfo };
