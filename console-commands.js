/**
 * console-commands.js — Piloter le bot depuis le terminal (sans passer par Discord).
 *
 * On tape des commandes dans la fenêtre noire (ou dans la ligne de commande de
 * la GUI, qui les envoie ici) et le bot les exécute sur Discord.
 *
 * Exemples :
 *   /call #général cc les amis      -> le bot écrit dans le salon #général
 *   /join Général                   -> le bot rejoint un salon vocal
 *   /leave                          -> il quitte le vocal
 *   /ban @pseudo raison             -> bannit un membre
 *   /say <id de salon> texte        -> écrit dans un salon par son identifiant
 *   /help                           -> liste toutes les commandes
 *
 * Tout est fait pour être tolérant : « #général », « general », « Général »
 * ou l'identifiant du salon fonctionnent tous.
 */

const { ChannelType, PermissionsBitField } = require('discord.js');

// Pour lancer les commandes musique depuis le terminal, on simule un
// « contexte » comme si la commande venait de Discord, en s'appuyant sur
// l'état réel du vocal (membre déjà connecté) récupéré via le gateway.
function makeMusicContext(client, guild, query, getPlayer) {
  // On cherche d'abord un membre du bot déjà en vocal, sinon un humain en vocal.
  let voiceChannel = null;
  const player = guild && getPlayer(guild.id);
  if (player && player.connection && player.connection.channelId) {
    voiceChannel = client.channels.cache.get(player.connection.channelId);
  }
  if (!voiceChannel) {
    for (const [, m] of guild.members.cache) {
      if (m.voice && m.voice.channel) { voiceChannel = m.voice.channel; break; }
    }
  }
  // Membre « fictif » basé sur le bot, avec le salon vocal trouvé.
  const member = {
    id: client.user.id,
    voice: { channel: voiceChannel, channelId: voiceChannel ? voiceChannel.id : null },
    user: client.user,
    guild,
  };
  return {
    guildId: guild.id,
    channel: voiceChannel,
    member,
    client,
    // Réponses de la commande musique → renvoyées vers le terminal.
    _embeds: [],
    reply: async (data) => { return { editReply: async () => {}, delete: async () => {} }; },
    editReply: async () => {},
    deferred: false,
    replied: false,
  };
}

/**
 * Lance une commande musique via le moteur de commandes existant.
 * Le salon vocal est découvert depuis l'état réel (membre humain en vocal
 * ou le bot déjà connecté) — aucun besoin d'être soi-même en vocal.
 */
async function musicCommand(client, name, arg, { ok, err, getPlayer, prefix, langFor, langStore, botT }) {
  const guild = client.guilds.cache.first();
  if (!guild) return err('Le bot n’est sur aucun serveur.');
  const cmd = client.commands.get(name);
  if (!cmd) return err(`Commande musique inconnue : /${name}`);

  if (name === 'play' && client.commands.get('play')) {
    // /play exige un membre dans un vocal (déjà géré dans commands/play.js).
    const ctx = makeMusicContext(client, guild, arg, getPlayer);
    if (!ctx.member.voice.channel) {
      return err('Aucun salon vocal actif trouvé (un membre doit être en vocal sur Discord).');
    }
    try {
      await cmd.execute(ctx, arg.split(/\s+/).filter(Boolean), { getPlayer, prefix, langFor, langStore, botT });
      ok(`🎵 /play lancé : ${arg}`);
    } catch (e) {
      err(`/play : ${e.message}`);
    }
    return;
  }

  const ctx = makeMusicContext(client, guild, arg, getPlayer);
  try {
    await cmd.execute(ctx, arg.split(/\s+/).filter(Boolean), { getPlayer, prefix: prefix || '!', langFor, langStore, botT });
    ok(`🎶 /${name} exécuté.`);
  } catch (e) {
    err(`/${name} : ${e.message}`);
  }
}

/**
 * /join — rejoint le salon vocal où UN utilisateur est déjà connecté sur
 * Discord (découvert via le gateway). Pas de nom à taper.
 */
async function joinUserCurrentVoice(client, getPlayer, { ok, err }) {
  let target = null;
  let who = null;
  for (const [, g] of client.guilds.cache) {
    for (const [, m] of g.members.cache) {
      if (!m.user.bot && m.voice && m.voice.channel) { target = m.voice.channel; who = m.user.username; break; }
    }
    if (target) break;
  }
  if (!target) {
    return err('Aucun membre n’est dans un salon vocal sur Discord. /join sert à rejoindre une personne déjà en vocal.');
  }
  await getPlayer(target.guild.id).ensureConnection(target);
  ok(`🔊 Le bot a rejoint le vocal « ${target.name} » (où est ${who}).`);
}

/** Enlève les accents et la casse pour comparer des noms de salons. */
function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Retrouve un salon à partir de ce que l'utilisateur a tapé.
 * Accepte : #général, général, general, <#123...>, ou l'identifiant brut.
 */
function findChannel(client, query, types) {
  if (!query) return null;
  let q = String(query).trim();

  // Mention Discord <#123456> ou identifiant seul
  const idMatch = q.match(/^<#(\d+)>$/) || q.match(/^(\d{15,25})$/);
  if (idMatch) {
    const ch = client.channels.cache.get(idMatch[1]);
    if (ch && (!types || types.includes(ch.type))) return ch;
  }

  q = q.replace(/^#/, '');
  const nq = normalize(q);
  const pool = [...client.channels.cache.values()]
    .filter((c) => !types || types.includes(c.type));

  // Correspondance exacte, puis « commence par », puis « contient »
  return pool.find((c) => normalize(c.name) === nq)
      || pool.find((c) => normalize(c.name).startsWith(nq))
      || pool.find((c) => normalize(c.name).includes(nq))
      || null;
}

/** Retrouve un membre : @pseudo, pseudo, ou identifiant. */
/** Trouve un rôle (mention <@&id>, #id, nom avec ou sans @). */
async function findRole(guild, query) {
  if (!guild || !query) return null;
  const q = String(query).trim();
  const idMatch = q.match(/^<@&(\d+)>$/) || q.match(/^(\d{15,25})$/);
  if (idMatch) return guild.roles.cache.get(idMatch[1]) || null;
  const nq = normalize(q.replace(/^[@#]/, ''));
  return guild.roles.cache.find((r) => normalize(r.name) === nq)
    || guild.roles.cache.find((r) => normalize(r.name).startsWith(nq))
    || null;
}

async function findMember(guild, query) {
  if (!guild || !query) return null;
  const q = String(query).trim();
  const idMatch = q.match(/^<@!?(\d+)>$/) || q.match(/^(\d{15,25})$/);
  if (idMatch) {
    return guild.members.fetch(idMatch[1]).catch(() => null);
  }
  const nq = normalize(q.replace(/^@/, ''));
  const list = await guild.members.fetch().catch(() => null);
  if (!list) return null;
  return list.find((m) => normalize(m.user.username) === nq)
      || list.find((m) => normalize(m.displayName) === nq)
      || list.find((m) => normalize(m.user.username).startsWith(nq))
      || list.find((m) => normalize(m.displayName).startsWith(nq))
      || null;
}

/** Liste des commandes, utilisée par /help et par la GUI. */
const HELP = [
  ['/play <recherche|lien>', 'Lancer une musique (YouTube/Spotify)'],
  ['/skip', 'Passer à la musique suivante'],
  ['/pause', 'Mettre en pause'],
  ['/resume', 'Reprendre la lecture'],
  ['/stop', 'Arrêter et vider la file'],
  ['/now', 'Musique en cours'],
  ['/queue', 'File d’attente'],
  ['/volume <0-100>', 'Régler le volume'],
  ['/loop [off|song|queue]', 'Mode de boucle'],
  ['/shuffle', 'Mélanger la file'],
  ['/call <#salon> <message>', 'Écrire un message dans un salon texte'],
  ['/say <#salon> <message>', 'Identique à /call'],
  ['/reply <#salon> <id> <msg>', 'Répondre à un message précis'],
  ['/join', 'Rejoindre le salon vocal où est déjà un membre'],
  ['/leave', 'Faire quitter le salon vocal'],
  ['/voices', 'Lister les salons vocaux'],
  ['/channels', 'Lister les salons texte'],
  ['/servers', 'Lister les serveurs du bot'],
  ['/members [recherche]', 'Lister/chercher des membres'],
  ['/roles', 'Lister les rôles du serveur'],
  ['/ban <membre|@rôle> [raison]', 'Bannir un membre ou tout un rôle'],
  ['/unban <id> ', 'Débannir par identifiant'],
  ['/kick <membre|@rôle> [raison]', 'Expulser un membre ou tout un rôle'],
  ['/timeout <membre> <min>', 'Rendre muet temporairement'],
  ['/nick <membre> <surnom>', 'Changer le surnom'],
  ['/dm <membre> <message>', 'Envoyer un message privé'],
  ['/status <texte>', "Changer l'activité affichée du bot"],
  ['/language [fr|en|es|ar]', 'Langue personnelle du terminal/GUI'],
  ['/language #all <lang>', 'Langue forcée du serveur (propriétaire)'],
  ['/link', 'Lien panneau de config (propriétaire)'],
  ['/whoami', 'Infos sur le bot connecté'],
  ['/help', 'Afficher cette aide'],
];

/**
 * Installe la console.
 * @param {object} opts
 * @param {import('discord.js').Client} opts.client
 * @param {(level:string, text:string)=>void} opts.log  affichage (cmd + GUI)
 * @param {boolean} opts.readStdin  lire le clavier de la fenêtre noire
 */
function setupConsole({ client, log, readStdin = true, langStore, isOwner, botT, getPlayer, langFor, setStatusText }) {
  const say = (t) => log('out', t);
  const ok = (t) => log('ok', t);
  const err = (t) => log('err', t);

  // Langue du terminal/GUI (l'opérateur local)
  const termLang = () => (langStore && langStore.getTerminal()) || 'fr';
  const STR = () => (botT ? botT(termLang()) : { linkTitle: 'Lien', linkOpen: (u) => u, langSetPersonal: (l) => l, langSetServer: (l) => l, langUnknown: (l) => l, langList: 'fr en es ar' });
  const runMusicCommand = (name, arg = '') => musicCommand(client, name, arg, { ok, err, getPlayer, prefix: '!', langFor, langStore, botT });

  /** Serveur par défaut : le seul, sinon le premier. */
  function defaultGuild() {
    return client.guilds.cache.first() || null;
  }

  async function run(line) {
    const raw = String(line || '').trim();
    if (!raw) return;
    if (!raw.startsWith('/')) {
      err('Les commandes commencent par « / ». Tapez /help pour la liste.');
      return;
    }
    const sp = raw.indexOf(' ');
    const cmd = (sp === -1 ? raw.slice(1) : raw.slice(1, sp)).toLowerCase();
    const rest = sp === -1 ? '' : raw.slice(sp + 1).trim();

    switch (cmd) {
      // ---------- Écrire dans un salon ----------
      case 'call':
      case 'say': {
        const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) return err('Utilisation : /call #salon votre message');
        const ch = findChannel(client, m[1], [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
        if (!ch) return err(`Salon introuvable : ${m[1]} — tapez /channels pour la liste.`);
        await ch.send(m[2]);
        ok(`✉ Envoyé dans #${ch.name} : ${m[2]}`);
        return;
      }

      case 'reply': {
        const m = rest.match(/^(\S+)\s+(\d{15,25})\s+([\s\S]+)$/);
        if (!m) return err('Utilisation : /reply #salon <id du message> votre réponse');
        const ch = findChannel(client, m[1], [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
        if (!ch) return err(`Salon introuvable : ${m[1]}`);
        const target = await ch.messages.fetch(m[2]).catch(() => null);
        if (!target) return err('Message introuvable dans ce salon.');
        await target.reply(m[3]);
        ok(`↩ Réponse envoyée dans #${ch.name}`);
        return;
      }

      // ---------- Vocal ----------
      case 'join': {
        // /join rejoint UNIQUEMENT le salon vocal où se trouve DÉJÀ
        // l'utilisateur sur Discord (pas de nom à taper). C'est le pont entre
        // le terminal et un utilisateur déjà en vocal — sans ça le bot ne peut
        // pas deviner où aller.
        return joinUserCurrentVoice(client, getPlayer, { ok, err });
      }

      case 'leave': {
        const g = defaultGuild();
        const player = g && getPlayer(g.id);
        if (!player || !player.connection) return err('Le bot n’est dans aucun salon vocal.');
        player.destroy();
        ok('👋 Le bot a quitté le salon vocal.');
        return;
      }

      // ---------- Listes ----------
      case 'channels': {
        const list = [...client.channels.cache.values()]
          .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
        if (!list.length) return err('Aucun salon texte visible.');
        say(`Salons texte (${list.length}) :`);
        for (const c of list) say(`  #${c.name}   [${c.guild?.name || '?'}]  id:${c.id}`);
        return;
      }

      case 'voices': {
        const list = [...client.channels.cache.values()]
          .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
        if (!list.length) return err('Aucun salon vocal visible.');
        say(`Salons vocaux (${list.length}) :`);
        for (const c of list) say(`  🔊 ${c.name}   [${c.guild?.name || '?'}]  id:${c.id}`);
        return;
      }

      case 'servers': {
        say(`Serveurs (${client.guilds.cache.size}) :`);
        for (const g of client.guilds.cache.values()) {
          say(`  ${g.name}  (${g.memberCount} membres)  id:${g.id}`);
        }
        return;
      }

      case 'members': {
        const g = defaultGuild();
        if (!g) return err('Le bot n’est sur aucun serveur.');
        const all = await g.members.fetch().catch(() => null);
        if (!all) return err('Impossible de lire la liste des membres (intent « Server Members » désactivé ?).');
        const nq = normalize(rest);
        const list = [...all.values()]
          .filter((m) => !nq || normalize(m.user.username).includes(nq) || normalize(m.displayName).includes(nq))
          .slice(0, 40);
        say(`Membres${rest ? ' contenant « ' + rest + ' »' : ''} (${list.length}) :`);
        for (const m of list) say(`  ${m.user.username}${m.nickname ? ' (' + m.nickname + ')' : ''}  id:${m.id}`);
        return;
      }

      // ---------- Modération ----------
      case 'ban':
      case 'kick': {
        const m = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/);
        if (!m) return err(`Utilisation : /${cmd} <membre ou @rôle> [raison]`);
        const g = defaultGuild();
        const perm = cmd === 'ban' ? PermissionsBitField.Flags.BanMembers : PermissionsBitField.Flags.KickMembers;
        if (!g.members.me.permissions.has(perm)) {
          return err(`Le bot n’a pas la permission de ${cmd === 'ban' ? 'bannir' : 'expulser'}.`);
        }
        const reason = m[2] || 'Depuis le panneau de contrôle';

        // Cible un rôle ? On applique à tous ses membres.
        const roleTarget = await findRole(g, m[1]);
        if (roleTarget) {
          const members = [...roleTarget.members.values()];
          if (!members.length) return err(`Le rôle @${roleTarget.name} n’a aucun membre.`);
          let done = 0;
          for (const member of members) {
            try {
              if (cmd === 'ban') await member.ban({ reason }); else await member.kick(reason);
              done++;
            } catch (_) { /* un membre peut échouer (permissions) */ }
          }
          ok(`${cmd === 'ban' ? '🔨 Bannis' : '👢 Expulsés'} : ${done}/${members.length} membre(s) du rôle @${roleTarget.name} (${reason})`);
          return;
        }

        const member = await findMember(g, m[1]);
        if (!member) return err(`Membre ou rôle introuvable : ${m[1]} — tapez /members ou /roles.`);
        if (cmd === 'ban') await member.ban({ reason });
        else await member.kick(reason);
        ok(`${cmd === 'ban' ? '🔨 Banni' : '👢 Expulsé'} : ${member.user.username} (${reason})`);
        return;
      }

      case 'roles': {
        const g = defaultGuild();
        const list = [...g.roles.cache.values()].sort((a, b) => b.position - a.position);
        if (!list.length) return err('Aucun rôle sur ce serveur.');
        say(`Rôles (${list.length}) :`);
        for (const r of list) say(`  @${r.name}   id:${r.id}`);
        return;
      }

      case 'unban': {
        const id = rest.trim();
        if (!/^\d{15,25}$/.test(id)) return err('Utilisation : /unban <identifiant du membre>');
        const g = defaultGuild();
        await g.bans.remove(id, 'Depuis le panneau de contrôle');
        ok(`✅ Débanni : ${id}`);
        return;
      }

      case 'timeout': {
        const m = rest.match(/^(\S+)\s+(\d+)$/);
        if (!m) return err('Utilisation : /timeout <membre> <minutes>  (0 pour annuler)');
        const g = defaultGuild();
        const member = await findMember(g, m[1]);
        if (!member) return err(`Membre introuvable : ${m[1]}`);
        const min = Number(m[2]);
        await member.timeout(min > 0 ? min * 60000 : null, 'Depuis le panneau de contrôle');
        ok(min > 0 ? `🔇 ${member.user.username} muet pendant ${min} min.` : `🔊 ${member.user.username} n’est plus muet.`);
        return;
      }

      case 'nick': {
        const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) return err('Utilisation : /nick <membre> <nouveau surnom>');
        const g = defaultGuild();
        const member = await findMember(g, m[1]);
        if (!member) return err(`Membre introuvable : ${m[1]}`);
        await member.setNickname(m[2]);
        ok(`✏ Surnom de ${member.user.username} : ${m[2]}`);
        return;
      }

      case 'dm': {
        const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
        if (!m) return err('Utilisation : /dm <membre> <message>');
        const g = defaultGuild();
        const member = await findMember(g, m[1]);
        if (!member) return err(`Membre introuvable : ${m[1]}`);
        await member.send(m[2]);
        ok(`📩 Message privé envoyé à ${member.user.username}`);
        return;
      }

      // ---------- Musique (pilote le bot comme si on était sur Discord) ----------
      case 'play': {
        const q = rest.trim();
        if (!q) return err('Utilisation : /play <recherche ou lien YouTube/Spotify>');
        return runMusicCommand('play', q);
      }
      case 'skip':
        return runMusicCommand('skip');
      case 'pause':
        return runMusicCommand('pause');
      case 'resume':
        return runMusicCommand('resume');
      case 'stop':
        return runMusicCommand('stop');
      case 'leave':
        return runMusicCommand('leave');
      case 'now':
      case 'np':
        return runMusicCommand('now');
      case 'queue':
      case 'q':
        return runMusicCommand('queue');
      case 'volume': {
        if (!rest.trim()) return err('Utilisation : /volume <0-100>');
        return runMusicCommand('volume', rest.trim());
      }
      case 'loop':
        return runMusicCommand('loop', rest.trim());
      case 'shuffle':
        return runMusicCommand('shuffle');

      // ---------- Lien de configuration (propriétaire) + Langue ----------
      case 'link': {
        // Sur le terminal, l'opérateur local est considéré comme le propriétaire.
        const url = `http://localhost:${process.env.GUI_PORT || 7790}/`;
        ok(`🔗 ${STR().linkTitle}`);
        ok(STR().linkOpen(url));
        return;
      }
      case 'language': {
        const m = rest.match(/^(#all\s+)?(\S+)$/i);
        if (!m) { ok(STR().langList); return; }
        const forced = !!m[1];
        const lang = (m[2] || '').toLowerCase();
        const LANGS = ['fr', 'en', 'es', 'ar'];
        if (!LANGS.includes(lang)) { err(STR().langUnknown(lang)); return; }
        if (forced) { langStore.setServer((defaultGuild() || {}).id, lang, true); ok(STR().langSetServer(lang)); }
        else { langStore.setTerminal(lang); ok(STR().langSetPersonal(lang)); }
        return;
      }

      // ---------- Divers ----------
      case 'status': {
        if (!rest) return err('Utilisation : /status <texte affiché>');
        if (typeof setStatusText === 'function') setStatusText(rest);
        else client.user.setActivity(rest, { type: 2 }); // 2 = Écoute
        ok(`🎧 Texte d’activité enregistré : « ${rest} »`);
        return;
      }

      case 'whoami': {
        const u = client.user;
        say(`Bot : ${u.username} (id ${u.id})`);
        say(`Serveurs : ${client.guilds.cache.size} | Salons : ${client.channels.cache.size}`);
        return;
      }

      case 'help': {
        say('Commandes disponibles depuis le terminal :');
        for (const [c, d] of HELP) say(`  ${c.padEnd(28)} ${d}`);
        return;
      }

      default:
        err(`Commande inconnue : /${cmd} — tapez /help.`);
    }
  }

  /** Exécute une ligne en attrapant les erreurs (jamais de plantage). */
  async function handle(line) {
    try {
      await run(line);
    } catch (e) {
      err(`Erreur : ${e.message}`);
    }
  }

  // Lecture du clavier (fenêtre noire OU pipe du serveur GUI).
  // On attache le handler dès que readStdin est vrai, sans condition sur isTTY :
  // quand le bot est lancé par le serveur GUI, son stdin est un pipe (isTTY = undefined/false),
  // et c'est précisément là qu'on veut lire les commandes envoyées par le panneau.
  if (readStdin) {
    process.stdin.setEncoding('utf8');
    let buffer = '';
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, '');
        buffer = buffer.slice(i + 1);
        if (line.trim()) handle(line);
      }
    });
    process.stdin.resume();
  }

  return { handle, HELP, findChannel, findMember };
}

module.exports = { setupConsole, HELP };
