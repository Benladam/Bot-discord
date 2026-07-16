# 🚀 Features Bonus - Bot Discord Musique (Node.js)

## 1. 🔄 Commande Clear (Vider la queue)

Créez `commands/clear.js`:
```javascript
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'clear',
    description: 'Vide la file d\'attente',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);
    const size = player.queue.length;
    player.clearQueue();

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🗑️ Queue vidée')
        .setDescription(`${size} chanson(s) supprimée(s)`)
        .setColor('#FF0000')
      ]
    });
  }
};
```

## 2. 🔀 Commande Shuffle (Mélanger la queue)

Créez `commands/shuffle.js`:
```javascript
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'shuffle',
    description: 'Mélange la file d\'attente',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);

    if (player.queue.length === 0) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription('La queue est vide')
          .setColor('#FF0000')
        ]
      });
    }

    // Mélanger le tableau
    for (let i = player.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [player.queue[i], player.queue[j]] = [player.queue[j], player.queue[i]];
    }

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🔀 Queue mélangée')
        .setDescription(`${player.queue.length} chanson(s)`)
        .setColor('#00FF00')
      ]
    });
  }
};
```

## 3. 🎯 Commande Remove (Supprimer une chanson)

Créez `commands/remove.js`:
```javascript
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'remove',
    description: 'Supprime une chanson de la queue',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);
    const position = parseInt(args[0]);

    if (!position || position < 1 || position > player.queue.length) {
      return message.reply({
        embeds: [new EmbedBuilder()
          .setTitle('❌ Erreur')
          .setDescription(`Position invalide (1-${player.queue.length})`)
          .setColor('#FF0000')
        ]
      });
    }

    const removed = player.queue.splice(position - 1, 1)[0];

    message.reply({
      embeds: [new EmbedBuilder()
        .setTitle('🗑️ Chanson supprimée')
        .setDescription(`**${removed.title}**`)
        .setColor('#FF0000')
      ]
    });
  }
};
```

## 4. 📊 Commande Stats

Créez `commands/stats.js`:
```javascript
const { EmbedBuilder } = require('discord.js');

module.exports = {
  data: {
    name: 'stats',
    description: 'Affiche les statistiques',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);
    const voiceChannel = message.member.voice.channel;

    const embed = new EmbedBuilder()
      .setTitle('📊 Statistiques')
      .setColor('#800080')
      .addFields(
        { 
          name: 'Utilisateurs connectés', 
          value: voiceChannel ? `${voiceChannel.members.size}` : '0', 
          inline: true 
        },
        { 
          name: 'Serveurs', 
          value: `${client.guilds.cache.size}`, 
          inline: true 
        },
        { 
          name: 'Queue', 
          value: `${player.queue.length}`, 
          inline: true 
        },
        { 
          name: 'Volume', 
          value: `${Math.round(player.volume * 100)}%`, 
          inline: true 
        },
        { 
          name: 'État', 
          value: player.isPlaying ? '▶️ En lecture' : '⏹️ Arrêté', 
          inline: true 
        }
      );

    message.reply({ embeds: [embed] });
  }
};
```

## 5. 🎤 Commande Search (Recherche avancée)

Créez `commands/search.js`:
```javascript
const { EmbedBuilder } = require('discord.js');
const play = require('play-dl');

module.exports = {
  data: {
    name: 'search',
    description: 'Recherche une musique',
  },

  async execute(message, args, client, getPlayer) {
    const query = args.join(' ');

    if (!query) {
      return message.reply('❌ Veuillez spécifier un terme de recherche');
    }

    try {
      const results = await play.search(query, { limit: 5 });

      if (results.length === 0) {
        return message.reply('❌ Aucun résultat trouvé');
      }

      const embed = new EmbedBuilder()
        .setTitle('🔍 Résultats de recherche')
        .setDescription(`Recherche: \`${query}\``)
        .setColor('#FFA500');

      results.forEach((result, index) => {
        const duration = result.durationInSec || 0;
        const mins = Math.floor(duration / 60);
        const secs = duration % 60;
        const durationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

        embed.addFields({
          name: `${index + 1}. ${result.title.substring(0, 50)}`,
          value: `⏱️ ${durationStr}`,
          inline: false
        });
      });

      embed.setFooter({ text: 'Utilisez !play [lien] pour jouer' });
      message.reply({ embeds: [embed] });
    } catch (error) {
      message.reply(`❌ Erreur: ${error.message}`);
    }
  }
};
```

## 6. 🎯 Réactions pour contrôler le bot

Modifiez `bot.js` et ajoutez ceci:
```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.id === client.user.id) return;

  const message = reaction.message;
  const guild = message.guild;
  if (!guild) return;

  const emojiCommands = {
    '▶️': 'resume',
    '⏸️': 'pause',
    '⏭️': 'skip',
    '⏹️': 'stop',
    '🔀': 'shuffle',
  };

  if (emojiCommands[reaction.emoji.name]) {
    const cmd = emojiCommands[reaction.emoji.name];
    const command = client.commands.get(cmd);
    
    if (command) {
      const msg = { 
        guild, 
        author: user, 
        reply: (content) => message.reply(content) 
      };
      await command.execute(msg, [], client, getPlayer);
    }
  }
});
```

## 7. 📝 Base de données SQLite (Playlists)

Installez: `npm install sqlite3`

Créez `commands/saveplaylist.js`:
```javascript
const { EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../playlists.db'));

// Créer la table si elle n'existe pas
db.run(`CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY,
  user_id TEXT,
  name TEXT,
  songs TEXT
)`);

module.exports = {
  data: {
    name: 'saveplaylist',
    description: 'Sauve la queue en tant que playlist',
  },

  execute(message, args, client, getPlayer) {
    const player = getPlayer(message.guildId);
    const playlistName = args.join(' ');

    if (!playlistName) {
      return message.reply('❌ Veuillez spécifier un nom de playlist');
    }

    if (player.queue.length === 0) {
      return message.reply('❌ La queue est vide');
    }

    const songs = player.queue.map(s => s.url).join('|');

    db.run(
      'INSERT INTO playlists (user_id, name, songs) VALUES (?, ?, ?)',
      [message.author.id, playlistName, songs],
      (err) => {
        if (err) {
          return message.reply(`❌ Erreur: ${err.message}`);
        }

        message.reply({
          embeds: [new EmbedBuilder()
            .setTitle('💾 Playlist sauvegardée')
            .setDescription(`**${playlistName}** - ${player.queue.length} chanson(s)`)
            .setColor('#00FF00')
          ]
        });
      }
    );
  }
};
```

## 8. 📌 Commande Load Playlist

Créez `commands/loadplaylist.js`:
```javascript
const { EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3');
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../playlists.db'));

module.exports = {
  data: {
    name: 'loadplaylist',
    description: 'Charge une playlist sauvegardée',
  },

  execute(message, args, client, getPlayer) {
    const playlistName = args.join(' ');

    if (!playlistName) {
      return message.reply('❌ Veuillez spécifier le nom de la playlist');
    }

    db.get(
      'SELECT songs FROM playlists WHERE user_id = ? AND name = ?',
      [message.author.id, playlistName],
      async (err, row) => {
        if (err || !row) {
          return message.reply('❌ Playlist introuvable');
        }

        const player = getPlayer(message.guildId);
        const songs = row.songs.split('|');

        for (const url of songs) {
          player.addToQueue({ url, title: 'Chanson' });
        }

        message.reply({
          embeds: [new EmbedBuilder()
            .setTitle('📌 Playlist chargée')
            .setDescription(`${songs.length} chanson(s)`)
            .setColor('#00FF00')
          ]
        });
      }
    );
  }
};
```

## 9. 🌐 Support Spotify

Installez: `npm install spotify-url-info`

```javascript
const { getPreview } = require('spotify-url-info')(fetch);

// Dans la commande play, vérifier si c'est un lien Spotify
if (query.includes('spotify.com')) {
  const info = await getPreview(query);
  // Chercher sur YouTube avec le titre de la chanson Spotify
}
```

## 10. 🎙️ Système de Logs

Installez: `npm install winston`

Créez `utils/logger.js`:
```javascript
const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

module.exports = logger;
```

## 11. ⚡ Système de Cache

Ajoutez ceci dans `bot.js`:
```javascript
// Cache de 5 minutes pour les recherches
const searchCache = new Map();

function getCachedSearch(query) {
  if (searchCache.has(query)) {
    const cached = searchCache.get(query);
    if (Date.now() - cached.time < 5 * 60 * 1000) {
      return cached.data;
    }
  }
  return null;
}

function setCachedSearch(query, data) {
  searchCache.set(query, { data, time: Date.now() });
}
```

## 12. 🚀 Déploiement en Production

### Avec PM2 (Recommandé)
```bash
npm install -g pm2
pm2 start bot.js --name discord-music-bot
pm2 save
pm2 startup
```

### Avec Docker
Créez `Dockerfile`:
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

CMD ["npm", "start"]
```

```bash
docker build -t discord-music-bot .
docker run -d --env-file .env discord-music-bot
```

## 📦 Dependances supplémentaires

```bash
# Logs
npm install winston

# Base de données
npm install sqlite3 mongoose

# Spotify
npm install spotify-url-info

# Utilitaires
npm install axios moment

# PM2 (Production)
npm install -g pm2
```

## 🎯 Checklist pour améliorer le bot

- [ ] Ajouter des commandes bonus
- [ ] Implémenter la base de données
- [ ] Ajouter un système de logs
- [ ] Implémenter le cache
- [ ] Ajouter Spotify
- [ ] Système de reactions
- [ ] Configuration multi-serveur
- [ ] Déployer en production
- [ ] Ajouter un site web de gestion

## 📚 Ressources

- [Discord.js Guide](https://discordjs.guide/)
- [play-dl](https://github.com/play-dl/play-dl)
- [Winston Logger](https://github.com/winstonjs/winston)
- [PM2](https://pm2.keymetrics.io/)

Bon codage! 🚀
