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

function editOAuthConfig(root, { enable = false, refreshToken, clearRefreshToken = false } = {}) {
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
    const refreshTokenConfigured = lines.some((line, index) => index > oauthIndex && index < actualEnd
      && /^      refreshToken:\s*(?!["']{2}\s*$)(?!null\s*$)\S/i.test(line));
    const skipInitializationIndex = lines.findIndex((line, index) => index > oauthIndex && index < actualEnd
      && line === '      skipInitialization: true');
    // A stale skipInitialization flag with no token silently suppresses Google's device flow.
    if (enable && !refreshTokenConfigured && skipInitializationIndex >= 0) {
      lines[skipInitializationIndex] = '      skipInitialization: false';
    }
    if (typeof refreshToken === 'string') {
      if (refreshToken.length < 20 || refreshToken.length > 4096 || /[\r\n\x00-\x1f]/.test(refreshToken)) {
        throw new Error('Jeton OAuth invalide; aucun jeton n’a été enregistré.');
      }
      const tokenLine = `      refreshToken: ${JSON.stringify(refreshToken)}`;
      const skipLine = '      skipInitialization: true';
      const tokenIndex = lines.findIndex((line, index) => index > oauthIndex && index < actualEnd && /^      refreshToken:/.test(line));
      if (tokenIndex >= 0) lines[tokenIndex] = tokenLine;
      else lines.splice(actualEnd, 0, tokenLine);
      const skipIndex = lines.findIndex(line => /^      skipInitialization:\s*(?:true|false)\s*$/.test(line));
      if (skipIndex >= 0) lines[skipIndex] = skipLine;
      else lines.splice(tokenIndex >= 0 ? tokenIndex + 1 : actualEnd + 1, 0, skipLine);
    }
    if (clearRefreshToken) {
      // Remove only OAuth credentials inside the YouTube plugin's OAuth block.
      const beforeClearEnd = lines.findIndex((line, index) => index > oauthIndex && /^    [A-Za-z]/.test(line));
      const clearEnd = beforeClearEnd < 0 ? lines.length : beforeClearEnd;
      for (let index = clearEnd - 1; index > oauthIndex; index--) {
        if (/^      refreshToken:/.test(lines[index])) lines.splice(index, 1);
      }
      const currentEnd = lines.findIndex((line, index) => index > oauthIndex && /^    [A-Za-z]/.test(line));
      const oauthEndIndex = currentEnd < 0 ? lines.length : currentEnd;
      const skipIndexes = [];
      for (let index = oauthIndex + 1; index < oauthEndIndex; index++) {
        if (/^      skipInitialization:\s*(?:true|false)\s*$/.test(lines[index])) skipIndexes.push(index);
      }
      if (skipIndexes.length) {
        lines[skipIndexes[0]] = '      skipInitialization: false';
        for (const index of skipIndexes.slice(1).reverse()) lines.splice(index, 1);
      } else {
        lines.splice(oauthEndIndex, 0, '      skipInitialization: false');
      }
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
function clearLavalinkRefreshToken(root) { return editOAuthConfig(root, { enable: true, clearRefreshToken: true }); }
function persistLavalinkRefreshToken(root, refreshToken) {
  return editOAuthConfig(root, { refreshToken });
}

function lavalinkOAuthStatus(root) {
  const text = fs.readFileSync(privateConfigPath(root), 'utf8');
  const tokenLine = text.match(/^      refreshToken:\s*(.*?)\s*$/m)?.[1] || '';
  const refreshTokenConfigured = Boolean(tokenLine && !['""', "''", 'null'].includes(tokenLine));
  return {
    enabled: /^    oauth:\s*\r?\n      enabled: true\s*$/m.test(text),
    refreshTokenConfigured,
    skipInitialization: /^      skipInitialization: true\s*$/m.test(text),
    tvClientConfigured: /^      - TV\s*$/m.test(text),
  };
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

function parseOAuthDiagnosticLine(line) {
  const value = String(line);
  if (/OAUTH INTEGRATION: The device token has expired/i.test(value)) return 'YOUTUBE_OAUTH_DEVICE_CODE_EXPIRED';
  if (/OAUTH INTEGRATION: Account linking was denied/i.test(value)) return 'YOUTUBE_OAUTH_ACCOUNT_LINK_DENIED';
  if (/Failed to fetch OAuth2 token response|Failed to acquire HTTP interface/i.test(value)) return 'YOUTUBE_OAUTH_TOKEN_POLL_FAILED';
  if (/YoutubeOauth2Handler.*\b(?:ERROR|WARN)\b|\b(?:ERROR|WARN)\b.*YoutubeOauth2Handler/i.test(value)) return 'YOUTUBE_OAUTH_HANDLER_ERROR';
  if (/(?:UnknownHostException|ConnectException|SocketTimeoutException|SSLHandshakeException)/i.test(value)
      && /oauth|device code|youtube/i.test(value)) return 'YOUTUBE_OAUTH_NETWORK_FAILED';
  if (/(?:failed|failure|error|exception).{0,100}(?:oauth|device code)|(?:oauth|device code).{0,100}(?:failed|failure|error|exception)/i.test(value)) {
    return 'YOUTUBE_OAUTH_STARTUP_FAILED';
  }
  const status = value.match(/(?:device code fetch|oauth2 token fetch).{0,120}?\b(401|403|429|5\d{2})\b/i)?.[1];
  return status ? `YOUTUBE_OAUTH_HTTP_${status}` : null;
}

module.exports = { enableLavalinkOAuth, persistLavalinkRefreshToken, lavalinkOAuthStatus,
  clearLavalinkRefreshToken, parseOAuthDeviceLine, parseOAuthRefreshTokenLine, parseOAuthDiagnosticLine };
