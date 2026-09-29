const { createThemedEmbed } = require('../shared/discord/embedTheme');
const { isSlash, deferReply } = require('../shared/discord/commandHelpers');

module.exports = {
  data: { name: 'serverinfo', description: 'Affiche les informations de ce serveur' },
  slash: true,
  async execute(ctx) {
    if (!ctx.guild) throw new Error('Cette commande doit être utilisée dans un serveur.');
    await deferReply(ctx);
    const guild = ctx.guild;
    const owner = await guild.fetchOwner().catch(() => null);
    const embed = createThemedEmbed('primary').setTitle(`🏰 ${guild.name}`)
      .setDescription(`Serveur créé le ${guild.createdAt.toLocaleDateString('fr-FR')}.`)
      .addFields(
        { name: 'Membres', value: String(guild.memberCount), inline: true },
        { name: 'Salons', value: String(guild.channels.cache.size), inline: true },
        { name: 'Propriétaire', value: owner?.user?.tag || `<@${guild.ownerId}>`, inline: true },
        { name: 'Identifiant', value: guild.id, inline: true },
      );
    const icon = guild.iconURL({ size: 512 });
    if (icon) embed.setThumbnail(icon);
    if (isSlash(ctx)) return ctx.editReply({ embeds: [embed] });
    return ctx.reply({ embeds: [embed] });
  },
};
