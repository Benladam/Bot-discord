# Bot Discord Musique (YouTube + Spotify + Deezer)

Bot de musique multi-serveur pour Discord, écrit en Node.js avec [discord.js v14](https://discord.js.org/).
Il recherche dans les catalogues **YouTube, Spotify et Deezer** et lit l'audio
correspondant depuis YouTube. Il prend aussi les liens **Spotify** (pistes,
albums et playlists accessibles avec les droits du compte OAuth). Les commandes
fonctionnent en **slash `/`** ou avec le **préfixe `!`**.

> ⚠️ Spotify n'autorise pas le streaming audio direct. Les liens Spotify sont
> résolus en métadonnées (titre + artiste) puis lus via l'audio YouTube équivalent.

## Fonctionnalités

- Lecture de liens YouTube (watch / youtu.be)
- Lecture de liens Spotify : piste, album et playlist si le compte autorisé peut en lire le contenu
- Recherche paginée par morceaux, artistes, albums et playlists publiques
- Playlists personnalisées SQLite isolées par serveur et partageables
- Réglage du volume mémorisé séparément pour chaque serveur
- File d'attente, boucle (chanson / file), mélange
- Volume, pause / reprise, skip, stop, leave
- Commandes slash `/` **et** préfixe `!`

## Installation

Prérequis : Node.js 22.5+ et npm.

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
| `SPOTIFY_CLIENT_ID` | recherche Spotify, discographies et playlists publiques | ID d'application Spotify |
| `SPOTIFY_CLIENT_SECRET` | recherche Spotify, discographies et playlists publiques | Secret d'application Spotify |
| `MUSIC_MARKET` | non | Marché Spotify, ex. `FR` |
| `BOT_DATA_DIR` | non | Dossier de la base SQLite persistante |
| `YTDLP_PATH` | non | Chemin vers `yt-dlp` si absent du PATH |
| `FFMPEG_PATH` | non | Chemin vers FFmpeg si absent du PATH |

### Inviter le bot sur un serveur Discord
1. https://discord.com/developers/applications → New Application
2. Section **Bot** → Reset Token
3. **OAuth2 → URL Generator** : cochez les scopes `bot` et
   `applications.commands`, puis générez le lien d'invitation.
4. Donnez au bot uniquement les permissions nécessaires dans le serveur et les
   salons : voir les salons, envoyer des messages, intégrer des liens, se
   connecter et parler en vocal (activité vocale).
5. L'intent **Message Content** n'est utile que pour les commandes préfixées
   (`!play`, `!pause`) et le relais `/call`. Les commandes slash fonctionnent
   sans lui. **Server Members Intent** n'est pas requis par ce projet ; l'accès
   aux états vocaux est un intent Gateway standard.

Les commandes slash sont enregistrées globalement et deviennent disponibles
dans chaque serveur où le bot est invité. À grande échelle, Discord traite
Message Content comme un intent privilégié pour les applications vérifiées ;
un bot public peut choisir de n'exposer que les commandes slash ou demander cet
accès selon les règles Discord.

### Obtenir les identifiants Spotify (albums et playlists)
1. https://developer.spotify.com/dashboard → Create app
2. Copiez le **Client ID** et le **Client Secret** dans `.env`.

Les recherches et discographies Spotify nécessitent les deux variables ci-dessus.
Les résultats Spotify et Deezer sont des métadonnées : leur lecture est résolue
sur YouTube et ne stream pas l'audio protégé de ces plateformes. Spotify peut
afficher des playlists trouvées dans son catalogue, mais son API actuelle ne
permet de lire le contenu que d'une playlist appartenant au compte OAuth ou
auquel ce compte collabore. Le mode identifiants d'application seul ne permet
donc pas de lire les titres de toutes les playlists publiques.

`/play query niska` ouvre un menu privé paginé pour choisir un morceau, un album,
un artiste ou une playlist YouTube/Spotify/Deezer. Choisir un artiste Spotify
ouvre sa discographie publique. Les playlists affichées sont celles visibles
par la recherche du catalogue ; l’API Spotify actuelle peut toutefois refuser
leurs titres si le compte OAuth de l’application n’en est ni propriétaire ni
collaborateur. Une liste privée n’est pas accessible avec les seuls identifiants
d’application.

`/playlist action:create name:...` crée une playlist pour le serveur. Les actions
`add`, `list`, `play`, `remove` et `delete` permettent aux membres de partager
et d'écouter ces listes; seul le créateur peut les modifier ou supprimer.
Chaque serveur a ses propres playlists dans SQLite. Windows utilise
`%APPDATA%\bot-discord`; sur Linux/Docker, configure `BOT_DATA_DIR` vers un
volume persistant (l'image Docker utilise `/data`). Sans volume attaché, les
données de conteneur peuvent disparaître lors d'un redéploiement. SQLite convient
à une instance du bot ; un déploiement réparti sur plusieurs machines nécessitera
une base réseau. Aucune liaison à un jeu n'est requise pour inviter le bot ; une
intégration de jeu spécifique dépendra du jeu et de son API.

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

Tests locaux : `npm test`.

## Commandes

| Commande | Description |
|----------|-------------|
| `!play` / `/play [lien/recherche]` | Recherche YouTube/Spotify/Deezer et lit le résultat sélectionné |
| `/playlist` | Crée et gère les playlists propres au serveur |
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
  musicCatalog.js       Recherche unifiée YouTube/Spotify/Deezer
  database.js           SQLite multi-serveur pour les playlists personnelles
  spotify.js            Résolution et recherche Spotify -> YouTube
  resolve.js            Résolution des liens YouTube/Spotify/Deezer
  embeds.js             Embeds (messages enrichis)
  respond.js            Helpers de réponse unifiés
package.json            Dépendances JavaScript
.env.example            Modèle de configuration (sans secret)
launch.sh               Lanceur Linux/macOS
Heuss-GUI.bat           Lanceur GUI Windows
```
