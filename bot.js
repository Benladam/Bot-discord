/**
 * bot.js — Point d'entrée du bot Discord multifonction.
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
require('dotenv').config({ path: path.join(__dirname, '.env.minecraft'), quiet: true });
const { MusicPlayer } = require('./utils/musicPlayer');
const guildDatabase = require('./utils/database');
const { createUpdater } = require('./utils/updater');
const { createMinecraftBridge } = require('./utils/minecraftBridge');
const { PresenceManager } = require('./utils/presenceManager');
const { GuildNowPlayingManager } = require('./utils/guildNowPlaying');

const { setupConsole } = require('./console-commands');
const langStore = require('./langStore');
const { t: botT } = require('./botI18n');
// Les ponts de Test exposent une commande distante sans authentification.
// Ils restent désactivés par défaut, en particulier sur l'hébergement public.
const ENABLE_TEST_MODULES = /^(1|true|yes)$/i.test(String(process.env.ENABLE_TEST_MODULES || 'false'));
if (ENABLE_TEST_MODULES) {
  try { require('./Test/wsBridge'); } catch (e) { console.error('[wsBridge] ' + e.message); }
}

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

const updater = createUpdater({
  client,
  database: guildDatabase,
  log: (level, message) => {
    if (level === 'error') Logger.error(message);
    else if (level === 'warn') Logger.warn(message);
    else Logger.info(message);
  },
});
const presence = new PresenceManager({
  client,
  database: guildDatabase,
  log: (level, message) => {
    if (level === 'warn') Logger.warn(message);
    else Logger.info(message);
  },
});
const guildNowPlaying = new GuildNowPlayingManager({
  client,
  database: guildDatabase,
  log: (level, message) => level === 'warn' ? Logger.warn(message) : Logger.info(message),
});

client.commands = new Collection(); // nom -> module de commande
client.musicPlayers = new Collection(); // guildId -> MusicPlayer
let botConsole = null;                  // console terminal (voir ClientReady)
// Callbacks de présence (déclarés ici car getPlayer peut être appelé avant ClientReady)
let c_user_setActivity = (info) => presence.setMusicActivity('console', info);
let c_defaultActivity = () => presence.setMusicActivity('console', null);
client.cooldowns = new Collection();

function getPlayer(guildId) {
  if (!client.musicPlayers.has(guildId)) {
    const p = new MusicPlayer(guildId, client);
    if (guildId) {
      const savedVolume = Number(guildDatabase.getGuildSetting(guildId, 'defaultVolume', 1));
      p.volume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 1;
    }
    // Le statut de lecture est publié dans un message propre à cette guilde.
    p.onActivityChange = (state) => guildNowPlaying.update(p, state);
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

const deps = { getPlayer, prefix: PREFIX, isOwner, langFor, langStore, botT, updater, database: guildDatabase, presence, logger: Logger, commands: client.commands };
const minecraftBridge = createMinecraftBridge({
  client,
  getPlayer,
  database: guildDatabase,
  logger: Logger,
});

// --- Mode de lancement rapide (Phase 5) ---
// BOT_MODE = 'all' (défaut) | 'music' (musique seule) | 'admin' (admin seule)
const BOT_MODE = (process.env.BOT_MODE || 'all').toLowerCase();
const MUSIC_CMDS = new Set(['play', 'playlist', 'pause', 'resume', 'skip', 'stop', 'queue', 'now', 'volume', 'loop', 'shuffle', 'leave', 'help']);
const CORE_CMDS = new Set(['link', 'language', 'update', 'updatelog', 'presence', 'about']);
function commandMode(name) {
  if (CORE_CMDS.has(name)) return 'core';
  if (MUSIC_CMDS.has(name)) return 'music';
  return 'admin'; // modération et outils serveur
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
    if (cmd.data.defaultMemberPermissions !== undefined) {
      builder = builder.setDefaultMemberPermissions(cmd.data.defaultMemberPermissions);
    }
    // Les options sont définies dans `data.options` par les modules de commande.
    // Accepte aussi `cmd.options` pour rester compatible avec d'anciens modules.
    const options = Array.isArray(cmd.data.options) ? cmd.data.options : cmd.options;
    if (Array.isArray(options)) {
      for (const opt of options) {
        if (opt.type === 4) builder = builder.addIntegerOption((o) => {
          o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required);
          if (Number.isInteger(opt.minValue)) o.setMinValue(opt.minValue);
          if (Number.isInteger(opt.maxValue)) o.setMaxValue(opt.maxValue);
          return o;
        });
        else if (opt.type === 3) builder = builder.addStringOption((o) => {
          o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required);
          if (Array.isArray(opt.choices)) o.addChoices(...opt.choices);
          else if (opt.autocomplete) o.setAutocomplete(true);
          if (Number.isInteger(opt.minLength)) o.setMinLength(opt.minLength);
          if (Number.isInteger(opt.maxLength)) o.setMaxLength(opt.maxLength);
          return o;
        });
        else if (opt.type === 5) builder = builder.addBooleanOption((o) => o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required));
        else if (opt.type === 6) builder = builder.addUserOption((o) => o.setName(opt.name).setDescription(opt.description || '').setRequired(!!opt.required));
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
  c_defaultActivity = () => presence.setMusicActivity('console', null);
  c_user_setActivity = (info = {}) => presence.setMusicActivity('console', info);
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
  presence.start();
  c_defaultActivity();
  updater.start();



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
    setStatusText: (text) => presence.update({ messages: [text] }),
    langStore,
    isOwner,
    botT,
    getPlayer,
    langFor,
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
    if (await minecraftBridge.handleLinkButton(interaction)) return;
  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    if (interaction.customId?.startsWith('playcat:')) {
      try { await client.commands.get('play')?.handleCatalogInteraction?.(interaction, deps); }
      catch (e) {
        Logger.error(`Erreur catalogue musical: ${e.message}`);
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `Erreur catalogue : ${e.message}`, embeds: [], components: [] }).catch(() => {});
        else await interaction.reply({ content: `Erreur catalogue : ${e.message}`, ephemeral: true }).catch(() => {});
      }
      return;
    }
  }
  // Autocomplétion live de /play (recherche multi-résultats pendant la frappe)
  if (interaction.isAutocomplete()) {
    const cmd = client.commands.get(interaction.commandName);
    if (cmd && typeof cmd.autocomplete === 'function') {
      try { await cmd.autocomplete(interaction, deps); }
      catch (e) {
        Logger.error(`Erreur autocomplétion /${interaction.commandName}: ${e.message}`);
        if (!interaction.responded) await interaction.respond([]).catch(() => {});
      }
    } else if (!interaction.responded) {
      await interaction.respond([]).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  if (cmd.ownerOnly && !isOwner(interaction.user.id)) {
    const message = interaction.commandName === 'link'
      ? botT(langFor(interaction.user.id, interaction.guildId)).linkOnlyOwner
      : 'Cette commande est réservée au propriétaire du bot.';
    return interaction.reply({ content: message, ephemeral: true });
  }

  if (isInCooldown(interaction.user.id, interaction.commandName)) {
    return interaction.reply({ content: '⏱️ Trop rapide !', ephemeral: true });
  }

  try {
    Logger.info(`${interaction.user.tag} a utilisé /${interaction.commandName}`);
    // N'inclut que le texte dans les arguments: /play expose aussi
    // l'option booléenne "insert-first", qui ne doit pas devenir un mot recherché.
    const args = interaction.options.data
      .filter((opt) => typeof opt.value === 'string' || typeof opt.value === 'number')
      .map((opt) => String(opt.value));
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

  if (cmd.ownerOnly && !isOwner(message.author.id)) {
    return message.reply(name === 'link' ? botT(langFor(message.author.id, message.guild?.id)).linkOnlyOwner : 'Cette commande est réservée au propriétaire du bot.');
  }

  if (isInCooldown(message.author.id, name)) {
    return message.reply('⏱️ Trop rapide !');
  }

  try {
    const fullCmd = `${PREFIX}${name} ${args.join(' ')}`.trim();
    Logger.info(name === 'play'
      ? `${message.author.tag} ❯ ${PREFIX}play [requête musicale — détails sécurisés ci-dessous]`
      : `${message.author.tag} ❯ ${fullCmd}`);
    await cmd.execute(message, args, deps);
  } catch (e) {
    Logger.error(`Erreur ${PREFIX}${name}: ${e.message}`);
    await message.reply({ embeds: [{ title: '❌ Erreur', description: e.message, color: 0xff0000 }] });
  }
});

// Nettoie les connexions orphelines et confie l'inactivité au lecteur par serveur.
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
  player.handleVoiceStateUpdate(oldState.channelId, newState.channelId);
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
        '**Heuss l\'Enfoiré** réunit musique, modération et outils pour ton serveur Discord.\n' +
        'Voici comment démarrer :',
      fields: [
        { name: '🎵 Jouer de la musique', value: 'Rejoins un salon vocal puis tape `/play <musique ou lien>`', inline: false },
        { name: '🖥️ Ouvrir le panneau (contrôleur)', value: 'Le panneau web s\'ouvre automatiquement au lancement du bot. Sinon tape `/controller`', inline: false },
        { name: '🛡️ Modération', value: '`/warn` · `/warnings` · `/timeout` · `/clear` · `/kick` · `/ban`', inline: false },
        { name: '🧰 Outils serveur', value: '`/ping` · `/userinfo` · `/serverinfo` · `/avatar` · `/poll`', inline: false },
        { name: '❓ Aide', value: 'Tape `/help` pour la liste des commandes, `/about` pour les crédits.', inline: false },
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

// --- Hook de pilotage externe (Test/ : réservé aux essais sur machine privée) ---
if (ENABLE_TEST_MODULES) {
  try { require('./Test/botHook')(client, deps); } catch (e) { Logger.error(`Hook Test: ${e.message}`); }
}

module.exports = { client, getPlayer };
