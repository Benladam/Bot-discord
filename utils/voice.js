/**
 * voice.js — Connexion vocale Discord 100% maison (sans @discordjs/voice).
 * Ouvre le WebSocket vocal + le socket UDP, fait la IP discovery en forçant
 * l'IP publique, négocie l'AEAD RTP (AES-GCM ou XChaCha20), puis envoie
 * l'audio Opus; les frames sont protégées par DAVE quand Discord l'exige.
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
const { DaveManager } = require('./dave'); // protocole DAVE maison (crypto via @snazzah/davey)

function rotateLeft32(value, shift) { return ((value << shift) | (value >>> (32 - shift))) >>> 0; }

function hchacha20(key, nonce16) {
  if (key.length !== 32 || nonce16.length !== 16) throw new Error('HChaCha20 attend une clé de 32 octets et un nonce de 16 octets.');
  const state = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
  for (let i = 0; i < 8; i++) state.push(key.readUInt32LE(i * 4));
  for (let i = 0; i < 4; i++) state.push(nonce16.readUInt32LE(i * 4));
  const quarterRound = (a, b, c, d) => {
    state[a] = (state[a] + state[b]) >>> 0; state[d] = rotateLeft32(state[d] ^ state[a], 16);
    state[c] = (state[c] + state[d]) >>> 0; state[b] = rotateLeft32(state[b] ^ state[c], 12);
    state[a] = (state[a] + state[b]) >>> 0; state[d] = rotateLeft32(state[d] ^ state[a], 8);
    state[c] = (state[c] + state[d]) >>> 0; state[b] = rotateLeft32(state[b] ^ state[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    quarterRound(0, 4, 8, 12); quarterRound(1, 5, 9, 13);
    quarterRound(2, 6, 10, 14); quarterRound(3, 7, 11, 15);
    quarterRound(0, 5, 10, 15); quarterRound(1, 6, 11, 12);
    quarterRound(2, 7, 8, 13); quarterRound(3, 4, 9, 14);
  }
  const out = Buffer.alloc(32);
  [state[0], state[1], state[2], state[3], state[12], state[13], state[14], state[15]]
    .forEach((word, index) => out.writeUInt32LE(word, index * 4));
  return out;
}

function encryptTransport(mode, secretKey, counter, header, opusFrame) {
  const nonceSuffix = Buffer.alloc(4);
  nonceSuffix.writeUInt32BE(counter >>> 0, 0);
  if (mode === 'aead_aes256_gcm_rtpsize') {
    const nonce = Buffer.alloc(12);
    nonceSuffix.copy(nonce);
    const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, nonce);
    cipher.setAAD(header, { plaintextLength: opusFrame.length });
    return Buffer.concat([header, cipher.update(opusFrame), cipher.final(), cipher.getAuthTag(), nonceSuffix]);
  }
  if (mode === 'aead_xchacha20_poly1305_rtpsize') {
    const nonce24 = Buffer.alloc(24);
    nonceSuffix.copy(nonce24);
    const subkey = hchacha20(secretKey, nonce24.subarray(0, 16));
    const nonce12 = Buffer.alloc(12);
    nonce24.copy(nonce12, 4, 16, 24);
    const cipher = crypto.createCipheriv('chacha20-poly1305', subkey, nonce12, { authTagLength: 16 });
    cipher.setAAD(header, { plaintextLength: opusFrame.length });
    return Buffer.concat([header, cipher.update(opusFrame), cipher.final(), cipher.getAuthTag(), nonceSuffix]);
  }
  throw new Error(`Mode de chiffrement vocal non pris en charge : ${mode || 'inconnu'}`);
}

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
    this.publicIp = publicIp || null;
    this.ssrc = null;
    this.voiceIp = null;     // IP du serveur vocal Discord (pour envoyer l'audio)
    this.voicePort = null;   // port du serveur vocal Discord
    this.secretKey = null;   // Buffer 32
    this.mode = null;
    this.nonceCounter = 0;   // compteur 4 octets appendu au payload (rtpsize)
    this.daveRequired = false;
    this.lastSeq = -1;
    this.identified = false;
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
        // Discord envoie HELLO/READY/SESSION_DESCRIPTION en JSON (parfois en Buffer).
        // Les opcodes DAVE (25/27/29/30) sont binaires. On tente JSON d'abord.
        const str = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        let msg = null;
        try { msg = JSON.parse(str); } catch { /* pas du JSON -> binaire DAVE */ }
        if (msg && typeof msg === 'object' && msg.op !== undefined) {
          this._onWS(msg, resolve, reject);
        } else if (Buffer.isBuffer(data)) {
          this._onBinary(data);
        }
      });
      this.ws.on('error', (e) => { console.error('[voice] WS erreur:', e.message); this.emit('error', e); reject(e); });
      this.ws.on('close', (code, reason) => {
        console.log('[voice] WS ferme code=' + code + ' reason=' + (reason ? reason.toString() : ''));
        const wasConnected = this.connected;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.connected = false; this.emit('close');
        // Si la connexion n'est pas encore établie, on reject pour declencher le retry.
        if (!wasConnected) reject(new Error('WS ferme code=' + code + ' (' + (reason ? reason.toString() : '') + ')'));
      });
    });
  }

  // --- Protocole DAVE : messages binaires (opcodes 25/27/29/30) ---

  _sendBinary(opcode, payload) {
    // Les opcodes DAVE 25/27/29/30 (serveur -> client) ont un numéro de
    // séquence. Les réponses client 26/28 n'en ont pas : uint8 opcode + data.
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket vocal fermé pendant le handshake DAVE.');
    this.ws.send(Buffer.concat([Buffer.from([opcode]), payload]));
  }

  _sendDaveReady(transitionId) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket vocal fermé avant la transition DAVE.');
    this.ws.send(JSON.stringify({ op: 23, d: { transition_id: transitionId } }));
    console.log('[dave] prêt pour transition (op 23 JSON) tid=' + transitionId);
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
    } else if (opcode === 27) { // dave_mls_proposals = operation_type(1) + MLSMessage vector (PAS de transition_id)
      const res = this.dave.processProposals(payload);
      if (res && res.commit) {
        // op 28: uint8 opcode + MLSMessage commit + [Welcome] (PAS de transition_id)
        const out = Buffer.concat([res.commit, res.welcome || Buffer.alloc(0)]);
        this._sendBinary(28, out);
        console.log('[dave] commit+welcome envoye (op 28)');
      }
    } else if (opcode === 29) { // dave_mls_announce_commit_transition (a transition_id)
      if (payload.length >= 2) {
        this.dave.transitionId = payload.readUInt16BE(0);
        const commit = payload.slice(2);
        if (this.dave.processCommit(commit)) this._sendDaveReady(this.dave.transitionId);
      }
    } else if (opcode === 30) { // dave_mls_welcome
      if (payload.length >= 2) {
        this.dave.transitionId = payload.readUInt16BE(0);
        const welcome = payload.slice(2);
        if (this.dave.processWelcome(welcome)) this._sendDaveReady(this.dave.transitionId);
      }
    } else {
      console.log('[dave] op binaire recu op=' + opcode + ' (non gere)');
    }
  }

  _onWS(msg, resolve, reject) {
    const { op, d } = msg;
    if (Number.isInteger(msg.seq)) this.lastSeq = msg.seq;
    switch (op) {
      case 8: { // HELLO (WS vocal : op 8 = HELLO, pas 10)
        const interval = d.heartbeat_interval;
        console.log('[voice] HELLO recu (heartbeat ' + interval + ' ms)');
        if (this.identified) return;
        if (!this.sessionId || !this.token) {
          console.error('[voice] IDENTIFY impossible: sessionId=' + this.sessionId + ' token=' + (this.token ? 'present' : 'ABSENT'));
          reject(new Error('VOCAL_UNAVAILABLE'));
          return;
        }
        console.log('[voice] IDENTIFY : session et jeton vocal présents.');
        this._startHeartbeat(interval);
        this.ws.send(JSON.stringify({
          op: 0, // IDENTIFY (WS vocal : op 0)
          d: {
            server_id: this.serverId,
            user_id: this.userId,
            session_id: this.sessionId,
            token: this.token,
        max_dave_protocol_version: 1,
          },
        }));
        this.identified = true;
        console.log('[voice] IDENTIFY envoye');
        break;
      }
      case 2: { // READY (WS vocal : op 2)
        this.ssrc = d.ssrc;
        this.voiceIp = d.ip;
        this.voicePort = d.port;
        this.modes = d.modes;
        // Discord n'accepte plus les anciens modes. AES-GCM est natif sur Node 20+.
        const pref = ['aead_aes256_gcm_rtpsize', 'aead_xchacha20_poly1305_rtpsize'];
        this.mode = pref.find((m) => (d.modes || []).includes(m));
        if (!this.mode) {
          reject(new Error(`Aucun chiffrement vocal pris en charge. Modes reçus : ${(d.modes || []).join(', ') || 'aucun'}`));
          return;
        }
        console.log('[voice] READY: ssrc=' + d.ssrc + ' ip=' + d.ip + ':' + d.port + ' modes=' + (d.modes || []).join(','));
        this._openUDP().then((discoveredIp) => {
          const address = discoveredIp || this.publicIp || '127.0.0.1';
          console.log('[voice] UDP local port=' + this.udpPort + ' -> SELECT_PROTOCOL ip=' + address);
          this.ws.send(JSON.stringify({
            op: 1,
            d: {
              protocol: 'udp',
              data: {
                address,
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
        if (d.mode) this.mode = d.mode;
        this.daveRequired = Number(d.dave_protocol_version || 0) > 0;
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
        // Le bot doit annoncer qu'il parle avant l'envoi du premier paquet RTP.
        this._sendSpeaking(1);
        break;
      }
      default:
        // Opcodes vocaux connus a ignorer (bruit): 5 SPEAKING, 11 ?, 13 ?, 15 ?,
        // 18 ?, 20 ?. On ne loggue que les opcodes vraiment inattendus.
        if (op === 11 && this.dave && Array.isArray(d?.user_ids)) {
          for (const id of d.user_ids) this.dave.addRecognizedUser(id);
          console.log('[dave] membres vocaux connus=' + this.dave.recognizedUserIds.length);
        } else if (op === 13 && this.dave && d?.user_id) {
          this.dave.removeRecognizedUser(d.user_id);
        } else if (![5, 11, 13, 15, 18, 20].includes(op)) console.log('[voice] WS op=' + op + ' recu');
        break;
    }
  }

  _startHeartbeat(interval) {
    // NE PAS envoyer de heartbeat immediatement : l'IDENTIFY doit partir en
    // premier, sinon Discord ferme en 4003 "Not authenticated" (payload before
    // identifying). On attend l'intervalle avant le 1er heartbeat.
    const send = () => this.ws && this.ws.send(JSON.stringify({ op: 3, d: { t: Date.now(), seq_ack: this.lastSeq } }));
    this.heartbeatTimer = setInterval(send, interval * 0.9);
  }

  async _openUDP() {
    return new Promise((resolve, reject) => {
      this.udp = dgram.createSocket('udp4');
      this.udp.on('error', reject);
      this.udp.bind(0, () => {
        this.udpPort = this.udp.address().port;
        const disc = Buffer.alloc(74);
        disc.writeUInt16BE(0x0001, 0);
        disc.writeUInt16BE(70, 2);
        disc.writeUInt32BE(this.ssrc, 4);
        const timeout = setTimeout(() => resolve(null), 1500);
        this.udp.once('message', (msg) => {
          clearTimeout(timeout);
          const zero = msg.indexOf(0, 8);
          resolve(msg.toString('ascii', 8, zero < 0 ? 72 : zero));
        });
        this.udp.send(disc, 0, 74, this.voicePort, this.voiceIp, (e) => { if (e) { clearTimeout(timeout); resolve(null); } });
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
   * Envoie une frame Opus brute (20ms @ 48kHz) chiffree selon le mode AEAD négocié.
   * @param {Buffer} opusFrame
   */
  sendOpus(opusFrame) {
    if (!this.connected || !this.secretKey || !this.udp) return false;
    // Ne jamais envoyer de frame en clair lorsque Discord a exigé DAVE.
    if (this.daveRequired && (!this.dave || !this.dave.ready)) return false;
    // DAVE/E2EE : aucune frame en clair n'est envoyée en cas d'échec crypto.
    if (this.daveRequired) opusFrame = this.dave.encryptOpus(opusFrame);
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = 0x78; // payload type Opus
    header.writeUInt16BE(this.seq & 0xffff, 2);
    header.writeUInt32BE(this.timestamp & 0xffffffff, 4);
    header.writeUInt32BE(this.ssrc, 8);

    const packet = encryptTransport(this.mode, this.secretKey, this.nonceCounter, header, opusFrame);
    this.nonceCounter = (this.nonceCounter + 1) >>> 0;

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

module.exports = { VoiceConnection, encryptTransport, hchacha20 };
