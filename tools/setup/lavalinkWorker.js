/** Le processus Java est toujours arrêté si le bot parent disparaît. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { parseOAuthDeviceLine, parseOAuthRefreshTokenLine, persistLavalinkRefreshToken } = require('../../features/music/lavalinkOAuth');
const cipherRuntime = require('../../features/music/youtubeCipher');
const [root, java, cipherRoot] = process.argv.slice(2);
if (!process.send || !path.isAbsolute(root || '')) process.exit(1);
let child = null;
let cipher = null;
let cipherFailure = null;
let cipherStderr = '';
let stopping = false;
let stopTimer = null;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  child?.kill('SIGTERM');
  cipher?.kill('SIGTERM');
  stopTimer = setTimeout(() => {
    child?.kill('SIGKILL');
    cipher?.kill('SIGKILL');
    process.exit(exitCode);
  }, 3000);
  stopTimer.unref();
  if (!child && !cipher) {
    clearTimeout(stopTimer);
    process.disconnect?.();
    process.exit(exitCode);
  }
}

async function waitForCipher() {
  const connection = cipherRuntime.readConnection(cipherRoot);
  if (!connection) throw new Error('YOUTUBE_CIPHER_INSTALL_INVALID');
  const deadline = Date.now() + 20_000;
  while (!stopping && cipher && Date.now() < deadline) {
    try {
      const response = await fetch(`${cipherRuntime.URL}/decrypt_signature`, {
        method: 'POST', headers: { Authorization: connection.password, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(700), redirect: 'error',
      });
      const message = await response.text();
      if (response.status === 400 && message.includes('player_url')) return;
      if (response.status === 401) throw new Error('YOUTUBE_CIPHER_AUTH_FAILED');
      if (response.status === 404) throw new Error('YOUTUBE_CIPHER_ENDPOINT_MISSING');
      if (response.status >= 500) throw new Error('YOUTUBE_CIPHER_SERVER_ERROR');
    } catch (error) {
      if (/^YOUTUBE_CIPHER_[A-Z_]+$/.test(error?.message || '')) throw error;
      /* Le serveur Deno n'a pas encore fini son démarrage. */
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(cipherFailure || 'YOUTUBE_CIPHER_HELPER_UNAVAILABLE');
}

async function start() {
  if (cipherRoot && cipherRuntime.isConfigured(root, cipherRoot)) {
    const paths = cipherRuntime.installationPaths({ BOT_DATA_DIR: path.resolve(cipherRoot, '..', '..', '..') });
    const connection = cipherRuntime.readConnection(cipherRoot);
    const env = cipherRuntime.runtimeEnvironment(cipherRoot, connection.password, process.env);
    const args = cipherRuntime.runtimeArgs(cipherRoot);
    cipher = spawn(paths.deno, args, { cwd: paths.source, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const cipherChild = cipher;
    cipherChild.stderr.on('data', bytes => { cipherStderr = (cipherStderr + bytes.toString('utf8')).slice(-4096); });
    cipherChild.once('error', error => {
      if (cipher === cipherChild) {
        cipher = null;
        cipherFailure = error.code === 'EACCES' ? 'YOUTUBE_CIPHER_PERMISSION_DENIED'
          : error.code === 'ENOENT' ? 'YOUTUBE_CIPHER_RUNTIME_MISSING' : 'YOUTUBE_CIPHER_HELPER_UNAVAILABLE';
        process.send?.({ type: 'diagnostic', text: cipherFailure });
        stop(1);
      }
    });
    cipherChild.once('exit', (code, signal) => {
      if (cipher === cipherChild) {
        cipher = null;
        if (!stopping) {
          cipherFailure = cipherRuntime.helperFailureCode(cipherStderr, code, signal);
          process.send?.({ type: 'diagnostic', text: cipherFailure,
            detail: cipherRuntime.helperFailureDetail(cipherStderr) });
          stop(1);
        }
      }
    });
    await waitForCipher();
    process.send?.({ type: 'diagnostic', text: 'YOUTUBE_CIPHER_HELPER_READY' });
  }

  if (stopping) return;
  child = spawn(java || 'java', ['-Xms32m', '-Xmx192m', '-XX:MaxDirectMemorySize=64m',
    '-XX:ActiveProcessorCount=2', '-jar', 'Lavalink.jar', '--server.error.include-stacktrace=on_param'], {
    cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const javaChild = child;
  // Les sorties brutes Java ne sont jamais transmises : elles contiennent le
  // refresh token après l'autorisation. Seuls le lien/code d'appareil et l'état
  // d'enregistrement sont communiqués au parent.
  for (const output of [javaChild.stdout, javaChild.stderr]) {
    let pending = '';
    output.on('data', bytes => {
      pending = (pending + bytes.toString('utf8')).slice(-16_384);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const device = parseOAuthDeviceLine(line);
        if (device) process.send?.({ type: 'oauth-device', ...device });
        const refreshToken = parseOAuthRefreshTokenLine(line);
        if (refreshToken) {
          try {
            persistLavalinkRefreshToken(root, refreshToken);
            process.send?.({ type: 'diagnostic', text: 'YOUTUBE_OAUTH_TOKEN_SAVED' });
          } catch {
            process.send?.({ type: 'diagnostic', text: 'YOUTUBE_OAUTH_TOKEN_SAVE_FAILED' });
          }
        }
        for (const code of ['OutOfMemoryError', 'UnsupportedClassVersionError', 'BindException']) {
          if (line.includes(code)) process.send?.({ type: 'diagnostic', text: code });
        }
        const reasons = [
          [/sign in to confirm|LOGIN_REQUIRED|not a bot/i, 'YOUTUBE_AUTH_REQUIRED'],
          [/cipher|signature|action functions/i, 'YOUTUBE_CIPHER_FAILED'],
          [/403|Forbidden/, 'YOUTUBE_HTTP_403'],
          [/429|Too Many Requests/, 'YOUTUBE_HTTP_429'],
        ];
        for (const [pattern, code] of reasons) {
          if (pattern.test(line)) process.send?.({ type: 'diagnostic', text: code });
        }
      }
    });
  }
  javaChild.once('error', () => {
    if (child === javaChild) {
      child = null;
      process.send?.({ type: 'diagnostic', text: 'JAVA_UNAVAILABLE' });
      stop(1);
    }
  });
  javaChild.once('exit', code => {
    if (child !== javaChild) return;
    child = null;
    process.send?.({ type: 'diagnostic', text: `JAVA_EXIT ${Number.isInteger(code) ? code : 'SIGNAL'}` });
    stop(code || 0);
  });
}

process.on('disconnect', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
start().catch(error => {
  const code = /^[A-Z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'YOUTUBE_CIPHER_HELPER_UNAVAILABLE';
  process.send?.({ type: 'diagnostic', text: code });
  stop(1);
});
if (!process.connected) stop(0);
