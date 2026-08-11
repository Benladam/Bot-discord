/**
 * botHook.js — Execute les commandes du bot a partir d'un fichier (ponts WS / app C#).
 * - Watch Test/cmd.txt : chaque ligne "nom arg1 arg2 ..." declenche client.commands.get(nom).execute(...).
 * - Simule un message Discord minimal (prefixe !) pour les commandes type message.
 *
 * ISOLE dans Test/ (regle enzom) : ne pas mettre en prod sans validation.
 */
const fs = require('fs');
const path = require('path');

module.exports = function installBotHook(client, deps) {
  const CMD_FILE = path.join(__dirname, 'cmd.txt');
  if (!fs.existsSync(CMD_FILE)) fs.writeFileSync(CMD_FILE, '');

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
