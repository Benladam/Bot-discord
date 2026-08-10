// Test vocal auto — SNIPPET de diagnostic (NE PAS laisser dans bot.js en prod H24).
// A coller dans bot.js (apres c_defaultActivity();) uniquement pour tester le
// vocal en autonome. Une fois le test fait, retirer ce bloc pour que le bot
// tourne H24 proprement dans le GUI.
//
// Usage : env TEST_VOCAL=1 node bot.js  (le bot rejoint le salon et joue rk ft larry)
//
// === MODE TEST VOCAL AUTOMATIQUE (diagnostic) ===
if (process.env.TEST_VOCAL === '1') {
  const GUILD_ID = '1527327658583527554';
  const VOCAL_ID = process.env.TEST_CHANNEL_ID || '1527327659955060769';
  setTimeout(async () => {
    try {
      const fs = require('fs');
      const _orig = console.log.bind(console);
      const _origErr = console.error.bind(console);
      console.log = (...a) => { _orig(...a); try { fs.appendFileSync('vocal_diag.txt', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (_) {} };
      console.error = (...a) => { _origErr(...a); try { fs.appendFileSync('vocal_diag.txt', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (_) {} };
      const diag = (s) => console.log(s);
      diag('=== DIAG VOCAL ' + new Date().toISOString() + ' ===');
      const guild = c.guilds.cache.get(GUILD_ID);
      const voiceChannel = c.channels.cache.get(VOCAL_ID);
      if (!guild || !voiceChannel) { diag('[TEST] guild ou salon introuvable'); return; }
      const player = getPlayer(GUILD_ID);
      await player.ensureConnection(voiceChannel);
      const member = guild.members.cache.get(c.user.id);
      const ctx = {
        guildId: GUILD_ID,
        channel: c.channels.cache.get('1527327659955060768'),
        member, user: c.user, author: c.user,
        reply: (o) => diag('[test-reply] ' + JSON.stringify(o).slice(0, 200)),
        editReply: (o) => diag('[test-edit] ' + JSON.stringify(o).slice(0, 200)),
      };
      diag('[TEST] connexion OK, lancement play.execute(rk ft larry)');
      const play = require('./commands/play');
      await play.execute(ctx, ['rk', 'ft', 'larry'], deps);
      diag('[TEST] play execute termine');
    } catch (e) {
      console.error('[TEST] erreur:', e);
    }
  }, 40000);
}
