const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveQuery, youtubeVideoId, normalizeSoundCloudTrack, resolveDeezerTracks } = require('../features/music/resolve');

test('un lien YouTube direct récupère un titre public pour permettre le repli audio', async () => {
  const url = 'https://www.youtube.com/watch?v=abc123';
  assert.equal(youtubeVideoId(url), 'abc123');
  let requestedUrl;
  const songs = await resolveQuery(url, {
    fetchImpl: async (requested, options) => {
      requestedUrl = new URL(requested);
      assert.equal(options.headers.accept, 'application/json');
      assert.ok(options.signal);
      return new Response(JSON.stringify({
        title: 'Chasse à l’homme',
        author_name: 'Niska',
        thumbnail_url: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(requestedUrl.origin, 'https://www.youtube.com');
  assert.equal(requestedUrl.pathname, '/oembed');
  assert.deepEqual(songs, [{
    title: 'Chasse à l’homme',
    url,
    duration: 0,
    thumbnail: 'https://i.ytimg.com/vi/abc123/hqdefault.jpg',
    source: 'youtube',
    fallbackQuery: 'Niska - Chasse à l’homme',
  }]);
});

test('un lien YouTube reste jouable même si ses métadonnées publiques sont indisponibles', async () => {
  const url = 'https://youtu.be/abc123';
  const songs = await resolveQuery(url, { fetchImpl: async () => { throw new Error('réseau indisponible'); } });
  assert.equal(songs[0].url, url);
  assert.equal(songs[0].title, 'YouTube · abc123');
  assert.equal(songs[0].fallbackQuery, undefined);
});

test('les pistes SoundCloud conservent artiste et titre pour un repli YouTube', () => {
  const song = normalizeSoundCloudTrack({
    name: 'Track',
    permalink: 'https://soundcloud.com/artist/track',
    durationInSec: 180,
    user: { username: 'Artist' },
  });
  assert.equal(song.source, 'soundcloud');
  assert.equal(song.fallbackQuery, 'Artist - Track');
});

test('une recherche YouTube Deezer mal formée ignore la piste et conserve les résultats valides', async () => {
  const failures = [];
  const songs = await resolveDeezerTracks([
    { title: 'Piste indisponible', artist: { name: 'Artiste' }, durationInSec: 180 },
    { title: 'Piste lisible', artist: { name: 'Artiste' }, durationInSec: 200 },
  ], {
    search: async (query) => {
      if (query.endsWith('Piste indisponible')) {
        throw new TypeError("Cannot read properties of undefined (reading 'browseId')");
      }
      return [{ url: 'https://www.youtube.com/watch?v=good123', durationInSec: 201 }];
    },
    onSearchError: (trackName, error) => failures.push({ trackName, error }),
    searchSoundCloud: async () => [],
  });

  assert.equal(songs.length, 1);
  assert.equal(songs[0].title, 'Piste lisible - Artiste');
  assert.equal(songs[0].url, 'https://www.youtube.com/watch?v=good123');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].trackName, 'Artiste - Piste indisponible');
  assert.match(failures[0].error.message, /browseId/);
});

test('toutes les recherches Deezer invalides renvoient une erreur exploitable', async () => {
  await assert.rejects(resolveDeezerTracks([
    { title: 'Piste indisponible', artist: { name: 'Artiste' } },
  ], {
    search: async () => { throw new TypeError('résultat YouTube mal formé'); },
    searchSoundCloud: async () => { throw new Error('SoundCloud indisponible'); },
    onSearchError() {},
  }), /Aucun équivalent audio public trouvé sur YouTube ou SoundCloud pour ce lien Deezer/);
});

test('un titre Deezer bascule vers SoundCloud après une erreur browseId ou une recherche vide', async () => {
  for (const fails of [true, false]) {
    const songs = await resolveDeezerTracks([{ title: 'Titre', artist: { name: 'Artiste' } }], {
      search: async () => {
        if (fails) throw new TypeError("Cannot read properties of undefined (reading 'browseId')");
        return [];
      },
      searchSoundCloud: async (query) => {
        assert.equal(query, 'Artiste - Titre');
        return [{ permalink: 'https://example.com/invalid' }, { permalink: 'https://soundcloud.com/artist/track' }];
      },
      onSearchError() {},
    });
    assert.equal(songs[0].url, 'https://soundcloud.com/artist/track');
    assert.equal(songs[0].fallbackQuery, 'Artiste - Titre');
  }
});
