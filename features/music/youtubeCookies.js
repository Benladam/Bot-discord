const fs = require('node:fs');

const MAX_COOKIE_BYTES = 1024 * 1024;
const AUTH_COOKIE = /^(?:SID|HSID|SSID|APISID|SAPISID|LOGIN_INFO|__Secure-(?:1P|3P)(?:SID|APISID|SIDTS|SIDCC))$/;

function cookieError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Ne jamais inclure les lignes ou valeurs de cookies dans une erreur.
function inspectCookieText(input, { now = Date.now() } = {}) {
  const content = String(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)(?:\n|$)/.test(content)) {
    throw cookieError('YOUTUBE_COOKIES_INVALID', 'Le fichier de cookies doit être une exportation Netscape, pas du JSON ou du HTML.');
  }
  const summary = { entries: 0, youtubeEntries: 0, activeEntries: 0, expiredEntries: 0, activeAuthEntries: 0 };
  for (const rawLine of content.split('\n').slice(1)) {
    if (!rawLine.trim() || (rawLine.startsWith('#') && !rawLine.startsWith('#HttpOnly_'))) continue;
    const fields = rawLine.replace(/^#HttpOnly_/, '').split('\t');
    if (fields.length !== 7 || !/^(TRUE|FALSE)$/.test(fields[1]) || !/^(TRUE|FALSE)$/.test(fields[3])
        || !/^\d+$/.test(fields[4]) || !fields[2].startsWith('/') || !fields[5] || /\0/.test(rawLine)) {
      throw cookieError('YOUTUBE_COOKIES_INVALID', 'Une ligne du fichier de cookies ne respecte pas le format Netscape à sept colonnes.');
    }
    summary.entries++;
    const domain = fields[0].toLowerCase().replace(/^\./, '');
    if (domain !== 'youtube.com' && !domain.endsWith('.youtube.com')) continue;
    summary.youtubeEntries++;
    const active = fields[6].length > 0 && (Number(fields[4]) === 0 || Number(fields[4]) * 1000 > now);
    if (active) {
      summary.activeEntries++;
      if (AUTH_COOKIE.test(fields[5])) summary.activeAuthEntries++;
    } else summary.expiredEntries++;
  }
  if (!summary.youtubeEntries) throw cookieError('YOUTUBE_COOKIES_EMPTY', 'Le fichier ne contient aucun cookie YouTube.');
  if (!summary.activeEntries) throw cookieError('YOUTUBE_COOKIES_EXPIRED', 'Tous les cookies YouTube de cette exportation sont expirés ou vides. Renouvelle le fichier sur le serveur.');
  return { content: content.endsWith('\n') ? content : `${content}\n`, summary };
}

function readCookieFile(file, options) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_COOKIE_BYTES) {
    throw cookieError('YOUTUBE_COOKIES_INVALID', 'Le fichier de cookies est invalide ou dépasse 1 Mio.');
  }
  return inspectCookieText(fs.readFileSync(file, 'utf8'), options);
}

module.exports = { inspectCookieText, readCookieFile };
