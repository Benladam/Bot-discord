'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('WebMCP expose uniquement un état musical en lecture seule après authentification', async () => {
  const elements = new Map();
  const element = () => ({
    hidden: false,
    disabled: false,
    value: '',
    textContent: '',
    dataset: {},
    classList: { toggle() {} },
    addEventListener() {},
    replaceChildren() {},
    append() {},
    querySelector() { return element(); },
    focus() {},
    select() {},
  });
  const button = element();
  const loginForm = element();
  loginForm.querySelector = () => button;
  const document = {
    querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, selector === '#login-form' ? loginForm : element());
      return elements.get(selector);
    },
    createElement: element,
    modelContext: undefined,
  };

  let tool;
  let resolveTool;
  const registered = new Promise((resolve) => { resolveTool = resolve; });
  const modelContext = {
    registerTool: async (definition) => { tool = definition; resolveTool(); },
  };
  const musicState = { guild: { id: '123456789012345678', name: 'Serveur test' }, current: { title: 'Piste test' }, queue: [] };
  const requests = [];
  const fetch = async (url, options) => {
    const requestPath = String(url);
    requests.push(requestPath);
    if (requestPath === '/api/auth') return new Response(JSON.stringify({ authenticated: true, csrfToken: 'test-csrf' }));
    if (requestPath === '/api/status') return new Response(JSON.stringify({ guilds: [] }));
    if (requestPath === '/api/guilds/123456789012345678/music' && options?.method === 'GET') {
      return new Response(JSON.stringify(musicState));
    }
    throw new Error(`Route de test inattendue : ${requestPath}`);
  };
  const window = {
    navigator: { modelContext },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout,
    confirm: () => false,
  };

  const source = fs.readFileSync(path.join(__dirname, '..', 'features', 'web', 'public', 'app.js'), 'utf8');
  vm.runInNewContext(source, {
    document, window, fetch, Headers, Response, URL,
    setTimeout, clearTimeout, console,
  }, { filename: 'features/web/public/app.js' });
  await registered;

  assert.equal(tool.name, 'get_music_status');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.untrustedContentHint, true);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Array.from(tool.inputSchema.required), ['guild_id']);
  assert.deepEqual(await tool.execute({ guild_id: '123456789012345678' }), musicState);
  await assert.rejects(tool.execute({ guild_id: '123456789012345678', extra: true }), /Expected only a valid guild_id/);
  assert.equal(requests.includes('/api/guilds/123456789012345678/music'), true);
});
