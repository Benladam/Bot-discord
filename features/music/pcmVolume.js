const { Transform } = require('node:stream');
const { StereoFilter } = require('./audioFilters');

/** Gain en PCM avant l'unique encodage Opus, sans redémarrer le morceau. */
class PcmVolume extends Transform {
  constructor(volume = 1, filter = 'none') {
    super({ highWaterMark: 3840 }); // 20 ms de PCM stéréo 48 kHz
    this.pending = Buffer.alloc(0);
    this.filter = new StereoFilter(filter);
    this.setVolume(volume);
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(1, Number(value) || 0)); }
  setFilter(name) { this.filter.set(name); }
  _transform(chunk, encoding, callback) {
    const input = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const size = input.length - (input.length % 4);
    this.pending = Buffer.from(input.subarray(size));
    const output = Buffer.allocUnsafe(size);
    for (let offset = 0; offset < size; offset += 4) {
      const values = this.filter.frame(input.readInt16LE(offset), input.readInt16LE(offset + 2));
      values.forEach((value, channel) => output.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * this.volume))), offset + channel * 2));
    }
    callback(null, output);
  }
  _flush(callback) { callback(this.pending.length ? new Error('Flux PCM stéréo incomplet.') : null); }
}
module.exports = { PcmVolume };
