const { Client, Collection, GatewayIntentBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuration
const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.COMMAND_PREFIX || '!';

// Vérifier le token
if (!TOKEN) {
  console.error('❌ DISCORD_TOKEN non trouvé dans .env');
  process.exit(1);
}

// Créer le client Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Collection pour les commandes
client.commands = new Collection();
client.musicPlayers = new Collection();

// Charger les commandes
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
  const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
  
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
    }
  }
}

// Classe pour gérer la musique
class MusicPlayer {
  constructor(guildId) {
    this.guildId = guildId;
    this.queue = [];
    this.current = null;
    this.connection = null;
    this.dispatcher = null;
    this.volume = 0.5;
    this.isPlaying = false;
    this.isPaused = false;
  }

  addToQueue(song) {
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

  skip() {
    if (this.dispatcher) {
      this.dispatcher.end();
      return true;
    }
    return false;
  }
}

// Obtenir ou créer un player pour un serveur
function getPlayer(guildId) {
  if (!client.musicPlayers.has(guildId)) {
    client.musicPlayers.set(guildId, new MusicPlayer(guildId));
  }
  return client.musicPlayers.get(guildId);
}

// Event: Bot prêt
client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.username}`);
  client.user.setActivity(`${PREFIX}help`, { type: 'LISTENING' });
});

// Event: Message reçu
client.on('messageCreate', async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  const command = client.commands.get(commandName);

  if (!command) {
    return message.reply(`❌ Commande introuvable. Tapez \`${PREFIX}help\` pour l'aide.`);
  }

  try {
    await command.execute(message, args, client, getPlayer);
  } catch (error) {
    console.error('Erreur:', error);
    message.reply(`❌ Une erreur s'est produite: ${error.message}`);
  }
});

// Event: Gestion des voix
client.on('voiceStateUpdate', async (oldState, newState) => {
  const guild = newState.guild;
  const player = getPlayer(guild.id);

  // Si le bot a quitté le canal
  if (oldState.member?.id === client.user.id && oldState.channelId && !newState.channelId) {
    player.clearQueue();
    player.isPlaying = false;
  }
});

// Lancer le bot
client.login(TOKEN);

// Gérer les erreurs non capturées
process.on('unhandledRejection', error => {
  console.error('Erreur non capturée:', error);
});
