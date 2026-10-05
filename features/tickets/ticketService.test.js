const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Collection, PermissionFlagsBits: P } = require('discord.js');
const { openTicket, closeTicket, marker } = require('./ticketService');
test('private ticket deduplicates concurrent opens and explicitly denies everyone', async () => {
  let count = 0; let options;
  const guild = { id: '123', roles: { fetch: async () => ({ id: '456' }) }, members: { me: { id: '999', permissions: { has: () => true } } },
    channels: { fetch: async () => new Collection(), create: async value => { count++; options = value; return { id: '789' }; } } };
  const tickets = await Promise.all([openTicket(guild, '555', { supportRoleId: '456' }), openTicket(guild, '555', { supportRoleId: '456' })]);
  assert.equal(count, 1); assert.equal(tickets[0].id, tickets[1].id);
  assert.equal(options.topic, marker('123', '555')); assert.deepEqual(options.permissionOverwrites[0], { id: '123', deny: [P.ViewChannel] });
});
test('tickets reject missing support or public role, without creating channel', async () => {
  await assert.rejects(openTicket({ id: '123' }, '555', null), /Configure/);
  await assert.rejects(openTicket({ id: '123', roles: { fetch: async () => ({ id: '123' }) } }, '555', { supportRoleId: '123' }), /public/);
});
test('close ticket refuses unrelated channel/user and archives instead of deleting', async () => {
  let archived; let overwrite;
  const ctx = { guildId: '123', user: { id: '555' }, channel: { topic: marker('123', '555'), name: 'ticket-555',
    permissionOverwrites: { edit: async (...args) => { overwrite = args; } }, setName: async name => { archived = name; }, delete: assert.fail } };
  await assert.rejects(closeTicket({ ...ctx, user: { id: '666' } }, {}), /Seul/);
  await assert.rejects(closeTicket({ ...ctx, guildId: 'other' }, {}), /créé par ce bot/);
  await closeTicket(ctx, {}); assert.equal(archived, 'closed-ticket-555'); assert.equal(overwrite[1].SendMessages, false);
});
