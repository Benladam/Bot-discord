// diag_vocal.js — test isolé (bot frais) de la connexion vocale maison.
require('dotenv').config();
const WebSocket = require('ws');
const { Client, GatewayIntentBits } = require('discord.js');

const GUILD_ID = '1527327658583527554';
const VOCAL_ID = '1527327659955060769';
const TOKEN = process.env.DISCORD_TOKEN;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

let voiceEndpoint = null, voiceToken = null, voiceSession = null;
let phase = 'idle';

function wsSend(payload) {
  if (typeof client.ws.send === 'function') client.ws.send(payload);
  else { const sh = client.ws.shards && client.ws.shards.first(); if (sh && typeof sh.send === 'function') sh.send(payload); }
}

client.on('raw', (pkt) => {
  if (pkt.t === 'VOICE_SERVER_UPDATE' && pkt.d && pkt.d.endpoint) {
    voiceEndpoint = pkt.d.endpoint;
    voiceToken = pkt.d.token;
    console.log('[diag] VOICE_SERVER_UPDATE endpoint=' + voiceEndpoint + ' token=' + (voiceToken || '').slice(0, 6));
    tryConnectIfReady();
  } else if (pkt.t === 'VOICE_STATE_UPDATE' && pkt.d.user_id === client.user.id && pkt.d.session_id) {
    voiceSession = pkt.d.session_id;
    console.log('[diag] VOICE_STATE_UPDATE session=' + voiceSession + ' channel=' + (pkt.d.channel_id || 'null'));
    tryConnectIfReady();
  }
});

function tryConnectIfReady() {
  if (phase !== 'joined' || !voiceEndpoint || !voiceToken || !voiceSession) return;
  phase = 'connecting';
  const endpoint = voiceEndpoint.split(':')[0];
  const url = 'wss://' + endpoint + '/?v=8';
  console.log('[diag] WS vocal -> ' + url);
  const ws = new WebSocket(url);
  ws.on('open', () => console.log('[diag] WS ouvert'));
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { console.log('[diag] MSG non-JSON: ' + data.toString().slice(0, 200)); return; }
    console.log('[diag] <<< op=' + msg.op + ' d=' + JSON.stringify(msg.d).slice(0, 300));
    if (msg.op === 8) {
      const identify = { op: 0, d: { server_id: GUILD_ID, user_id: client.user.id, session_id: voiceSession, token: voiceToken } };
      console.log('[diag] >>> IDENTIFY: ' + JSON.stringify(identify).slice(0, 400));
      ws.send(JSON.stringify(identify));
    }
  });
  ws.on('close', (code, reason) => console.log('[diag] WS ferme code=' + code + ' reason=' + (reason ? reason.toString() : '')));
  ws.on('error', (e) => console.log('[diag] WS erreur: ' + e.message));
}

client.once('ready', () => {
  console.log('[diag] bot connecte ' + client.user.username);
  // quit residuel
  console.log('[diag] quit residuel');
  wsSend({ op: 4, d: { guild_id: GUILD_ID, channel_id: null, self_mute: false, self_deaf: false } });
  setTimeout(() => {
    phase = 'joined';
    console.log('[diag] join ' + VOCAL_ID);
    wsSend({ op: 4, d: { guild_id: GUILD_ID, channel_id: VOCAL_ID, self_mute: false, self_deaf: false } });
  }, 800);
});

client.login(TOKEN);
