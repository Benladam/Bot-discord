/** Le processus Java est toujours arrêté si le bot parent disparaît. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { parseOAuthDeviceLine, parseOAuthRefreshTokenLine, persistLavalinkRefreshToken } = require('../../features/music/lavalinkOAuth');
const [root, java] = process.argv.slice(2);
if (!process.send || !path.isAbsolute(root || '')) process.exit(1);
const child = spawn(java || 'java', ['-Xms32m', '-Xmx192m', '-XX:MaxDirectMemorySize=64m',
  '-XX:ActiveProcessorCount=2', '-jar', 'Lavalink.jar', '--server.error.include-stacktrace=on_param'], {
  cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
// Les sorties brutes Java ne sont jamais transmises : elles contiennent le
// refresh token après l'autorisation. Seuls le lien/code d'appareil et l'état
// d'enregistrement sont communiqués au parent.
for (const output of [child.stdout, child.stderr]) {
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
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true; child.kill('SIGTERM');
  const timer = setTimeout(() => { child.kill('SIGKILL'); process.exit(0); }, 3000);
  timer.unref();
}
process.on('disconnect', stop); process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.once('error', () => { process.send?.({ type: 'diagnostic', text: 'JAVA_UNAVAILABLE' }); process.disconnect?.(); process.exit(1); });
child.once('exit', code => {
  process.send?.({ type: 'diagnostic', text: `JAVA_EXIT ${Number.isInteger(code) ? code : 'SIGNAL'}` });
  process.disconnect?.(); process.exit(code || 0);
});
if (!process.connected) stop();
