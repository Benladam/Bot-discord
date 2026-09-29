/**
 * wsBridge.js — Pont WebSocket local pour piloter/observer le bot depuis l'app C# (HeussGUI).
 * - Ecoute uniquement sur 127.0.0.1:7777; aucune connexion depuis le reseau n'est acceptee.
 * - Exige TEST_BRIDGE_TOKEN avant d'authentifier un client ou de recevoir des commandes.
 * - Envoie aux clients : {"type":"log","line":"..."} a chaque console.log du bot.
 * - Recoit des clients : {"cmd":"play","query":"..."} -> ecrit dans Test/cmd.txt (lu par bot.js).
 *
 * ISOLE dans Test/ (regle enzom) : ne pas mettre en prod sans validation.
 */
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');

const PORT = 7777;
const HOST = '127.0.0.1';
const AUTH_TIMEOUT_MS = 5000;
const CMD_FILE = path.join(__dirname, 'cmd.txt'); // le bot lit ce fichier pour executer les commandes
const BRIDGE_TOKEN = String(process.env.TEST_BRIDGE_TOKEN || '');

if (Buffer.byteLength(BRIDGE_TOKEN, 'utf8') < 32) {
  throw new Error('TEST_BRIDGE_TOKEN doit contenir au moins 32 octets.');
}

function validToken(candidate) {
  const provided = Buffer.from(String(candidate || ''), 'utf8');
  const expected = Buffer.from(BRIDGE_TOKEN, 'utf8');
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

const wss = new WebSocket.Server({ host: HOST, port: PORT, maxPayload: 16 * 1024, perMessageDeflate: false });
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
  let authenticated = false;
  const authTimer = setTimeout(() => ws.close(1008, 'Authentification requise'), AUTH_TIMEOUT_MS);
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (!authenticated) {
        if (msg?.type !== 'auth' || !validToken(msg.token)) {
          ws.close(1008, 'Jeton invalide');
          return;
        }
        authenticated = true;
        clearTimeout(authTimer);
        clients.add(ws);
        ws.send(JSON.stringify({ type: 'log', line: '[bridge] authentifie sur localhost' }));
        return;
      }
      if (typeof msg.cmd === 'string' && /^[a-z0-9_-]{1,32}$/i.test(msg.cmd)) {
        // Ecrit la commande pour que bot.js l'execute (format: cmd args)
        const query = typeof msg.query === 'string' ? msg.query.slice(0, 500) : '';
        const value = msg.value === undefined ? '' : String(msg.value).slice(0, 100);
        const line = msg.cmd + (query ? ' ' + query : '') + (value ? ' ' + value : '');
        fs.writeFileSync(CMD_FILE, line + '\n');
        broadcast('[bridge] commande recue: ' + line);
      }
    } catch (e) { /* ignore */ }
  });
  ws.on('close', () => { clearTimeout(authTimer); clients.delete(ws); });
});

console.log(`[bridge] WebSocket de test en ecoute sur ws://${HOST}:${PORT} (jeton requis)`);

module.exports = { wss };
