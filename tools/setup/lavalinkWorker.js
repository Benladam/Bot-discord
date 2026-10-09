/** Le processus Java est toujours arrêté si le bot parent disparaît. */
const { spawn } = require('node:child_process');
const path = require('node:path');
const [root, java] = process.argv.slice(2);
if (!process.send || !path.isAbsolute(root || '')) process.exit(1);
const child = spawn(java || 'java', ['-Xms32m', '-Xmx192m', '-XX:MaxDirectMemorySize=64m',
  '-XX:ActiveProcessorCount=2', '-jar', 'Lavalink.jar', '--server.error.include-stacktrace=on_param'], {
  cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
// Pas de journaux Java bruts : ils peuvent contenir des URLs signées.
for (const output of [child.stdout, child.stderr]) output.on('data', bytes => {
  const text = bytes.toString();
  for (const code of ['OutOfMemoryError', 'UnsupportedClassVersionError', 'BindException']) {
    if (text.includes(code)) process.send?.({ type: 'diagnostic', text: code });
  }
  const reasons = [
    [/sign in to confirm|LOGIN_REQUIRED|not a bot/i, 'YOUTUBE_AUTH_REQUIRED'],
    [/cipher|signature|action functions/i, 'YOUTUBE_CIPHER_FAILED'],
    [/403|Forbidden/, 'YOUTUBE_HTTP_403'],
    [/429|Too Many Requests/, 'YOUTUBE_HTTP_429'],
  ];
  for (const [pattern, code] of reasons) {
    if (pattern.test(text)) process.send?.({ type: 'diagnostic', text: code });
  }
});
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
