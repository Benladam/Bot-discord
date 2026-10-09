/** Configuration OAuth du plugin YouTube, uniquement dans l'installation privée. */
const fs = require('node:fs');
const path = require('node:path');
const { VERSION } = require('./lavalinkRuntime');

function privateConfigPath(root) {
  const resolved = path.resolve(String(root || ''));
  if (!path.isAbsolute(String(root || '')) || path.basename(resolved) !== VERSION
      || path.basename(path.dirname(resolved)) !== 'lavalink'
      || path.basename(path.dirname(path.dirname(resolved))) !== '.cache') {
    throw new Error('Chemin d’installation Lavalink invalide.');
  }
  const config = path.join(resolved, 'application.yml');
  if (!fs.statSync(config).isFile()) throw new Error('Configuration Lavalink introuvable.');
  return config;
}

function editOAuthConfig(root, { enable = false, refreshToken } = {}) {
  const configPath = privateConfigPath(root);
  const original = fs.readFileSync(configPath, 'utf8');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const pluginIndex = lines.indexOf('plugins:');
  if (pluginIndex < 0 || lines[pluginIndex + 1] !== '  youtube:') {
    throw new Error('Structure YouTube inattendue; configuration privée conservée.');
  }
  const pluginEnd = lines.findIndex((line, index) => index > pluginIndex && line && !/^\s|^#/.test(line));
  const end = pluginEnd < 0 ? lines.length : pluginEnd;
  const enabledIndex = lines.findIndex((line, index) => index > pluginIndex && index < end && line === '    enabled: true');
  if (enabledIndex < 0) throw new Error('Option YouTube introuvable; configuration privée conservée.');

  let oauthIndex = lines.findIndex((line, index) => index > pluginIndex && index < end && line === '    oauth:');
  if (enable && oauthIndex < 0) {
    lines.splice(enabledIndex + 1, 0, '    oauth:', '      enabled: true');
    oauthIndex = enabledIndex + 1;
  }
  if (oauthIndex >= 0) {
    const oauthEnd = lines.findIndex((line, index) => index > oauthIndex && index < end && /^    [A-Za-z]/.test(line));
    const actualEnd = oauthEnd < 0 ? end : oauthEnd;
    const enabledOAuthIndex = lines.findIndex((line, index) => index > oauthIndex && index < actualEnd && line === '      enabled: true');
    if (enable && enabledOAuthIndex < 0) lines.splice(oauthIndex + 1, 0, '      enabled: true');
    if (typeof refreshToken === 'string') {
      if (refreshToken.length < 20 || refreshToken.length > 4096 || /[\r\n\x00-\x1f]/.test(refreshToken)) {
        throw new Error('Jeton OAuth invalide; aucun jeton n’a été enregistré.');
      }
      const tokenLine = `      refreshToken: ${JSON.stringify(refreshToken)}`;
      const skipLine = '      skipInitialization: true';
      const tokenIndex = lines.findIndex((line, index) => index > oauthIndex && index < actualEnd && /^      refreshToken:/.test(line));
      if (tokenIndex >= 0) lines[tokenIndex] = tokenLine;
      else lines.splice(actualEnd, 0, tokenLine);
      const skipIndex = lines.findIndex(line => line === skipLine);
      if (skipIndex < 0) lines.splice(tokenIndex >= 0 ? tokenIndex + 1 : actualEnd + 1, 0, skipLine);
    }
  }

  const current = lines.join(eol) + eol;
  let updated = current;
  if (enable && !/^      - TV\s*$/m.test(updated)) {
    const clientMarker = '      - WEBEMBEDDED';
    if (!updated.includes(clientMarker)) throw new Error('Liste des clients YouTube introuvable; configuration conservée.');
    updated = updated.replace(clientMarker, `${clientMarker}${eol}      - TV`);
  }
  if (enable) {
    const logger = '    dev.lavalink.youtube.http.YoutubeOauth2Handler: INFO';
    if (!updated.includes(logger)) {
      const rootLevel = '    root: WARN';
      if (!updated.includes(rootLevel)) throw new Error('Configuration des logs Lavalink inattendue; fichier conservé.');
      updated = updated.replace(rootLevel, `${rootLevel}${eol}${logger}`);
    }
  }
  if (updated !== original) {
    const temp = `${configPath}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(temp, updated, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      fs.chmodSync(temp, 0o600);
      fs.renameSync(temp, configPath);
    } catch (error) {
      try { fs.unlinkSync(temp); } catch {}
      throw error;
    }
  }
  return configPath;
}

function enableLavalinkOAuth(root) { return editOAuthConfig(root, { enable: true }); }
function persistLavalinkRefreshToken(root, refreshToken) {
  return editOAuthConfig(root, { refreshToken });
}

function parseOAuthDeviceLine(line) {
  const match = String(line).match(/OAUTH INTEGRATION: To give youtube-source access to your account, go to\s+(https:\/\/[^\s]+)\s+and enter code\s+([A-Za-z0-9-]{6,20})/i);
  if (!match) return null;
  try {
    const url = new URL(match[1].replace(/[.,;)]$/, ''));
    const hostAllowed = url.hostname === 'google.com' || url.hostname.endsWith('.google.com')
      || url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com');
    if (url.protocol !== 'https:' || !hostAllowed || url.username || url.password) return null;
    return { url: `${url.origin}${url.pathname}`, code: match[2].toUpperCase() };
  } catch { return null; }
}

function parseOAuthRefreshTokenLine(line) {
  const match = String(line).match(/Token retrieved successfully\. Store your refresh token as this can be reused\. \(([^()\s]{20,4096})\)/i);
  return match?.[1] || null;
}

module.exports = { enableLavalinkOAuth, persistLavalinkRefreshToken, parseOAuthDeviceLine, parseOAuthRefreshTokenLine };
