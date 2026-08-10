# 🎵 Guide d'Installation - Bot Discord Musique

## 📋 Prérequis

- Python 3.8 ou plus récent
- Un compte Discord
- FFmpeg installé sur votre système

## 1️⃣ Créer un Bot Discord

### Étape 1: Accéder au portail développeur Discord
1. Allez sur [Discord Developer Portal](https://discord.com/developers/applications)
2. Cliquez sur "New Application" et donnez-lui un nom
3. Allez dans l'onglet "Bot" et cliquez sur "Add Bot"

### Étape 2: Obtenir le Token
1. Dans l'onglet "Bot", sous "TOKEN", cliquez sur "Copy"
2. **⚠️ NE JAMAIS PARTAGER ce token** - Il donne accès complet à votre bot

### Étape 3: Configurer les permissions
1. Allez dans l'onglet "OAuth2" → "URL Generator"
2. Sélectionnez les scopes:
   - `bot`
3. Sélectionnez les permissions:
   - `Send Messages`
   - `Connect` (Voice)
   - `Speak` (Voice)
   - `Use Voice Activity`
4. Copiez l'URL générée et collez-la dans votre navigateur
5. Sélectionnez le serveur où ajouter le bot

## 2️⃣ Installation des dépendances

### Sur Windows
```bash
# Installer Python packages
pip install -r requirements.txt

# Installer FFmpeg
# Option 1: Avec chocolatey (si installé)
choco install ffmpeg

# Option 2: Télécharger manuellement
# https://ffmpeg.org/download.html
```

### Sur Linux (Ubuntu/Debian)
```bash
# Installer Python packages
pip install -r requirements.txt

# Installer FFmpeg
sudo apt-get update
sudo apt-get install ffmpeg
```

### Sur macOS
```bash
# Installer Python packages
pip install -r requirements.txt

# Installer FFmpeg avec Homebrew
brew install ffmpeg
```

## 3️⃣ Configuration du Bot

### Étape 1: Ajouter votre token
Ouvrez `discord_music_bot.py` et remplacez:
```python
TOKEN = "VOTRE_TOKEN_BOT_ICI"
```
Par votre token réel (ex: `TOKEN = "MjQ4OTc..."`

### Étape 2: Vérifier le chemin FFmpeg
Si FFmpeg n'est pas dans le PATH système, modifiez:
```python
FFMPEG_PATH = "/usr/bin/ffmpeg"  # Linux
FFMPEG_PATH = "C:\\ffmpeg\\bin\\ffmpeg.exe"  # Windows
```

## 4️⃣ Lancer le Bot

```bash
python discord_music_bot.py
```

Vous devriez voir:
```
✅ Bot connecté en tant que VotreBotName#1234
```

## 📖 Commandes Disponibles

| Commande | Description |
|----------|------------|
| `!play [lien/recherche]` | Joue une musique (YouTube, URL, texte de recherche) |
| `!pause` | Met en pause la musique |
| `!resume` | Reprend la musique |
| `!skip` | Passe à la prochaine musique |
| `!stop` | Arrête et vide la queue |
| `!queue` | Affiche la file d'attente |
| `!volume [0-100]` | Ajuste le volume (0-100%) |
| `!leave` | Le bot quitte le canal vocal |
| `!help` | Affiche l'aide |

## 💡 Exemples d'utilisation

```
!play https://www.youtube.com/watch?v=dQw4w9WgXcQ
!play Never Gonna Give You Up
!pause
!resume
!queue
!skip
!volume 50
!leave
```

## 🐛 Dépannage

### Le bot n'apparaît pas dans le serveur
- Vérifiez que vous avez accepté l'invitation du bot
- Vérifiez les permissions du serveur

### "FFmpeg not found"
- Vérifiez que FFmpeg est installé
- Vérifiez le chemin FFmpeg_PATH dans le code

### "Invalid token"
- Vérifiez que votre token est correct
- N'oubliez pas les guillemets autour du token

### Le bot ne peut pas se connecter au canal vocal
- Vérifiez que le bot a les permissions "Connect" et "Speak"
- Vérifiez que PyNaCl est installé: `pip install PyNaCl`

### "module 'discord' has no attribute 'FFmpegPCMAudio'"
- Assurez-vous que discord.py 2.0+ est installé
- Réinstallez: `pip install --upgrade discord.py`

## 🔒 Sécurité

- **NE JAMAIS** partager votre token
- **NE JAMAIS** mettre le token dans le code partagé
- Utilisez des variables d'environnement pour les déploiements en production:

```python
import os
from dotenv import load_dotenv

load_dotenv()
TOKEN = os.getenv('DISCORD_TOKEN')
bot.run(TOKEN)
```

## 📦 Fichier .env (optionnel, mais recommandé)

Créez un fichier `.env`:
```
DISCORD_TOKEN=votre_token_ici
```

Puis modifiez le code pour utiliser `.env`

## 🚀 Conseils pour un meilleur bot

1. **Ajouter une base de données** pour les playlists persistantes
2. **Implémenter Spotify** pour plus de sources musicales
3. **Ajouter des reactions** pour contrôler le bot
4. **Logging** pour tracker les erreurs
5. **Rôles** pour limiter l'accès aux commandes

## 📚 Ressources

- [Discord.py Documentation](https://discordpy.readthedocs.io/)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)

Bon amusement! 🎶
