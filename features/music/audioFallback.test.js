const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { prepareInput, soundCloudStream, buildYtDlpArgs, soundCloudSearchStream, youtubeSearchStream } = require('./audioSender');

test('SoundCloud examine les résultats au-delà des dix premiers et classe avant de jouer', async () => {
  const opened = [];
  const stream = await soundCloudSearchStream('Koba LaD - RR 9.1', {
    expectedTitle: 'RR 9.1 - Koba LaD', expectedDuration: 200, isConfigured: () => false,
    searchCandidates: async (_query, options) => {
      assert.equal(options.limit, 25);
      return [
        { title: 'RR 9.1', user: { username: 'Koba LaD' }, duration: 219, url: 'https://soundcloud.com/koba/less-close' },
        ...Array.from({ length: 22 }, (_, i) => ({ title: 'RR 9.1 Remix', user: { username: 'Koba LaD' }, url: `https://soundcloud.com/koba/remix-${i}` })),
        { title: 'RR91 (feat. Niska)', metadata_artist: 'Koba La D', duration: 200, url: 'https://soundcloud.com/koba/best' },
      ];
    },
    openTrack: async url => { opened.push(url); return new PassThrough(); },
  });
  assert.deepEqual(opened, ['https://soundcloud.com/koba/best']);
  stream.destroy();
});

test('le repli API SoundCloud est essayé lorsque yt-dlp trouve seulement de mauvaises réponses', async () => {
  let apiCalls = 0;
  const stream = await soundCloudSearchStream('Koba LaD - RR 9.1', {
    expectedDuration: 200, isConfigured: () => true,
    searchCandidates: async () => [{ title: 'RR 9.1 Remix', metadata_artist: 'Koba LaD', url: 'https://soundcloud.com/koba/remix' }],
    searchFallback: async () => {
      apiCalls++;
      return [{ title: 'RR91', publisher_metadata: { artist: 'Koba La D' }, duration: 200, url: 'https://soundcloud.com/koba/correct' }];
    },
    openTrack: async url => { assert.equal(url, 'https://soundcloud.com/koba/correct'); return new PassThrough(); },
  });
  assert.equal(apiCalls, 1);
  stream.destroy();
});

test('une deuxième formulation trouve le bon titre après une première recherche trop bruitée', async () => {
  const terms = [];
  const stream = await soundCloudSearchStream('Koba LaD - RR 9.1', {
    expectedTitle: 'RR 9.1 - Koba LaD', isConfigured: () => false,
    searchCandidates: async term => {
      terms.push(term);
      return term === 'koba lad rr 91'
        ? [{ title: 'RR91', metadata_artist: 'Koba LaD', url: 'https://soundcloud.com/koba/rr91' }]
        : [];
    },
    openTrack: async () => new PassThrough(),
  });
  assert.deepEqual(terms, ['rr 9 1 koba lad', 'koba lad rr 91']);
  stream.destroy();
});

test('un flux SoundCloud indisponible est dédupliqué et une autre correspondance est essayée', async () => {
  const opened = [];
  const track = { title: 'Réseaux', metadata_artist: 'Niska', duration: 196 };
  const stream = await soundCloudSearchStream('Niska - Réseaux', {
    expectedDuration: 196, isConfigured: () => true,
    searchCandidates: async () => [{ ...track, url: 'https://soundcloud.com/niska/blocked' }],
    searchFallback: async () => [
      { ...track, url: 'https://soundcloud.com/niska/blocked' },
      { ...track, url: 'https://soundcloud.com/niska/correct' },
    ],
    openTrack: async url => {
      opened.push(url);
      if (url.endsWith('/blocked')) throw new Error('HTTP 403');
      return new PassThrough();
    },
  });
  assert.deepEqual(opened, ['https://soundcloud.com/niska/blocked', 'https://soundcloud.com/niska/correct']);
  stream.destroy();
});

test('le budget SoundCloud expire sans lancer les résultats arrivés trop tard', async () => {
  let release;
  let opened = false;
  await assert.rejects(soundCloudSearchStream('Niska - Réseaux', {
    timeoutMs: 100, isConfigured: () => false,
    searchCandidates: async () => new Promise(resolve => { release = resolve; }),
    openTrack: async () => { opened = true; return new PassThrough(); },
  }), /délai de recherche SoundCloud/);
  release([{ title: 'Réseaux', metadata_artist: 'Niska', url: 'https://soundcloud.com/niska/late' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, false);
});

test('Djadja & Dinaz : refuse un upload sans attribution artiste dans le titre', async () => {
  let opened = false;
  await assert.rejects(soundCloudSearchStream("Djadja & Dinaz - J'fais mes affaires", {
    expectedTitle: "Djadja & Dinaz - J'fais mes affaires [Clip Officiel]",
    searchCandidates: async () => [{ title: "J'fais mes affaires", user: { username: 'joris.py' }, url: 'https://soundcloud.com/joris/upload', duration: 276.5 }],
    openTrack: async () => { opened = true; return new PassThrough(); },
  }), { code: 'MUSIC_TRACK_MISMATCH' });
  assert.equal(opened, false);
});

test('un upload attribué au bon artiste est essayé, sans accepter mashup ou extrait, et sans remplacer la requête', async () => {
  const opened = [];
  const stream = await soundCloudSearchStream('Koba LaD - RR 9.1', {
    expectedDuration: 200, isConfigured: () => false,
    searchCandidates: async () => [
      { title: 'Koba LaD x Niska x Gala - RR91 Desire', duration: 200, user: { username: 'DJ' }, url: 'https://soundcloud.com/dj/mashup' },
      { title: 'Koba LaD - RR 9.1', duration: 30, user: { username: 'DJ' }, url: 'https://soundcloud.com/dj/extrait' },
      { title: 'koba la d rr9 1 (feat niska)', duration: 200, user: { username: 'tim_cnss' }, url: 'https://soundcloud.com/tim/rr91' },
    ],
    openTrack: async url => { opened.push(url); return new PassThrough(); },
  });
  assert.deepEqual(opened, ['https://soundcloud.com/tim/rr91']);
  stream.destroy();
});

test('Niska Réseaux en file : cherche le titre nettoyé et accepte le bon résultat après cinq mauvais', async () => {
  const opened = [];
  const stream = await soundCloudSearchStream('Niska Officiel - Niska - Réseaux (Clip Officiel)', {
    expectedTitle: 'Niska - Réseaux (Clip Officiel)', expectedDuration: 196,
    searchCandidates: async (query, options) => {
      assert.equal(query, 'niska reseaux');
      assert.equal(options.limit, 25);
      return [
        ...Array.from({ length: 5 }, (_, index) => ({ title: 'Niska - Autre chanson', url: `https://soundcloud.com/niska/other-${index}` })),
        { title: 'Niska - Réseaux', user: { username: 'Niska' }, durationInSec: 196, url: 'https://soundcloud.com/niska/reseaux' },
      ];
    },
    openTrack: async url => { opened.push(url); return new PassThrough(); },
  });
  assert.deepEqual(opened, ['https://soundcloud.com/niska/reseaux']);
  stream.destroy();
});

test('le repli SoundCloud ouvre le Niska demandé, pas le premier résultat ni son remix', async () => {
  const opened = [];
  const stream = await soundCloudSearchStream("Niska Officiel - Niska - Chasse à l'homme #KeDuSal 2", {
    expectedTitle: "Niska - Chasse à l'homme #KeDuSal 2", expectedDuration: 164,
    searchCandidates: async () => [
      { title: 'Niska - Réseaux', durationInSec: 164, url: 'https://soundcloud.com/niska/wrong' },
      { title: 'Niska - Chasse à l’homme Remix', durationInSec: 164, url: 'https://soundcloud.com/niska/remix' },
      { title: 'Chasse à l’homme', user: { username: 'Niska' }, durationInSec: 164, url: 'https://soundcloud.com/niska/correct' },
    ],
    openTrack: async url => { opened.push(url); return new PassThrough(); },
  });
  assert.deepEqual(opened, ['https://soundcloud.com/niska/correct']);
  stream.destroy();
});

test('le repli YouTube refuse aussi une autre piste ou un remix', async () => {
  const opened = [];
  const stream = await youtubeSearchStream('Niska - Chasse à l’homme', {
    expectedDuration: 164,
    searchCandidates: async () => [
      { title: 'Niska - Réseaux', url: 'https://youtu.be/wrong' },
      { title: 'Niska - Chasse à l’homme Remix', url: 'https://youtu.be/remix' },
      { title: 'Niska - Chasse à l’homme (Clip Officiel)', url: 'https://youtu.be/correct' },
    ],
    openTrack: async url => { opened.push(url); return new PassThrough(); },
  });
  assert.deepEqual(opened, ['https://youtu.be/correct']);
  stream.destroy();
});

test('aucun repli ne joue un autre son si tous les résultats sont incorrects', async () => {
  for (const [search, url] of [
    [soundCloudSearchStream, 'https://soundcloud.com/niska/wrong'],
    [youtubeSearchStream, 'https://youtu.be/wrong'],
  ]) {
    let opened = false;
    await assert.rejects(search('Niska', {
      expectedTitle: 'Niska - Chasse à l’homme',
      searchCandidates: async () => [{ title: 'Niska - Réseaux', url }],
      openTrack: async () => { opened = true; return new PassThrough(); },
    }), { code: 'MUSIC_TRACK_MISMATCH' });
    assert.equal(opened, false);
  }
});

test('la préparation transmet titre, durée et serveur aux replis dans les deux sens', async () => {
  for (const [url, primaryKey, fallbackKey] of [
    ['https://youtu.be/track', 'getYouTubeStream', 'searchSoundCloudStream'],
    ['https://soundcloud.com/artist/track', 'getSoundCloudStream', 'searchYouTubeStream'],
  ]) {
    let received;
    const media = await prepareInput(url, 'niska', {
      expectedTitle: 'Niska - Chasse à l’homme', expectedDuration: 164, guildId: 'guild-niska',
      [primaryKey]: async () => { throw new Error('source indisponible'); },
      [fallbackKey]: async (_query, options) => { received = options; return new PassThrough(); },
    });
    assert.deepEqual(received, {
      expectedTitle: 'Niska - Chasse à l’homme', expectedDuration: 164, guildId: 'guild-niska',
    });
    media.stream.destroy();
  }
});

test('yt-dlp refuse les formats preview SoundCloud pour les deux modes de lecture', () => {
  for (const outputToStdout of [false, true]) {
    const args = buildYtDlpArgs([], 'https://soundcloud.com/artist/track', { outputToStdout });
    assert.equal(args[args.indexOf('-f') + 1], 'bestaudio[format_id!*=preview]/best[format_id!*=preview]');
  }
  const youtubeArgs = buildYtDlpArgs([], 'https://youtu.be/track', { cookiesPath: '' });
  assert.equal(youtubeArgs[youtubeArgs.indexOf('-f') + 1], 'bestaudio/best');
});

test('le repli play-dl exclut les previews même quand SoundCloud annonce une durée complète', async () => {
  const stream = new PassThrough();
  const complete = { url: 'https://api.soundcloud.com/full', duration: 181_000, format: { protocol: 'hls' } };
  let receivedFormats;
  const selected = await soundCloudStream('https://soundcloud.com/artist/track', {
    getYtDlpStream: async () => { throw new Error('yt-dlp indisponible'); },
    isConfigured: () => true,
    getTrack: async () => ({ type: 'track', durationInSec: 181, formats: [
      { url: 'https://api.soundcloud.com/a', snipped: true, duration: 181_000, format: { protocol: 'hls' } },
      { url: 'https://api.soundcloud.com/preview/track', duration: 181_000, format: { protocol: 'hls' } },
      { url: 'https://api.soundcloud.com/b', duration: 30_000, format: { protocol: 'hls' } },
      complete,
    ] }),
    streamFromInfo: async (track) => { receivedFormats = track.formats; return { stream }; },
  });
  assert.equal(selected, stream);
  assert.deepEqual(receivedFormats, [complete]);
  stream.destroy();
});

test('le repli play-dl refuse une piste dont tous les transcodages sont des extraits', async () => {
  let opened = false;
  await assert.rejects(soundCloudStream('https://soundcloud.com/artist/track', {
    getYtDlpStream: async () => { throw new Error('yt-dlp indisponible'); },
    isConfigured: () => true,
    getTrack: async () => ({ type: 'track', durationInSec: 181, formats: [
      { url: 'https://api.soundcloud.com/playlist/0/30/audio', format: { protocol: 'hls' } },
    ] }),
    streamFromInfo: async () => { opened = true; return { stream: new PassThrough() }; },
  }), (error) => error.code === 'SOUNDCLOUD_PREVIEW_ONLY');
  assert.equal(opened, false);
});

test('bascule de YouTube vers SoundCloud si l’extraction YouTube échoue', async () => {
  const soundCloudStream = new PassThrough();
  let searchedQuery = '';
  const media = await prepareInput('https://www.youtube.com/watch?v=track', 'Niska - Chasse à l’homme', {
    getYouTubeStream: async () => { throw new Error('HTTP 503'); },
    searchSoundCloudStream: async (query) => { searchedQuery = query; return soundCloudStream; },
  });

  assert.equal(searchedQuery, 'Niska - Chasse à l’homme');
  assert.equal(media.stream, soundCloudStream);
  assert.equal(media.fallback, true);
  assert.equal(media.fallbackProvider, 'SoundCloud');
  soundCloudStream.destroy();
});

test('bascule d’un lien SoundCloud vers YouTube avec la recherche de titre', async () => {
  let searchedQuery = '';
  const media = await prepareInput('https://soundcloud.com/artist/track', 'Artist - Track', {
    getSoundCloudStream: async () => { throw new Error('Flux SoundCloud indisponible'); },
    searchYouTubeStream: async (query) => { searchedQuery = query; return 'https://audio.example/stream'; },
  });

  assert.equal(searchedQuery, 'Artist - Track');
  assert.equal(media.url, 'https://audio.example/stream');
  assert.equal(media.fallback, true);
  assert.equal(media.fallbackProvider, 'YouTube');
});

test('explique les deux échecs et les réglages serveur manquants', async () => {
  await assert.rejects(prepareInput('https://youtu.be/track', 'Artist - Track', {
    getYouTubeStream: async () => { throw new Error('YouTube bloqué'); },
    searchSoundCloudStream: async () => { throw new Error('SOUNDCLOUD_CLIENT_ID manquant'); },
  }), (error) => {
    assert.equal(error.code, 'MUSIC_PROVIDERS_FAILED');
    assert.match(error.message, /YouTube bloqué/);
    assert.match(error.message, /SOUNDCLOUD_CLIENT_ID/);
    assert.match(error.message, /YOUTUBE_COOKIES_PATH/);
    return true;
  });
});

test('ne lance pas une recherche de repli sans métadonnées de requête', async () => {
  let attemptedSoundCloud = false;
  await assert.rejects(prepareInput('https://youtu.be/track', '', {
    getYouTubeStream: async () => { throw new Error('YouTube indisponible'); },
    searchSoundCloudStream: async () => { attemptedSoundCloud = true; return new PassThrough(); },
  }), /YouTube indisponible/);
  assert.equal(attemptedSoundCloud, false);
});
