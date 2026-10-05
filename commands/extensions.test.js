const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildSlashCommand } = require('../shared/discord/slashCommandBuilder');
const names = ['previous', 'remove', 'move', 'filter', 'lyrics', 'ticket', 'unban', 'untimeout'];
test('new commands serialize with production builder and are discoverable by private help', () => {
  for (const name of names) {
    const command = require(`./${name}`);
    assert.equal(buildSlashCommand(command).name, name);
    assert.equal(command.slash, true); assert.ok(command.helpCategory);
  }
});
test('queue controls work with prefix and slash, without pinging the author', async () => {
  for (const slash of [false, true]) {
    let removed; let payload;
    const ctx = { guildId: 'guild', guild: {}, member: { voice: { channelId: 'voice' } },
      isChatInputCommand: () => slash, options: { getInteger: () => 2 }, reply: async value => { payload = value; } };
    const player = { connection: { channelId: 'voice' }, removeTrack(position) { removed = position; return { title: 'Song' }; } };
    await require('./remove').execute(ctx, ['2'], { getPlayer: guildId => { assert.equal(guildId, 'guild'); return player; } });
    assert.equal(removed, 2); assert.equal(payload.allowedMentions.repliedUser, false); assert.deepEqual(payload.allowedMentions.parse, []);
  }
});
test('new moderation commands deny users lacking Discord permissions', async () => {
  const ctx = { guildId: 'guild', guild: {}, member: { permissions: { has: () => false } } };
  for (const name of ['unban', 'untimeout']) await assert.rejects(require(`./${name}`).execute(ctx, []), /permission/);
});
test('ticket setup rejects non-admin even though ticket open is public', async () => {
  const ctx = { guildId: 'guild', guild: {}, member: { permissions: { has: () => false } } };
  await assert.rejects(require('./ticket').execute(ctx, ['setup'], { database: { getGuildSetting: () => null } }), /permission/);
});
