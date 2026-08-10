# 📁 Structure du Projet Discord Music Bot

## Arborescence Complète

```
discord-music-bot/
│
├── bot.js                           # Fichier principal (version standard)
├── bot-advanced.js                  # Version avancée avec OOP
├── package.json                     # Dépendances Node.js
├── .env                            # Configuration (ne pas commiter!)
├── .env.example                    # Exemple de configuration
├── .gitignore                      # Fichiers à ignorer sur Git
│
├── commands/                       # Dossier des commandes
│   ├── play.js                    # Commande: jouer une musique
│   ├── pause.js                   # Commande: mettre en pause
│   ├── resume.js                  # Commande: reprendre
│   ├── skip.js                    # Commande: passer chanson
│   ├── stop.js                    # Commande: arrêter tout
│   ├── queue.js                   # Commande: afficher queue
│   ├── volume.js                  # Commande: volume
│   ├── now.js                     # Commande: chanson actuelle
│   ├── leave.js                   # Commande: quitter canal
│   ├── help.js                    # Commande: aide
│   ├── clear.js                   # (BONUS) Vider queue
│   ├── shuffle.js                 # (BONUS) Mélanger queue
│   ├── remove.js                  # (BONUS) Supprimer chanson
│   └── search.js                  # (BONUS) Recherche avancée
│
├── utils/                         # Utilitaires
│   ├── logger.js                  # Système de logging
│   ├── helpers.js                 # Fonctions auxiliaires
│   └── constants.js               # Constantes
│
├── events/                        # Gestionnaires d'événements
│   ├── ready.js
│   ├── messageCreate.js
│   └── voiceStateUpdate.js
│
├── db/                            # Base de données
│   └── playlists.db              # SQLite (créé automatiquement)
│
├── logs/                          # Fichiers de log
│   ├── error.log
│   └── combined.log
│
├── config/                        # Configuration
│   └── config.json               # Paramètres du bot
│
├── README.md                      # Documentation principale
├── INSTALLATION_NODEJS.md         # Guide d'installation
├── FEATURES_BONUS_NODEJS.md       # Features supplémentaires
└── STRUCTURE.md                   # Ce fichier
```

## 📝 Description des Fichiers Clés

### bot.js
Le fichier principal qui:
- Crée le client Discord
- Charge les commandes
- Gère les événements
- Maintient les music players

### commands/
Chaque fichier suit la structure:
```javascript
module.exports = {
  data: {
    name: 'nom-commande',
    description: 'Description courte',
  },

  async execute(message, args, client, getPlayer) {
    // Code de la commande
  }
};
```

### utils/
Fonctions utilitaires réutilisables:
```javascript
// logger.js
module.exports = {
  log: (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`),
  error: (msg) => console.error(`[ERROR] ${msg}`),
};

// helpers.js
module.exports = {
  formatDuration: (secs) => `${Math.floor(secs/60)}:${secs%60}`,
  formatQueue: (queue) => queue.slice(0, 10).map((s, i) => `${i+1}. ${s.title}`),
};
```

### events/
Chaque événement Discord:
```javascript
module.exports = {
  name: 'ready',
  once: true,
  execute(client) {
    console.log(`Bot connecté: ${client.user.tag}`);
  }
};
```

## 🚀 Comment Créer la Structure

### Méthode 1: Avec un Script Shell (Linux/macOS)

Créez un fichier `setup.sh`:
```bash
#!/bin/bash

mkdir -p commands utils events db logs config

echo "✅ Structure créée!"
echo ""
echo "Dossiers créés:"
echo "  - commands/"
echo "  - utils/"
echo "  - events/"
echo "  - db/"
echo "  - logs/"
echo "  - config/"
echo ""
echo "Prochaine étape: npm install"
```

Puis:
```bash
chmod +x setup.sh
./setup.sh
```

### Méthode 2: Avec PowerShell (Windows)

Créez un fichier `setup.ps1`:
```powershell
$folders = @('commands', 'utils', 'events', 'db', 'logs', 'config')

foreach ($folder in $folders) {
    if (!(Test-Path $folder)) {
        New-Item -ItemType Directory -Name $folder
        Write-Host "✅ Créé: $folder" -ForegroundColor Green
    }
}

Write-Host "`nStructure prête!" -ForegroundColor Green
Write-Host "Prochaine étape: npm install" -ForegroundColor Yellow
```

Puis:
```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

### Méthode 3: Manuellement

Créez les dossiers à la main:
1. Clic droit dans le dossier du projet
2. "Nouveau" → "Dossier"
3. Créez: `commands`, `utils`, `events`, `db`, `logs`, `config`

## 📦 Structure Détaillée par Dossier

### 📁 commands/
```
commands/
├── play.js           (410 lignes)
├── pause.js          (30 lignes)
├── resume.js         (30 lignes)
├── skip.js           (30 lignes)
├── stop.js           (30 lignes)
├── queue.js          (50 lignes)
├── volume.js         (50 lignes)
├── leave.js          (40 lignes)
├── now.js            (40 lignes)
└── help.js           (50 lignes)

Total: ~1200 lignes
```

### 📁 utils/
```
utils/
├── logger.js         # Logging Winston
├── helpers.js        # formatDuration(), format()
├── database.js       # Gestion SQLite
└── constants.js      # Couleurs, emojis, etc.
```

### 📁 events/
```
events/
├── ready.js          # Événement "ready"
├── messageCreate.js  # Événement "messageCreate"
├── voiceStateUpdate.js
├── interactionCreate.js
└── error.js          # Gestion erreurs
```

## 🔧 Configuration Avancée

### config.json
```json
{
  "prefix": "!",
  "version": "1.0.0",
  "colors": {
    "primary": "#0099ff",
    "success": "#00ff00",
    "error": "#ff0000",
    "warning": "#ffaa00"
  },
  "settings": {
    "autoLeaveEmpty": true,
    "autoLeavesAfter": 300000,
    "maxQueueSize": 1000
  }
}
```

### .env Complet
```
# Discord
DISCORD_TOKEN=xxxxx
COMMAND_PREFIX=!

# Logs
LOG_LEVEL=info

# Database
DB_TYPE=sqlite
DB_PATH=./db/bot.db

# API Keys (optionnel)
SPOTIFY_ID=xxxxx
SPOTIFY_SECRET=xxxxx

# Features
ENABLE_SPOTIFY=false
ENABLE_REACTIONS=true
AUTO_LEAVE=true
```

## 🎯 Flux d'Initialisation

```
npm start
    ↓
bot.js charge
    ↓
.env chargé
    ↓
Commands chargées depuis ./commands
    ↓
Client Discord login
    ↓
Event "ready" déclenché
    ↓
Bot opérationnel ✅
```

## 📊 Taille Estimée du Projet

| Composant | Fichiers | Lignes |
|-----------|----------|--------|
| Core (bot.js) | 1 | 150 |
| Commands | 10 | 1200 |
| Utils | 4 | 300 |
| Events | 5 | 250 |
| Config | 2 | 100 |
| **Total** | **22** | **2000** |

## 🔀 Structure Alternative (Avec Handlers)

Pour les projets plus gros:

```
bot/
├── main.js
├── handlers/
│   ├── commandHandler.js
│   ├── eventHandler.js
│   ├── errorHandler.js
│   └── databaseHandler.js
├── commands/
│   ├── music/
│   │   ├── play.js
│   │   ├── pause.js
│   │   └── ...
│   ├── admin/
│   │   └── ...
│   └── utility/
│       └── ...
├── events/
│   ├── client/
│   │   └── ready.js
│   └── message/
│       └── messageCreate.js
├── models/
│   ├── Player.js
│   └── Playlist.js
├── schemas/
│   └── userSchema.js
└── utils/
    ├── logger.js
    ├── pagination.js
    └── validators.js
```

## 💡 Conseils d'Organisation

1. **Un fichier = Une commande**
   - Chaque commande dans son propre fichier
   - Plus facile à maintenir

2. **Utiliser des dossiers logiques**
   - `commands/music/`, `commands/admin/`
   - Meilleure organisation

3. **Documenter les fichiers**
   - JSDoc au début de chaque fichier
   - Comments pour les fonctions complexes

4. **Respecter le naming**
   - Fichiers: `snake-case` (play.js)
   - Dossiers: `snake-case` (commands/)
   - Classes: `PascalCase` (MusicPlayer)
   - Variables: `camelCase` (isPlaying)

## 🚀 Évolution du Projet

### Phase 1: MVP (Jours 1-3)
✅ Structure basique
✅ Commandes essentielles
✅ .env setup

### Phase 2: Features (Jours 4-7)
✅ Utils réutilisables
✅ Logging
✅ Gestion d'erreurs

### Phase 3: Production (Semaines 2+)
✅ Database
✅ API externe (Spotify)
✅ Web dashboard
✅ Déploiement

---

Besoin d'aide pour mettre en place la structure?
Consultez le guide d'installation! 🚀
