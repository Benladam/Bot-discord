# Bot Discord Musique (YouTube + Spotify)

Bot de musique pour Discord, écrit en Node.js avec [discord.js v14](https://discord.js.org/).
Il lit de l'audio **YouTube** et des liens **Spotify** (pistes, albums, playlists),
et fonctionne avec les **commandes slash `/`** aussi bien qu'avec le **préfixe `!`**.

> ⚠️ Spotify n'autorise pas le streaming audio direct. Les liens Spotify sont
> résolus en métadonnées (titre + artiste) puis lus via l'audio YouTube équivalent.

## Fonctionnalités

- Lecture de liens YouTube (watch / youtu.be)
- Lecture de liens Spotify : piste, album, playlist
- Recherche texte (joue le premier résultat YouTube)
- File d'attente, boucle (chanson / file), mélange
- Volume, pause / reprise, skip, stop, leave
- Commandes slash `/` **et** préfixe `!`

## Installation

Prérequis : Node.js 20+ et npm.

```bash
git clone <repo>
cd Bot-discord
npm install
```

Le lanceur Windows `Heuss-GUI.bat` ouvre le panneau local. Le lanceur Linux
`bash launch.sh` démarre le bot dans le terminal. Au premier lancement, chaque
lanceur crée `.env` depuis `.env.example` et demande le token Discord si celui-ci
est vide. Le token reste dans `.env`, ignoré par Git.

La voix utilise une implémentation maison : WebSocket vocal Discord, découverte
UDP, RTP/Opus, chiffrement du transport et gestion DAVE sont gérés dans le
projet. Aucune IP publique ne doit être renseignée : la découverte UDP se fait
automatiquement derrière une box/NAT ou sur un serveur. Pour lire YouTube,
`yt-dlp` et FFmpeg restent nécessaires comme outils de décodage/extraction.

Sous Windows, installe ou mets à jour yt-dlp avec Python (une version ancienne
peut renvoyer une vignette au lieu de l'audio) :

```powershell
py -m pip install --user --upgrade yt-dlp
```

Si tu utilises le binaire autonome `yt-dlp.exe`, indique son chemin si besoin :

```env
YTDLP_PATH=C:\\outils\\yt-dlp.exe
FFMPEG_PATH=C:\\outils\\ffmpeg\\bin\\ffmpeg.exe
```

Sur le serveur Linux, installez simplement `yt-dlp` et `ffmpeg` avec le
gestionnaire de paquets. L'image Docker du projet les installe déjà.

Copiez `.env.example` en `.env` et remplissez les valeurs :

```bash
cp .env.example .env
```

### Variables `.env`

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DISCORD_TOKEN` | oui | Token du bot Discord |
| `COMMAND_PREFIX` | non | Préfixe des commandes texte (défaut `!`) |
| `SPOTIFY_CLIENT_ID` | recherche Spotify, albums/playlists | ID d'application Spotify |
| `SPOTIFY_CLIENT_SECRET` | recherche Spotify, albums/playlists | Secret d'application Spotify |
| `YTDLP_PATH` | non | Chemin vers `yt-dlp` si absent du PATH |
| `FFMPEG_PATH` | non | Chemin vers FFmpeg si absent du PATH |

### Obtenir un token Discord
1. https://discord.com/developers/applications → New Application
2. Section **Bot** → Reset Token
3. Section **OAuth2 → URL Generator** → cochez `applications.commands` + `bot`,
   activez les intents **Server Members Intent**, **Message Content Intent** et
   **Voice State Intent**, puis utilisez l'URL générée pour inviter le bot.

### Obtenir les identifiants Spotify (albums et playlists)
1. https://developer.spotify.com/dashboard → Create app
2. Copiez le **Client ID** et le **Client Secret** dans `.env`.

Les liens Spotify vers une piste (`/track/…`) fonctionnent aussi sans ces
identifiants grâce aux métadonnées publiques Spotify. Les albums et playlists
utilisent l'API Spotify et demandent les deux variables ci-dessus.

## Interface Windows

`Heuss-GUI.bat` (ou l'alias `Heus-GUI.bat`) utilise Windows PowerShell, inclus dans Windows. Le panneau peut
démarrer ou arrêter le bot, configurer le token et afficher les journaux. Il
installe les dépendances npm au premier démarrage. Les journaux sont écrits dans
`.bot-gui-logs/`.

Pour Linux ou macOS, utilise `bash launch.sh` ou `npm start`.

## Lancement en ligne de commande

```bash
npm start
```

## Commandes

| Commande | Description |
|----------|-------------|
| `!play` / `/play [lien/recherche]` | Joue une musique (YouTube, Spotify, ou recherche) |
| `!pause` / `/pause` | Met en pause |
| `!resume` / `/resume` | Reprend |
| `!skip` / `/skip` | Passe à la suivante |
| `!stop` / `/stop` | Arrête et vide la file |
| `!queue` / `/queue` | Affiche la file |
| `!now` / `/now` | Musique en cours |
| `!volume` / `/volume [0-100]` | Règle le volume |
| `!loop` / `/loop [off\|song\|queue]` | Mode de boucle |
| `!shuffle` / `/shuffle` | Mélange la file |
| `!leave` / `/leave` | Le bot quitte le canal |
| `!help` / `/help` | Affiche l'aide |

## Structure

```
bot.js                  Point d'entrée (slash + préfixe)
gui-app/                Interface native locale optionnelle
commands/               Une commande par fichier
utils/
  musicPlayer.js        Logique de lecture (connexion vocale, file, boucle)
  spotify.js            Résolution des liens Spotify -> YouTube
  resolve.js            Résolution YouTube/Spotify/recherche
  embeds.js             Embeds (messages enrichis)
  respond.js            Helpers de réponse unifiés
package.json            Dépendances JavaScript
.env.example            Modèle de configuration (sans secret)
launch.sh               Lanceur Linux/macOS
Heuss-GUI.bat           Lanceur GUI Windows
```
