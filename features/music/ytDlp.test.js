const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { ensureManagedYtDlp, parseChecksum, releaseAsset } = require('./ytDlp');
const {
  buildYtDlpArgs,
  buildYtDlpSearchArgs,
  getYouTubeCookiesPath,
  getYouTubeCookiesPaths,
  parseYtDlpSearch,
  prepareInput,
  searchYouTubeCandidates,
  searchYouTubePlaylists,
  searchSoundCloudCandidates,
  soundCloudSearchStream,
  streamUrl,
  streamYtDlp,
} = require('./audioSender');
const { getSoundCloudClientId } = require('./providers/soundcloud');

const originalBotDataDir = process.env.BOT_DATA_DIR;
let testDataDirectory;
test.before(async () => {
  testDataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-yt-dlp-tests-'));
  process.env.BOT_DATA_DIR = testDataDirectory;
});
test.after(async () => {
  if (originalBotDataDir === undefined) delete process.env.BOT_DATA_DIR;
  else process.env.BOT_DATA_DIR = originalBotDataDir;
  if (testDataDirectory) await fs.rm(testDataDirectory, { recursive: true, force: true });
});

test('sélectionne le binaire yt-dlp officiel pour les plateformes courantes', () => {
  assert.equal(releaseAsset('linux', 'x64'), 'yt-dlp_linux');
  assert.equal(releaseAsset('linux', 'arm64'), 'yt-dlp_linux_aarch64');
  assert.equal(releaseAsset('linux', 'x64', true), 'yt-dlp_musllinux');
  assert.equal(releaseAsset('linux', 'arm64', true), 'yt-dlp_musllinux_aarch64');
  assert.equal(releaseAsset('win32', 'x64'), 'yt-dlp.exe');
  assert.equal(releaseAsset('win32', 'arm64'), 'yt-dlp_arm64.exe');
  assert.equal(releaseAsset('darwin', 'arm64'), 'yt-dlp_macos');
  assert.throws(() => releaseAsset('freebsd', 'x64'), /YTDLP_PATH/);
});

test('active explicitement le runtime JavaScript Node de yt-dlp', () => {
  const args = buildYtDlpArgs([], 'https://youtube.com/watch?v=test');
  assert.equal(args[0], '--ignore-config');
  assert.deepEqual(args.slice(1, 3), ['--js-runtimes', `node:${process.execPath}`]);
  assert.deepEqual(args.slice(3, 5), ['--remote-components', 'ejs:github']);
  assert.ok(args.includes('--no-playlist'));
});

test('construit une recherche yt-dlp avec limite et cookies locaux', () => {
  const projectRoot = path.resolve(os.tmpdir(), 'bot-discord-search-test');
  const args = buildYtDlpSearchArgs([], 'Artiste - Titre', {
    projectRoot,
    cookiesPath: 'data/cookies.txt',
    limit: 3,
  });
  assert.ok(args.includes('--dump-single-json'));
  assert.ok(args.includes('--flat-playlist'));
  assert.equal(args[0], '--ignore-config');
  assert.deepEqual(args.slice(3, 5), ['--remote-components', 'ejs:github']);
  assert.ok(args.includes('--playlist-end'));
  assert.ok(args.includes('3'));
  assert.ok(args.includes('ytsearch3:Artiste - Titre'));
  assert.deepEqual(args.slice(args.indexOf('--cookies'), args.indexOf('--cookies') + 2), [
    '--cookies', path.join(projectRoot, 'data', 'cookies.txt'),
  ]);
});

test('parse les résultats JSON yt-dlp en URLs YouTube jouables', () => {
  const results = parseYtDlpSearch(JSON.stringify({ entries: [
    { id: 'abc1234', title: 'Titre', duration: 164, channel: 'Artiste' },
    { id: 'xyz9876', title: 'Autre titre', webpage_url: 'https://www.youtube.com/watch?v=xyz9876' },
  ] }));
  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://www.youtube.com/watch?v=abc1234');
  assert.equal(results[0].durationInSec, 164);
  assert.equal(results[0].channel.name, 'Artiste');
  assert.equal(results[1].url, 'https://www.youtube.com/watch?v=xyz9876');
});

test('le parser SoundCloud conserve les crédits artiste plutôt que seulement le diffuseur', () => {
  const [track] = parseYtDlpSearch(JSON.stringify({
    title: 'RR 9.1', duration: 200, uploader: 'Label', artist: 'Koba LaD',
    metadata_artist: 'Koba La D', publisher_metadata: { artist: 'Koba LaD, Niska' },
    webpage_url: 'https://soundcloud.com/label/rr91',
  }), 'soundcloud');
  assert.equal(track.artist, 'Koba LaD');
  assert.equal(track.metadata_artist, 'Koba La D');
  assert.deepEqual(track.publisher_metadata, { artist: 'Koba LaD, Niska' });
  assert.equal(track.channel.name, 'Label');
});

test('la recherche SoundCloud transmet réellement une limite de 25 à yt-dlp', async () => {
  let captured;
  const results = await searchSoundCloudCandidates('Koba LaD RR91', {
    limit: 25, candidates: [['fake-yt-dlp', []]],
    spawnImpl: (_command, args) => {
      captured = args;
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      setImmediate(() => {
        child.stdout.end(JSON.stringify({ entries: Array.from({ length: 25 }, (_, i) => ({
          title: `Piste ${i}`, webpage_url: `https://soundcloud.com/koba/track-${i}`, artist: 'Koba LaD',
        })) }));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  });
  assert.equal(results.length, 25);
  assert.equal(captured.at(-1), 'scsearch25:Koba LaD RR91');
  assert.ok(!captured.includes('--cookies'));
});

test('recherche playlists via yt-dlp sans parser play-dl ni envoyer de cookies de compte', async () => {
  let captured;
  const results = await searchYouTubePlaylists('Niska & Dinaz', {
    candidates: [['fake-yt-dlp', []]],
    spawnImpl: (command, args) => {
      captured = args;
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      setImmediate(() => {
        child.stdout.end(JSON.stringify({ entries: [null,
          { _type: 'playlist', id: 'PLabcdef123456', title: 'Playlist Niska', uploader: 'Créateur' },
          { id: 'abc12345678', title: 'Vidéo ignorée' },
        ] }));
        setImmediate(() => child.emit('close', 0));
      });
      return child;
    },
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://www.youtube.com/playlist?list=PLabcdef123456');
  const searchUrl = new URL(captured.at(-1));
  assert.equal(searchUrl.searchParams.get('search_query'), 'Niska & Dinaz');
  assert.equal(searchUrl.searchParams.get('sp'), 'EgIQAw==');
  assert.ok(!captured.includes('--cookies'));
});

test('le délai de recherche tue le processus et ne relance pas un deuxième binaire', async () => {
  let spawns = 0; let kills = 0;
  await assert.rejects(searchYouTubeCandidates('Niska', {
    timeoutMs: 100, candidates: [['fake-one', []], ['fake-two', []]],
    spawnImpl: () => {
      spawns++;
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { kills++; setImmediate(() => child.emit('close', null)); return true; };
      return child;
    },
  }), /délai/);
  assert.equal(spawns, 1); assert.equal(kills, 1);
});

test('recherche YouTube installe le binaire géré après ENOENT et conserve le cookie', async () => {
  const calls = [];
  const spawnOptions = [];
  const cookieCopies = [];
  let installs = 0;
  const cookieDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-search-cookie-'));
  const cookiePath = path.join(cookieDir, 'cookies.txt');
  const cookieContents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsource-cookie\n';
  await fs.writeFile(cookiePath, cookieContents);
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args });
    spawnOptions.push(options);
    const cookieIndex = args.indexOf('--cookies');
    const workingPath = args[cookieIndex + 1];
    cookieCopies.push({ path: workingPath, contents: fsSync.readFileSync(workingPath, 'utf8') });
    fsSync.writeFileSync(workingPath, '# yt-dlp rewrote its working cookie jar\n');
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      if (command !== 'managed-yt-dlp') {
        const error = new Error(`spawn ${command} ENOENT`);
        error.code = 'ENOENT';
        child.emit('error', error);
        return;
      }
      child.stdout.end(JSON.stringify({ entries: [{ id: 'abc1234', title: 'Titre', duration: 164 }] }));
      child.stderr.end();
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };

  try {
    const results = await searchYouTubeCandidates('Artiste - Titre', {
      candidates: [['yt-dlp', []]],
      cookiesPaths: [cookiePath],
      cookieTempDirectory: path.join(cookieDir, 'working-cookies'),
      runtimeTempDirectory: path.join(cookieDir, 'runtime'),
      install: async () => { installs++; return 'managed-yt-dlp'; },
      spawnImpl: fakeSpawn,
      limit: 1,
    });
    assert.equal(results[0].url, 'https://www.youtube.com/watch?v=abc1234');
    assert.equal(installs, 1);
    assert.equal(calls.length, 2);
    assert.ok(calls[1].args.includes('ytsearch1:Artiste - Titre'));
    assert.equal(cookieCopies.length, 2);
    assert.ok(cookieCopies.every(copy => copy.path !== cookiePath && copy.contents === cookieContents));
    assert.ok(cookieCopies.every(copy => copy.path.startsWith(path.join(cookieDir, 'working-cookies'))));
    assert.notEqual(cookieCopies[0].path, cookieCopies[1].path);
    assert.equal(spawnOptions.length, 2);
    for (const options of spawnOptions) {
      assert.equal(options.env.TMPDIR, path.join(cookieDir, 'runtime'));
      assert.equal(options.env.TEMP, path.join(cookieDir, 'runtime'));
      assert.equal(options.env.TMP, path.join(cookieDir, 'runtime'));
      assert.ok(options.env.PATH);
    }
    assert.equal((await fs.stat(path.join(cookieDir, 'runtime'))).isDirectory(), true);
    assert.equal(await fs.readFile(cookiePath, 'utf8'), cookieContents);
  } finally {
    await fs.rm(cookieDir, { recursive: true, force: true });
  }
});

test('le repli SoundCloud refuse les extraits courts et essaie un résultat complet ensuite', async () => {
  const opened = [];
  const selected = await soundCloudSearchStream('Artiste - Titre', {
    expectedDuration: 181,
    searchCandidates: async () => [
      { title: 'Artiste - Titre', permalink: 'https://soundcloud.com/example/preview', durationInSec: 29 },
      { title: 'Artiste - Titre', user: { username: 'Artiste' }, permalink: 'https://soundcloud.com/example/full-track', durationInSec: 180 },
    ],
    openTrack: async (url) => { opened.push(url); return new PassThrough(); },
  });
  assert.equal(opened.length, 1);
  assert.equal(opened[0], 'https://soundcloud.com/example/full-track');
  assert.equal(typeof selected.pipe, 'function');
  selected.destroy();
});

test('le repli SoundCloud échoue clairement si seuls des extraits courts correspondent', async () => {
  await assert.rejects(soundCloudSearchStream('Artiste - Titre', {
    expectedDuration: 181,
    searchCandidates: async () => [
      { title: 'Artiste - Titre', permalink: 'https://soundcloud.com/example/preview', durationInSec: 29 },
    ],
  }), /extraits trop courts/);
});

test('transmet la durée Spotify attendue au repli SoundCloud', async () => {
  let expectedDuration;
  const selected = await prepareInput('https://youtube.com/watch?v=abc1234', 'Artiste - Titre', {
    expectedDuration: 181,
    getYouTubeStream: async () => { throw new Error('YouTube indisponible'); },
    searchSoundCloudStream: async (_query, options) => {
      expectedDuration = options.expectedDuration;
      return new PassThrough();
    },
  });
  assert.equal(expectedDuration, 181);
  assert.equal(selected.fallback, true);
  selected.stream.destroy();
});

test('une erreur ENOSPC arrête immédiatement les essais yt-dlp et donne une indication utile', async () => {
  let spawnCalls = 0;
  let installCalls = 0;
  const spawnImpl = () => {
    spawnCalls++;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      const error = new Error('spawn yt-dlp ENOSPC');
      error.code = 'ENOSPC';
      child.emit('error', error);
    });
    return child;
  };

  await assert.rejects(searchYouTubeCandidates('Artiste - Titre', {
    candidates: [['yt-dlp', []], ['python3', ['-m', 'yt_dlp']], ['fallback', []]],
    cookiesPaths: [],
    install: async () => { installCalls++; throw new Error('ne doit pas installer'); },
    spawnImpl,
  }), error => {
    assert.equal(error.code, 'ENOSPC');
    assert.match(error.message, /volume de données et du dossier temporaire/);
    return true;
  });
  assert.equal(spawnCalls, 1);
  assert.equal(installCalls, 0);
});

test('une erreur ENOSPC sur un flux ne déclenche pas un second lancement yt-dlp', async () => {
  let spawnCalls = 0;
  const spawnImpl = () => {
    spawnCalls++;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      const error = new Error('spawn yt-dlp ENOSPC');
      error.code = 'ENOSPC';
      child.emit('error', error);
    });
    return child;
  };

  await assert.rejects(streamUrl('https://www.youtube.com/watch?v=test', {
    candidates: [['yt-dlp', []], ['fallback', []]],
    cookiesPaths: [],
    install: async () => { throw new Error('ne doit pas installer'); },
    spawnImpl,
  }), error => error.code === 'ENOSPC' && error.resourceExhausted);
  assert.equal(spawnCalls, 1);
});

test('une erreur YouTube utile n’est pas masquée par un binaire yt-dlp absent', async () => {
  const fakeSpawn = (command) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      if (command === 'broken-extractor') {
        child.stdout.end();
        child.stderr.end('HTTP 403 Forbidden');
        setImmediate(() => child.emit('close', 1));
        return;
      }
      const error = new Error(`spawn ${command} ENOENT`);
      error.code = 'ENOENT';
      child.emit('error', error);
    });
    return child;
  };

  await assert.rejects(searchYouTubeCandidates('Artiste - Titre', {
    candidates: [['broken-extractor', []], ['yt-dlp', []]],
    install: async () => { throw new Error('ne doit pas installer après une vraie erreur'); },
    spawnImpl: fakeSpawn,
    cookiesPaths: [],
  }), /HTTP 403 Forbidden/);
});

test('n’ajoute les cookies YouTube que si un chemin local est configuré', () => {
  const projectRoot = path.resolve(os.tmpdir(), 'bot-discord-cookie-test');
  const args = buildYtDlpArgs([], 'https://youtube.com/watch?v=test', {
    cookiesPath: 'private/youtube-cookies.txt',
    projectRoot,
  });
  const cookieIndex = args.indexOf('--cookies');
  assert.deepEqual(args.slice(cookieIndex, cookieIndex + 2), ['--cookies', path.join(projectRoot, 'private', 'youtube-cookies.txt')]);
  assert.ok(!buildYtDlpArgs([], 'https://youtube.com/watch?v=test', { cookiesPath: '' }).includes('--cookies'));
  assert.ok(!buildYtDlpArgs([], 'https://example.com/audio', { cookiesPath: 'private/youtube-cookies.txt' }).includes('--cookies'));
});

test('détecte le fichier de cookies privé par défaut dans data/', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-cookies-'));
  const cookiePath = path.join(projectRoot, 'data', 'youtube-cookies.txt');
  await fs.mkdir(path.dirname(cookiePath), { recursive: true });
  await fs.writeFile(cookiePath, '# test uniquement\n');

  try {
    assert.equal(getYouTubeCookiesPath({ env: {}, projectRoot }), cookiePath);
    const args = buildYtDlpArgs([], 'https://youtube.com/watch?v=test', { projectRoot, env: {} });
    const cookieIndex = args.indexOf('--cookies');
    assert.deepEqual(args.slice(cookieIndex, cookieIndex + 2), ['--cookies', cookiePath]);
    assert.equal(getYouTubeCookiesPath({ env: { YOUTUBE_COOKIES_PATH: 'private/session.txt' }, projectRoot }),
      path.join(projectRoot, 'private', 'session.txt'));
    assert.deepEqual(getYouTubeCookiesPaths({
      env: { YOUTUBE_COOKIES_PATH: 'private/account.txt;private/backup.txt' }, projectRoot,
    }), [
      path.join(projectRoot, 'private', 'account.txt'),
      path.join(projectRoot, 'private', 'backup.txt'),
    ]);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
});

test('SoundCloud reste désactivé proprement si aucun identifiant client n’est fourni', () => {
  assert.equal(getSoundCloudClientId({}), '');
  assert.equal(getSoundCloudClientId({ SOUNDCLOUD_CLIENT_ID: '  test-client  ' }), 'test-client');
});

test('installe yt-dlp après les erreurs ENOENT puis réessaie la lecture', async () => {
  const calls = [];
  let installs = 0;
  const fakeSpawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      if (command === 'python3') {
        child.stdout.end();
        child.stderr.end("No module named 'yt_dlp'");
        setImmediate(() => child.emit('close', 1));
        return;
      }
      if (command !== 'managed-yt-dlp') {
        const error = new Error(`spawn ${command} ENOENT`);
        error.code = 'ENOENT';
        child.emit('error', error);
        return;
      }
      child.stdout.end('https://audio.example/stream\n');
      child.stderr.end();
      setImmediate(() => child.emit('close', 0));
    });
    return child;
  };

  const audioUrl = await streamUrl('https://youtube.com/watch?v=test', {
    candidates: [['yt-dlp', []], ['python3', ['-m', 'yt_dlp']]],
    install: async () => { installs++; return 'managed-yt-dlp'; },
    spawnImpl: fakeSpawn,
  });
  assert.equal(audioUrl, 'https://audio.example/stream');
  assert.equal(installs, 1);
  assert.equal(calls.length, 3);
});

test('ne tente pas de réinstaller yt-dlp si YouTube bloque une version déjà présente', async () => {
  let installs = 0;
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.end();
      child.stderr.end('Sign in to confirm you are not a bot');
      setImmediate(() => child.emit('close', 1));
    });
    return child;
  };

  await assert.rejects(streamUrl('https://youtube.com/watch?v=test', {
    candidates: [['yt-dlp', []]],
    install: async () => { installs++; return 'managed-yt-dlp'; },
    spawnImpl: fakeSpawn,
  }), error => error.code === 'YOUTUBE_AUTH_BLOCKED' && /YouTube réclame une authentification/.test(error.message));
  assert.equal(installs, 0);
});

test('journalise la cause du repli YouTube en masquant cookies, jetons et URLs', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-yt-dlp-diagnostic-'));
  const cookiesPath = path.join(dataDir, 'cookies.txt');
  await fs.writeFile(cookiesPath, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-test-cookie\n');
  const warnings = [];
  const originalWarn = console.warn;
  let attempt = 0;
  console.warn = (...args) => warnings.push(args.join(' '));

  const fakeSpawn = (_command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      attempt++;
      child.stdout.end();
      child.stderr.end(attempt === 1
        ? 'Sign in to confirm you are not a bot'
        : 'Sign in to confirm you are not a bot; ERROR: challenge solver failed https://example.test/path?token=private-token\nCookie: SID=private-cookie');
      setImmediate(() => child.emit('close', 1));
    });
    return child;
  };

  try {
    await assert.rejects(streamUrl('https://youtube.com/watch?v=test', {
      candidates: [['yt-dlp', []]],
      cookiesPaths: [cookiesPath],
      cookieTempDirectory: path.join(dataDir, 'working-cookies'),
      install: async () => { throw new Error('should not install'); },
      spawnImpl: fakeSpawn,
    }), error => error.code === 'YOUTUBE_AUTH_BLOCKED');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cookies=readable,/);
    assert.match(warnings[0], /challenge solver failed/);
    assert.doesNotMatch(warnings[0], /private-token|private-cookie|example\.test/);
  } finally {
    console.warn = originalWarn;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('réessaie une vidéo YouTube bloquée avec le client intégré sans compte', async () => {
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.end(args.includes('youtube:player_client=web_embedded')
        ? 'https://audio.example/stream\n'
        : '');
      child.stderr.end(args.includes('youtube:player_client=web_embedded')
        ? ''
        : '-from-browser or --cookies for the authentication. See https://github.com/yt-dlp/yt-dlp/wiki/FAQ');
      setImmediate(() => child.emit('close', args.includes('youtube:player_client=web_embedded') ? 0 : 1));
    });
    return child;
  };

  const audioUrl = await streamUrl('https://www.youtube.com/watch?v=test', {
    candidates: [['yt-dlp', []]],
    install: async () => { throw new Error('should not install'); },
    spawnImpl: fakeSpawn,
  });
  assert.equal(audioUrl, 'https://audio.example/stream');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes('youtube:player_client=web_embedded'));
});

test('ne renvoie pas un cookie refusé dans le dernier essai YouTube sans compte', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-rejected-cookie-'));
  const cookiesPath = path.join(directory, 'cookies.txt');
  await fs.writeFile(cookiesPath, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-cookie\n');
  const calls = [];
  const originalWarn = console.warn;
  console.warn = () => {};

  const fakeSpawn = (_command, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      const embeddedWithoutCookies = args.includes('--extractor-args')
        && args.includes('youtube:player_client=web_embedded')
        && !args.includes('--cookies');
      const success = embeddedWithoutCookies;
      child.stdout.end(success ? 'https://audio.example/stream\n' : '');
      child.stderr.end(success ? '' : 'Sign in to confirm you are not a bot');
      setImmediate(() => child.emit('close', success ? 0 : 1));
    });
    return child;
  };

  try {
    const audioUrl = await streamUrl('https://youtube.com/watch?v=test', {
      candidates: [['yt-dlp', []]],
      cookiesPaths: [cookiesPath],
      cookieTempDirectory: path.join(directory, 'working-cookies'),
      install: async () => { throw new Error('should not install'); },
      spawnImpl: fakeSpawn,
    });
    assert.equal(audioUrl, 'https://audio.example/stream');
    assert.equal(calls.length, 3, 'sans cookie, cookie de secours, puis client intégré sans cookie');
    assert.ok(!calls[0].includes('--cookies'));
    assert.ok(calls[1].includes('--cookies'));
    assert.ok(calls[2].includes('youtube:player_client=web_embedded'));
    assert.ok(!calls[2].includes('--cookies'));
  } finally {
    console.warn = originalWarn;
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('essaie le deuxième fichier cookies quand le premier compte est refusé', async () => {
  const cookieDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-cookie-fallback-'));
  const first = path.join(cookieDir, 'account-1.txt');
  const second = path.join(cookieDir, 'account-2.txt');
  const firstContents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfirst-account\n';
  const secondContents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecond-account\n';
  await fs.writeFile(first, firstContents);
  await fs.writeFile(second, secondContents);
  const calls = [];
  const fakeSpawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      const cookieIndex = args.indexOf('--cookies');
      const workingPath = cookieIndex >= 0 ? args[cookieIndex + 1] : '';
      const workingContents = workingPath ? fsSync.readFileSync(workingPath, 'utf8') : '';
      const accepted = workingContents === secondContents;
      if (workingPath) fsSync.writeFileSync(workingPath, '# yt-dlp rewrote its working cookie jar\n');
      child.stdout.end(accepted ? 'https://audio.example/stream\n' : '');
      child.stderr.end(accepted ? '' : 'Sign in to confirm you are not a bot');
      setImmediate(() => child.emit('close', accepted ? 0 : 1));
    });
    return child;
  };

  try {
    const audioUrl = await streamUrl('https://youtube.com/watch?v=test', {
      candidates: [['yt-dlp', []]],
      cookiesPaths: [first, second],
      cookieTempDirectory: path.join(cookieDir, 'working-cookies'),
      install: async () => { throw new Error('should not install'); },
      spawnImpl: fakeSpawn,
    });
    assert.equal(audioUrl, 'https://audio.example/stream');
    assert.equal(calls.length, 3);
    assert.ok(!calls[0].args.includes('--cookies'));
    assert.notEqual(calls[1].args[calls[1].args.indexOf('--cookies') + 1], first);
    assert.notEqual(calls[2].args[calls[2].args.indexOf('--cookies') + 1], second);
    assert.equal(await fs.readFile(first, 'utf8'), firstContents);
    assert.equal(await fs.readFile(second, 'utf8'), secondContents);
  } finally {
    await fs.rm(cookieDir, { recursive: true, force: true });
  }
});

test('lit uniquement le checksum de l’asset demandé', () => {
  const digest = 'a'.repeat(64);
  assert.equal(parseChecksum(`${'b'.repeat(64)}  autre-fichier\n${digest} *yt-dlp_linux`, 'yt-dlp_linux'), digest);
  assert.throws(() => parseChecksum(`${digest}  autre-fichier`, 'yt-dlp_linux'), /absent/);
});

test('recherche YouTubei prend le relais si la recherche yt-dlp échoue sur le serveur', async () => {
  const results = await searchYouTubeCandidates('Niska - Chasse à l’homme', {
    cookiesPaths: [], candidates: [['fake-yt-dlp', []]],
    install: async () => { throw new Error('yt-dlp already attempted'); },
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      setImmediate(() => { child.stderr.end('ENOSPC'); child.emit('close', 1); });
      return child;
    },
    youtubeiSearch: async (query, options) => {
      assert.equal(query, 'Niska - Chasse à l’homme'); assert.equal(options.limit, 5);
      return [{ title: 'Niska - Chasse à l’homme #KeDuSal 2', url: 'https://youtu.be/abcdefghijk', duration: 181 }];
    },
  });
  assert.equal(results[0].url, 'https://youtu.be/abcdefghijk');
});

test('un titre public ne lit jamais le fichier de cookies invalide, dans les deux modes audio', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-public-audio-'));
  const invalidCookies = path.join(directory, 'cookies.txt');
  await fs.writeFile(invalidCookies, '{"invalid":"not-a-cookie-export"}');
  try {
    for (const open of [streamUrl, streamYtDlp]) {
      const calls = [];
      const result = await open('https://youtube.com/watch?v=test', {
        candidates: [['test-yt-dlp', []]], cookiesPaths: [invalidCookies],
        cookieTempDirectory: path.join(directory, 'should-not-exist'),
        spawnImpl: (_command, args) => {
          calls.push(args);
          const child = new EventEmitter();
          child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
          setImmediate(() => {
            child.stdout.end(open === streamUrl ? 'https://audio.example/stream\n' : Buffer.from('test-audio'));
            child.stderr.end(); setImmediate(() => child.emit('close', 0));
          });
          return child;
        },
        install: async () => assert.fail('Un binaire disponible ne doit pas être réinstallé'),
      });
      assert.equal(calls.length, 1);
      assert.ok(calls[0].includes('--ignore-config'));
      assert.ok(!calls[0].includes('--cookies'));
      if (typeof result !== 'string') {
        assert.equal(result.youtubeAuthentication, 'anonymous');
        result.cleanup(); result.destroy();
      }
    }
    assert.equal(fsSync.existsSync(path.join(directory, 'should-not-exist')), false);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('la lecture stdout tente les cookies seulement après le refus sans compte', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-pipe-cookies-'));
  const cookies = path.join(directory, 'cookies.txt');
  const contents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\ttest-only-session\n';
  await fs.writeFile(cookies, contents);
  const calls = [];
  let stream;
  try {
    stream = await streamYtDlp('https://youtube.com/watch?v=test', {
      candidates: [['test-yt-dlp', []]], cookiesPaths: [cookies],
      cookieTempDirectory: path.join(directory, 'working'),
      spawnImpl: (_command, args) => {
        calls.push(args);
        const child = new EventEmitter();
        child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
        setImmediate(() => {
          const accepted = args.includes('--cookies');
          child.stdout.end(accepted ? Buffer.from('test-audio') : undefined);
          child.stderr.end(accepted ? '' : 'Sign in to confirm your age');
          setImmediate(() => child.emit('close', accepted ? 0 : 1));
        });
        return child;
      },
    });
    assert.equal(calls.length, 2);
    assert.ok(!calls[0].includes('--cookies'));
    assert.ok(calls[1].includes('--cookies'));
    assert.equal(stream.youtubeAuthentication, 'cookies');
    assert.equal(await fs.readFile(cookies, 'utf8'), contents);
  } finally {
    stream?.cleanup?.(); stream?.destroy?.();
    await new Promise(resolve => setImmediate(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('télécharge le binaire, vérifie SHA-256 et le met en cache dans le dossier de données', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-ytdlp-'));
  const binary = Buffer.from('faux binaire yt-dlp pour le test');
  const digest = crypto.createHash('sha256').update(binary).digest('hex');
  const manifest = Buffer.from(`${digest} *yt-dlp_linux\n`);
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    return new Response(url.endsWith('SHA2-256SUMS') ? manifest : binary, { status: 200 });
  };

  try {
    const executable = await ensureManagedYtDlp({ platform: 'linux', arch: 'x64', dataDir, fetchImpl });
    assert.equal(await fs.readFile(executable, 'utf8'), binary.toString());
    assert.equal(requested.length, 2);
    assert.ok(requested.some((url) => url.endsWith('/yt-dlp_linux')));
    assert.ok(requested.some((url) => url.endsWith('/SHA2-256SUMS')));
    assert.match(executable, /\.cache[\\/]yt-dlp[\\/]yt-dlp$/);

    const callsBeforeReuse = requested.length;
    assert.equal(await ensureManagedYtDlp({ platform: 'linux', arch: 'x64', dataDir, fetchImpl }), executable);
    assert.equal(requested.length, callsBeforeReuse);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('refuse un fichier dont le checksum ne correspond pas et ne le met pas en cache', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-ytdlp-bad-hash-'));
  const fetchImpl = async (url) => new Response(
    url.endsWith('SHA2-256SUMS') ? `${'0'.repeat(64)} *yt-dlp_linux\n` : 'binary modifié',
    { status: 200 },
  );

  try {
    await assert.rejects(
      ensureManagedYtDlp({ platform: 'linux', arch: 'x64', dataDir, fetchImpl }),
      /checksum .* ne correspond pas/,
    );
    await assert.rejects(fs.stat(path.join(dataDir, '.cache', 'yt-dlp', 'yt-dlp')), { code: 'ENOENT' });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
