/**
 * rpc.js — Présence Discord ("Rich Presence") du panneau de contrôle.
 *
 * Affiche sur ton profil Discord :  « Joue à Bot Gui »
 * avec le nom du bot et depuis combien de temps le panneau est ouvert.
 *
 * Aucune dépendance : on parle directement à l'application Discord installée
 * sur le PC, via son tuyau local (IPC). Rien ne sort sur Internet, et aucun
 * token n'est transmis : on n'utilise que l'identifiant public de l'application.
 *
 * Si Discord n'est pas lancé, tout est simplement ignoré (aucune erreur bloquante).
 */

'use strict';

const net = require('net');
const os = require('os');
const https = require('https');

// Opérations du protocole IPC de Discord
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;

/** Chemin du tuyau local de Discord (Windows / Linux / macOS). */
function ipcPath(id) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${id}`;
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || '/tmp';
  return `${base.replace(/\/$/, '')}/discord-ipc-${id}`;
}

/**
 * Déduit l'identifiant public de l'application depuis le token du bot.
 * La 1re partie d'un token Discord est l'ID de l'application encodé en base64.
 * (On ne stocke ni ne transmet jamais le token lui-même.)
 */
function appIdFromToken(token) {
  try {
    const id = Buffer.from(String(token).split('.')[0], 'base64').toString('utf8');
    return /^\d{17,20}$/.test(id) ? id : null;
  } catch (_) { return null; }
}

/**
 * Récupère le VRAI nom du bot auprès de Discord (et non « Bot Gui »).
 * Le token n'est utilisé que pour cet appel et n'est jamais affiché.
 * @returns {Promise<string|null>}
 */
function fetchBotName(token) {
  return new Promise((resolve) => {
    if (!token) return resolve(null);
    const req = https.request({
      host: 'discord.com',
      path: '/api/v10/users/@me',
      method: 'GET',
      headers: { Authorization: 'Bot ' + token },
      timeout: 8000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(j.username || null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

class DiscordPresence {
  constructor(log = () => {}) {
    this.log = log;
    this.sock = null;
    this.buf = Buffer.alloc(0);
    this.ready = false;
    this.user = null;       // pseudo Discord détecté
    this.startedAt = Date.now();
    this.activity = null;   // dernière présence demandée
    this.appId = null;
    this.lastError = null;
    this.token = null;
    this.warnedClosed = false;
    this.retryTimer = null;
  }

  /**
   * Surveille Discord : si l'application est lancée (ou relancée) après la GUI,
   * la présence « Bot Gui » s'active toute seule. Vérification toutes les 20 s.
   */
  autoReconnect(token, everyMs = 20000) {
    this.token = token;
    this.connect(token);
    clearInterval(this.retryTimer);
    this.retryTimer = setInterval(() => {
      if (!this.ready && !this.sock) this.connect(this.token);
    }, everyMs);
    if (this.retryTimer.unref) this.retryTimer.unref();
  }

  get status() {
    return {
      connected: !!this.ready,
      user: this.user,
      error: this.lastError,
    };
  }

  /** Encode et envoie une trame IPC. */
  _send(op, data) {
    if (!this.sock || this.sock.destroyed) return;
    const body = Buffer.from(JSON.stringify(data), 'utf8');
    const head = Buffer.alloc(8);
    head.writeInt32LE(op, 0);
    head.writeInt32LE(body.length, 4);
    try { this.sock.write(Buffer.concat([head, body])); } catch (_) { /* ignore */ }
  }

  /**
   * Se connecte à Discord et affiche la présence.
   * Essaie les tuyaux 0 à 9 (Discord, Canary, PTB peuvent en utiliser plusieurs).
   */
  connect(token, id = 0) {
    if (this.sock) return;
    if (token) this.token = token;
    this.appId = appIdFromToken(this.token);
    if (!this.appId) {
      this.lastError = 'token_invalide';
      return;
    }
    if (id > 9) {
      this.sock = null;
      this.lastError = 'discord_ferme';
      if (!this.warnedClosed) {
        this.warnedClosed = true;
        this.log('warn', '⚠ Discord n’est pas lancé : la présence « Bot Gui » s’activera dès son ouverture.');
      }
      return;
    }

    const sock = net.connect(ipcPath(id));
    this.sock = sock;

    sock.on('connect', () => {
      this.lastError = null;
      this._send(OP_HANDSHAKE, { v: 1, client_id: this.appId });
    });

    sock.on('data', (chunk) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      while (this.buf.length >= 8) {
        const len = this.buf.readInt32LE(4);
        if (this.buf.length < 8 + len) break;
        let payload = null;
        try { payload = JSON.parse(this.buf.slice(8, 8 + len).toString('utf8')); } catch (_) {}
        this.buf = this.buf.slice(8 + len);
        if (payload) this._onPayload(payload);
      }
    });

    // Tuyau occupé/inexistant : on tente le suivant.
    sock.on('error', () => {
      this.sock = null;
      this.buf = Buffer.alloc(0);
      this.connect(token, id + 1);
    });

    sock.on('close', () => {
      if (this.ready) this.log('warn', 'Présence Discord déconnectée.');
      this.ready = false;
      this.sock = null;
    });
  }

  _onPayload(payload) {
    if (payload.evt === 'READY') {
      this.ready = true;
      this.warnedClosed = false;
      this.user = payload.data?.user?.username || null;
      this.log('ok', `🎮 Présence Discord activée${this.user ? ' pour ' + this.user : ''} — « Bot Gui ».`);
      if (this.activity) this.setActivity(this.activity);
    }
    if (payload.evt === 'ERROR') {
      this.lastError = payload.data?.message || 'erreur';
      this.log('warn', `⚠ Présence Discord : ${this.lastError}`);
    }
  }

  /**
   * Met à jour ce qui s'affiche sur le profil Discord.
   * @param {{details?:string, state?:string, botOnline?:boolean}} info
   */
  setActivity(info = {}) {
    this.activity = info;
    if (!this.ready) return;
    this._send(OP_FRAME, {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: {
          // type 2 = « Écoute » (au lieu de « Joue à »). Vérifié : accepté par Discord.
          // Le NOM affiché est toujours celui de l'application Discord — il ne peut
          // pas être forcé ici (testé : le champ « name » est ignoré). C'est donc
          // le vrai nom du bot qui s'affiche, pas « Bot Gui ».
          type: 2,
          details: (info.details || 'Panneau de contrôle').slice(0, 128),
          state: (info.state || 'Bot Discord musique').slice(0, 128),
          timestamps: { start: this.startedAt },
          instance: false,
        },
      },
      nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    });
  }

  /** Retire la présence et ferme proprement. */
  destroy() {
    clearInterval(this.retryTimer);
    if (!this.sock) return;
    try {
      if (this.ready) {
        this._send(OP_FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid }, nonce: String(Date.now()) });
      }
      this._send(OP_CLOSE, {});
      this.sock.destroy();
    } catch (_) { /* ignore */ }
    this.sock = null;
    this.ready = false;
  }
}

module.exports = { DiscordPresence, appIdFromToken, fetchBotName };
