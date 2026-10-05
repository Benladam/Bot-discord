const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { isSlash, getStringOption, requireGuildContext, deferReply } = require('../shared/discord/commandHelpers');
const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { songIdentity, getLyrics } = require('../features/music/lyrics');
module.exports = {
  data: { name: 'lyrics', description: 'Affiche les paroles en privé avec pagination', options: [
    { name: 'titre', description: 'Artiste - Titre; vide = morceau actuel', type: 3, required: false, maxLength: 400 },
  ] }, slash: true, helpCategory: 'music',
  async execute(ctx, args, deps) {
    requireGuildContext(ctx); await deferReply(ctx);
    const query = isSlash(ctx) ? getStringOption(ctx, 'titre') : args.join(' ');
    const identity = songIdentity(query ? { title: query } : deps.getPlayer(ctx.guildId).current);
    const lyrics = await (deps.getLyrics || getLyrics)(identity);
    const pages = lyrics.match(/[\s\S]{1,1800}/g) || ['Paroles indisponibles.'];
    let page = 0;
    const render = () => ({ embeds: [createThemedEmbed('primary').setTitle(`🎤 ${identity.artist} — ${identity.title}`.slice(0, 256))
      .setDescription(pages[page]).setFooter({ text: `LRCLIB · page ${page + 1}/${pages.length}` })], allowedMentions: { parse: [], repliedUser: false },
      components: pages.length > 1 ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('lyrics:previous').setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId('lyrics:next').setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length - 1))] : [] });
    const message = isSlash(ctx) ? await ctx.editReply(render()) : await ctx.author.send(render());
    const collector = message.createMessageComponentCollector?.({ time: 120_000 });
    const owner = ctx.user?.id || ctx.author?.id;
    collector?.on('collect', async interaction => {
      try {
        if (interaction.user.id !== owner) return await interaction.reply({ content: 'Ce menu est privé.', flags: MessageFlags.Ephemeral });
        if (!['lyrics:previous', 'lyrics:next'].includes(interaction.customId)) return;
        page = Math.max(0, Math.min(pages.length - 1, page + (interaction.customId === 'lyrics:next' ? 1 : -1)));
        await interaction.update(render());
      } catch { /* expired interaction or deleted message */ }
    });
    collector?.on('end', () => {
      const update = { components: [] };
      Promise.resolve(isSlash(ctx) ? ctx.editReply(update) : message.edit(update)).catch(() => {});
    });
    return message;
  },
};
