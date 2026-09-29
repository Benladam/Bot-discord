// Client WebSocket de diagnostic local : affiche le premier message reçu.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });
const WebSocket = require('ws');
const token = String(process.env.DIAGNOSTIC_BRIDGE_TOKEN || process.env.TEST_BRIDGE_TOKEN || '');
if (Buffer.byteLength(token, 'utf8') < 32) {
  throw new Error('Configure un DIAGNOSTIC_BRIDGE_TOKEN d’au moins 32 octets dans .env.');
}
const ws = new WebSocket('ws://127.0.0.1:7777');
ws.on('open', () => {
  console.log('[diagnostic] connecté à localhost:7777');
  ws.send(JSON.stringify({ type: 'auth', token }));
});
ws.on('message', (d) => { console.log('[diagnostic] reçu:', d.toString().slice(0, 120)); setTimeout(() => process.exit(0), 500); });
ws.on('error', (e) => { console.log('[diagnostic] erreur:', e.message); process.exit(1); });
setTimeout(() => { console.log('[diagnostic] délai dépassé (aucun message)'); process.exit(1); }, 6000);
