# 🎵 Guide d'Installation - Bot Discord Musique (Node.js)

## 📋 Prérequis

- **Node.js 18+** ([Télécharger ici](https://nodejs.org/))
- **npm** (installé automatiquement avec Node.js)
- **FFmpeg** (obligatoire pour la lecture audio)
- Un compte Discord
- Git (optionnel)

## 1️⃣ Vérifier l'installation de Node.js

### Windows, macOS, Linux
```bash
node --version
npm --version
```

Vous devriez voir des numéros de version (ex: v18.0.0)

## 2️⃣ Créer un Bot Discord

### Étape 1: Accéder au portail développeur Discord
1. Allez sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Connectez-vous avec votre compte Discord
3. Cliquez sur **"New Application"** et donnez-lui un nom (ex: "BotMusique")
4. Acceptez les conditions et cliquez sur **"Create"**

### Étape 2: Créer le bot
1. Allez dans l'onglet **"Bot"**
2. Cliquez sur **"Add Bot"**
3. Sous **"TOKEN"**, cliquez sur **"Copy"**
4. **⚠️ NE JAMAIS PARTAGER ce token** - Il donne accès complet à votre bot

### Étape 3: Configurer les permissions
1. Allez dans l'onglet **"OAuth2"** → **"URL Generator"**
2. Sélectionnez les scopes:
   - ✅ `bot`
3. Sélectionnez les permissions:
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Attach Files`
   - ✅ `Connect` (Voice)
   - ✅ `Speak` (Voice)
   - ✅ `Use Voice Activity`
4. Copiez l'URL générée (en bas)
5. Ouvrez-la dans votre navigateur et sélectionnez le serveur où ajouter le bot

### Étape 4: Activer Message Content Intent
1. Retour à l'onglet **"Bot"**
2. Allez vers le bas, trouvez **"Privileged Gateway Intents"**
3. Activez **"Message Content Intent"**
4. Cliquez sur **"Save Changes"**

## 3️⃣ Installer FFmpeg

### Windows
**Option 1: Avec Chocolatey (si installé)**
```bash
choco install ffmpeg
```

**Option 2: Manuel**
1. Télécharger FFmpeg: https://ffmpeg.org/download.html
2. Extraire les fichiers
3. Ajouter le chemin au PATH système

### macOS
```bash
# Avec Homebrew
brew install ffmpeg

# Ou avec MacPorts
sudo port install ffmpeg
```

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install ffmpeg
```

### Vérifier FFmpeg
```bash
ffmpeg -version
```

## 4️⃣ Cloner/Télécharger le Bot

### Avec Git
```bash
git clone https://github.com/votre-username/discord-music-bot.git
cd discord-music-bot
```

### Ou sans Git
Téléchargez les fichiers et placez-les dans un dossier

## 5️⃣ Installation des Dépendances

```bash
# Dans le dossier du bot
npm install
```

Cela installera:
- `discord.js` - Framework Discord
- `@discordjs/voice` - Gestion audio
- `play-dl` - Téléchargement YouTube
- `dotenv` - Gestion des variables d'environnement
- `ffmpeg-static` - FFmpeg bundlé

## 6️⃣ Configuration

### Étape 1: Ajouter le token
1. Ouvrez le fichier `.env`
2. Remplacez `votre_token_discord_ici` par votre token réel
3. Sauvegardez le fichier

**Exemple:**
```
DISCORD_TOKEN=MjQ4OTc0NzM5NDU0MjM3NzA4.GqZ9kq.1234567890abcdefghijklmnopqrstuvwxyz
COMMAND_PREFIX=!
```

### Étape 2: Vérifier la structure des dossiers

```
discord-music-bot/
├── bot.js
├── package.json
├── .env
└── commands/
    ├── play.js
    ├── pause.js
    ├── resume.js
    ├── skip.js
    ├── stop.js
    ├── queue.js
    ├── volume.js
    ├── leave.js
    ├── now.js
    └── help.js
```

## 7️⃣ Lancer le Bot

### Mode Normal
```bash
npm start
```

### Mode Développement (avec rechargement automatique)
```bash
npm install --save-dev nodemon
npm run dev
```

### Résultat attendu
```
✅ Bot connecté en tant que BotMusique#1234
```

## 📖 Commandes Disponibles

| Commande | Description | Exemple |
|----------|------------|---------|
| `!play [lien/recherche]` | Joue une musique | `!play Never Gonna Give You Up` |
| `!pause` | Met en pause | `!pause` |
| `!resume` | Reprend la lecture | `!resume` |
| `!skip` | Passe à la suivante | `!skip` |
| `!stop` | Arrête et vide la queue | `!stop` |
| `!queue` | Affiche la file d'attente | `!queue` |
| `!volume [0-100]` | Ajuste le volume | `!volume 50` |
| `!now` | Chanson en cours | `!now` |
| `!leave` | Bot quitte le canal | `!leave` |
| `!help` | Affiche l'aide | `!help` |

## 🐛 Dépannage

### "command not found: node"
- Node.js n'est pas installé ou pas dans le PATH
- Téléchargez depuis https://nodejs.org/

### "FFmpeg not found"
```bash
# Vérifier l'installation
ffmpeg -version

# Windows: Ajouter au PATH système
# macOS/Linux: réinstaller avec brew/apt
```

### "Cannot find module 'discord.js'"
```bash
# Réinstaller les dépendances
npm install
```

### "Invalid token"
- Vérifiez que le token dans .env est correct
- Ne pas ajouter de caractères supplémentaires
- Vérifiez que Message Content Intent est activé

### "The bot isn't in the voice channel"
- Assurez-vous que le bot a les permissions "Connect" et "Speak"
- Vérifiez les permissions du serveur et du canal

### Le bot ne répond pas aux commandes
- Vérifiez que le préfixe est correct (!play, !skip, etc.)
- Vérifiez que Message Content Intent est activé
- Redémarrez le bot

## 🔒 Sécurité

### ⚠️ IMPORTANT
- **NE JAMAIS** committer le fichier `.env` sur Git
- **NE JAMAIS** partager votre token
- **NE JAMAIS** mettre le token dans le code public

### Ajouter .gitignore
```
node_modules/
.env
.env.local
*.log
```

## 🚀 Conseils pour un meilleur bot

### 1. Ajouter des commandes supplémentaires
- `clear` - Vider la queue
- `shuffle` - Mélanger la queue
- `loop` - Boucle une chanson

### 2. Ajouter des réactions pour contrôler le bot
```javascript
// Dans une embed de musique
await message.react('▶️');
await message.react('⏸️');
await message.react('⏭️');
```

### 3. Implémenter la persistance
- Base de données SQLite pour les playlists
- Sauvegarder les queues des utilisateurs

### 4. Ajouter Spotify
```bash
npm install spotify-url-info
```

### 5. Système de logs
```bash
npm install winston
```

### 6. Déployer en production
- **Heroku** (gratuit avec limitations)
- **Railway** (payant, fiable)
- **Replit** (gratuit)
- **Serveur personnel** (VPS)

## 📚 Ressources Utiles

- [Discord.js Documentation](https://discord.js.org/)
- [Discord API](https://discord.com/developers/docs/intro)
- [@discordjs/voice](https://discord.js.org/#/docs/voice)
- [play-dl GitHub](https://github.com/play-dl/play-dl)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)

## ❓ Questions Fréquentes

**Q: Puis-je utiliser le bot sur plusieurs serveurs?**
A: Oui, le bot fonctionnera sur tous les serveurs où il est invité.

**Q: Puis-je modifier le préfixe?**
A: Oui, modifiez `COMMAND_PREFIX` dans `.env`

**Q: Comment ajouter plus de commandes?**
A: Créez un fichier `.js` dans le dossier `commands/` avec la structure requise.

**Q: Le bot peut-il jouer des fichiers locaux?**
A: Oui, modifiez `play.js` pour supporter les chemins fichiers.

**Q: Comment héberger le bot 24/7?**
A: Utilisez un service d'hébergement ou un serveur personnel.

---

Bon amusement avec votre bot! 🎶

Si vous avez des problèmes, vérifiez:
1. ✅ Node.js 18+ installé
2. ✅ FFmpeg installé
3. ✅ Token valide dans .env
4. ✅ Message Content Intent activé
5. ✅ Permissions du bot correctes
