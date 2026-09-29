const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
} = require('discord.js');
const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { withBrandArtwork, ART_NAME } = require('../shared/discord/brandArtwork');
const { isSlash } = require('../shared/discord/commandHelpers');

const PAGE_SIZE = 8;
const HELP_PREFIX = 'helpui:';
const CATEGORY_ORDER = ['music', 'moderation', 'server', 'setup', 'other'];
const CATEGORY_LABELS = {
  fr: {
    music: '🎵 Musique', moderation: '🛡️ Modération', server: '🧰 Outils du serveur',
    setup: '⚙️ Configuration', other: '📦 Autres commandes', owner: 'propriétaire du bot',
    permission: 'permission du serveur',
  },
  en: {
    music: '🎵 Music', moderation: '🛡️ Moderation', server: '🧰 Server tools',
    setup: '⚙️ Configuration', other: '📦 Other commands', owner: 'bot owner',
    permission: 'server permission',
  },
  es: {
    music: '🎵 Música', moderation: '🛡️ Moderación', server: '🧰 Herramientas del servidor',
    setup: '⚙️ Configuración', other: '📦 Otros comandos', owner: 'propietario del bot',
    permission: 'permiso del servidor',
  },
  ar: {
    music: '🎵 الموسيقى', moderation: '🛡️ الإشراف', server: '🧰 أدوات الخادم',
    setup: '⚙️ الإعدادات', other: '📦 أوامر أخرى', owner: 'مالك البوت',
    permission: 'صلاحية الخادم',
  },
};

function labelsFor(language) {
  return CATEGORY_LABELS[language] || CATEGORY_LABELS.fr;
}

function optionText(option) {
  const optional = option.required ? '' : '?';
  return `\`${option.name}${optional}\``;
}

function formatOptions(options = []) {
  return options
    .filter((option) => option.type !== 1 && option.type !== 2)
    .map(optionText)
    .join(' ');
}

function formatCommand(command, labels) {
  const data = command.data || {};
  const options = Array.isArray(data.options) ? data.options : command.options || [];
  const description = String(data.description || 'Commande disponible')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 150);
  const access = command.ownerOnly
    ? ` · ${labels.owner}`
    : data.defaultMemberPermissions ? ` · ${labels.permission}` : '';
  const entries = [];
  const groups = options.filter((option) => option.type === 2);
  const subcommands = options.filter((option) => option.type === 1);

  if (!groups.length && !subcommands.length) {
    const usage = formatOptions(options);
    return [`**${data.name}**${usage ? ` ${usage}` : ''} — ${description}${access}`];
  }

  for (const subcommand of subcommands) {
    const usage = formatOptions(subcommand.options);
    entries.push(`**${data.name} ${subcommand.name}**${usage ? ` ${usage}` : ''} — ${subcommand.description || description}${access}`);
  }
  for (const group of groups) {
    for (const subcommand of group.options || []) {
      const usage = formatOptions(subcommand.options);
      entries.push(`**${data.name} ${group.name} ${subcommand.name}**${usage ? ` ${usage}` : ''} — ${subcommand.description || description}${access}`);
    }
  }
  return entries;
}

function commandCategory(command) {
  if (command.helpCategory) return String(command.helpCategory).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 24) || 'other';
  if (command.ownerOnly) return 'setup';
  if (command.data?.defaultMemberPermissions) return 'moderation';
  return 'server';
}

function buildCategories(deps, userId, language) {
  const labels = labelsFor(language);
  const grouped = new Map();
  const commands = [...(deps.commands?.values?.() || [])]
    .filter((command) => command?.data?.name)
    .filter((command) => !command.ownerOnly || deps.isOwner?.(userId))
    .sort((a, b) => a.data.name.localeCompare(b.data.name));

  for (const command of commands) {
    const key = commandCategory(command);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(...formatCommand(command, labels));
  }

  const orderedKeys = [
    ...CATEGORY_ORDER.filter((key) => grouped.has(key)),
    ...[...grouped.keys()].filter((key) => !CATEGORY_ORDER.includes(key)).sort(),
  ];
  return orderedKeys.map((key) => ({
    key,
    label: labels[key] || key.replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase()),
    lines: grouped.get(key),
  }));
}

function makeComponents(categories, categoryKey, page, pageCount, userId) {
  const categoryMenu = new StringSelectMenuBuilder()
    .setCustomId(`${HELP_PREFIX}category:${userId}`)
    .setPlaceholder('Choisir une catégorie')
    .addOptions(categories.slice(0, 25).map((category) => ({
      label: category.label.slice(0, 100),
      description: `${category.lines.length} commande(s)`.slice(0, 100),
      value: category.key,
      default: category.key === categoryKey,
    })));

  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}page:${userId}:${categoryKey}:${Math.max(0, page - 1)}:previous`)
      .setLabel('Précédent')
      .setEmoji({ name: '⬅️' })
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}indicator:${userId}:${categoryKey}:${page}`)
      .setLabel(`${page + 1} / ${pageCount}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}page:${userId}:${categoryKey}:${Math.min(pageCount - 1, page + 1)}:next`)
      .setLabel('Suivant')
      .setEmoji({ name: '➡️' })
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page >= pageCount - 1),
  );

  return [new ActionRowBuilder().addComponents(categoryMenu), navigation];
}

function renderPage(categories, categoryKey, page, userId, language) {
  const category = categories.find((item) => item.key === categoryKey) || categories[0];
  const pageCount = Math.max(1, Math.ceil(category.lines.length / PAGE_SIZE));
  const safePage = Math.max(0, Math.min(pageCount - 1, page));
  const pageLines = category.lines.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const description = pageLines.length
    ? pageLines.join('\n\n').slice(0, 4000)
    : 'Aucune commande disponible dans cette catégorie.';
  const embed = createThemedEmbed('primary')
    .setTitle(`📖 Aide · ${category.label}`.slice(0, 256))
    .setDescription(description)
    .setFooter({ text: `Page ${safePage + 1}/${pageCount} · menu privé · ${category.lines.length} commande(s)` })
    .setTimestamp();
  const payload = withBrandArtwork(embed);
  payload.components = makeComponents(categories, category.key, safePage, pageCount, userId);
  return payload;
}

function keepExistingArtwork(payload, interaction) {
  const attachments = [...(interaction.message?.attachments?.values?.() || [])]
    .map((attachment) => ({ id: attachment.id, filename: attachment.name }))
    .filter((attachment) => attachment.id && attachment.filename);
  if (attachments.some((attachment) => attachment.filename === ART_NAME)) {
    payload.attachments = attachments;
    delete payload.files;
  }
  return payload;
}

async function replyPrivately(ctx, payload) {
  if (isSlash(ctx)) return ctx.reply({ ...payload, flags: MessageFlags.Ephemeral });

  const recipient = ctx.author;
  if (typeof recipient?.send === 'function') {
    try {
      return await recipient.send(payload);
    } catch (_) {
      // Les MP peuvent être fermés. Ne réponds pas au message de commande
      // après l’avoir supprimé : Discord rejette alors sa référence.
    }
  }

  let commandMessageDeleted = false;
  if (ctx.deletable && typeof ctx.delete === 'function') {
    try {
      await ctx.delete();
      commandMessageDeleted = true;
    } catch (_) {
      // La permission de suppression est facultative.
    }
  }

  const notice = {
    content: 'Je ne peux pas t’envoyer le menu d’aide en privé. Active tes messages privés pour ce serveur et réessaie.',
    allowedMentions: { repliedUser: false },
  };

  if (typeof ctx.channel?.send === 'function') {
    try {
      const sent = await ctx.channel.send(notice);
      const timer = setTimeout(() => {
        if (typeof sent?.delete !== 'function') return;
        Promise.resolve().then(() => sent.delete()).catch(() => {});
      }, 30_000);
      timer.unref?.();
      return sent;
    } catch (_) {
      // Si le bot ne peut pas écrire dans le salon, essaie le reply ci-dessous
      // uniquement si le message source existe encore.
    }
  }

  if (!commandMessageDeleted && typeof ctx.reply === 'function') {
    try {
      return await ctx.reply(notice);
    } catch (_) {
      // Le message d’origine a pu être supprimé entre-temps.
    }
  }
  return null;
}

module.exports = {
  data: { name: 'help', description: 'Affiche les commandes par catégorie, en privé' },
  slash: true,
  helpCategory: 'setup',

  async execute(ctx, _args, deps) {
    const userId = ctx.user?.id || ctx.author?.id;
    const language = deps.langFor ? deps.langFor(userId, ctx.guildId || ctx.guild?.id) : 'fr';
    const categories = buildCategories(deps, userId, language);
    const firstCategory = categories.find((category) => category.key === 'music') || categories[0];
    if (!firstCategory) {
      const embed = createThemedEmbed('neutral')
        .setTitle('📖 Aide')
        .setDescription('Aucune commande n’est actuellement chargée.')
        .setTimestamp();
      return replyPrivately(ctx, { embeds: [embed] });
    }
    return replyPrivately(ctx, renderPage(categories, firstCategory.key, 0, userId, language));
  },

  async handleInteraction(interaction, deps) {
    if (!interaction.customId?.startsWith(HELP_PREFIX)) return false;
    const [, action, ownerId, categoryKey, rawPage, direction] = interaction.customId.split(':');
    if (!ownerId || String(interaction.user?.id || '') !== ownerId) {
      await interaction.reply({
        content: 'Ce menu d’aide est réservé à la personne qui l’a ouvert.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const language = deps.langFor ? deps.langFor(ownerId, interaction.guildId) : 'fr';
    const categories = buildCategories(deps, ownerId, language);
    if (!categories.length) {
      await interaction.update({ content: 'Aucune commande n’est actuellement chargée.', embeds: [], components: [] });
      return true;
    }

    let targetCategory = categoryKey;
    let targetPage = Number.parseInt(rawPage, 10);
    if (action === 'category' && interaction.isStringSelectMenu?.()) {
      targetCategory = interaction.values?.[0];
      targetPage = 0;
    } else if (action !== 'page' || !interaction.isButton?.() || !Number.isInteger(targetPage)
        || (direction !== undefined && !['previous', 'next'].includes(direction))) {
      await interaction.reply({ content: 'Cette navigation d’aide n’est plus valide.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!categories.some((category) => category.key === targetCategory)) {
      await interaction.reply({ content: 'Cette catégorie n’est pas disponible dans ton menu d’aide.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const payload = keepExistingArtwork(
      renderPage(categories, targetCategory, targetPage, ownerId, language),
      interaction,
    );
    await interaction.update(payload);
    return true;
  },
};
