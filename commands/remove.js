const { isSlash, getIntegerOption, sendReply } = require('../shared/discord/commandHelpers');
const { controlledPlayer } = require('../features/music/musicControls');
module.exports = {
  data: { name: 'remove', description: 'Retire un titre en attente sans couper la lecture', options: [
    { name: 'position', description: 'Position dans la file (à partir de 1)', type: 4, required: true, minValue: 1 },
  ] }, slash: true, helpCategory: 'music',
  async execute(ctx, args, deps) {
    const player = controlledPlayer(ctx, deps);
    const song = player.removeTrack(isSlash(ctx) ? getIntegerOption(ctx, 'position') : Number(args[0]));
    return sendReply(ctx, `🗑️ **${song.title}** retiré de la file.`);
  },
};
