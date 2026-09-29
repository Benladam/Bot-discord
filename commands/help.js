const { tr } = require('../shared/i18n/embedI18n');
const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { withBrandArtwork } = require('../shared/discord/brandArtwork');

const CATEGORY_LABELS = {
  fr: { music: '🎵 Musique', moderation: '🛡️ Modération', server: '🧰 Outils du serveur', setup: '⚙️ Configuration', other: '📦 Autres commandes', owner: 'propriétaire du bot', permission: 'permission du serveur' },
  en: { music: '🎵 Music', moderation: '🛡️ Moderation', server: '🧰 Server tools', setup: '⚙️ Configuration', other: '📦 Other commands', owner: 'bot owner', permission: 'server permission' },
  es: { music: '🎵 Música', moderation: '🛡️ Moderación', server: '🧰 Herramientas del servidor', setup: '⚙️ Configuración', other: '📦 Otros comandos', owner: 'propietario del bot', permission: 'permiso del servidor' },
  ar: { music: '🎵 الموسيقى', moderation: '🛡️ الإشراف', server: '🧰 أدوات الخادم', setup: '⚙️ الإعدادات', other: '📦 أوامر أخرى', owner: 'مالك البوت', permission: 'صلاحية الخادم' },
};

function optionSignature(option) {
  const optional = option.required ? '' : '?';
  return `\`${option.name}${optional}\``;
}

function formatCommand(command, labels) {
  const options = (command.data.options || []).filter((option) => option.type !== 1 && option.type !== 2);
  const usage = options.length ? ` ${options.map(optionSignature).join(' ')}` : '';
  const description = String(command.data.description || '').replace(/[\r\n]+/g, ' ').slice(0, 180);
  const access = command.ownerOnly ? ` · ${labels.owner}` : command.data.defaultMemberPermissions ? ` · ${labels.permission}` : '';
  return `**${command.data.name}**${usage} — ${description}${access}`;
}

function splitField(category, lines) {
  const chunks = [];
  let chunk = '';
  for (const line of lines) {
    const candidate = chunk ? `${chunk}\n${line}` : line;
    if (candidate.length > 1024 && chunk) {
      chunks.push(chunk);
      chunk = line;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((value, index) => ({
    name: index ? `${category} · suite ${index + 1}` : category,
    value,
    inline: false,
  }));
}

function commandCategory(command) {
  if (command.helpCategory) return command.helpCategory;
  if (command.ownerOnly) return 'setup';
  if (command.data.defaultMemberPermissions) return 'moderation';
  return 'server';
}

module.exports = {
  data: { name: 'help', description: 'Affiche les commandes disponibles et leurs options' },
  slash: true,
  helpCategory: 'setup',

  async execute(ctx, _args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    const language = deps.langFor ? deps.langFor(userId, ctx.guild?.id) : 'fr';
    const lang = CATEGORY_LABELS[language] ? language : 'fr';
    const T = tr(lang);
    const commands = [...(deps.commands?.values?.() || [])]
      .filter((command) => command.slash && (!command.ownerOnly || deps.isOwner?.(userId)))
      .sort((a, b) => a.data.name.localeCompare(b.data.name));
    const groups = new Map();
    for (const command of commands) {
      const category = commandCategory(command);
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category).push(formatCommand(command, CATEGORY_LABELS[lang]));
    }

    const categoryOrder = ['music', 'moderation', 'server', 'setup', 'other'];
    const labels = CATEGORY_LABELS[lang];
    const fields = [];
    for (const key of categoryOrder) {
      const lines = groups.get(key);
      if (!lines?.length) continue;
      fields.push(...splitField(labels[key] || labels.other, lines));
    }

    const description = 'Commandes disponibles sur cette instance, regroupées par fonction; les options et permissions sont indiquées à côté de chaque nom.';
    const embed = createThemedEmbed('primary')
      .setTitle(T.helpTitle || '📖 Commandes du bot')
      .setDescription(description)
      .addFields(fields.slice(0, 25))
      .setFooter({ text: T.helpFooter || 'Commandes disponibles sur ce serveur' })
      .setTimestamp();

    return ctx.reply(withBrandArtwork(embed));
  },
};
