const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { isSlash, getStringOption } = require('../shared/discord/commandHelpers');

module.exports = {
  data: {
    name: 'poll', description: 'Crée un sondage Oui / Non',
    options: [{ name: 'question', description: 'Question du sondage', type: 3, required: true, maxLength: 1000 }],
  },
  slash: true,
  async execute(ctx, args) {
    const question = (isSlash(ctx) ? getStringOption(ctx, 'question') : args.join(' ')).trim();
    if (!question) throw new Error('Indique la question du sondage.');
    if (question.length > 1000) throw new Error('La question doit contenir au maximum 1000 caractères.');
    const embed = createThemedEmbed('primary').setTitle('📊 Sondage').setDescription(question)
      .setFooter({ text: `Créé par ${ctx.user?.username || ctx.author?.username || 'un membre'}` });
    const payload = { embeds: [embed], allowedMentions: { parse: [] } };
    let message;
    if (isSlash(ctx)) {
      await ctx.reply(payload);
      message = await ctx.fetchReply();
    } else {
      message = await ctx.channel.send(payload);
    }
    await message.react('👍').catch(() => {});
    await message.react('👎').catch(() => {});
    return message;
  },
};
