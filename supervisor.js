const { fork } = require('node:child_process');
const path = require('node:path');

const botPath = path.join(__dirname, 'bot.js');
let botProcess = null;
let restartRequested = false;
let shuttingDown = false;

function startBot() {
  if (shuttingDown) return;
  restartRequested = false;
  botProcess = fork(botPath, [], {
    cwd: __dirname,
    env: { ...process.env, BOT_SUPERVISED: '1' },
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
  });

  botProcess.on('message', (message) => {
    if (message && message.type === 'update-restart') restartRequested = true;
  });
  botProcess.once('error', (error) => {
    console.error(`[supervisor] Impossible de démarrer le bot: ${error.message}`);
  });
  botProcess.once('exit', (code, signal) => {
    botProcess = null;
    if (shuttingDown) return;
    if (restartRequested) {
      console.log('[supervisor] Redémarrage demandé après mise à jour.');
      setTimeout(startBot, 750);
      return;
    }
    if (signal) console.error(`[supervisor] Bot arrêté par ${signal}.`);
    process.exitCode = code ?? 1;
  });
}

function stop(signal) {
  shuttingDown = true;
  if (botProcess && !botProcess.killed) botProcess.kill(signal);
  else process.exit(0);
}

process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));

startBot();
