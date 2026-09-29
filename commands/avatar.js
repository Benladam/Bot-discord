const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { resolveUser, isSlash } = require('../shared/discord/commandHelpers');

module.exports = {
  data: {
    name: 'avatar', description: 'Affiche l’avatar d’un utilisateur',
    options: [{ name: 'utilisateur', description: 'Utilisateur (par défaut : toi)', type: 6, required: false }],
  },
  slash: true,
  async execute(ctx, args) {
    const user = await resolveUser(ctx, args, 'utilisateur');
    if (!user) throw new Error('Utilisateur introuvable.');
    const image = user.displayAvatarURL({ size: 1024 });
    const embed = createThemedEmbed('primary').setTitle(`🖼️ Avatar de ${user.username}`).setImage(image).setURL(image);
    if (isSlash(ctx)) return ctx.reply({ embeds: [embed], ephemeral: false });
    return ctx.reply({ embeds: [embed] });
  },
};
