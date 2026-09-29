const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { ensureManagedYtDlp, parseChecksum, releaseAsset } = require('../features/music/ytDlp');
const {
  buildYtDlpArgs,
  buildYtDlpSearchArgs,
  getYouTubeCookiesPath,
  getYouTubeCookiesPaths,
  parseYtDlpSearch,
  searchYouTubeCandidates,
  streamUrl,
} = require('../features/music/audioSender');
const { getSoundCloudClientId } = require('../features/music/providers/soundcloud');

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
  assert.deepEqual(args.slice(0, 2), ['--js-runtimes', `node:${process.execPath}`]);
  assert.deepEqual(args.slice(2, 4), ['--remote-components', 'ejs:github']);
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
  assert.deepEqual(args.slice(2, 4), ['--remote-components', 'ejs:github']);
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

test('recherche YouTube installe le binaire géré après ENOENT et conserve le cookie', async () => {
  const calls = [];
  const cookieCopies = [];
  let installs = 0;
  const cookieDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-discord-search-cookie-'));
  const cookiePath = path.join(cookieDir, 'cookies.txt');
  const cookieContents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsource-cookie\n';
  await fs.writeFile(cookiePath, cookieContents);
  const fakeSpawn = (command, args) => {
    calls.push({ command, args });
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
    assert.notEqual(cookieCopies[0].path, cookieCopies[1].path);
    assert.equal(await fs.readFile(cookiePath, 'utf8'), cookieContents);
  } finally {
    await fs.rm(cookieDir, { recursive: true, force: true });
  }
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
  await fs.writeFile(cookiesPath, '# Netscape HTTP Cookie File\n');
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
        : 'ERROR: challenge solver failed https://example.test/path?token=private-token\nCookie: SID=private-cookie');
      setImmediate(() => child.emit('close', 1));
    });
    return child;
  };

  try {
    await assert.rejects(streamUrl('https://youtube.com/watch?v=test', {
      candidates: [['yt-dlp', []]],
      cookiesPaths: [cookiesPath],
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
      install: async () => { throw new Error('should not install'); },
      spawnImpl: fakeSpawn,
    });
    assert.equal(audioUrl, 'https://audio.example/stream');
    assert.equal(calls.length, 3, 'cookie, sans cookie, puis client intégré sans cookie');
    assert.ok(calls[0].includes('--cookies'));
    assert.ok(!calls[1].includes('--cookies'));
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
      const workingPath = args[cookieIndex + 1];
      const workingContents = fsSync.readFileSync(workingPath, 'utf8');
      const accepted = workingContents === secondContents;
      fsSync.writeFileSync(workingPath, '# yt-dlp rewrote its working cookie jar\n');
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
      install: async () => { throw new Error('should not install'); },
      spawnImpl: fakeSpawn,
    });
    assert.equal(audioUrl, 'https://audio.example/stream');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].args[calls[0].args.indexOf('--cookies') + 1], first);
    assert.notEqual(calls[1].args[calls[1].args.indexOf('--cookies') + 1], second);
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
