# Bot Discord multifonction

Bot Discord multi-serveur créé par **lefauxmaghrebin**, écrit en Node.js avec [discord.js v14](https://discord.js.org/).
Il réunit musique, modération et outils serveur dans un seul projet.
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
- Vérification périodique des commits GitHub avec nouvelles du bot dans un salon `/updatelog` séparé
- Mise à jour automatique facultative avec compte à rebours, installation npm et redémarrage supervisé
- Commandes administrateur `/updatelog` et `/update` pour configurer le journal ou installer manuellement
- File d'attente, boucle (chanson / file), mélange
- Volume, pause / reprise, skip, stop, leave
- Commandes slash `/` **et** préfixe `!`
- Modération : avertissements persistants, kick, ban, timeout et nettoyage de messages
- Informations utiles : ping, profil utilisateur, informations du serveur et avatar
- Sondages Oui/Non avec réactions
- Présence configurable du bot : statut en ligne, activité, textes cycliques et intervalle
- Crédits du créateur et licence MIT accessibles avec `/about`

## Installation

Prérequis : Node.js 22.5+ et npm.

```bash
git clone <URL HTTPS du dépôt GitHub>
cd Bot-discord
npm install
```

Pour récupérer l’URL HTTPS, ouvre la page du dépôt sur GitHub, sélectionne
**Code → HTTPS**, puis copie l’adresse affichée.

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
| `UPDATE_CHECK_ENABLED` | non | Active la vérification GitHub (défaut `true`) |
| `UPDATE_CHECK_INTERVAL_MINUTES` | non | Intervalle de vérification, entre 1 et 1440 minutes (défaut `5`) |
| `UPDATE_AUTO_INSTALL` | non | Installe les commits propres et redémarre automatiquement après compte à rebours (défaut `false`) |
| `UPDATE_RESTART_COUNTDOWN_SECONDS` | non | Délai annoncé avant redémarrage auto, entre 10 et 3600 secondes (défaut `60`) |
| `UPDATE_BRANCH` | non | Branche GitHub suivie (branche active, sinon `main` si checkout détaché) |
| `UPDATE_REMOTE` | non | Remote Git suivie (défaut `origin`) |
| `MINECRAFT_GUILD_ID` | pont Minecraft | ID du serveur Discord associé au serveur Minecraft |
| `MINECRAFT_BRIDGE_TOKEN` | pont Minecraft | Secret partagé d'au moins 32 caractères |
| `MINECRAFT_CHANNEL_ID` | pont Minecraft | Salon réservé aux changelogs Minecraft publiés après un redémarrage réussi |
| `PORT` | pont Minecraft | Port attribué au WebSocket du bot sur Kinetic (`SERVER_PORT` est aussi reconnu) |
| `YTDLP_PATH` | non | Chemin vers `yt-dlp` si absent du PATH |
| `FFMPEG_PATH` | non | Chemin vers FFmpeg si absent du PATH |
| `BOT_PRESENCE_STATUS` | non | Présence initiale : `online`, `dnd`, `idle` ou `invisible` |
| `BOT_PRESENCE_TYPE` | non | Activité initiale : `playing`, `listening`, `watching` ou `competing` |
| `BOT_PRESENCE_INTERVAL_SECONDS` | non | Délai initial entre deux textes (30 à 86400 secondes, défaut `60`) |
| `BOT_PRESENCE_TEXTS` | non | Textes d’activité séparés par `|`; `{prefix}` est remplacé par le préfixe du bot |

### Présence du bot

Le propriétaire du bot peut utiliser `/presence` ou `!presence` pour régler le
statut (en ligne, ne pas déranger, inactif ou invisible), le type d’activité,
les textes affichés et le délai de rotation. Les réglages sont globaux à
l’instance du bot et enregistrés dans SQLite. L’intervalle accepté va de 30
secondes à 24 heures, avec au plus 20 textes de 128 caractères. Dans `/presence`,
sépare les textes avec `|`; utilise `off` pour masquer l’activité. Exemple :

```text
/presence statut:idle intervalle:60 type:watching textes:la musique | /help pour les commandes
```

Une lecture musicale en cours affiche temporairement le titre écouté. Après la
lecture, le bot reprend la rotation configurée. Le statut Discord et le texte
d’activité sont distincts : les activités s’affichent sous le nom du bot sous
une forme comme « Regarde … » ou « Écoute … ».

### Mises à jour GitHub

Le bot vérifie la branche configurée sur le remote GitHub toutes les cinq
minutes. Dans Discord, un administrateur lance `/updatelog` dans le salon réservé
aux nouvelles du bot. Chaque commit détecté y affiche son titre et un lien.
Avec `UPDATE_AUTO_INSTALL=true`, un commit en avance et un arbre de travail propre
déclenchent le compte à rebours annoncé dans ce salon, puis un fast-forward,
`npm install` et le redémarrage supervisé du bot. Le délai par défaut est de 60
secondes. Les fichiers locaux modifiés, les branches divergentes et l'absence
d'un salon `/updatelog` bloquent l'installation automatique. `/update` reste
disponible aux administrateurs et annonce un délai de 10 secondes dans le même
salon.

Ces annonces concernent uniquement le bot Discord : `/updatelog` refuse le salon
défini par `MINECRAFT_CHANNEL_ID`, afin que les changements du bot ne polluent
pas le changelog Minecraft. Le redémarrage du bot ne redémarre pas le serveur
Minecraft.

Le dépôt doit être une copie Git avec ses métadonnées `.git` et le remote GitHub
`origin` (ou la valeur de `UPDATE_REMOTE`), et Git doit être installé sur l’hôte.
L’image Docker installe Git automatiquement. Pour un dépôt privé, configure les
identifiants GitHub sur l’hôte avant de lancer le bot.

La mise à jour automatique n’écrase pas les modifications locales et refuse les
branches divergentes. Pour appliquer une mise à jour manuellement depuis le
dossier du bot, exécute `git fetch origin`, `git merge --ff-only origin/main`,
`npm install --omit=dev --no-audit --no-fund`, puis redémarre le bot. Remplace
`main` si tu as configuré une autre branche.

Le salon choisi est conservé dans SQLite pour chaque serveur. Sur Kinetic, le
fichier `data/bot.sqlite3` reste dans les fichiers du split entre redémarrages ;
configure les sauvegardes Kinetic pour conserver playlists et réglages. Pour un
conteneur Docker jetable, monte un volume persistant ou définis `BOT_DATA_DIR`.

### Hébergement Kinetic

Utilise un split Kinetic distinct en logiciel **Discord Bot**, pas Fly.io, pour
laisser le serveur Minecraft indépendant. Le bot requiert Node.js 22.5 ou plus
récent, car sa base utilise `node:sqlite`. La page publique Kinetic consultée ne
documente que Node.js jusqu'à 21 : vérifie que le runtime 22.5+ est bien proposé
sur le split avant de l'activer. Si ce n'est pas le cas, il faudra adapter le
driver SQLite ou fournir un runtime Node plus récent.

Pour l'auto-update, le processus doit voir un clone Git complet (`.git`, remote
`origin`) et pouvoir exécuter `git fetch`. Le bot redémarre uniquement son
processus Node après installation ; le serveur Minecraft reste en ligne.
Configure `PORT` avec le port du split Kinetic, puis configure un endpoint WSS
TLS accessible depuis Minecraft et le même secret dans le fichier de config du
mod. Garde `MINECRAFT_CHANNEL_ID` séparé du salon `/updatelog`.

### Inviter le bot sur un serveur Discord
1. https://discord.com/developers/applications → New Application
2. Section **Bot** → Reset Token
3. **OAuth2 → URL Generator** : cochez les scopes `bot` et
   `applications.commands`, puis générez le lien d'invitation.
4. Donnez au bot uniquement les permissions nécessaires dans le serveur et les
   salons : voir les salons, envoyer des messages, intégrer des liens, se
   connecter et parler en vocal (activité vocale). Pour la modération, ajoutez
   les permissions de bannissement, d’expulsion, de modération des membres,
   gestion des messages et ajout de réactions; placez le rôle du bot au-dessus
   des rôles visés.
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
`%APPDATA%\bot-discord`; sur Linux/Docker, configure `BOT_DATA_DIR` si nécessaire
(l'image Docker utilise `/data`). Kinetic conserve le dossier `data/` du split
entre redémarrages. SQLite convient à une instance du bot ; un déploiement réparti
sur plusieurs machines nécessitera une base réseau. Aucune liaison à un jeu n'est
requise pour inviter le bot ; une intégration de jeu spécifique dépendra du jeu
et de son API.

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
| `/warn membre raison` | (Modération) Ajoute un avertissement conservé dans SQLite |
| `/warnings membre` | (Modération) Affiche les avertissements enregistrés |
| `/unwarn membre numero` | (Modération) Retire l’avertissement choisi |
| `/timeout membre duree [raison]` | (Modération) Met un membre en sourdine (`30m`, `2h`, `1d`) |
| `/kick membre [raison]` | (Modération) Expulse un membre |
| `/ban membre [raison] [jours]` | (Modération) Bannit un membre, avec suppression facultative des messages |
| `/clear nombre` | (Modération) Supprime de 1 à 100 messages récents |
| `/ping` | Affiche la latence du bot et de Discord |
| `/userinfo [utilisateur]` | Affiche les informations publiques d’un utilisateur |
| `/serverinfo` | Affiche les informations du serveur actuel |
| `/avatar [utilisateur]` | Affiche l’avatar d’un utilisateur |
| `/poll question` | Publie un sondage Oui / Non |
| `/presence` | (Propriétaire) Configure le statut, l’activité et sa rotation |
| `/about` | Affiche les crédits et la licence |
| `/updatelog` | (Admin) Définit le salon actuel pour les nouvelles du bot Discord |
| `/update` | (Admin) Installe la dernière version et redémarre le bot |

Les commandes de modération vérifient la permission du membre et celle du bot.
Discord bloque les actions contre les membres dont le rôle est supérieur à
celui du bot. Pour utiliser les commandes avec le préfixe, active l’intent
**Message Content** dans le portail développeur.

## Auteur et licence

Le projet original est créé par **lefauxmaghrebin** (Discord). Le dépôt Git
actuellement configuré indique **Benladam** comme compte GitHub du projet.
Le dépôt utilise la licence
[MIT](LICENSE) : chacun peut utiliser, modifier et redistribuer le bot, y
compris dans un projet commercial. Les copies ou portions substantielles doivent
conserver l’avis de copyright et le texte de la licence. La commande `/about`
affiche également le crédit d’origine.

## Structure

```
bot.js                  Point d'entrée (slash + préfixe)
supervisor.js           Relance bot.js après une mise à jour
gui-app/                Interface native locale optionnelle
commands/               Une commande par fichier
utils/
  presenceManager.js    Statut, activité et rotation persistants
  commandHelpers.js     Aides communes aux commandes slash et préfixées
  moderationStore.js    Avertissements persistants par serveur
  musicPlayer.js        Logique de lecture (connexion vocale, file, boucle)
  musicCatalog.js       Recherche unifiée YouTube/Spotify/Deezer
  database.js           SQLite multi-serveur pour les playlists personnelles
  updater.js            Vérifie GitHub, installe les commits et demande le redémarrage
  spotify.js            Résolution et recherche Spotify -> YouTube
  resolve.js            Résolution des liens YouTube/Spotify/Deezer
  embeds.js             Embeds (messages enrichis)
  respond.js            Helpers de réponse unifiés
package.json            Dépendances JavaScript
.env.example            Modèle de configuration (sans secret)
launch.sh               Lanceur Linux/macOS
Heuss-GUI.bat           Lanceur GUI Windows
```
