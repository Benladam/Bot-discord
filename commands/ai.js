const { sendReply, deferReply, getStringOption, isSlash } = require('../shared/discord/commandHelpers');
const { listFreeOpenRouterModels } = require('../features/ai/providers');

module.exports = {
  data: {
    name: 'ai', description: 'Affiche la configuration IA ou les modèles gratuits (propriétaire)',
    options: [{ name: 'action', description: 'Informations à afficher', type: 3, required: false,
      choices: [{ name: 'Statut', value: 'statut' }, { name: 'Modèles gratuits OpenRouter', value: 'modeles' },
        { name: 'Fournisseurs et configuration', value: 'fournisseurs' }] }],
  },
  slash: true, ownerOnly: true, helpCategory: 'setup',
  async execute(ctx, args, deps) {
    if (!deps.isOwner?.(ctx.user?.id || ctx.author?.id)) return sendReply(ctx, 'Cette commande est réservée au propriétaire du bot.');
    const action = (isSlash(ctx) ? getStringOption(ctx, 'action') : args[0]) || 'statut';
    if (action === 'modeles') {
      await deferReply(ctx);
      try {
        const models = await listFreeOpenRouterModels();
        const lines = models.filter(model => model.id !== 'openrouter/free').map(model => `• \`${model.id}\``);
        let text = 'Routeur gratuit : `openrouter/free`\nModèles :free actuellement à 0 pour les tokens d’entrée/sortie :\n';
        for (const line of lines) { if (text.length + line.length > 1750) break; text += line + '\n'; }
        text += `\n${models.length} modèle(s) gratuit(s) dans le catalogue. Liste complète : https://openrouter.ai/models?max_price=0\nLes quotas et la disponibilité du fournisseur s’appliquent.`;
        return sendReply(ctx, text);
      } catch (_) { return sendReply(ctx, 'Le catalogue OpenRouter est indisponible. Réessaie plus tard.'); }
    }
    if (action === 'fournisseurs') return sendReply(ctx,
      'Dans .env, choisis AI_PROVIDER et AI_MODEL, puis redémarre le bot.\n' +
      '• openrouter → OPENROUTER_API_KEY; modèle conseillé : openrouter/free; OPENROUTER_FREE_ONLY=true.\n' +
      '• nvidia → NVIDIA_API_KEY; accès de prototypage selon ton compte.\n' +
      '• groq → GROQ_API_KEY; offre gratuite avec quotas.\n' +
      '• gemini → GEMINI_API_KEY; modèles éligibles au quota gratuit.\n' +
      '• omniroute → OMNIROUTE_API_KEY + AI_BASE_URL; configure les fournisseurs gratuits dans ta passerelle.\n' +
      '• ollama → AI_BASE_URL; modèle installé sur ta machine.\n' +
      '• openai-compatible → AI_BASE_URL + AI_API_KEY; autres API compatibles (LM Studio, vLLM, Cerebras…).\n' +
      'OpenAI et Anthropic restent disponibles. Aucun fournisseur n’est gratuit sans condition; les abonnements aux applications ne paient pas leurs API.');
    const status = deps.aiChat?.getStatus();
    if (!status) return sendReply(ctx, 'Le statut IA n’est pas disponible.');
    const model = /^[a-zA-Z0-9._:/-]{1,160}$/.test(status.model) && !status.model.startsWith('sk-') ? status.model : '(non configuré)';
    return sendReply(ctx, `Conversation : **${status.ready ? 'configurée' : status.requested ? 'incomplète' : 'désactivée'}**\n` +
      `Fournisseur : ${status.provider}\nModèle : ${model}\nClé configurée : ${status.keyConfigured ? 'oui' : 'non'}\n` +
      `OpenRouter gratuit uniquement : ${status.freeOnly ? 'oui' : 'sans objet ou désactivé'}\n` +
      'Ce statut ne prouve pas que le quota est disponible. Aucun secret n’est affiché.');
  },
};
