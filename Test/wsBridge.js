/**
 * wsBridge.js — Pont WebSocket local pour piloter/observer le bot depuis l'app C# (HeussGUI).
 * - Ecoute sur 0.0.0.0:7777 (accessible en local + depuis le tel sur le meme WiFi via IP du PC).
 * - Envoie aux clients : {"type":"log","line":"..."} a chaque console.log du bot.
 * - Recoit des clients : {"cmd":"play","query":"..."} -> ecrit dans Test/cmd.txt (lu par bot.js).
 *
 * ISOLE dans Test/ (regle enzom) : ne pas mettre en prod sans validation.
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = 7777;
const CMD_FILE = path.join(__dirname, 'cmd.txt'); // le bot lit ce fichier pour executer les commandes

const wss = new WebSocket.Server({ host: '0.0.0.0', port: PORT });
const clients = new Set();

// Capture des logs du bot
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
function broadcast(line) {
  const msg = JSON.stringify({ type: 'log', line });
  for (const c of clients) { if (c.readyState === WebSocket.OPEN) c.send(msg); }
}
console.log = (...args) => { origLog(...args); broadcast(args.map(String).join(' ')); };
console.error = (...args) => { origErr(...args); broadcast('[err] ' + args.map(String).join(' ')); };

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'log', line: '[bridge] connecte au bot' }));
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.cmd) {
        // Ecrit la commande pour que bot.js l'execute (format: cmd args)
        const line = msg.cmd + (msg.query ? ' ' + msg.query : '') + (msg.value !== undefined ? ' ' + msg.value : '');
        fs.writeFileSync(CMD_FILE, line + '\n');
        broadcast('[bridge] commande recue: ' + line);
      }
    } catch (e) { /* ignore */ }
  });
  ws.on('close', () => clients.delete(ws));
});

console.log(`[bridge] WebSocket en ecoute sur ws://0.0.0.0:${PORT}`);

module.exports = { wss };
