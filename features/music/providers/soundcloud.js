/** Configuration facultative de SoundCloud pour play-dl. */
const play = require('play-dl');

function getSoundCloudClientId(env = process.env) {
  return String(env.SOUNDCLOUD_CLIENT_ID || '').trim();
}

function configureSoundCloud(env = process.env) {
  const clientId = getSoundCloudClientId(env);
  if (!clientId) return false;
  play.setToken({ soundcloud: { client_id: clientId } });
  return true;
}

module.exports = { configureSoundCloud, getSoundCloudClientId };
