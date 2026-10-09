const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applicationConfig } = require('../../tools/setup/installLavalink');
const { enableLavalinkOAuth, persistLavalinkRefreshToken, clearLavalinkRefreshToken, lavalinkOAuthStatus,
  parseOAuthDeviceLine, parseOAuthRefreshTokenLine, parseOAuthDiagnosticLine } = require('./lavalinkOAuth');

function privateInstall() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-oauth-'));
  const root = path.join(parent, '.cache', 'lavalink', '4.2.2');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const config = path.join(root, 'application.yml');
  fs.writeFileSync(config, applicationConfig('test-secret'), { mode: 0o600 });
  return { parent, root, config };
}

test('OAuth ajoute uniquement le client TV et son niveau de log à la configuration privée', () => {
  const { parent, root, config } = privateInstall();
  try {
    enableLavalinkOAuth(root);
    const text = fs.readFileSync(config, 'utf8');
    assert.match(text, /oauth:\n      enabled: true/);
    assert.match(text, /      - WEBEMBEDDED\n      - TV/);
    assert.match(text, /dev\.lavalink\.youtube\.http\.YoutubeOauth2Handler: INFO/);
    assert.deepEqual(lavalinkOAuthStatus(root), { enabled: true, refreshTokenConfigured: false,
      skipInitialization: false, tvClientConfigured: true });
    if (process.platform !== 'win32') assert.equal((fs.statSync(config).mode & 0o777), 0o600);
    enableLavalinkOAuth(root);
    assert.equal((text.match(/      - TV/g) || []).length, 1);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('la configuration OAuth réactive le flux appareil si un ancien flag le bloquait sans token', () => {
  const { parent, root, config } = privateInstall();
  try {
    enableLavalinkOAuth(root);
    const initial = fs.readFileSync(config, 'utf8');
    fs.writeFileSync(config, initial.replace('      enabled: true\n', '      enabled: true\n      skipInitialization: true\n'));
    enableLavalinkOAuth(root);
    const updated = fs.readFileSync(config, 'utf8');
    assert.match(updated, /skipInitialization: false/);
    assert.deepEqual(lavalinkOAuthStatus(root), { enabled: true, refreshTokenConfigured: false,
      skipInitialization: false, tvClientConfigured: true });
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('le refresh token est privé et survit à un redémarrage sans être imprimé', () => {
  const { parent, root, config } = privateInstall();
  try {
    enableLavalinkOAuth(root);
    const secret = '1//private-refresh-token-value';
    persistLavalinkRefreshToken(root, secret);
    const text = fs.readFileSync(config, 'utf8');
    assert.ok(text.includes(`refreshToken: "${secret}"`));
    assert.match(text, /skipInitialization: true/);
    assert.equal((text.match(/^      skipInitialization:/gm) || []).length, 1);
    assert.equal(lavalinkOAuthStatus(root).refreshTokenConfigured, true);
    if (process.platform !== 'win32') assert.equal((fs.statSync(config).mode & 0o777), 0o600);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('le remplacement du refresh token le retire et réactive le flux OAuth appareil sans fuite', () => {
  const { parent, root, config } = privateInstall();
  try {
    enableLavalinkOAuth(root);
    const secret = '1//private-refresh-token-value';
    persistLavalinkRefreshToken(root, secret);
    clearLavalinkRefreshToken(root);
    const text = fs.readFileSync(config, 'utf8');
    assert.doesNotMatch(text, /private-refresh-token-value/);
    assert.match(text, /skipInitialization: false/);
    assert.equal((text.match(/^      refreshToken:/gm) || []).length, 0);
    assert.equal((text.match(/^      skipInitialization:/gm) || []).length, 1);
    assert.deepEqual(lavalinkOAuthStatus(root), { enabled: true, refreshTokenConfigured: false,
      skipInitialization: false, tvClientConfigured: true });
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});

test('le code OAuth expose seulement une adresse Google HTTPS et ignore le refresh token hors canal privé', () => {
  assert.deepEqual(parseOAuthDeviceLine('OAUTH INTEGRATION: To give youtube-source access to your account, go to https://www.google.com/device and enter code ABCD-EFGH'),
    { url: 'https://www.google.com/device', code: 'ABCD-EFGH' });
  assert.equal(parseOAuthDeviceLine('OAUTH INTEGRATION: To give youtube-source access to your account, go to https://evil.example/device and enter code ABCD-EFGH'), null);
  assert.equal(parseOAuthRefreshTokenLine('OAUTH INTEGRATION: Token retrieved successfully. Store your refresh token as this can be reused. (1//private-refresh-token-value)'),
    '1//private-refresh-token-value');
  assert.equal(parseOAuthDiagnosticLine('[ERROR] YoutubeOauth2Handler - failed to initialize OAuth'), 'YOUTUBE_OAUTH_HANDLER_ERROR');
  assert.equal(parseOAuthDiagnosticLine('UnknownHostException: youtube.com/o/oauth2/device/code'), 'YOUTUBE_OAUTH_NETWORK_FAILED');
  assert.equal(parseOAuthDiagnosticLine('OAUTH INTEGRATION: Account linking was denied.'), 'YOUTUBE_OAUTH_ACCOUNT_LINK_DENIED');
  assert.equal(parseOAuthDiagnosticLine('INFO unrelated plugin startup'), null);
});
