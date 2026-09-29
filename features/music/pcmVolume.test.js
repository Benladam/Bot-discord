const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PcmVolume } = require('./pcmVolume');

test('le volume change réellement les échantillons et accepte les chunks coupés entre deux octets', async () => {
  const gain = new PcmVolume(0.5);
  const samples = [];
  gain.on('data', chunk => { for (let offset = 0; offset < chunk.length; offset += 2) samples.push(chunk.readInt16LE(offset)); });
  const input = Buffer.alloc(4);
  input.writeInt16LE(20000, 0); input.writeInt16LE(-12000, 2);
  gain.write(input.subarray(0, 1)); gain.write(input.subarray(1));
  gain.setVolume(0); gain.write(input);
  gain.setVolume(1); gain.end(input);
  await new Promise(resolve => gain.on('end', resolve));
  assert.deepEqual(samples, [10000, -6000, 0, 0, 20000, -12000]);
});
