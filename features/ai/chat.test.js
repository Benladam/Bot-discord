'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIChat } = require('./chat');

function incoming(content = '<@bot> ça va ?', mention = true) {
  const replies = [];
  return {
    content, author: { id: 'person', bot: false }, guildId: 'test-guild', channelId: 'test-channel',
    mentions: { users: { has: (id) => mention && id === 'bot' } },
    channel: { sendTyping: async () => {}, send: async (reply) => { replies.push(reply); } },
    reply: async (reply) => { replies.push(reply); }, replies,
  };
}

const bot = { id: 'bot', username: 'TestBot' };
const logger = { warn: () => {} };

test('le diagnostic distingue un fournisseur désactivé sans exposer la clé', async () => {
  let calls = 0;
  const chat = createAIChat({ env: { OPENAI_API_KEY: 'secret-for-test' }, logger,
    fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  assert.equal(chat.getStatus().requested, false);
  assert.equal(chat.getStatus().ready, false);
  assert.equal(JSON.stringify(chat.getStatus()).includes('secret-for-test'), false);
  assert.equal(await chat.handleMessage(incoming(), bot), false);
  assert.equal(calls, 0);
});

test('une mention appelle Responses et répond dans le salon de test', async () => {
  const requests = [];
  const chat = createAIChat({ env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'secret-for-test' }, logger,
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'Ça va, et toi ?' }] }] }), { status: 200 });
    } });
  const message = incoming();
  assert.equal(chat.getStatus().ready, true);
  assert.equal(await chat.handleMessage(message, bot), true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].body.model, 'gpt-5.6-luna');
  assert.deepEqual(requests[0].body.input, [{ role: 'user', content: 'ça va ?' }]);
  assert.equal(requests[0].body.store, false);
  assert.equal(requests[0].body.tools, undefined);
  assert.equal(message.replies[0].content, 'Ça va, et toi ?');
  assert.deepEqual(message.replies[0].allowedMentions, { parse: [], repliedUser: false });
});

test('le nom du bot déclenche une réponse sans ping', async () => {
  const chat = createAIChat({ env: { AI_PROVIDER: 'openai', AI_MODEL: 'chosen-model', OPENAI_API_KEY: 'secret-for-test' }, logger,
    fetchImpl: async () => new Response(JSON.stringify({ output_text: 'Salut !' }), { status: 200 }) });
  const message = incoming('TestBot, bonjour !', false);
  assert.equal(await chat.handleMessage(message, bot), true);
  assert.equal(message.replies[0].content, 'Salut !');
});

test('une clé absente produit une explication sans appel API', async () => {
  let calls = 0;
  const chat = createAIChat({ env: { AI_PROVIDER: 'openai' }, logger,
    fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  const message = incoming();
  assert.equal(chat.getStatus().issue, 'key');
  assert.equal(await chat.handleMessage(message, bot), true);
  assert.match(message.replies[0].content, /clé API.*pas configurée/);
  assert.equal(calls, 0);
});

for (const quotaCode of ['insufficient_quota', 'credit_balance_exhausted']) test(`le quota ${quotaCode} indique la facturation et masque les détails du fournisseur`, async () => {
  const warnings = [];
  const chat = createAIChat({ env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'secret-for-test' },
    logger: { warn: (value) => warnings.push(value) },
    fetchImpl: async () => new Response(JSON.stringify({ error: { code: quotaCode, message: 'secret-for-test' } }), { status: 429 }) });
  const message = incoming();
  assert.equal(await chat.handleMessage(message, bot), true);
  assert.match(message.replies[0].content, /facturation API/);
  assert.equal(JSON.stringify([message.replies, warnings]).includes('secret-for-test'), false);
});
