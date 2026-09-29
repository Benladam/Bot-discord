/**
 * botHook.js — Exécute les commandes du bot depuis le pont local de diagnostic.
 * - Lit le fichier de passage privé sous data/diagnostics/.
 * - Simule un message Discord minimal (prefixe !) pour les commandes type message.
 *
 * Désactivé par défaut; bot.js ne l'installe qu'avec un opt-in et un jeton fort.
 */
const fs = require('fs');
const { getCommandFilePath } = require('./shared');

module.exports = function installBotHook(client, deps) {
  const CMD_FILE = getCommandFilePath();

  // Message Discord factice (prefixe !) : reponse via .reply + .channel.send
  function fakeMessage(userId, guildId, channelId) {
    const reply = (content) => { console.log('[hook:reply] ' + (content?.description || content?.content || content)); return Promise.resolve(); };
    return {
      author: { id: userId, bot: false, tag: 'AppC#', username: 'AppC#' },
      member: { id: userId, displayName: 'AppC#' },
      guild: client.guilds.cache.get(guildId) || { id: guildId, name: 'local' },
      guildId: guildId,
      channel: { id: channelId, send: (c) => { console.log('[hook:send] ' + (c?.description || c?.content || c)); return Promise.resolve(); } },
      reply,
      channelId,
      content: '',
    };
  }

  let last = '';
  setInterval(() => {
    try {
      const txt = fs.readFileSync(CMD_FILE, 'utf8').trim();
      if (!txt || txt === last) return;
      last = txt;
      fs.writeFileSync(CMD_FILE, ''); // consomme
      const [name, ...args] = txt.split(/\s+/);
      const cmd = client.commands.get(name.toLowerCase());
      if (!cmd) { console.log('[hook] commande inconnue: ' + name); return; }
      const guild = client.guilds.cache.first();
      const msg = fakeMessage('hook', guild ? guild.id : '0', guild?.channels?.cache?.first()?.id || '0');
      console.log('[hook] execute /' + name + ' ' + args.join(' '));
      cmd.execute(msg, args, deps).catch((e) => console.error('[hook] erreur ' + name + ': ' + e.message));
    } catch (_) { /* ignore */ }
  }, 500);
};
