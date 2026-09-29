const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const { PROVIDERS, providerPresentation } = require('./providerPresentation');
const { ICON_DIRECTORY, withProviderIcons } = require('./providerIcons');

test('chaque plateforme possède un véritable PNG livré avec le bot', () => {
  for (const [provider, entry] of Object.entries(PROVIDERS)) {
    const name = `provider-${provider}.png`;
    assert.equal(entry.iconURL, `attachment://${name}`);
    const image = fs.readFileSync(path.join(ICON_DIRECTORY, name));
    assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(image.readUInt32BE(16) >= 16);
    assert.ok(image.readUInt32BE(20) >= 16);
  }
});

test('les logos sont joints une seule fois et les changements de plateforme retirent les anciennes pièces jointes', () => {
  const source = providerPresentation('spotify', 'https://open.spotify.com/track/a');
  const embed = new EmbedBuilder().setAuthor({ name: source.name, iconURL: source.iconURL });
  const payload = withProviderIcons({ embeds: [embed, embed], components: [] });
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].name, 'provider-spotify.png');
  assert.equal(payload.files[0].attachment, path.join(ICON_DIRECTORY, 'provider-spotify.png'));
  assert.deepEqual(payload.attachments, []);
  assert.equal(withProviderIcons(payload).files.length, 1);
});

test('un embed sans logo reste inchangé et aucun chemin arbitraire ne peut être joint', () => {
  const payload = { embeds: [{ author: { icon_url: 'attachment://../../.env' } }] };
  assert.equal(withProviderIcons(payload), payload);
  assert.equal(withProviderIcons('message'), 'message');
});
