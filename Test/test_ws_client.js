// Test rapide : client WS qui se connecte a :7777 et affiche le 1er message recu.
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:7777');
ws.on('open', () => console.log('[test] connecte a :7777'));
ws.on('message', (d) => { console.log('[test] recu:', d.toString().slice(0, 120)); setTimeout(() => process.exit(0), 500); });
ws.on('error', (e) => { console.log('[test] ERREUR:', e.message); process.exit(1); });
setTimeout(() => { console.log('[test] timeout (aucun message)'); process.exit(1); }, 6000);
