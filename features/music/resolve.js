/**
 * Résolution de musique : YouTube, Spotify et Deezer via leurs métadonnées.
 * Fonctionne pour les deux modes de commande (! et /).
 */

const play = require('play-dl');
const { isSpotifyUrl, resolveSpotifyLink } = require('./providers/spotify');
const { configureSoundCloud } = require('./providers/soundcloud');
const { searchYouTubeCandidates, searchSoundCloudCandidates, resolveSoundCloudCandidates } = require('./audioSender');
const { musicArtwork } = require('./artwork');

function youtubeVideoId(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.split('/').filter(Boolean)[0] || null;
    if (!['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'].includes(host)) return null;
    const fromQuery = parsed.searchParams.get('v');
    if (fromQuery) return fromQuery;
    return parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?]+)/i)?.[1] || null;
  } catch (_) {
    return null;
  }
}

function normalizeSoundCloudTrack(track) {
  const title = track.name || track.title || 'Musique inconnue';
  const artist = track.user?.username || track.publisher?.name || track.channel?.name || track.uploader || '';
  return {
    title: artist && !title.toLowerCase().includes(artist.toLowerCase()) ? `${artist} - ${title}` : title,
    url: track.permalink || track.webpage_url || track.url,
    duration: track.durationInSec || track.duration || 0,
    thumbnail: musicArtwork(track),
    source: 'soundcloud',
    fallbackQuery: [artist, title].filter(Boolean).join(' - '),
  };
}

async function resolveSoundCloudLink(url) {
  if (configureSoundCloud()) {
    try {
      const entry = await play.soundcloud(url);
      const tracks = entry.type === 'track' ? [entry]
        : entry.type === 'playlist' ? await entry.all_tracks()
          : [];
      const songs = tracks.slice(0, 100).map(normalizeSoundCloudTrack).filter((track) => track.url);
      if (songs.length) return songs;
    } catch (_) { /* repli sur l'extracteur yt-dlp */ }
  }
  let extracted = [];
  try {
    extracted = await resolveSoundCloudCandidates(url, { limit: 100 });
  } catch (_) { /* le message final ne révèle aucun détail sensible du fournisseur */ }
  const songs = extracted.slice(0, 100).map(normalizeSoundCloudTrack).filter((track) => track.url);
  if (!songs.length) throw new Error('Aucun morceau SoundCloud public et lisible trouvé dans ce lien.');
  return songs;
}

/**
 * Résout une requête utilisateur en une ou plusieurs chansons jouables.
 * @returns {Promise<Array<{title,url,duration,thumbnail,source}>>}
 */
async function resolveQuery(query, { fetchImpl = globalThis.fetch } = {}) {
  if (/(?:soundcloud\.com|snd\.sc)\//i.test(query)) {
    return resolveSoundCloudLink(query);
  }

  // 1) Lien Spotify
  if (isSpotifyUrl(query)) {
    return resolveSpotifyLink(query);
  }

  // Deezer sert de catalogue/metadata; l'audio est ensuite trouvé sur YouTube.
  if (/(?:deezer\.com|dzr\.page\.link)\//i.test(query)) {
    return resolveDeezerLink(query);
  }

  // 2) Lien YouTube
  const videoId = youtubeVideoId(query);
  if (videoId) {
    // Ne pas demander les métadonnées par play-dl avant la lecture : YouTube
    // bloque souvent ces requêtes d'hébergeur avec "Sign in to confirm...".
    // yt-dlp récupère le flux audio dans audioSender.js au démarrage de la lecture.
    let metadata = null;
    if (typeof fetchImpl === 'function') {
      try {
        const canonicalUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        const oembedUrl = new URL('https://www.youtube.com/oembed');
        oembedUrl.searchParams.set('url', canonicalUrl);
        oembedUrl.searchParams.set('format', 'json');
        const response = await fetchImpl(oembedUrl, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(2_500),
        });
        if (response.ok) {
          const data = await response.json();
          const title = String(data?.title || '').trim().slice(0, 200);
          const artist = String(data?.author_name || '').trim().slice(0, 100);
          let thumbnail = null;
          try {
            const parsedThumbnail = new URL(data?.thumbnail_url);
            if (parsedThumbnail.protocol === 'https:' && /(^|\.)ytimg\.com$/i.test(parsedThumbnail.hostname)) {
              thumbnail = parsedThumbnail.toString();
            }
          } catch (_) { /* métadonnées optionnelles et non fiables */ }
          if (title) metadata = { title, artist, thumbnail };
        }
      } catch (_) { /* la lecture directe reste possible si le catalogue public est indisponible */ }
    }
    const title = metadata?.title || `YouTube · ${videoId}`;
    const fallbackQuery = [metadata?.artist, metadata?.title].filter(Boolean).join(' - ');
    return [{
      title,
      url: query,
      duration: 0,
      thumbnail: musicArtwork({ thumbnail: metadata?.thumbnail, url: query }),
      source: 'youtube',
      ...(fallbackQuery ? { fallbackQuery } : {}),
    }];
  }

  if (/(?:youtube\.com|youtu\.be)/i.test(query)) {
    const valid = await play.validate(query);
    if (!valid) {
      throw new Error('Lien YouTube invalide.');
    }
    if (valid === 'yt_playlist') {
      const playlist = await play.playlist_info(query, { incomplete: true });
      const videos = (await playlist.all_videos()).slice(0, 100);
      return videos.map((video) => ({
        title: video.title || 'Musique inconnue',
        url: video.url,
        duration: video.durationInSec || 0,
        thumbnail: video.thumbnails?.[0]?.url || null,
        source: 'youtube',
      }));
    }
    const info = await play.video_info(query);
    const d = info.video_details;
    return [{
      title: d.title || 'Musique inconnue',
      url: d.url || query,
      duration: d.durationInSec || 0,
      thumbnail: d.thumbnails && d.thumbnails.length ? d.thumbnails[0].url : null,
      source: 'youtube',
    }];
  }

  // 3) Recherche texte sur YouTube
  const results = await searchYouTubeCandidates(query, { limit: 1 });
  if (!results.length) {
    throw new Error(`Aucun résultat trouvé pour: \`${query}\``);
  }
  const r = results[0];
  return [{
    title: r.title,
    url: r.url,
    duration: r.durationInSec || 0,
    thumbnail: musicArtwork(r),
    source: 'youtube',
    fallbackQuery: query,
  }];
}

async function resolveDeezerTracks(tracks, {
  search = searchYouTubeCandidates,
  searchSoundCloud = searchSoundCloudCandidates,
  onSearchError = (trackName, error) => {
    console.warn(`[catalogue] Recherche musicale échouée pour « ${trackName} »: ${error.message}`);
  },
} = {}) {
  const candidates = tracks.slice(0, 100);
  const songs = new Array(candidates.length);
  for (let offset = 0; offset < candidates.length; offset += 4) {
    const batch = candidates.slice(offset, offset + 4);
    const resolved = await Promise.all(batch.map(async (track) => {
      const title = track.title || track.name || 'Musique inconnue';
      const artist = track.artist?.name || '';
      const query = [artist, title].filter(Boolean).join(' - ');
      let media;
      try {
        const results = await search(query, { limit: 1 });
        const video = Array.isArray(results) ? results[0] : null;
        if (video?.url && youtubeVideoId(video.url)) media = video;
      } catch (error) {
        try { onSearchError(query, error); } catch (_) { /* garder la recherche indépendante du logger */ }
      }
      if (!media) {
        try {
          const alternatives = await searchSoundCloud(query);
          for (const candidate of Array.isArray(alternatives) ? alternatives : []) {
            const url = candidate?.permalink || candidate?.url;
            try {
              const parsed = new URL(url);
              if (parsed.protocol === 'https:' && /(^|\.)soundcloud\.com$/i.test(parsed.hostname)) {
                media = { ...candidate, url };
                break;
              }
            } catch (_) { /* résultat incomplet */ }
          }
        } catch (error) {
          try { onSearchError(query, error); } catch (_) { /* garder la playlist disponible */ }
        }
      }
      if (!media) return null;
      return {
        title: `${title}${artist ? ` - ${artist}` : ''}`,
        url: media.url,
        duration: track.durationInSec || media.durationInSec || 0,
        thumbnail: musicArtwork(track) || musicArtwork(media),
        source: 'deezer',
        fallbackQuery: query,
      };
    }));
    resolved.forEach((song, index) => { songs[offset + index] = song; });
  }
  const ready = songs.filter(Boolean);
  if (!ready.length) throw new Error('Aucun équivalent audio public trouvé sur YouTube ou SoundCloud pour ce lien Deezer. Vérifie la disponibilité du titre sur ces plateformes.');
  if (tracks.length > candidates.length) console.info('[catalogue] liste Deezer limitée aux 100 premiers titres.');
  return ready;
}

async function resolveDeezerLink(url) {
  const entry = await play.deezer(url);
  const tracks = entry.type === 'track' ? [entry] : await entry.all_tracks();
  return resolveDeezerTracks(tracks);
}

module.exports = { resolveQuery, youtubeVideoId, normalizeSoundCloudTrack, resolveDeezerTracks };
