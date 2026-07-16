# 🎵 Bot Discord Musique - Node.js

Un bot Discord complet pour jouer de la musique avec discord.js!

## ⚡ Démarrage Rapide (5 minutes)

### 1. Prérequis
```bash
# Vérifier que vous avez Node.js 18+
node --version

# Vérifier que FFmpeg est installé
ffmpeg -version
```

### 2. Installer les dépendances
```bash
npm install
```

### 3. Créer le bot Discord
1. Allez sur https://discord.com/developers/applications
2. Cliquez "New Application"
3. Onglet "Bot" → "Add Bot"
4. Copiez le TOKEN
5. Onglet "OAuth2" → "URL Generator"
   - Scopes: `bot`
   - Permissions: `Send Messages`, `Connect`, `Speak`
6. Copiez l'URL et acceptez le bot sur votre serveur

### 4. Configurer le token
1. Ouvrez `.env`
2. Remplacez `votre_token_discord_ici` par votre token
3. Sauvegardez

### 5. Lancer le bot
```bash
npm start
```

## 🎵 Commandes

```
!play [lien ou recherche]   → Joue une musique
!pause                      → Met en pause
!resume                     → Reprend
!skip                       → Passe à la suivante
!stop                       → Arrête tout
!queue                      → File d'attente
!volume [0-100]             → Change le volume
!now                        → Chanson en cours
!leave                      → Bot quitte
!help                       → Aide
```

## 📁 Structure du Projet

```
discord-music-bot/
├── bot.js              # Fichier principal
├── package.json        # Dépendances
├── .env                # Configuration
└── commands/           # Dossier des commandes
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

## 🚀 Features

✅ Jouer de la musique YouTube  
✅ File d'attente  
✅ Contrôle du volume  
✅ Pause/Resume  
✅ Skip/Stop  
✅ Interface élégante avec embeds  
✅ Gestion d'erreurs robuste  
✅ Système de commandes modulaire  

## 🐛 Dépannage

**"command not found: node"**
→ Installer Node.js depuis https://nodejs.org/

**"FFmpeg not found"**
→ Installer FFmpeg

**"Invalid token"**
→ Vérifier que le token dans .env est correct

**"Cannot find module"**
→ Lancer `npm install`

**Le bot ne répond pas**
→ Vérifier que Message Content Intent est activé sur Discord Developer Portal

## 📚 Documentation Complète

- **[INSTALLATION_NODEJS.md](INSTALLATION_NODEJS.md)** - Guide complet d'installation
- **[FEATURES_BONUS_NODEJS.md](FEATURES_BONUS_NODEJS.md)** - Features additionnelles

## 🔒 Sécurité

⚠️ **NE JAMAIS PARTAGER VOTRE TOKEN!**

Utilisez `.env` pour les secrets:
```
DISCORD_TOKEN=votre_token_ici
```

Ajoutez `.env` au `.gitignore`

## 📞 Support

- [Discord.js Documentation](https://discord.js.org/)
- [Discord API Docs](https://discord.com/developers/docs)
- [play-dl GitHub](https://github.com/play-dl/play-dl)

## 📄 Licence

MIT

## 🎮 Exemples d'utilisation

```
# Jouer une chanson
!play Never Gonna Give You Up

# Jouer depuis YouTube
!play https://www.youtube.com/watch?v=dQw4w9WgXcQ

# Afficher la queue
!queue

# Mettre en pause
!pause

# Reprendre
!resume

# Passer à la suivante
!skip

# Arrêter
!stop

# Régler le volume à 50%
!volume 50

# Afficher l'aide
!help
```

## 💡 Prochaines Étapes

1. [Ajouter les features bonus](FEATURES_BONUS_NODEJS.md)
2. [Déployer en production](INSTALLATION_NODEJS.md#-déploiement-en-production)
3. Ajouter une base de données
4. Implémenter Spotify
5. Créer un site web de gestion

---

Bon amusement! 🎶

Besoin d'aide? Consultez les guides complets fournis!
