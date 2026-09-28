const { EmbedBuilder } = require('discord.js');
const { resolveUser, isSlash, deferReply } = require('../utils/commandHelpers');

module.exports = {
  data: {
    name: 'userinfo', description: 'Affiche les informations publiques d’un utilisateur',
    options: [{ name: 'utilisateur', description: 'Utilisateur (par défaut : toi)', type: 6, required: false }],
  },
  slash: true,
  async execute(ctx, args) {
    await deferReply(ctx);
    const user = await resolveUser(ctx, args, 'utilisateur');
    if (!user) throw new Error('Utilisateur introuvable.');
    const member = ctx.guild?.members.cache.get(user.id) || await ctx.guild?.members.fetch(user.id).catch(() => null);
    const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`Utilisateur : ${user.tag || user.username}`)
      .setThumbnail(user.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: 'Identifiant', value: user.id, inline: true },
        { name: 'Compte créé', value: user.createdAt.toLocaleDateString('fr-FR'), inline: true },
      );
    if (member) {
      embed.addFields({ name: 'A rejoint le serveur', value: member.joinedAt?.toLocaleDateString('fr-FR') || 'inconnu', inline: true });
      const roles = member.roles.cache.filter((role) => role.id !== ctx.guild.id).map((role) => role.name).slice(0, 10);
      if (roles.length) embed.addFields({ name: 'Rôles', value: roles.join(', ').slice(0, 1024) });
    }
    if (isSlash(ctx)) return ctx.editReply({ embeds: [embed] });
    return ctx.reply({ embeds: [embed] });
  },
};
