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
  MessageFlags,
} = require('discord.js');
require('dotenv').config();
require('dotenv').config({ path: path.join(__dirname, '.env.minecraft'), quiet: true });
const { MusicPlayer } = require('./features/music/musicPlayer');
const guildDatabase = require('./core/database');
const { createUpdater } = require('./core/updater');
const { createMinecraftBridge } = require('./features/minecraft/bridge');
const { createWebPanel } = require('./features/web/server');
const { PresenceManager } = require('./features/presence/manager');
const { GuildNowPlayingManager } = require('./features/music/guildNowPlaying');
const { sanitizeDiagnosticText } = require('./features/music/musicLinkMetadata');

const { setupConsole } = require('./core/consoleCommands');
const { normalizeCommandPrefix, getGatewayIntents, parsePrefixedCommand } = require('./core/commandConfig');
const { buildSlashCommands } = require('./shared/discord/slashCommandBuilder');
const langStore = require('./core/i18n/langStore');
const { t: botT } = require('./core/i18n/botI18n');
// Les outils de Test ne sont jamais chargés par défaut. Leur activation exige
// un jeton fort; le pont WebSocket reste limité à localhost dans Test/wsBridge.js.
const TEST_MODULES_REQUESTED = /^(1|true|yes)$/i.test(String(
  process.env.ENABLE_TEST_HOOKS ?? process.env.ENABLE_TEST_MODULES ?? 'false',
));
const TEST_BRIDGE_TOKEN = String(process.env.TEST_BRIDGE_TOKEN || '');
const ENABLE_TEST_MODULES = TEST_MODULES_REQUESTED && Buffer.byteLength(TEST_BRIDGE_TOKEN, 'utf8') >= 32;
if (TEST_MODULES_REQUESTED && !ENABLE_TEST_MODULES) {
  console.error('[Test] Hooks désactivés : TEST_BRIDGE_TOKEN doit contenir au moins 32 octets.');
}
if (ENABLE_TEST_MODULES) {
  try { require('./Test/wsBridge'); } catch (e) { console.error('[wsBridge] ' + e.message); }
}

// --- Configuration ---
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = normalizeCommandPrefix(process.env.COMMAND_PREFIX ?? '!');
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
  intents: getGatewayIntents(GatewayIntentBits, PREFIX),
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
    const p = new MusicPlayer(guildId, client, {
      keepAlive: () => guildDatabase.getGuildSetting(guildId, 'music24_7', false) === true,
    });
    if (guildId) {
      const savedVolume = Number(guildDatabase.getGuildSetting(guildId, 'defaultVolume', 1));
      p.volume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 1;
    }
    // Le statut de lecture est publié dans un message propre à cette guilde.
    p.onActivityChange = (state) => guildNowPlaying.update(p, state);
    p.onQueueEnd = (_player, requesterId) => guildNowPlaying.finishQueue(p, requesterId);
    client.musicPlayers.set(guildId, p);
  }
  return client.musicPlayers.get(guildId);
}

// --- Propriétaire du bot (pour /link et commandes réservées) ---
// Priorité : OWNER_ID du .env, sinon le propriétaire de l'application Discord.
let ownerId = process.env.OWNER_ID || null;
async function resolveOwnerId() {
  if (ownerId) return ownerId;
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
const webPanel = createWebPanel({
  client,
  getPlayer,
  database: guildDatabase,
  logger: Logger,
});
const minecraftBridge = createMinecraftBridge({
  client,
  getPlayer,
  database: guildDatabase,
  logger: Logger,
  handleWebRequest: webPanel.handleHttp,
});

// --- Mode de lancement rapide (Phase 5) ---
// BOT_MODE = 'all' (défaut) | 'music' (musique seule) | 'admin' (admin seule)
const BOT_MODE = (process.env.BOT_MODE || 'all').toLowerCase();
const MUSIC_CMDS = new Set(['play', 'playlist', 'pause', 'resume', 'skip', 'stop', 'queue', 'now', 'volume', 'loop', 'shuffle', 'leave', '24-7', 'help']);
const CORE_CMDS = new Set(['controller', 'link', 'language', 'update', 'updatelog', 'presence', 'about']);
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
  return buildSlashCommands(client.commands);
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
    const cleared = await guildNowPlaying.resetAfterRestart(c.guilds.cache.map((guild) => guild.id));
    if (cleared) Logger.info(`${cleared} ancien(s) statut(s) musical(aux) retiré(s) après le redémarrage.`);
  } catch (error) {
    Logger.warn(`Nettoyage des anciens statuts musicaux impossible : ${error.message}`);
  }
  try {
    await registerSlashCommands(c.user.id);
  } catch (e) {
    Logger.error(`Échec enregistrement slash commands: ${e.message}`);
  }
  await resolveOwnerId();
  if (ownerId) Logger.info('Commandes réservées au propriétaire activées.');
  presence.start();
  c_defaultActivity();
  updater.start();
  await webPanel.start();



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
  Logger.info(`Console prête — tapez help pour les commandes.${PREFIX ? ` Préfixe Discord facultatif actif : ${PREFIX}` : ' Commandes texte Discord désactivées (utilisez les commandes slash).'}`);

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
    if (interaction.customId?.startsWith('musicctl:')) {
      try { await guildNowPlaying.handleControl(interaction, getPlayer); }
      catch (e) {
        Logger.error(`Erreur contrôle musical: ${e.message}`);
        if (interaction.deferred || interaction.replied) await interaction.followUp({ content: `Erreur contrôle musical : ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
        else await interaction.reply({ content: `Erreur contrôle musical : ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return;
    }
    if (interaction.customId?.startsWith('playcat:')) {
      try { await client.commands.get('play')?.handleCatalogInteraction?.(interaction, deps); }
      catch (e) {
        Logger.error(`Erreur catalogue musical: ${e.message}`);
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `Erreur catalogue : ${e.message}`, embeds: [], components: [] }).catch(() => {});
        else await interaction.reply({ content: `Erreur catalogue : ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
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
        Logger.error(`Erreur autocomplétion /${interaction.commandName}: ${sanitizeDiagnosticText(e.stack || e.message)}`);
        if (!interaction.responded) {
          try {
            const fallback = cmd.autocompleteFallback?.(interaction) || [];
            await interaction.respond(Array.isArray(fallback) ? fallback : [fallback]);
          } catch (fallbackError) {
            Logger.error(`Réponse de secours autocomplétion /${interaction.commandName} impossible: ${sanitizeDiagnosticText(fallbackError.message)}`);
          }
        }
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
    return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  }

  if (isInCooldown(interaction.user.id, interaction.commandName)) {
    return interaction.reply({ content: '⏱️ Trop rapide !', flags: MessageFlags.Ephemeral });
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
    else await interaction.reply({ ...err, flags: MessageFlags.Ephemeral });
  }
});

// Les commandes texte sont optionnelles : le mode slash n’a pas besoin de
// l’intent privilégié Message Content.
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  const parsed = parsePrefixedCommand(message.content, PREFIX);
  if (!parsed) return;
  const { name, args } = parsed;
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

    const displayName = String(process.env.BOT_DISPLAY_NAME || c.user?.username || 'Discord Music Bot').slice(0, 80);
    const supportUrl = (() => {
      try {
        const url = new URL(process.env.SUPPORT_URL || '');
        return url.protocol === 'https:' ? url.toString() : null;
      } catch (_) { return null; }
    })();
    const embed = {
      color: 0x5865f2,
      title: `👋 Merci de m'avoir ajouté sur ${guild.name} !`,
      description:
        `**${displayName}** réunit musique, modération et outils pour ton serveur Discord.\n` +
        'Voici comment démarrer :',
      fields: [
        { name: '🎵 Jouer de la musique', value: 'Rejoins un salon vocal puis tape `/play <musique ou lien>`', inline: false },
        { name: '🖥️ Ouvrir le panneau (contrôleur)', value: 'Le panneau web s\'ouvre automatiquement au lancement du bot. Sinon tape `/controller`', inline: false },
        { name: '🛡️ Modération', value: '`/warn` · `/warnings` · `/timeout` · `/clear` · `/kick` · `/ban`', inline: false },
        { name: '🧰 Outils serveur', value: '`/ping` · `/userinfo` · `/serverinfo` · `/avatar` · `/poll`', inline: false },
        { name: '❓ Aide', value: 'Tape `/help` pour la liste des commandes, `/about` pour les crédits.', inline: false },
      ],
      ...(supportUrl ? { footer: { text: `Support : ${supportUrl}` } } : {}),
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
