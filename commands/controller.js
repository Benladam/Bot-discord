/**
 * Commande: controller (!controller / /controller)
 * Donne le lien vers le panneau de contrôle web (GUI).
 */

module.exports = {
  data: {
    name: 'controller',
    description: 'Ouvre le panneau de contrôle du bot (musique, modération, réglages)',
  },
  slash: true,

  async execute(ctx, args, deps) {
    const port = process.env.GUI_PORT || '7777';
    const url = `http://127.0.0.1:${port}`;
    const reply = (o) => ctx.reply(o);
    const edit = (o) => (typeof ctx.editReply === 'function' ? ctx.editReply(o) : ctx.reply(o));

    const embed = {
      color: 0x5865f2,
      title: '🖥️ Panneau de contrôle',
      description:
        `Le panneau web du bot est disponible ici : **${url}**\n\n` +
        'Il permet de contrôler la musique, la modération et les réglages直接从 ton navigateur.',
      fields: [
        { name: '🎵 Musique', value: 'Rechercher, voir la file, ajouter des musiques', inline: true },
        { name: '🛡️ Modération', value: 'Kick, ban, timeout…', inline: true },
        { name: '⚙️ Réglages', value: 'Tokens, mise à jour GitHub, aide', inline: true },
      ],
      footer: { text: 'Le panneau s\'ouvre automatiquement au lancement du bot.' },
    };

    if (ctx.guild) {
      return reply({ embeds: [embed], ephemeral: true });
    }
    return reply({ embeds: [embed] });
  },
};
