'use strict';

const COMPATIBLE_PROVIDERS = Object.freeze({
  openrouter: { key: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/free' },
  nvidia: { key: 'NVIDIA_API_KEY', baseUrl: 'https://integrate.api.nvidia.com/v1' },
  groq: { key: 'GROQ_API_KEY', baseUrl: 'https://api.groq.com/openai/v1' },
  omniroute: { key: 'OMNIROUTE_API_KEY', baseUrl: 'http://127.0.0.1:20128/v1', configurableUrl: true },
  ollama: { baseUrl: 'http://127.0.0.1:11434/v1', model: 'llama3.1', configurableUrl: true, optionalKey: true },
  'openai-compatible': { key: 'AI_API_KEY', baseUrl: 'http://127.0.0.1:11434/v1', configurableUrl: true, optionalKey: true },
});

const PROVIDER_NAMES = Object.freeze(['openai', 'anthropic', 'gemini', ...Object.keys(COMPATIBLE_PROVIDERS)]);
let freeCatalog = null;
let pendingCatalog = null;

async function listFreeOpenRouterModels({ fetchImpl = globalThis.fetch } = {}) {
  if (freeCatalog && Date.now() - freeCatalog.updatedAt < 300_000) return freeCatalog.models;
  if (pendingCatalog) return pendingCatalog;
  pendingCatalog = (async () => {
    const response = await fetchImpl('https://openrouter.ai/api/v1/models', {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('catalog-unavailable');
    const data = await response.json();
    if (!Array.isArray(data?.data)) throw new Error('catalog-unavailable');
    const models = data.data.filter(model => {
      const price = model?.pricing;
      return typeof model?.id === 'string' && /^[a-zA-Z0-9._:/-]{1,160}$/.test(model.id)
        && (model.id.endsWith(':free') || model.id === 'openrouter/free')
        && price?.prompt != null && price?.completion != null
        && Number(price.prompt) === 0 && Number(price.completion) === 0;
    }).map(model => ({ id: model.id, contextLength: Number(model.context_length) || 0 }))
      .sort((a, b) => a.id.localeCompare(b.id));
    freeCatalog = { updatedAt: Date.now(), models };
    return models;
  })();
  try { return await pendingCatalog; } finally { pendingCatalog = null; }
}

module.exports = { COMPATIBLE_PROVIDERS, PROVIDER_NAMES, listFreeOpenRouterModels };
