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
const nacl = require('tweetnacl'); // xsalsa20-poly1305 pur JS (pas de binaire natif)

class VoiceConnection extends require('events').EventEmitter {
  constructor({ endpoint, token, sessionId, serverId, userId, publicIp }) {
    super();
    this.endpointBrut = endpoint || '';
    this.endpoint = (endpoint || '').split(':')[0]; // WS vocal sur 443, pas le port UDP
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
    this.mode = 'xsalsa20_poly1305_libsodium';
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
        const raw = data.toString();
        let msg;
        try { msg = JSON.parse(raw); } catch { console.log('[voice] WS message non-JSON:', raw.slice(0, 200)); return; }
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
        console.log('[voice] SESSION_DESCRIPTION recu (secretKey OK)');
        this.emit('ready');
        resolve();
        break;
      }
      default:
        // SPEAKING (op 5) etc.
        if (op !== 5) console.log('[voice] WS op=' + op + ' recu');
        break;
    }
  }

  _startHeartbeat(interval) {
    const send = () => this.ws && this.ws.send(JSON.stringify({ op: 3, d: Date.now() }));
    send();
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
   * Envoie une frame Opus brute (20ms @ 48kHz) chiffrée xsalsa20.
   * @param {Buffer} opusFrame
   */
  sendOpus(opusFrame) {
    if (!this.connected || !this.secretKey || !this.udp) return false;
    const header = Buffer.alloc(12);
    header[0] = 0x80;
    header[1] = 0x78; // payload type Opus
    header.writeUInt16BE(this.seq & 0xffff, 2);
    header.writeUInt32BE(this.timestamp & 0xffffffff, 4);
    header.writeUInt32BE(this.ssrc, 8);

    // xsalsa20_poly1305_libsodium : nonce = 24 octets = 12 zéros + 12 octets du header RTP
    const nonce = Buffer.alloc(24);
    header.copy(nonce, 12, 0, 12);
    // tweetnacl attend des Uint8Array
    const ct = nacl.secretbox(
      new Uint8Array(opusFrame),
      new Uint8Array(nonce),
      new Uint8Array(this.secretKey),
    );
    const ciphertext = Buffer.from(ct);

    const packet = Buffer.concat([header, ciphertext]);
    this.udp.send(packet, 0, packet.length, this.voicePort, this.voiceIp);

    this.seq = (this.seq + 1) & 0xffff;
    this.timestamp = (this.timestamp + 960) & 0xffffffff; // 48kHz * 20ms = 960
    return true;
  }

  destroy() {
    this.connected = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.udp) try { this.udp.close(); } catch {}
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { VoiceConnection };
