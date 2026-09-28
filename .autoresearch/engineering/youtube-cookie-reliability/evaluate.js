'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');

delete process.env.YOUTUBE_COOKIES_PATH;

const projectRoot = path.resolve(__dirname, '../../..');
const {
  buildYtDlpArgs,
  getYouTubeCookiesPaths,
  searchYouTubeCandidates,
  streamUrl,
} = require(path.join(projectRoot, 'utils', 'audioSender'));

const scenarios = [];
let passed = 0;

function scenario(name, run) {
  scenarios.push({ name, run });
}

async function withTempDir(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bot-cookie-eval-'));
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

function fakeSpawn(handler, calls) {
  return (command, args) => {
    calls.push({ command, args: [...args] });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(async () => {
      try {
        const result = await handler(command, args);
        child.stdout.end(result.stdout || '');
        child.stderr.end(result.stderr || '');
        setImmediate(() => child.emit('close', result.code === undefined ? 0 : result.code));
      } catch (error) {
        child.emit('error', error);
      }
    });
    return child;
  };
}

function noInstall() {
  throw new Error('Unexpected yt-dlp installation in a cookie-only test');
}

function searchResult() {
  return JSON.stringify({
    entries: [{ id: 'fixture123', title: 'Synthetic track', duration: 123 }],
  });
}

scenario('copies a jar to a private working file and preserves its source', async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, 'source.txt');
    const contents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsynthetic-source\n';
    await fs.writeFile(source, contents);
    const calls = [];
    const url = await streamUrl('https://youtube.com/watch?v=fixture', {
      candidates: [['fake-yt-dlp', []]],
      cookiesPaths: [source],
      install: noInstall,
      spawnImpl: fakeSpawn((_command, args) => {
        const index = args.indexOf('--cookies');
        assert.notEqual(index, -1);
        assert.notEqual(args[index + 1], source);
        assert.equal(fsSync.readFileSync(args[index + 1], 'utf8'), contents);
        fsSync.writeFileSync(args[index + 1], '# rewritten fake jar\n');
        return { stdout: 'https://audio.example/fixture\n' };
      }, calls),
    });
    assert.equal(url, 'https://audio.example/fixture');
    assert.equal(calls.length, 1);
    assert.equal(await fs.readFile(source, 'utf8'), contents);
  });
});

scenario('tries a second configured jar after the first one is rejected', async () => {
  await withTempDir(async (directory) => {
    const first = path.join(directory, 'first.txt');
    const second = path.join(directory, 'second.txt');
    await fs.writeFile(first, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-one\n');
    const secondContents = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-two\n';
    await fs.writeFile(second, secondContents);
    const calls = [];
    const url = await streamUrl('https://youtube.com/watch?v=fixture', {
      candidates: [['fake-yt-dlp', []]],
      cookiesPaths: [first, second],
      install: noInstall,
      spawnImpl: fakeSpawn((_command, args) => {
        const index = args.indexOf('--cookies');
        assert.notEqual(index, -1);
        const contents = fsSync.readFileSync(args[index + 1], 'utf8');
        return contents === secondContents
          ? { stdout: 'https://audio.example/fixture\n' }
          : { code: 1, stderr: 'Sign in to confirm you are not a bot' };
      }, calls),
    });
    assert.equal(url, 'https://audio.example/fixture');
    assert.equal(calls.length, 2);
  });
});

scenario('a missing jar does not trigger installation or block playback without cookies', async () => {
  await withTempDir(async (directory) => {
    const missing = path.join(directory, 'missing.txt');
    const calls = [];
    const url = await streamUrl('https://youtube.com/watch?v=fixture', {
      candidates: [['fake-yt-dlp', []]],
      cookiesPaths: [missing],
      install: noInstall,
      spawnImpl: fakeSpawn((_command, args) => {
        assert.equal(args.includes('--cookies'), false);
        return { stdout: 'https://audio.example/fixture\n' };
      }, calls),
    });
    assert.equal(url, 'https://audio.example/fixture');
    assert.equal(calls.length, 1);
  });
});

scenario('a rejected account jar falls back to playback without cookies', async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, 'account.txt');
    await fs.writeFile(source, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-account\n');
    const calls = [];
    const url = await streamUrl('https://youtube.com/watch?v=fixture', {
      candidates: [['fake-yt-dlp', []]],
      cookiesPaths: [source],
      install: noInstall,
      spawnImpl: fakeSpawn((_command, args) => args.includes('--cookies')
        ? { code: 1, stderr: 'Sign in to confirm you are not a bot' }
        : { stdout: 'https://audio.example/fixture\n' }, calls),
    });
    assert.equal(url, 'https://audio.example/fixture');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.includes('--cookies'), false);
  });
});

scenario('a missing jar does not block YouTube search or install a binary', async () => {
  await withTempDir(async (directory) => {
    const calls = [];
    const results = await searchYouTubeCandidates('synthetic query', {
      candidates: [['fake-yt-dlp', []]],
      cookiesPaths: [path.join(directory, 'missing.txt')],
      install: noInstall,
      spawnImpl: fakeSpawn((_command, args) => {
        assert.equal(args.includes('--cookies'), false);
        return { stdout: searchResult() };
      }, calls),
      limit: 1,
    });
    assert.equal(results[0].url, 'https://www.youtube.com/watch?v=fixture123');
    assert.equal(calls.length, 1);
  });
});

scenario('YouTube search retries without cookies after an account jar is refused', async () => {
  await withTempDir(async (directory) => {
    const source = path.join(directory, 'account.txt');
    await fs.writeFile(source, '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfake-account\n');
    const calls = [];
    const results = await searchYouTubeCandidates('synthetic query', {
      candidates: [['fake-yt-dlp', []]],
      cookiesPaths: [source],
      install: noInstall,
      spawnImpl: fakeSpawn((_command, args) => args.includes('--cookies')
        ? { code: 1, stderr: 'Sign in to confirm you are not a bot' }
        : { stdout: searchResult() }, calls),
      limit: 1,
    });
    assert.equal(results[0].url, 'https://www.youtube.com/watch?v=fixture123');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].args.includes('--cookies'), false);
  });
});

scenario('splits, resolves and deduplicates configured cookie paths', async () => {
  await withTempDir(async (directory) => {
    const first = path.join(directory, 'one.txt');
    const second = path.join(directory, 'two.txt');
    const paths = getYouTubeCookiesPaths({
      env: { YOUTUBE_COOKIES_PATH: first + '; ' + second + ';' + first },
      projectRoot: directory,
    });
    assert.deepEqual(paths, [first, second]);
  });
});

scenario('detects the private default cookie jar under data/', async () => {
  await withTempDir(async (directory) => {
    const expected = path.join(directory, 'data', 'youtube-cookies.txt');
    await fs.mkdir(path.dirname(expected), { recursive: true });
    await fs.writeFile(expected, '# synthetic fixture\n');
    assert.deepEqual(getYouTubeCookiesPaths({ env: {}, projectRoot: directory }), [expected]);
  });
});

scenario('does not attach YouTube cookies to non-YouTube media URLs', async () => {
  await withTempDir(async (directory) => {
    const args = buildYtDlpArgs([], 'https://media.example/audio', {
      cookiesPath: 'data/synthetic.txt',
      projectRoot: directory,
    });
    assert.equal(args.includes('--cookies'), false);
  });
});

async function main() {
  for (const item of scenarios) {
    try {
      await item.run();
      passed++;
      console.log('PASS ' + item.name);
    } catch (error) {
      console.log('FAIL ' + item.name + ': ' + String(error.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240));
    }
  }

  console.log('cookie_cases_passed: ' + passed);
  console.log('cookie_cases_total: ' + scenarios.length);

  const suite = spawnSync('npm test', {
    cwd: projectRoot,
    shell: true,
    windowsHide: true,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (suite.stdout) process.stdout.write(suite.stdout);
  if (suite.stderr) process.stderr.write(suite.stderr);
  if (suite.error) {
    console.error('npm test could not run: ' + suite.error.message);
    process.exitCode = 1;
  } else if (suite.status !== 0) {
    process.exitCode = suite.status || 1;
  }
}

main().catch((error) => {
  console.error('Cookie reliability evaluation failed: ' + error.message);
  process.exitCode = 1;
});
