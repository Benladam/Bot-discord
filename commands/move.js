const { isSlash, getIntegerOption, sendReply } = require('../shared/discord/commandHelpers');
const { controlledPlayer } = require('../features/music/musicControls');
module.exports = {
  data: { name: 'move', description: 'Déplace un titre dans la file d’attente', options: [
    { name: 'depart', description: 'Position actuelle, à partir de 1', type: 4, required: true, minValue: 1 },
    { name: 'arrivee', description: 'Nouvelle position, à partir de 1', type: 4, required: true, minValue: 1 },
  ] }, slash: true, helpCategory: 'music',
  async execute(ctx, args, deps) {
    const player = controlledPlayer(ctx, deps);
    const from = isSlash(ctx) ? getIntegerOption(ctx, 'depart') : Number(args[0]);
    const to = isSlash(ctx) ? getIntegerOption(ctx, 'arrivee') : Number(args[1]);
    const song = player.moveTrack(from, to);
    return sendReply(ctx, `↕️ **${song.title}** déplacé de ${from} à ${to}.`);
  },
};
