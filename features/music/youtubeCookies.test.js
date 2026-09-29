const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectCookieText } = require('./youtubeCookies');
const header = '# Netscape HTTP Cookie File\n';
const row = (name, expires, value = 'secret-test-value', domain = '.youtube.com') => `${domain}\tTRUE\t/\tTRUE\t${expires}\t${name}\t${value}\n`;

test('normalise BOM et CRLF uniquement dans la copie et compte HttpOnly, session et expirations', () => {
  const source = '\uFEFF' + (header + '#HttpOnly_' + row('SID', 0) + row('SAPISID', 100) + row('YSC', 9999999999)).replace(/\n/g, '\r\n');
  const result = inspectCookieText(source, { now: 200000 });
  assert.equal(result.content, header + '#HttpOnly_' + row('SID', 0) + row('SAPISID', 100) + row('YSC', 9999999999));
  assert.deepEqual(result.summary, { entries: 3, youtubeEntries: 3, activeEntries: 2, expiredEntries: 1, activeAuthEntries: 1 });
  assert.ok(source.startsWith('\uFEFF'));
  assert.ok(!JSON.stringify(result.summary).includes('secret-test-value'));
});

test('refuse JSON, HTML, colonnes invalides, export vide et cookies expirés sans révéler de valeur', () => {
  for (const [content, code] of [
    ['{"secret-test-value":true}', 'YOUTUBE_COOKIES_INVALID'],
    ['<html>secret-test-value</html>', 'YOUTUBE_COOKIES_INVALID'],
    [header + '.youtube.com\tsecret-test-value\n', 'YOUTUBE_COOKIES_INVALID'],
    [header, 'YOUTUBE_COOKIES_EMPTY'],
    [header + row('SID', 0, 'secret-test-value', '.example.com'), 'YOUTUBE_COOKIES_EMPTY'],
    [header + row('SID', 100), 'YOUTUBE_COOKIES_EXPIRED'],
  ]) assert.throws(() => inspectCookieText(content, { now: 200000 }), error => error.code === code && !error.message.includes('secret-test-value'));
});
