const { test } = require('node:test');
const assert = require('node:assert/strict');

test('une recherche lente continue après la réponse Discord, est mutualisée et enrichit le cache', async () => {
  const audio = require('./audioSender');
  const spotify = require('./providers/spotify');
  const soundcloud = require('./providers/soundcloud');
  const play = require('play-dl');
  const originals = [audio.searchYouTubeCandidates, audio.searchYouTubePlaylists, spotify.searchSpotifyCatalog, soundcloud.configureSoundCloud, play.search];
  let release; let calls = 0; let budget;
  audio.searchYouTubeCandidates = (query, options) => { calls++; budget = options.timeoutMs; return new Promise(resolve => { release = resolve; }); };
  audio.searchYouTubePlaylists = async () => [];
  spotify.searchSpotifyCatalog = async () => [];
  soundcloud.configureSoundCloud = () => false;
  play.search = async () => [];
  delete require.cache[require.resolve('./musicCatalog')];
  try {
    const { searchCatalog, describe } = require('./musicCatalog');
    assert.deepEqual(await searchCatalog('regression-cache-lent', { sourceTimeoutMs: 100 }), []);
    assert.deepEqual(await searchCatalog('regression-cache-lent', { sourceTimeoutMs: 100 }), []);
    assert.equal(calls, 1);
    assert.equal(budget, 6000);
    release([{ title: 'Titre tardif', url: 'https://www.youtube.com/watch?v=abc12345678', channel: { name: 'Artiste' } }]);
    await new Promise(resolve => setImmediate(resolve));
    const items = await searchCatalog('regression-cache-lent', { sourceTimeoutMs: 100 });
    assert.equal(items[0].title, 'Titre tardif');
    assert.equal(calls, 1);
    assert.match(describe({ provider: 'soundcloud', kind: 'track' }), /^SoundCloud/);
  } finally {
    [audio.searchYouTubeCandidates, audio.searchYouTubePlaylists, spotify.searchSpotifyCatalog, soundcloud.configureSoundCloud, play.search] = originals;
    delete require.cache[require.resolve('./musicCatalog')];
  }
});
