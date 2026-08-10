/**
 * bot.js — Point d'entrée du bot musique Discord (YouTube + Spotify).
 * Supporte à la fois les commandes slash (/) et le préfixe (!).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
require('dotenv').config();
const { MusicPlayer } = require('./utils/musicPlayer');

// === BYPASS vocal local : on force discord.js a annoncer l'IP publique ===
// (au lieu de 192.168.1.x) lors de la IP discovery, sinon Discord envoie
// l'audio vers une IP inateignable et le son ne sort jamais.
const PUBLIC_IP = process.env.PUBLIC_IP || '87.91.140.78';
const _networkInterfaces = os.networkInterfaces.bind(os);
os.networkInterfaces = function () {
  const orig = _networkInterfaces();
  // Injecte une fausse interface avec l'IP publique en premier
  return Object.assign({}, orig, {
    '__public__': [{ address: PUBLIC_IP, family: 'IPv4', internal: false }],
  });
};
// discord.js lit parfois via dns ou une autre methode ; on patch aussi si besoin.
console.log('[bypass] IP publique forcee pour la voix : ' + PUBLIC_IP);
const { setupConsole } = require('./console-commands');
const langStore = require('./langStore');
const { t: botT } = require('./botI18n');

// --- Configuration ---
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.COMMAND_PREFIX || '!';
const CLIENT_ID = process.env.CLIENT_ID; // optionnel : fourni sinon déduit au login

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN introuvable dans .env');
  process.exit(1);
}

// Logger simple
const Logger = {
  info: (m) => console.log(`ℹ️  [${new Date().toLocaleTimeString()}] ${m}`),
  success: (m) => console.log(`✅ [${new Date().toLocaleTimeString()}] ${m}`),
  error: (m) => console.error(`❌ [${new Date().toLocaleTimeString()}] ${m}`),
  warn: (m) => console.warn(`⚠️  [${new Date().toLocaleTimeString()}] ${m}`),
};

// --- Client ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection(); // nom -> module de commande
client.musicPlayers = new Collection(); // guildId -> MusicPlayer
let botConsole = null;                  // console terminal (voir ClientReady)
// Callbacks de présence (déclarés ici car getPlayer peut être appelé avant ClientReady)
let c_user_setActivity = () => {};
let c_defaultActivity = () => {};
client.cooldowns = new Collection();

function getPlayer(guildId) {
  if (!client.musicPlayers.has(guildId)) {
    const p = new MusicPlayer(guildId, client);
    // Quand la lecture change, on met à jour la présence (bio) du bot.
    p.onActivityChange = (info) => {
      if (info) c_user_setActivity(info);
      else c_defaultActivity();
    };
    client.musicPlayers.set(guildId, p);
  }
  return client.musicPlayers.get(guildId);
}

// --- Propriétaire du bot (pour /link et commandes réservées) ---
// Priorité : OWNER_ID du .env, sinon le propriétaire de l'application Discord.
let ownerId = process.env.OWNER_ID || null;
async function resolveOwnerId() {
  try {
    const app = await client.application?.fetch?.();
    if (app && app.owner && app.owner.id) ownerId = app.owner.id;
  } catch (_) { /* application peut être indisponible */ }
  return ownerId;
}
function isOwner(userId) { return !!ownerId && userId === ownerId; }

// Langue effective pour un utilisateur/serveur donné.
function langFor(userId, guildId) { return langStore.resolve(userId, guildId); }

const deps = { getPlayer, prefix: PREFIX, isOwner, langFor, langStore, botT };

// --- Mode de lancement rapide (Phase 5) ---
// BOT_MODE = 'all' (défaut) | 'music' (musique seule) | 'admin' (admin seule)
const BOT_MODE = (process.env.BOT_MODE || 'all').toLowerCase();
const MUSIC_CMDS = new Set(['play', 'pause', 'resume', 'skip', 'stop', 'queue', 'now', 'volume', 'loop', 'shuffle', 'leave', 'help']);
const CORE_CMDS = new Set(['link', 'language']);
function commandMode(name) {
  if (CORE_CMDS.has(name)) return 'core';
  if (MUSIC_CMDS.has(name)) return 'music';
  return 'admin'; // ban, kick, timeout, nick, dm, etc.
}
function commandAllowed(name) {
  const m = commandMode(name);
  if (m === 'core') return true;
  if (BOT_MODE === 'music') return m === 'music';
  if (BOT_MODE === 'admin') return m === 'admin';
  return true; // 'all'
}

// --- Chargement des commandes depuis commands/ ---
function loadCommands() {
  const dir = path.join(__dirname, 'commands');
  if (!fs.existsSync(dir)) {
    Logger.warn('Dossier commands/ introuvable');
    return;
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    try {
      const cmd = require(path.join(dir, file));
      if (cmd.data && cmd.data.name && typeof cmd.execute === 'function') {
        if (!commandAllowed(cmd.data.name)) {
          Logger.info(`Commande désactivée (mode ${BOT_MODE}) : ${cmd.data.name}`);
          continue;
        }
        client.commands.set(cmd.data.name, cmd);
        Logger.info(`Commande chargée: ${cmd.data.name}`);
      }
    } catch (e) {
      Logger.error(`Erreur chargement ${file}: ${e.message}`);
    }
  }
}

// --- Construction des slash commands pour l'API Discord ---
function buildSlashCommands() {
  const arr = [];
  for (const cmd of client.commands.values()) {
    if (!cmd.slash) continue;
    let builder = new SlashCommandBuilder()
      .setName(cmd.data.name)
      .setDescription(cmd.data.description || 'Commande');
    if (Array.isArray(cmd.options)) {
      for (const opt of cmd.options) {
        if (opt.type === 4) builder = builder.addIntegerOption((o) => o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required));
        else if (opt.type === 3) builder = builder.addStringOption((o) => o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required).setAutocomplete(!!opt.autocomplete));
        else if (opt.type === 5) builder = builder.addBooleanOption((o) => o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required));
      }
    }
    arr.push(builder.toJSON());
  }
  return arr;
}

async function registerSlashCommands(clientId) {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const commands = buildSlashCommands();
  Logger.info(`Enregistrement de ${commands.length} slash command(s)...`);
  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  Logger.success('Slash commands enregistrées.');
}

// --- Gestion du délai de réflexion (cooldown) ---
function isInCooldown(userId, name, ms = 2000) {
  const key = `${userId}-${name}`;
  if (client.cooldowns.has(key)) return true;
  client.cooldowns.set(key, true);
  setTimeout(() => client.cooldowns.delete(key), ms);
  return false;
}

// --- Events ---
client.once(Events.ClientReady, async (c) => {
  // Référence au client, utilisée par les callbacks de présence du player.
  let botUser = c.user;
  // Repli de présence (quand aucune musique ne joue).
  c_defaultActivity = () => {
    try { botUser.setActivity(`${PREFIX}play | 🎵`, { type: 2 }); } catch (_) { /* ignore */ }
  };
  // Présence personnalisée (musique en cours) — type 2 = « Écoute … ».
  c_user_setActivity = (info = {}) => {
    try {
      botUser.setActivity({
        type: 2,
        details: (info.details || '🎵 Musique').slice(0, 128),
        state: (info.state || 'Bot Discord musique').slice(0, 128),
      });
    } catch (_) { /* ignore */ }
  };
  // Callback partagé (player de bot.js et de la console).
  client._onActivityChange = c_user_setActivity;

  Logger.success(`Bot connecté en tant que ${c.user.username}`);
  Logger.info(`Présent sur ${c.guilds.cache.size} serveur(s)`);
  try {
    await registerSlashCommands(c.user.id);
  } catch (e) {
    Logger.error(`Échec enregistrement slash commands: ${e.message}`);
  }
  await resolveOwnerId();
  if (ownerId) Logger.info(`Propriétaire du bot : ${ownerId}`);
  c_defaultActivity();

  // === MODE TEST VOCAL AUTOMATIQUE (diagnostic) ===
  if (process.env.TEST_VOCAL === '1') {
    const GUILD_ID = '1527327658583527554';
    const VOCAL_ID = process.env.TEST_CHANNEL_ID || '1527327659955060769';
    setTimeout(async () => {
      try {
        const fs = require('fs');
        // Redirige tous les console.log (dont [voice]) vers vocal_diag.txt
        const _orig = console.log.bind(console);
        const _origErr = console.error.bind(console);
        console.log = (...a) => { _orig(...a); try { fs.appendFileSync('vocal_diag.txt', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (_) {} };
        console.error = (...a) => { _origErr(...a); try { fs.appendFileSync('vocal_diag.txt', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n'); } catch (_) {} };
        const diag = (s) => console.log(s);
        diag('=== DIAG VOCAL ' + new Date().toISOString() + ' ===');
        const guild = c.guilds.cache.get(GUILD_ID);
        const voiceChannel = c.channels.cache.get(VOCAL_ID);
        if (!guild || !voiceChannel) { diag('[TEST] guild ou salon introuvable'); return; }
        const member = guild.members.cache.get(c.user.id);
        member.voice.channel = voiceChannel;
        const ctx = {
          guildId: GUILD_ID,
          channel: c.channels.cache.get('1527327659955060768'),
          member,
          user: c.user,
          author: c.user,
          reply: (o) => diag('[test-reply] ' + JSON.stringify(o).slice(0, 200)),
          editReply: (o) => diag('[test-edit] ' + JSON.stringify(o).slice(0, 200)),
        };
        const play = require('./commands/play');
        await play.execute(ctx, ['rk', 'ft', 'larry'], deps);
        diag('[TEST] play execute termine');
      } catch (e) {
        console.error('[TEST] erreur:', e);
      }
    }, 4000);
  }

  // Console : piloter le bot depuis le terminal, sans passer par Discord.
  botConsole = setupConsole({
    client: c,
    log: (level, text) => {
      if (level === 'err') Logger.error(text);
      else if (level === 'ok') Logger.success(text);
      else console.log(text);
    },
    readStdin: true,
    // Présence : on la met aussi à jour quand on lance une commande via le terminal.
    onActivityChange: c_user_setActivity,
    defaultActivity: c_defaultActivity,
    langStore,
    isOwner,
    botT,
  });
  Logger.info('Console prête — tapez /help pour les commandes (ex: /call #général salut).');

  // Écrit l'état de la file d'attente dans un fichier lu par le panneau GUI.
  // On écrit dans %APPDATA% car le dossier du projet (Documents/GitHub) est
  // souvent protégé en écriture par Windows (Controlled Folder Access / OneDrive).
  const APPDATA = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const QUEUE_DIR = path.join(APPDATA, 'bot-discord');
  try { fs.mkdirSync(QUEUE_DIR, { recursive: true }); } catch (_) {}
  const QUEUE_FILE = path.join(QUEUE_DIR, 'queue_state.json');
  setInterval(() => {
    try {
      const players = client.guilds.cache.map((g) => getPlayer(g.id));
      const states = {};
      for (const p of players) states[p.guildId] = p.getState();
      fs.writeFileSync(QUEUE_FILE, JSON.stringify(states), 'utf8');
    } catch (_) { /* ignore */ }
  }, 2000);
});

// Slash commands
client.on(Events.InteractionCreate, async (interaction) => {
  // Autocomplétion live de /play (recherche multi-résultats pendant la frappe)
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd && typeof cmd.autocomplete === 'function') {
      try { await cmd.autocomplete(interaction, deps); } catch (_) { /* ignore */ }
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  // Commande réservée au propriétaire : /link
  if (interaction.commandName === 'link' && !isOwner(interaction.user.id)) {
    return interaction.reply({ content: botT(langFor(interaction.user.id, interaction.guildId)).linkOnlyOwner, ephemeral: true });
  }

  if (isInCooldown(interaction.user.id, interaction.commandName)) {
    return interaction.reply({ content: '⏱️ Trop rapide !', ephemeral: true });
  }

  try {
    Logger.info(`${interaction.user.tag} a utilisé /${interaction.commandName}`);
    const args = [];
    for (const opt of interaction.options.data) {
      if (opt.value !== undefined) args.push(String(opt.value));
    }
    await cmd.execute(interaction, args, deps);
  } catch (e) {
    Logger.error(`Erreur /${interaction.commandName}: ${e.message}`);
    const err = { embeds: [{ title: '❌ Erreur', description: e.message, color: 0xff0000 }] };
    if (interaction.deferred || interaction.replied) await interaction.editReply(err);
    else await interaction.reply(err);
  }
});

// « Parler à travers le bot » sur Discord : un vrai membre écrit
//   /call salut tout le monde
// (sans #salon) dans un salon texte. Le bot supprime le message du membre
// et le re-poste en son nom. Évite le spam : ne réagit QU'à « /call » et
// ignore les messages du bot et ceux qui contiennent déjà un #salon.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.toLowerCase().startsWith('/call ')) return;      // uniquement /call
  const body = content.slice(6).trim();
  if (!body || body.includes('#')) return;                     // #salon -> commande terminal, on ignore
  try {
    await message.delete().catch(() => {});                     // supprime le message du membre
    await message.channel.send(`${message.member ? message.member.displayName : message.author.username} : ${body}`);
  } catch (e) {
    Logger.error(`/call (Discord) : ${e.message}`);
  }
});

// Commandes préfixe (!)
client.on(Events.MessageCreate, async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const name = args.shift().toLowerCase();
  const cmd = client.commands.get(name);
  if (!cmd) return;

  if (isInCooldown(message.author.id, name)) {
    return message.reply('⏱️ Trop rapide !');
  }

  try {
    const fullCmd = `${PREFIX}${name} ${args.join(' ')}`.trim();
    Logger.info(`${message.author.tag} ❯ ${fullCmd}`);
    await cmd.execute(message, args, deps);
  } catch (e) {
    Logger.error(`Erreur ${PREFIX}${name}: ${e.message}`);
    await message.reply({ embeds: [{ title: '❌ Erreur', description: e.message, color: 0xff0000 }] });
  }
});

// Déconnexion propre quand tout le monde quitte
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guild = newState.guild;
  const player = client.musicPlayers.get(guild.id);
  if (!player) return;

  // Le bot a été déconnecté
  if (oldState.member?.id === client.user.id && oldState.channelId && !newState.channelId) {
    player.destroy();
    Logger.info(`Bot déconnecté de ${guild.name}`);
    return;
  }
  // Tous les membres (sauf le bot) ont quitté -> inactivité
  if (oldState.channelId && newState.channelId === oldState.channelId) {
    const vc = guild.channels.cache.get(oldState.channelId);
    if (vc && vc.members.size === 1 && vc.members.has(client.user.id)) {
      setTimeout(() => {
        if (vc.members.size === 1) {
          player.destroy();
          Logger.info(`Bot quitte ${guild.name} (inactivité)`);
        }
      }, 5 * 60 * 1000);
    }
  }
});

// Message de bienvenue automatique quand le bot rejoint un nouveau serveur.
client.on(Events.GuildCreate, async (guild) => {
  try {
    // Salon système (celui défini par Discord) ou un salon "général" sinon.
    let channel = guild.systemChannel;
    if (!channel) {
      channel = guild.channels.cache.find((c) =>
        c.type === 0 && /^(général|general|accueil|welcome|bienvenue|chat)$/i.test(c.name)
      ) || guild.channels.cache.find((c) => c.type === 0);
    }
    if (!channel || !channel.permissionsFor(guild.members.me).has('SendMessages')) return;

    const embed = {
      color: 0x5865f2,
      title: `👋 Merci de m'avoir ajouté sur ${guild.name} !`,
      description:
        '**Heuss l\'Enfoiré** est un bot musique + modération pour ton serveur Discord.\n' +
        'Voici comment démarrer :',
      fields: [
        { name: '🎵 Jouer de la musique', value: 'Rejoins un salon vocal puis tape `/play <musique ou lien>`', inline: false },
        { name: '🖥️ Ouvrir le panneau (contrôleur)', value: 'Le panneau web s\'ouvre automatiquement au lancement du bot. Sinon tape `/controller`', inline: false },
        { name: '🛡️ Modération', value: '`/kick` · `/ban` · `/timeout` · `/nick` · `/dm`', inline: false },
        { name: '❓ Aide', value: 'Tape `/help` pour la liste des commandes', inline: false },
      ],
      footer: { text: 'Support : discord.gg/YpAyfZ9Bs7' },
    };
    await channel.send({ embeds: [embed] });
    Logger.info(`Message de bienvenue envoyé sur ${guild.name}`);
  } catch (e) {
    Logger.error(`Erreur message de bienvenue: ${e.message}`);
  }
});

// Erreurs non capturées
process.on('unhandledRejection', (e) => { Logger.error(`Rejet non géré: ${e?.message}`); });
process.on('uncaughtException', (e) => { Logger.error(`Exception: ${e?.message}`); });

loadCommands();
client.login(TOKEN).catch((e) => {
  Logger.error(`Échec de connexion: ${e.message}`);
  process.exit(1);
});

module.exports = { client, getPlayer };
