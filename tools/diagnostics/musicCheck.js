const path = require('node:path');
const fs = require('node:fs');
const { cacheAudio, closeMedia } = require('../../features/music/temporaryAudio');
const { readCookieFile } = require('../../features/music/youtubeCookies');
const { getYouTubeCookiesPaths, streamYtDlp, soundCloudSearchStream } = require('../../features/music/audioSender');

function diagnosticUrl(input) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const id = host === 'youtu.be' ? url.pathname.slice(1) : url.pathname === '/watch' ? url.searchParams.get('v') : '';
  if (url.protocol !== 'https:' || url.username || url.password
      || !['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)
      || !/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('Indique uniquement un lien vidéo YouTube HTTPS valide.');
  return `https://www.youtube.com/watch?v=${id}`;
}

async function musicCheck(input = '', { log = console.info, getPaths = getYouTubeCookiesPaths, readCookies = readCookieFile, probe = streamYtDlp } = {}) {
  // Aucun accès Discord : lecture de la configuration et essai d'extraction seulement.
  const url = input.trim() ? diagnosticUrl(input.trim()) : null;
  const paths = getPaths();
  if (!paths.length) log('[musiccheck] Aucun fichier de cookies configuré.');
  paths.forEach((file, index) => {
    try {
      const { summary } = readCookies(file);
      log(`[musiccheck] cookies #${index + 1} (${path.basename(file)}): Netscape; YouTube actifs=${summary.activeEntries}; expirés=${summary.expiredEntries}; authentification=${summary.activeAuthEntries}. Acceptation par YouTube non vérifiée.`);
    } catch (error) {
      // Ne pas imprimer error.message : les erreurs fs peuvent révéler un chemin privé.
      log(`[musiccheck] cookies #${index + 1}: ${error.code || 'READ_FAILED'}. Vérifie le fichier sur cet hébergement.`);
    }
  });
  if (!url) return { probed: false };
  let stream;
  try {
    stream = await probe(url);
    if (['anonymous', 'cookies'].includes(stream?.youtubeAuthentication)) {
      log(`[musiccheck] Mode YouTube : ${stream.youtubeAuthentication === 'anonymous' ? 'sans compte, aucun cookie transmis' : 'cookies de secours'}.`);
    }
    log('[musiccheck] YouTube a fourni des octets audio. Aucun vocal rejoint; écoute Discord non vérifiée.');
    return { probed: true, available: true };
  } catch (error) {
    const code = error.code || 'EXTRACTION_FAILED';
    log(`[musiccheck] Extraction YouTube refusée (${/^[A-Z0-9_]+$/.test(code) ? code : 'EXTRACTION_FAILED'}).`);
    return { probed: true, available: false };
  } finally {
    try { stream?.cleanup?.(); } catch (_) {}
    stream?.destroy?.();
  }
}

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  musicCheck(process.argv[2] || '').catch(() => { console.error('[musiccheck] Lien de diagnostic invalide.'); process.exitCode = 1; });
}
async function soundCloudCheck(input, { log = console.info, probe = soundCloudSearchStream, cache = cacheAudio } = {}) {
  const request = String(input || '').trim();
  const fullCache = request.match(/^--cache=(\d{1,4})\s+(.+)$/u);
  const expectedDuration = fullCache ? Number(fullCache[1]) : undefined;
  if (fullCache && !(expectedDuration >= 1 && expectedDuration <= 1200)) throw new Error('Durée du diagnostic cache : 1 à 1200 secondes.');
  const query = fullCache ? fullCache[2] : request;
  if (query.length < 3 || query.length > 200 || /https?:\/\/|[\r\n\x00-\x1f]/i.test(query)
      || !/\S\s+[-–—]\s+\S/u.test(query)) {
    throw new Error('Utilise soundcloudcheck Artiste - Titre (sans lien).');
  }
  let stream;
  let media;
  try {
    stream = await probe(query, { expectedTitle: query, guildId: 'diagnostic', timeoutMs: 12_000,
      ...(fullCache ? { expectedDuration, validateStream: source => cache({ stream: source, ...source.musicSource }, { expectedDuration, log }) } : {}),
    });
    if (fullCache) {
      media = stream.cached ? stream : await cache({ stream, ...stream.musicSource }, { expectedDuration, log });
      if (!media.cached) throw Object.assign(new Error('Cache indisponible'), { code: 'AUDIO_CACHE_UNAVAILABLE' });
      log('[soundcloudcheck] Audio complet préparé et durée vérifiée. Aucun vocal rejoint; contenu audible non vérifié.');
    }
    else {
    log('[soundcloudcheck] Flux correspondant ouvert. Aucun vocal rejoint; contenu audible non vérifié.');
    }
    return { available: true };
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'EXTRACTION_FAILED';
    log(`[soundcloudcheck] Aucun flux correspondant disponible (${code}). Aucun autre morceau lancé.`);
    return { available: false, code };
  } finally {
    if (media) {
      closeMedia(media);
      if (media.cached) log(fs.existsSync(media.url)
        ? '[soundcloudcheck] Suppression du cache en attente.'
        : '[soundcloudcheck] Fichier audio temporaire supprimé.');
    }
    try { stream?.cleanup?.(); } catch (_) {}
    stream?.destroy?.();
  }
}

module.exports = { musicCheck, diagnosticUrl, soundCloudCheck };
