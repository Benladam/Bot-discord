const path = require('node:path');
const fs = require('node:fs');
const { cacheAudio, closeMedia } = require('../../features/music/temporaryAudio');
const { readCookieFile } = require('../../features/music/youtubeCookies');
const {
  getYouTubeCookiesPaths, streamYtDlp, soundCloudSearchStream, youtubeSearchStream,
} = require('../../features/music/audioSender');
const { searchYouTubei, streamYouTubei } = require('../../features/music/providers/youtubei');
const { ensurePoToken, poTokenStatus } = require('../../features/music/youtubePoToken');

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
  if (String(input).trim() === 'setup-lavalink') {
    await require('../setup/installLavalink').installLavalink({ log });
    await require('../../features/music/lavalinkRuntime').ensureLavalink();
    log('[lavalink-check] Service et plugin prêts. Teste musiccheck lavalink --cache=durée Artiste - Titre pour vérifier l’audio complet.');
    return { installed: true, ready: true };
  }
  if (String(input).trim().startsWith('lavalink ')) {
    return lavalinkCheck(String(input).trim().slice('lavalink '.length), { log });
  }
  if (String(input).trim().startsWith('catalog ')) {
    const query = String(input).trim().slice(8).trim().slice(0, 200);
    if (query.length < 2 || /https?:\/\/|[\r\n\x00-\x1f]/i.test(query)) throw new Error('Utilise musiccheck catalog Artiste - Titre, sans lien.');
    const { searchCatalog } = require('../../features/music/musicCatalog');
    let removed = false;
    try { require.resolve('play-dl'); } catch (error) { removed = error.code === 'MODULE_NOT_FOUND'; }
    log(`[catalog-check] play-dl absent=${removed}; YouTubei primaire; métadonnées Deezer/SoundCloud HTTP; aucun navigateur utilisé.`);
    const initial = await searchCatalog(query, { limit: 10, fresh: true, sourceTimeoutMs: 2500 });
    // Attend aussi les fournisseurs tardifs pour ce diagnostic administrateur,
    // sans changer le délai court de l’autocomplétion Discord.
    await new Promise(resolve => setTimeout(resolve, 6500));
    const items = await searchCatalog(query, { limit: 10, sourceTimeoutMs: 2500 });
    const sources = {};
    for (const item of items.length ? items : initial) sources[item.provider] = (sources[item.provider] || 0) + 1;
    log(`[catalog-check] Résultats publics reçus par source : ${JSON.stringify(sources)}. Extraction audio et écoute non vérifiées.`);
    return { removed, sources };
  }
  if (String(input).trim().startsWith('youtubei ')) {
    return youtubeiCheck(String(input).trim().slice('youtubei '.length), { log });
  }
  if (input.trim().startsWith('pot-info ')) {
    return require('./poTokenCheck').poTokenCheck(diagnosticUrl(input.trim().slice(9)), { log });
  }
  if (input.trim() === 'setup-pot') {
    await require('../setup/installPoToken').installPoToken({ log });
    const ready = await ensurePoToken();
    log(ready ? '[musiccheck] PO token : helper prêt; tester une vidéo pour vérifier YouTube.' : '[musiccheck] PO token : helper non disponible.');
    return { installed: true, ready: Boolean(ready) };
  }
  const po = poTokenStatus();
  log(`[musiccheck] PO token : ${po.enabled ? po.ready ? 'helper prêt' : 'installé, démarrage à la lecture' : 'non installé ou désactivé'}.`);
  // Aucun accès Discord : lecture de la configuration et essai d'extraction seulement.
  const anonymousOnly = input.trim().startsWith('anonymous ');
  const requestedUrl = anonymousOnly ? input.trim().slice(10).trim() : input.trim();
  const url = requestedUrl ? diagnosticUrl(requestedUrl) : null;
  const paths = anonymousOnly ? [] : getPaths();
  if (anonymousOnly) log('[musiccheck] Diagnostic sans compte : aucun fichier de cookies lu ou transmis.');
  else if (!paths.length) log('[musiccheck] Aucun fichier de cookies configuré.');
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
    stream = anonymousOnly ? await probe(url, { cookiesPaths: [] }) : await probe(url);
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

async function youtubeiCheck(input, {
  log = console.info,
  search = searchYouTubei,
  open = streamYouTubei,
  cache = cacheAudio,
  label = 'youtubei-check',
} = {}) {
  const request = String(input || '').trim();
  const match = request.match(/^--cache=(\d{1,4})\s+(.+)$/u);
  if (!match) throw new Error('Utilise musiccheck youtubei --cache=durée Artiste - Titre pour valider tout le morceau.');
  const expectedDuration = Number(match[1]);
  const query = match[2].trim();
  if (!(expectedDuration >= 1 && expectedDuration <= 1200)
      || query.length < 3 || query.length > 200
      || /https?:\/\/|[\r\n\x00-\x1f]/i.test(query)
      || !/\S\s+[-–—]\s+\S/u.test(query)) {
    throw new Error('Indique une durée de 1 à 1200 secondes et une recherche Artiste - Titre, sans lien.');
  }
  let stream;
  let media;
  try {
    stream = await youtubeSearchStream(query, {
      expectedDuration,
      expectedTitle: query,
      guildId: 'diagnostic',
      searchCandidates: search,
      openTrack: open,
    });
    media = await cache({ stream, ...stream.musicSource }, { expectedDuration, log });
    if (!media?.cached) throw Object.assign(new Error('Le cache audio complet n’a pas été validé.'), { code: 'AUDIO_CACHE_UNAVAILABLE' });
    log(`[${label}] Le bon candidat et le morceau complet ont passé la vérification de durée; aucun cookie ni vocal utilisé.`);
    return { available: true, cached: true };
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'EXTRACTION_FAILED';
    log(`[${label}] Échec du test complet (${code}); aucun morceau n’a été lancé.`);
    if (error?.providerReason) {
      const reason = error.providerReason;
      const summary = `${reason.name || 'Error'}${reason.code ? `/${reason.code}` : ''}: ${reason.message || ''}`
        .replace(/https?:\/\/[^\s]+/gi, '[URL]')
        .replace(/\b(cookie|authorization|token|signature|sig)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
        .replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (summary) log(`[${label}] Détail expurgé du fournisseur: ${summary}`);
    }
    return { available: false, code };
  } finally {
    if (media) {
      closeMedia(media);
      if (media.cached) log(fs.existsSync(media.url)
        ? `[${label}] Suppression du cache en attente.`
        : `[${label}] Fichier audio temporaire supprimé.`);
    }
    closeMedia({ stream });
  }
}

function lavalinkCheck(input, options = {}) {
  const { searchLavalink, streamLavalink } = require('../../features/music/providers/lavalink');
  return youtubeiCheck(input, { search: searchLavalink, open: streamLavalink, ...options, label: 'lavalink-check' });
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

module.exports = { musicCheck, diagnosticUrl, soundCloudCheck, youtubeiCheck, lavalinkCheck };
