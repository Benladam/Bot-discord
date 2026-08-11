/**
 * voice.js — Connexion vocale Discord 100% maison (sans @discordjs/voice).
 * Ouvre le WebSocket vocal + le socket UDP, fait la IP discovery en forçant
 * l'IP publique, envoie SELECT_PROTOCOL, récupère secret_key, puis envoie
 * l'audio RTP/Opus chiffré xsalsa20 (libsodium-wrappers-sumo).
 *
 * Flux d'utilisation :
 *   const vc = new VoiceConnection({ endpoint, token, sessionId, serverId, userId, publicIp });
 *   await vc.connect();        // ouvre WS + UDP, handshake complet
 *   vc.setSpeaking(true);
 *   vc.sendOpus(opusFrame);    // frame Opus brute (20ms, 48kHz)
 *   vc.destroy();
 */

const WebSocket = require('ws');
const dgram = require('dgram');
const crypto = require('crypto');
const nacl = require('tweetnacl'); // xsalsa20-poly1305 pur JS (transport, pas E2EE)
const { DaveManager } = require('./dave'); // protocole DAVE maison (crypto via @snazzah/davey)

class VoiceConnection extends require('events').EventEmitter {
  constructor({ endpoint, token, sessionId, serverId, userId, publicIp }) {
    super();
    this.endpointBrut = endpoint || '';
    // IMPORTANT: garder le port dans l'endpoint WS vocal ! Discord a change et
    // exige desormais le port (ex: c-mrs04-xxx.discord.media:8443). Retirer le
    // port -> connexion au mauvais endpoint -> 4006 "Session is no longer valid".
    this.endpoint = endpoint || '';
    this.token = token;
    this.sessionId = sessionId;
    this.serverId = serverId;
    this.userId = userId;
    // IP publique forcee : c'est elle que Discord doit viser (NAT de la box).
    this.publicIp = publicIp || process.env.PUBLIC_IP || '87.91.140.78';
    this.ssrc = null;
    this.voiceIp = null;     // IP du serveur vocal Discord (pour envoyer l'audio)
    this.voicePort = null;   // port du serveur vocal Discord
    this.secretKey = null;   // Buffer 32
    this.mode = 'xsalsa20_poly1305'; // mode par defaut (DAVE desactive: on garde xsalsa20 maison)
    this.nonceCounter = 0;   // compteur 4 octets appendu au payload (rtpsize)
    this.ws = null;
    this.udp = null;
    this.udpPort = null;     // port local de notre socket UDP
    this.heartbeatTimer = null;
    this.seq = Math.floor(Math.random() * 65535);
    this.timestamp = 0;
    this.connected = false;
    this._buffer = Buffer.alloc(0); // buffer pour parser les frames Opus entrantes (non utilise ici)
  }

  async connect() {
    await this._openWS();
  }

  _openWS() {
    return new Promise((resolve, reject) => {
      const url = `wss://${this.endpoint}/?v=8`;
      console.log('[voice] ouverture WS vocal:', url, '(endpoint brut:', this.endpointBrut + ')');
      this.ws = new WebSocket(url);
      this.ws.on('open', () => {
        console.log('[voice] WS vocal ouvert');
      });
      this.ws.on('message', (data) => {
        // Les opcodes DAVE (25/27/29/30) sont BINAIRES (Buffer), pas JSON.
        if (Buffer.isBuffer(data)) {
          this._onBinary(data);
          return;
        }
        const raw = data.toString();
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        this._onWS(msg, resolve, reject);
      });
      this.ws.on('error', (e) => { console.error('[voice] WS erreur:', e.message); this.emit('error', e); reject(e); });
      this.ws.on('close', (code, reason) => {
        console.log('[voice] WS ferme code=' + code + ' reason=' + (reason ? reason.toString() : ''));
        this.connected = false; this.emit('close');
        // Si la connexion n'est pas encore établie, on reject pour declencher le retry.
        if (!this.connected) reject(new Error('WS ferme code=' + code + ' (' + (reason ? reason.toString() : '') + ')'));
      });
    });
  }

  // --- Protocole DAVE : messages binaires (opcodes 25/27/29/30) ---

  _sendBinary(opcode, payload) {
    // Format: uint16 sequence_number + uint8 opcode + payload
    const seq = this.dave ? this.dave.nextSeq() : 0;
    const head = Buffer.alloc(3);
    head.writeUInt16BE(seq & 0xffff, 0);
    head.writeUInt8(opcode, 2);
    this.ws.send(Buffer.concat([head, payload]));
  }

  _onBinary(data) {
    if (!Buffer.isBuffer(data) || data.length < 3) return;
    const seq = data.readUInt16BE(0);
    const opcode = data.readUInt8(2);
    const payload = data.slice(3);
    if (!this.dave) {
      console.log('[dave] message binaire op=' + opcode + ' mais session DAVE absente (ignore)');
      return;
    }
    if (opcode === 25) { // dave_mls_external_sender_package
      this.dave.setExternalSender(payload);
      const kp = this.dave.getKeyPackage();
      if (kp) this._sendBinary(26, kp);
      console.log('[dave] key package envoye (op 26)');
    } else if (opcode === 27) { // dave_mls_proposals
      const res = this.dave.processProposals(payload);
      if (res && res.commit) {
        const tid = Buffer.alloc(2);
        tid.writeUInt16BE(this.dave.transitionId & 0xffff, 0);
        const out = Buffer.concat([tid, res.commit, res.welcome || Buffer.alloc(0)]);
        this._sendBinary(28, out);
        console.log('[dave] commit+welcome envoye (op 28)');
      }
    } else if (opcode === 29) { // dave_mls_announce_commit_transition
      if (payload.length >= 2) {
        this.dave.transitionId = payload.readUInt16BE(0);
        const commit = payload.slice(2);
        this.dave.processCommit(commit);
        const tid = Buffer.alloc(2);
        tid.writeUInt16BE(this.dave.transitionId & 0xffff, 0);
        this._sendBinary(23, tid);
        console.log('[dave] pret pour transition (op 23) tid=' + this.dave.transitionId);
      }
    } else if (opcode === 30) { // dave_mls_welcome
      if (payload.length >= 2) {
        this.dave.transitionId = payload.readUInt16BE(0);
        const welcome = payload.slice(2);
        this.dave.processWelcome(welcome);
        const tid = Buffer.alloc(2);
        tid.writeUInt16BE(this.dave.transitionId & 0xffff, 0);
        this._sendBinary(23, tid);
        console.log('[dave] welcome traite + pret (op 23)');
      }
    } else {
      console.log('[dave] op binaire recu op=' + opcode + ' (non gere)');
    }
  }

  _onWS(msg, resolve, reject) {
    const { op, d } = msg;
    switch (op) {
      case 8: { // HELLO (WS vocal : op 8 = HELLO, pas 10)
        const interval = d.heartbeat_interval;
        console.log('[voice] HELLO recu (heartbeat ' + interval + ' ms)');
        if (!this.sessionId || !this.token) {
          console.error('[voice] IDENTIFY impossible: sessionId=' + this.sessionId + ' token=' + (this.token ? 'present' : 'ABSENT'));
          reject(new Error('VOCAL_UNAVAILABLE'));
          return;
        }
        console.log('[voice] IDENTIFY avec session=' + this.sessionId.slice(0, 8) + '... token=' + (this.token || '').slice(0, 6) + '...');
        this._startHeartbeat(interval);
        this.ws.send(JSON.stringify({
          op: 0, // IDENTIFY (WS vocal : op 0)
          d: {
            server_id: this.serverId,
            user_id: this.userId,
            session_id: this.sessionId,
            token: this.token,
            max_dave_protocol_version: 1, // DAVE/E2EE requis par Discord (xsalsa20 desactive)
          },
        }));
        console.log('[voice] IDENTIFY envoye');
        break;
      }
      case 2: { // READY (WS vocal : op 2)
        this.ssrc = d.ssrc;
        this.voiceIp = d.ip;
        this.voicePort = d.port;
        this.modes = d.modes;
        // Choisisr un mode xsalsa20 si Discord le propose (DAVE desactive cote client).
        const pref = ['xsalsa20_poly1305', 'xsalsa20_poly1305_lite', 'xsalsa20_poly1305_suffix'];
        this.mode = pref.find((m) => (d.modes || []).includes(m)) || d.modes[0] || this.mode;
        console.log('[voice] READY: ssrc=' + d.ssrc + ' ip=' + d.ip + ':' + d.port + ' modes=' + (d.modes || []).join(','));
        this._openUDP().then(() => {
          console.log('[voice] UDP local port=' + this.udpPort + ' -> SELECT_PROTOCOL ip=' + this.publicIp);
          this.ws.send(JSON.stringify({
            op: 1,
            d: {
              protocol: 'udp',
              data: {
                address: this.publicIp,
                port: this.udpPort,
                mode: this.mode,
              },
            },
          }));
        }).catch((e) => { console.error('[voice] UDP erreur:', e.message); reject(e); });
        break;
      }
      case 4: { // SESSION_DESCRIPTION
        this.secretKey = Buffer.from(d.secret_key);
        this.connected = true;
        // DAVE/E2EE : si Discord negocie une version DAVE, on initialise la session MLS.
        const daveVer = d.dave_protocol_version || 0;
        if (daveVer > 0 && !this.dave) {
          this.dave = new DaveManager(this.userId, this.channelId || this.serverId);
          this.dave.init();
          console.log('[dave] protocole DAVE v' + daveVer + ' active, session MLS cree');
        }
        console.log('[voice] SESSION_DESCRIPTION recu (secretKey OK)');
        this.emit('ready');
        resolve();
        // Discord exige un frame SPEAKING (op 5) pour activer le flux entrant.
        // On fait un toggle 0->1 (certains serveurs ignorent un seul 1).
        this._sendSpeaking(1);
        setTimeout(() => { this._sendSpeaking(0); }, 150);
        setTimeout(() => { this._sendSpeaking(1); }, 300);
        break;
      }
      default:
        // Opcodes vocaux connus a ignorer (bruit): 5 SPEAKING, 11 ?, 13 ?, 15 ?,
        // 18 ?, 20 ?. On ne loggue que les opcodes vraiment inattendus.
        if (![5, 11, 13, 15, 18, 20].includes(op)) console.log('[voice] WS op=' + op + ' recu');
        break;
    }
  }

  _startHeartbeat(interval) {
    // NE PAS envoyer de heartbeat immediatement : l'IDENTIFY doit partir en
    // premier, sinon Discord ferme en 4003 "Not authenticated" (payload before
    // identifying). On attend l'intervalle avant le 1er heartbeat.
    const send = () => this.ws && this.ws.send(JSON.stringify({ op: 3, d: Date.now() }));
    this.heartbeatTimer = setInterval(send, interval * 0.9);
  }

  async _openUDP() {
    return new Promise((resolve, reject) => {
      this.udp = dgram.createSocket('udp4');
      this.udp.on('error', reject);
      this.udp.bind(0, () => {
        this.udpPort = this.udp.address().port;
        // IP discovery : on envoie le packet, mais on force l'IP via SELECT_PROTOCOL.
        // On envoie quand meme le packet de découverte (Discord l'attend parfois).
        const disc = Buffer.alloc(74);
        disc.writeUInt16BE(0x0001, 0);
        disc.writeUInt16BE(70, 2);
        disc.writeUInt32BE(this.ssrc, 4);
        this.udp.send(disc, 0, 74, this.voicePort, this.voiceIp, (e) => {
          if (e) { /* non fatal : on force l'IP de toute façon */ }
        });
        // On n'attend PAS la réponse : on résout tout de suite (IP forcée).
        resolve();
      });
    });
  }

  setSpeaking(on = true) {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({
      op: 5,
      d: {
        speaking: on ? 1 : 0,
        delay: 0,
        ssrc: this.ssrc,
      },
    }));
  }

  /**
   * Envoie une frame Opus brute (20ms @ 48kHz) chiffree xsalsa20_poly1305 (maison, tweetnacl).
   * Nonce = header RTP (12) + 12 zeros = 24 octets.
   * @param {Buffer} opusFrame
   */
  sendOpus(opusFrame) {
    if (!this.connected || !this.secretKey || !this.udp) return false;
    // DAVE/E2EE : chiffre le frame Opus AVANT le transport xsalsa20.
    if (this.dave && this.dave.ready) {
      try {
        opusFrame = this.dave.encryptOpus(opusFrame);
      } catch (e) {
        console.error('[dave] encryptOpus echec:', e.message);
      }
    }
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = 0x78; // payload type Opus
    header.writeUInt16BE(this.seq & 0xffff, 2);
    header.writeUInt32BE(this.timestamp & 0xffffffff, 4);
    header.writeUInt32BE(this.ssrc, 8);

    // Nonce 24 octets = header RTP (12) + 12 zeros (format xsalsa20_poly1305)
    const nonce = Buffer.alloc(24);
    header.copy(nonce, 0, 0, 12);

    // xsalsa20-poly1305 (tweetnacl secretbox)
    const ciphertext = nacl.secretbox(new Uint8Array(opusFrame), new Uint8Array(nonce), new Uint8Array(this.secretKey));

    let packet;
    if (this.mode === 'xsalsa20_poly1305_lite') {
      // 4 octets du nonce (uint32 BE) ajoutes a la fin
      const nonceTail = Buffer.alloc(4);
      nonceTail.writeUInt32BE(this.nonceCounter & 0xffffffff, 0);
      this.nonceCounter = (this.nonceCounter + 1) & 0xffffffff;
      packet = Buffer.concat([header, Buffer.from(ciphertext), nonceTail]);
    } else if (this.mode === 'xsalsa20_poly1305_suffix') {
      // 24 octets aleatoires ajoutes a la fin
      const random = nacl.randomBytes(24);
      packet = Buffer.concat([header, Buffer.from(ciphertext), Buffer.from(random)]);
    } else {
      // xsalsa20_poly1305 (simple) : header + ciphertext
      packet = Buffer.concat([header, Buffer.from(ciphertext)]);
    }

    this.udp.send(packet, 0, packet.length, this.voicePort, this.voiceIp);

    this.seq = (this.seq + 1) & 0xffff;
    this.timestamp = (this.timestamp + 960) & 0xffffffff; // 48kHz * 20ms = 960
    return true;
  }

  /** Envoie un frame SPEAKING (op 5) sur le WS vocal pour activer le flux entrant. */
  _sendSpeaking(flag) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({
      op: 5,
      d: { speaking: flag ? 1 : 0, delay: 0, ssrc: this.ssrc },
    }));
    console.log('[voice] SPEAKING envoye (speaking=' + (flag ? 1 : 0) + ')');
  }

  destroy() {
    this.connected = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.udp) try { this.udp.close(); } catch {}
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { VoiceConnection };
