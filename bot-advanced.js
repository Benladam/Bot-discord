/**
 * Bot Discord Musique - Version Avancée
 * Avec gestion d'erreurs améliorée et structure OOP
 */

const { Client, Collection, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.COMMAND_PREFIX || '!';

if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN non trouvé dans .env');
  process.exit(1);
}

// Logger simple
class Logger {
  static info(message) {
    console.log(`ℹ️  [${new Date().toLocaleTimeString()}] ${message}`);
  }

  static success(message) {
    console.log(`✅ [${new Date().toLocaleTimeString()}] ${message}`);
  }

  static error(message) {
    console.error(`❌ [${new Date().toLocaleTimeString()}] ${message}`);
  }

  static warn(message) {
    console.warn(`⚠️  [${new Date().toLocaleTimeString()}] ${message}`);
  }
}

// Classe MusicPlayer améliorée
class MusicPlayer {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.current = null;
    this.connection = null;
    this.audioPlayer = null;
    this.volume = 0.5;
    this.isPlaying = false;
    this.isPaused = false;
    this.loopMode = 0; // 0: off, 1: song, 2: queue
    this.createdAt = Date.now();
  }

  addToQueue(song) {
    if (!song || !song.url) {
      throw new Error('Song must have URL property');
    }
    this.queue.push(song);
    return this.queue.length;
  }

  getNextSong() {
    if (this.queue.length > 0) {
      return this.queue.shift();
    }
    return null;
  }

  clearQueue() {
    this.queue = [];
  }

  shuffleQueue() {
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
  }

  removeSong(index) {
    if (index < 0 || index >= this.queue.length) {
      return null;
    }
    return this.queue.splice(index, 1)[0];
  }

  getQueueInfo() {
    return {
      current: this.current,
      queueLength: this.queue.length,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      volume: Math.round(this.volume * 100),
      loopMode: this.loopMode,
      uptime: Date.now() - this.createdAt
    };
  }

  destroy() {
    this.clearQueue();
    this.current = null;
    this.isPlaying = false;
    if (this.audioPlayer) {
      this.audioPlayer.stop();
    }
    if (this.connection) {
      this.connection.destroy();
    }
  }
}

// Client principal
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Collections
client.commands = new Collection();
client.musicPlayers = new Collection();
client.cooldowns = new Collection();

// Charger les commandes
const loadCommands = () => {
  const commandsPath = path.join(__dirname, 'commands');
  if (!fs.existsSync(commandsPath)) {
    Logger.warn('Dossier commands/ n\'existe pas');
    return;
  }

  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      if (command.data && command.execute) {
        client.commands.set(command.data.name, command);
        Logger.info(`Commande chargée: ${command.data.name}`);
      }
    } catch (error) {
      Logger.error(`Erreur lors du chargement de ${file}: ${error.message}`);
    }
  }
};

// Obtenir ou créer un player
function getPlayer(guildId) {
  if (!client.musicPlayers.has(guildId)) {
    client.musicPlayers.set(guildId, new MusicPlayer(guildId));
  }
  return client.musicPlayers.get(guildId);
}

// Utilitaires
function formatDuration(seconds) {
  if (!seconds) return 'Inconnue';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function isInCooldown(userId, commandName, cooldownTime = 2000) {
  const key = `${userId}-${commandName}`;
  if (client.cooldowns.has(key)) {
    return true;
  }
  client.cooldowns.set(key, true);
  setTimeout(() => client.cooldowns.delete(key), cooldownTime);
  return false;
}

// Events
client.once('ready', () => {
  Logger.success(`Bot connecté en tant que ${client.user.username}#${client.user.discriminator}`);
  Logger.info(`Utilisé par ${client.guilds.cache.size} serveur(s)`);
  client.user.setActivity(`${PREFIX}help | 🎵`, { type: 'LISTENING' });
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);

  if (!command) {
    // Ne pas répondre aux commandes inconnues
    return;
  }

  // Cooldown
  if (isInCooldown(message.author.id, commandName)) {
    return message.reply('⏱️ Vous utilisez trop rapidement les commandes!');
  }

  try {
    Logger.info(`${message.author.tag} a utilisé /${commandName}`);
    await command.execute(message, args, client, getPlayer);
  } catch (error) {
    Logger.error(`Erreur commande ${commandName}: ${error.message}`);
    
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Erreur')
      .setDescription(error.message || 'Une erreur s\'est produite')
      .setColor('#FF0000')
      .setTimestamp();

    try {
      await message.reply({ embeds: [errorEmbed] });
    } catch (err) {
      Logger.error(`Impossible de répondre: ${err.message}`);
    }
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const guild = newState.guild;
  const player = getPlayer(guild.id);

  // Bot a quitté le canal
  if (oldState.member?.id === client.user.id && oldState.channelId && !newState.channelId) {
    player.destroy();
    Logger.info(`Bot déconnecté de ${guild.name}`);
  }

  // Tout le monde a quitté le canal (sauf le bot)
  if (oldState.channelId && newState.channelId === oldState.channelId) {
    const voiceChannel = guild.channels.cache.get(oldState.channelId);
    if (voiceChannel && voiceChannel.members.size === 1 && voiceChannel.members.has(client.user.id)) {
      // Optionnel: bot quitte après 5 minutes d'inactivité
      setTimeout(() => {
        if (voiceChannel.members.size === 1) {
          player.destroy();
          Logger.info(`Bot quitte ${guild.name} (inactivité)`);
        }
      }, 5 * 60 * 1000);
    }
  }
});

// Gestion des erreurs
process.on('unhandledRejection', error => {
  Logger.error(`Erreur non capturée: ${error.message}`);
  console.error(error);
});

process.on('uncaughtException', error => {
  Logger.error(`Exception non capturée: ${error.message}`);
  console.error(error);
  process.exit(1);
});

// Charger et démarrer
loadCommands();
client.login(TOKEN);

module.exports = { getPlayer, MusicPlayer, Logger };
