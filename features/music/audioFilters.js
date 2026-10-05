const FILTERS = Object.freeze({ none: 'Normal', bass: 'Basses renforcées', soft: 'Aigus adoucis', mono: 'Mono', 'vocal-reduce': 'Voix atténuée (approximatif)' });
function validateFilter(value) {
  if (!Object.hasOwn(FILTERS, value)) throw new Error('Filtre inconnu. Choisis none, bass, soft, mono ou vocal-reduce.');
  return value;
}
/** Fixed stereo 48kHz PCM presets; no arbitrary expressions or duration changes. */
class StereoFilter {
  constructor(name = 'none') { this.set(name); }
  set(name) {
    this.name = validateFilter(name); this.low = [0, 0];
    this.alpha = 1 - Math.exp(-2 * Math.PI * (name === 'bass' ? 180 : 6000) / 48000);
  }
  frame(left, right) {
    if (this.name === 'mono') return [(left + right) / 2, (left + right) / 2];
    if (this.name === 'vocal-reduce') return [(left - right) / 2, (right - left) / 2];
    if (this.name === 'none') return [left, right];
    return [left, right].map((sample, channel) => {
      this.low[channel] += this.alpha * (sample - this.low[channel]);
      return this.name === 'bass' ? (sample + this.low[channel] * 0.8) * 0.55 : this.low[channel];
    });
  }
}
module.exports = { FILTERS, validateFilter, StereoFilter };
