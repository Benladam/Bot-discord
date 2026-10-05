const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { classifyPoDiagnostic, poTokenCheck } = require('./poTokenCheck');
test('PO diagnostics distinguish loaded plugin from requested generation and never expose verbose secrets', async () => {
  const logs = [];
  const result = await poTokenCheck('https://www.youtube.com/watch?v=abcdefghijk', {
    ensure: async () => ({ ready: true, plugins: 'private' }), binary: async () => 'yt-dlp', log: line => logs.push(line),
    spawnImpl: (_cmd, args) => {
      assert.ok(args.includes('--simulate')); assert.ok(!args.includes('--cookies'));
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      setImmediate(() => {
        child.stderr.write('[debug] yt-dlp version stable@2026.09.23\n[debug] PO Token Providers: bgutil:http (external)\nLOGIN_REQUIRED\ntoken=private-secret\n');
        child.emit('close', 1);
      }); return child;
    },
  });
  assert.equal(result.pluginLoaded, true); assert.equal(result.generationRequested, false); assert.equal(result.loginRequired, true);
  assert.ok(!logs.join().includes('private-secret'));
  assert.equal(classifyPoDiagnostic('Generating a gvs PO Token').generationRequested, true);
});

test('PO diagnostics distinguish unavailable video and missing formats from login rejection', () => {
  const unavailable = classifyPoDiagnostic('Video unavailable; token=private');
  assert.equal(unavailable.unavailable, true); assert.equal(unavailable.loginRequired, false);
  const formats = classifyPoDiagnostic('Requested format is not available');
  assert.equal(formats.noFormats, true); assert.equal(formats.loginRequired, false);
  assert.equal(classifyPoDiagnostic('challenge solver failed').solverFailed, true);
});
