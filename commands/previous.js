const { deferReply, sendReply } = require('../shared/discord/commandHelpers');
const { controlledPlayer } = require('../features/music/musicControls');
module.exports = {
  data: { name: 'previous', description: 'Rejoue le titre précédent de cette session' }, slash: true, helpCategory: 'music',
  async execute(ctx, _args, deps) {
    const player = controlledPlayer(ctx, deps);
    await deferReply(ctx);
    const song = await player.previous();
    return sendReply(ctx, song ? `⏮️ Titre précédent : **${song.title}**.` : 'Lecture annulée.');
  },
};
