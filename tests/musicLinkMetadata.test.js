const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getMusicInputInfo, formatMusicAttempt, resolveMusicLinkMetadata, sanitizeDiagnosticText } = require('../utils/musicLinkMetadata');
const { parseSpotifyUrl } = require('../utils/spotify');

test('Spotify reconnaît les liens localisés et les URI spotify:', () => {
  assert.deepEqual(parseSpotifyUrl('https://open.spotify.com/intl-fr/track/518c5Dr5EmpzACX268Aeqs?si=private'), {
    type: 'track', id: '518c5Dr5EmpzACX268Aeqs',
  });
  assert.deepEqual(parseSpotifyUrl('spotify:album:4xabc123'), { type: 'album', id: '4xabc123' });
});

test('un lien YouTube est converti en recherche artiste-titre via ses métadonnées publiques', async () => {
  let requestUrl;
  const metadata = await resolveMusicLinkMetadata('https://youtu.be/epmR0g3udAk?si=PRIVATE_TRACKING', {
    fetchImpl: async (url, options) => {
      requestUrl = new URL(url);
      assert.ok(options.signal);
      return { ok: true, json: async () => ({ title: 'Chasse à l’homme', author_name: 'Niska' }) };
    },
  });
  assert.equal(requestUrl.origin, 'https://www.youtube.com');
  assert.equal(requestUrl.pathname, '/oembed');
  assert.match(requestUrl.searchParams.get('url'), /watch\?v=epmR0g3udAk/);
  assert.deepEqual(metadata, {
    provider: 'youtube', kind: 'track', title: 'Chasse à l’homme', artist: 'Niska',
    searchQuery: 'Niska - Chasse à l’homme',
  });
});

test('un lien Spotify /intl-fr est interrogé par son URL canonique et renvoie un titre', async () => {
  const metadata = await resolveMusicLinkMetadata('https://open.spotify.com/intl-fr/track/518c5Dr5EmpzACX268Aeqs?si=PRIVATE', {
    fetchImpl: async (url) => {
      const request = new URL(url);
      assert.equal(request.origin, 'https://open.spotify.com');
      assert.equal(request.pathname, '/oembed');
      assert.equal(request.searchParams.get('url'), 'https://open.spotify.com/track/518c5Dr5EmpzACX268Aeqs');
      return { ok: true, json: async () => ({ title: 'Dracula (with JENNIE) - Tame Impala' }) };
    },
  });
  assert.equal(metadata.searchQuery, 'Dracula (with JENNIE) - Tame Impala');
});

test('un lien Deezer de morceau est normalisé en artiste et titre', async () => {
  const metadata = await resolveMusicLinkMetadata('https://www.deezer.com/track/123456?utm_source=private', {
    fetchImpl: async (url) => {
      assert.equal(url, 'https://api.deezer.com/track/123456');
      return { ok: true, json: async () => ({ title: 'Chasse à l’homme', artist: { name: 'Niska' } }) };
    },
  });
  assert.equal(metadata.searchQuery, 'Niska - Chasse à l’homme');
});

test('un lien SoundCloud public est converti depuis ses métadonnées oEmbed', async () => {
  const metadata = await resolveMusicLinkMetadata('https://soundcloud.com/artist/song?secret_token=PRIVATE', {
    fetchImpl: async (url, options) => {
      const request = new URL(url);
      assert.equal(request.origin, 'https://soundcloud.com');
      assert.equal(request.pathname, '/oembed');
      assert.match(request.searchParams.get('url'), /soundcloud\.com\/artist\/song/);
      assert.ok(options.signal);
      return { ok: true, json: async () => ({ title: 'Song by Artist', author_name: 'Artist' }) };
    },
  });
  assert.equal(metadata.searchQuery, 'Song by Artist');
});

test('les journaux montrent le nom ou la plateforme et masquent les paramètres privés', () => {
  assert.match(formatMusicAttempt('Niska - Chasse à l’homme'), /entrée=nom.*Niska - Chasse à l’homme/);
  const link = getMusicInputInfo('https://www.youtube.com/watch?v=epmR0g3udAk&si=SECRET_VALUE');
  assert.equal(link.providerLabel, 'YouTube');
  assert.match(formatMusicAttempt('https://www.youtube.com/watch?v=epmR0g3udAk&si=SECRET_VALUE'), /epmR0g3udAk/);
  assert.doesNotMatch(link.safe, /SECRET_VALUE/);
  const soundcloud = getMusicInputInfo('https://soundcloud.com/artist/track/s-PrivateToken123456?secret_token=SECRET_VALUE');
  assert.doesNotMatch(soundcloud.safe, /PrivateToken123456|SECRET_VALUE/);
  assert.match(soundcloud.safe, /s-\[masqué\]/);
  const spotify = getMusicInputInfo('spotify:track:abc123?si=PRIVATE_VALUE');
  assert.equal(spotify.safe, 'spotify:track:abc123');
  assert.doesNotMatch(sanitizeDiagnosticText('Erreur sur spotify:track:abc123?token=PRIVATE_VALUE'), /PRIVATE_VALUE/);
});
