const path = require('node:path');
const { readCookieFile } = require('../../features/music/youtubeCookies');
const { getYouTubeCookiesPaths, streamYtDlp } = require('../../features/music/audioSender');

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
module.exports = { musicCheck, diagnosticUrl };
