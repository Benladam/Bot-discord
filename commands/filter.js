const { isSlash, getStringOption, sendReply } = require('../shared/discord/commandHelpers');
const { controlledPlayer } = require('../features/music/musicControls');
const { FILTERS } = require('../features/music/audioFilters');
module.exports = {
  data: { name: 'filter', description: 'Applique un filtre en direct, sans changer de morceau', options: [
    { name: 'mode', description: 'Préréglage audio', type: 3, required: true,
      choices: Object.entries(FILTERS).map(([value, name]) => ({ name, value })) },
  ] }, slash: true, helpCategory: 'music',
  async execute(ctx, args, deps) {
    const player = controlledPlayer(ctx, deps);
    const name = player.setFilter(isSlash(ctx) ? getStringOption(ctx, 'mode') : args[0]);
    return sendReply(ctx, `🎚️ ${FILTERS[name]} · actif dans ce serveur uniquement.`);
  },
};
