const { Transform } = require('node:stream');

/** Gain en PCM avant l'unique encodage Opus, sans redémarrer le morceau. */
class PcmVolume extends Transform {
  constructor(volume = 1) {
    super({ highWaterMark: 3840 }); // 20 ms de PCM stéréo 48 kHz
    this.pendingByte = null;
    this.setVolume(volume);
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value) || 0)); }
  _transform(chunk, encoding, callback) {
    const input = this.pendingByte === null ? chunk : Buffer.concat([Buffer.from([this.pendingByte]), chunk]);
    const size = input.length - (input.length % 2);
    this.pendingByte = size < input.length ? input[size] : null;
    const output = Buffer.allocUnsafe(size);
    for (let offset = 0; offset < size; offset += 2) output.writeInt16LE(Math.round(input.readInt16LE(offset) * this.volume), offset);
    callback(null, output);
  }
  _flush(callback) { callback(this.pendingByte === null ? null : new Error('Flux PCM incomplet.')); }
}
module.exports = { PcmVolume };
