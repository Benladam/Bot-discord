/**
 * dave.js — Gestion du protocole DAVE (E2EE Discord) MAISON.
 * On utilise @snazzah/davey (wrapper libdave/OpenMLS) uniquement pour la
 * crypto MLS (chiffrement/déchiffrement des frames). Le protocole (handshake
 * via opcodes WS binaires, séquence des messages) est implémenté ici, pas dans
 * une lib tierce de vocal.
 *
 * Séquence (DAVE v1, voir daveprotocol.com) :
 *  1. op 4 (SessionDescription) -> dave_protocol_version > 0
 *  2. op 25 (external_sender_package) -> setExternalSender
 *  3. on envoie op 26 (key_package) = getSerializedKeyPackage()
 *  4. op 27 (proposals) -> processProposals -> si commit+welcome, on envoie op 28
 *  5. op 29 (announce_commit_transition) -> processCommit
 *  6. op 30 (welcome) -> processWelcome
 *  7. session prête -> encryptOpus() pour chaque frame
 */

const { DAVESession, ProposalsOperationType, MediaType, Codec } = require('@snazzah/davey');

class DaveManager {
  constructor(userId, channelId) {
    this.userId = String(userId);
    this.channelId = String(channelId);
    this.session = null;
    this.recognizedUserIds = [];
    this.transitionId = 0;
    this.seq = 0;
    this.initialized = false;
  }

  init() {
    this.session = new DAVESession(1, this.userId, this.channelId);
    this.initialized = true;
    console.log('[dave] session DAVE initialisee (user=' + this.userId + ' channel=' + this.channelId + ')');
  }

  setExternalSender(buf) {
    if (!this.session) return;
    try {
      this.session.setExternalSender(buf);
      console.log('[dave] external sender defini');
    } catch (e) {
      console.error('[dave] setExternalSender erreur:', e.message);
    }
  }

  getKeyPackage() {
    if (!this.session) return null;
    return this.session.getSerializedKeyPackage();
  }

  processProposals(buf) {
    if (!this.session || !buf || buf.length < 1) return null;
    try {
      // Format DAVE op 27: uint16 seq + uint8 opcode + ProposalsOperationType(1) + MLSMessage vector
      const opType = buf.readUInt8(0); // 0 = append, 1 = revoke
      const proposalsBuffer = buf.slice(1);
      const res = this.session.processProposals(
        opType === 1 ? ProposalsOperationType.REVOKE : ProposalsOperationType.APPEND,
        proposalsBuffer,
        this.recognizedUserIds.length ? this.recognizedUserIds : null
      );
      return res; // { commit?: Buffer, welcome?: Buffer }
    } catch (e) {
      console.error('[dave] processProposals erreur:', e.message);
      return null;
    }
  }

  processCommit(buf) {
    if (!this.session) return;
    try {
      this.session.processCommit(buf);
      console.log('[dave] commit traite');
    } catch (e) {
      console.error('[dave] processCommit erreur:', e.message);
    }
  }

  processWelcome(buf) {
    if (!this.session) return;
    try {
      this.session.processWelcome(buf);
      console.log('[dave] welcome traite');
    } catch (e) {
      console.error('[dave] processWelcome erreur:', e.message);
    }
  }

  addRecognizedUser(id) {
    id = String(id);
    if (!this.recognizedUserIds.includes(id)) this.recognizedUserIds.push(id);
  }

  get ready() {
    return this.session ? this.session.ready : false;
  }

  /** Chiffre un frame Opus (E2EE DAVE) avant le transport xsalsa20. */
  encryptOpus(packet) {
    if (!this.session || !this.session.ready) return packet;
    try {
      return Buffer.from(this.session.encryptOpus(new Uint8Array(packet)));
    } catch (e) {
      console.error('[dave] encryptOpus erreur:', e.message);
      return packet;
    }
  }

  /** Incrémente et retourne le sequence number (uint16) pour les opcodes binaires. */
  nextSeq() {
    this.seq = (this.seq + 1) & 0xffff;
    return this.seq;
  }
}

module.exports = { DaveManager, ProposalsOperationType, MediaType, Codec };
