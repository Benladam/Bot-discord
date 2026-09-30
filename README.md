# Bot Discord multifonction

Bot Discord open source multi-serveur, écrit en Node.js avec [discord.js v14](https://discord.js.org/).
Il réunit musique, modération et outils serveur dans un seul projet, sans présumer d’un propriétaire, d’un domaine ou d’un hébergeur précis.
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
- Annonce « Started playing » conservée dans le salon, avec logo de plateforme, lien public et pochette disponible
- Carte de lecture interactive distincte de l'historique ; avis de fin de file sans mention, supprimé après 30 secondes
- Suppressions temporaires isolées : une nouvelle lecture n'adopte jamais l'identifiant d'un ancien avis de fin
- Volume, pause / reprise, skip, stop, leave
- Commandes slash `/` **et** préfixe `!`
- Modération : avertissements persistants, kick, ban, timeout et nettoyage de messages
- Informations utiles : ping, profil utilisateur, informations du serveur et avatar
- Sondages Oui/Non avec réactions
- Discussion IA générale quand on mentionne le bot ou son nom (OpenAI, Claude, Gemini ou LLM compatible)
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
automatiquement derrière une box/NAT ou sur un serveur. FFmpeg est inclus avec
les dépendances npm. Si l'hôte n'a pas `yt-dlp`, le bot télécharge au premier
besoin le binaire officiel correspondant au système, vérifie son SHA-256, puis
le conserve dans le dossier de données (`BOT_DATA_DIR`, `%APPDATA%\\bot-discord`
sous Windows ou `data/` sous Linux/macOS). L'hôte doit autoriser HTTPS sortant
vers GitHub : le bot active le runtime Node et les composants EJS officiels de
`yt-dlp` pour résoudre les challenges YouTube. Une installation personnelle
peut être forcée avec `YTDLP_PATH` :

```env
YTDLP_PATH=C:\\outils\\yt-dlp.exe
# Facultatif : chemins Netscape séparés par ;, premier prioritaire; vide = auto-détection de data/youtube-cookies.txt
YOUTUBE_COOKIES_PATH=C:\chemin\compte-youtube.txt;C:\chemin\cookies-secours.txt
FFMPEG_PATH=C:\\outils\\ffmpeg\\bin\\ffmpeg.exe
```

Copiez `.env.example` en `.env` et remplissez les valeurs :

```bash
cp .env.example .env
```

### Variables `.env`

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `DISCORD_TOKEN` | oui | Token du bot Discord |
| `COMMAND_PREFIX` | non | Préfixe des commandes texte (défaut `!`) |
| `AI_PROVIDER` | non | `disabled` (défaut), `openai`, `anthropic`, `gemini` ou `openai-compatible` pour activer la conversation |
| `AI_MODEL` | non | Identifiant du modèle conversationnel choisi; exemples ci-dessous |
| `OPENAI_API_KEY` | selon le fournisseur | Clé API OpenAI, gardée dans `.env` |
| `ANTHROPIC_API_KEY` | selon le fournisseur | Clé API Claude, gardée dans `.env` |
| `GEMINI_API_KEY` | selon le fournisseur | Clé API Gemini, gardée dans `.env` |
| `AI_BASE_URL` | non | Adresse d’un serveur compatible OpenAI (défaut local `http://127.0.0.1:11434/v1`) |
| `AI_API_KEY` | non | Clé facultative d’un serveur compatible OpenAI |
| `AI_TRIGGER_NAMES` | non | Autres pseudonymes déclencheurs séparés par `|`; le nom Discord du bot est reconnu automatiquement |
| `AI_PERSONALITY` | non | Préférence de ton facultative; les limites de sécurité intégrées restent actives |
| `AI_RATE_LIMIT_PER_MINUTE` | non | Limite par personne (défaut `4`) |
| `AI_GLOBAL_RATE_LIMIT_PER_MINUTE` | non | Limite totale par minute (défaut `30`) |
| `AI_MAX_INPUT_CHARS` | non | Taille maximale du message envoyé au modèle (défaut `1600`) |
| `AI_MAX_OUTPUT_TOKENS` | non | Limite de génération (défaut `450`) |
| `AI_CONTEXT_MESSAGES` | non | Messages de contexte temporaire au maximum (défaut `8`) |
| `AI_HTTP_TIMEOUT_MS` | non | Délai maximal d’une requête au fournisseur (défaut `25000`) |
| `SPOTIFY_CLIENT_ID` | recherche Spotify, discographies et playlists publiques | ID d'application Spotify |
| `SPOTIFY_CLIENT_SECRET` | recherche Spotify, discographies et playlists publiques | Secret d'application Spotify |
| `SOUNDCLOUD_CLIENT_ID` | non | Active des recherches et replis API SoundCloud supplémentaires; yt-dlp permet déjà la recherche et la lecture sans cette clé |
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
| `PORT` | hébergement | Port HTTP attribué au service; `/healthz`, le panneau web et le pont WebSocket Minecraft le partagent (`SERVER_PORT` est prioritaire) |
| `WEB_ADMIN_TOKEN` | oui pour le panneau | Jeton d’accès d’au moins 32 octets; génère-en un aléatoire et garde-le uniquement dans la configuration privée du serveur |
| `WEB_PUBLIC_URL` | non | URL HTTPS publique de ton panneau, par exemple `https://music.example.org`; utilisée par `controller` et `link` |
| `WEB_BASE_PATH` | non | Préfixe de chemin facultatif si le reverse proxy publie le panneau sous un sous-chemin |
| `WEB_COOKIE_SECURE` | non | Utilise des cookies HTTPS `Secure` (recommandé avec un proxy SSL) |
| `ENABLE_TEST_HOOKS` | non | Active temporairement les scripts manuels de `Test/`; jeton local requis et pont limité à `127.0.0.1` |
| `TEST_BRIDGE_TOKEN` | requis si hooks activés | Jeton aléatoire d’au moins 32 octets, à garder uniquement dans l’environnement privé |
| `WEB_TRUST_PROXY` | non | Active la lecture des en-têtes transmis par le proxy; à activer seulement si le proxy remplace ces en-têtes |
| `YTDLP_PATH` | non | Chemin vers `yt-dlp` si absent du PATH |
| `YOUTUBE_COOKIES_PATH` | non | Un ou plusieurs chemins relatifs à la racine du bot ou absolus vers des fichiers cookies YouTube Netscape, séparés par `;`. Le premier est prioritaire, les suivants servent de secours. Si vide, `data/youtube-cookies.txt` est détecté automatiquement. Le dossier `data/` est ignoré par Git; ne publie jamais ces fichiers : l’usage de cookies de compte peut entraîner des restrictions du compte. |
| `FFMPEG_PATH` | non | Chemin vers FFmpeg si absent du PATH |
| `BOT_PRESENCE_STATUS` | non | Présence initiale : `online`, `dnd`, `idle` ou `invisible` |
| `BOT_PRESENCE_TYPE` | non | Activité initiale : `playing`, `listening`, `watching` ou `competing` |
| `BOT_PRESENCE_INTERVAL_SECONDS` | non | Délai initial entre deux textes (30 à 86400 secondes, défaut `60`) |
| `BOT_PRESENCE_TEXTS` | non | Textes d’activité séparés par `|`; `{prefix}` est remplacé par le préfixe du bot |

L’audio est transmis directement de yt-dlp à FFmpeg pour éviter de réutiliser
une URL temporaire qui peut expirer ou être refusée par le serveur média.
SoundCloud fonctionne aussi sans `SOUNDCLOUD_CLIENT_ID` via les extracteurs
yt-dlp; la clé est facultative et ajoute le repli API `play-dl`. Dépose un vrai
fichier de cookies YouTube au format Netscape sous `data/youtube-cookies.txt`, ou définis
`YOUTUBE_COOKIES_PATH` vers un ou plusieurs emplacements séparés par `;`. Le bot
essaie les fichiers dans l’ordre. Quand une piste SoundCloud échoue,
le bot cherche son titre sur YouTube; quand YouTube échoue, il essaie SoundCloud.
YouTube peut toutefois refuser un cookie expiré ou ne pas autoriser l’accès à
une vidéo; dans ce cas, le code ne contourne pas la vérification et tente le
repli SoundCloud.

Le fichier source de cookies n'est jamais modifié par yt-dlp : chaque essai
utilise une copie privée normalisée (UTF-8 sans BOM, fins de ligne LF). Le bot
vérifie le format Netscape et la présence de cookies YouTube non expirés avant
de lancer l'extracteur. Cela ne garantit pas que Google accepte la session.
Les recherches de catalogue publiques s'effectuent sans cookies de compte.

### Conversation IA

La conversation est désactivée par défaut. Choisissez un seul fournisseur dans
`.env`, ajoutez sa clé API privée et redémarrez le bot. Les identifiants de
modèles ci-dessous sont des exemples à remplacer si le fournisseur ne les
propose pas sur votre compte.

```env
# OpenAI — modèle généraliste
AI_PROVIDER=openai
AI_MODEL=gpt-6-luna
OPENAI_API_KEY=...

# OU Claude
# AI_PROVIDER=anthropic
# AI_MODEL=claude-haiku-4-5
# ANTHROPIC_API_KEY=...

# OU Gemini
# AI_PROVIDER=gemini
# AI_MODEL=gemini-3.8-flash
# GEMINI_API_KEY=...

# OU un serveur compatible avec l'API OpenAI, par exemple Ollama en local
# AI_PROVIDER=openai-compatible
# AI_MODEL=nom-du-modele-local
# AI_BASE_URL=http://127.0.0.1:11434/v1
```

Le bot répond à une mention Discord, à son nom/pseudonyme exact (sans tenir
compte des majuscules), ou à un alias défini dans `AI_TRIGGER_NAMES`.
L’historique est gardé uniquement en mémoire, séparé par personne et salon,
limité à quelques échanges et effacé après quatre heures ou au redémarrage.
Seuls le message déclencheur et ce contexte limité sont envoyés au fournisseur
choisi; ses tarifs, règles et paramètres de conservation s’appliquent.

Le modèle peut discuter et plaisanter, mais ne peut ni exécuter une commande ni
agir sur Discord. Il ne doit pas fabriquer de vrai hameçonnage ou demander des
secrets. Une parodie de phishing doit être étiquetée comme telle, clairement
fictive, sans lien ni collecte d’identifiants. Les informations inventées sur
le monde réel doivent aussi être signalées comme fiction. Cette intégration
répond en texte et ne crée pas de fichier image.

Pour vérifier directement l'hébergement, tape dans sa console :

```text
musiccheck
musiccheck https://www.youtube.com/watch?v=v2o3in-Aud0
```

Ou depuis un terminal local au projet :

```sh
node tools/diagnostics/musicCheck.js https://www.youtube.com/watch?v=v2o3in-Aud0
```

Le diagnostic ne rejoint aucun vocal, ne modifie pas la file et ne révèle ni
valeur de cookie ni jeton. Il distingue la validation locale du fichier,
l'acceptation de l'extraction par YouTube et l'écoute réelle dans Discord.
Si YouTube refuse toujours un fichier correctement formé, renouvelle
l'exportation du seul compte choisi en suivant le
[guide officiel yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies).
N'ajoute jamais les cookies ou le fichier `.env` à GitHub. Les refus d'accès ne
sont pas contournés et les remixes ne remplacent pas un titre demandé.

### Recherche et contrôles musicaux

Les catalogues sont interrogés en parallèle : les premiers résultats sont
affichés après une courte fenêtre de regroupement (180 ms), avec un budget
de réponse de 1,5 seconde. Les résultats tardifs enrichissent un cache de deux
minutes, partagé entre recherche et autocomplétion. Ce budget concerne le
catalogue, pas le téléchargement audio ni le handshake Discord.
Les extracteurs YouTube disposent d'au moins six secondes en arrière-plan,
avec arrêt du processus au délai maximal. Une recherche identique reste
mutualisée jusqu'à la fin de ce travail, même après la réponse à Discord.
La recherche de playlists utilise yt-dlp, sans le parseur HTML de play-dl.

Pour un lecteur déconnecté, le flux audio est préparé **avant** de rejoindre
le vocal. Le bouton **Dashboard** ouvre un embed privé dans Discord : volume
±10 %, muet, rétablissement, répétition et mélange. Il utilise automatiquement
le lecteur du serveur courant et exige le même salon vocal que le bot. Aucun
site web n'est nécessaire ; un lien web supplémentaire apparaît seulement si
le panneau est configuré. Le gain est appliqué en PCM avant l'encodage Opus,
sans redémarrer le titre et sans fichier audio temporaire.

Le repli automatique SoundCloud exige aussi une identité d'artiste cohérente,
pas seulement un titre identique. Les uploads tiers sans artiste identifiable
sont refusés ; cette vérification de métadonnées n'est pas une empreinte audio.
Un lien SoundCloud explicitement choisi reste une source directe.
Une interruption de flux annule la file au lieu de lancer un autre morceau
silencieusement. Une fin normale ou **Suivant** passe au titre suivant ;
**Stop** invalide aussi les demandes encore en attente de préparation.

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
récent, car sa base utilise `node:sqlite`; vérifie que le split exécute bien une
version compatible. Les lanceurs locaux refusent maintenant les versions plus
anciennes au lieu de laisser le bot planter au chargement de SQLite.

Pour l'auto-update, le processus doit voir un clone Git complet (`.git`, remote
`origin`) et pouvoir exécuter `git fetch`. Le bot redémarre uniquement son
processus Node après installation ; le serveur Minecraft reste en ligne.
Configure `PORT` avec le port du split Kinetic, puis configure un endpoint WSS
TLS accessible depuis Minecraft et le même secret dans le fichier de config du
mod. Garde `MINECRAFT_CHANNEL_ID` séparé du salon `/updatelog`.

#### Panneau web derrière le reverse proxy

Le site est servi directement par le processus du bot; il n’y a pas de machine locale à joindre. Le panneau réutilise le serveur HTTP déjà ouvert sur `SERVER_PORT` (sinon `PORT`), donc le reverse proxy doit cibler le port attribué au processus du bot. `/healthz`, l’interface web et le pont Minecraft cohabitent sur ce port; aucun second port web n’est nécessaire.

Dans l’environnement privé du split, configure au minimum :

```env
WEB_ADMIN_TOKEN=<jeton-aléatoire-de-64-caractères-hexadécimaux>
WEB_PUBLIC_URL=https://music.example.org
WEB_COOKIE_SECURE=true
```

Génère le secret sur ta machine avec `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, puis colle-le dans la configuration privée Kinetic — jamais dans Discord, un log, `.env.example` ou Git. Le propriétaire se connecte au site avec ce jeton. `/controller` et `/link` donneront l’URL publique configurée. Sans configuration, le panneau reste désactivé et les commandes expliquent quoi renseigner au lieu d’afficher une fausse adresse `localhost`.

Dans le panneau de ton hébergeur, associe le domaine que tu contrôles au port attribué au bot, active SSL et configure le DNS comme demandé. Le navigateur accède en HTTPS; le proxy transmet les requêtes au service HTTP du bot. Privilégie l’émission automatique d’un certificat public après vérification du domaine. N’utilise pas de certificat auto-signé pour un panneau public et ne colle jamais de clé privée dans Git.

Le site permet de voir et piloter la musique, la file et le réglage 24/7 de chaque serveur Discord. Les recherches et l’ajout de musique restent sur `/play` dans Discord. Les commandes `/pause`, `/skip`, `/stop`, `/leave` et `/24-7` restent aussi disponibles dans Discord.

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
5. L'intent privilégié **Message Content** est nécessaire aux commandes
   préfixées (`!play`, `!pause`) et à la conversation IA par mention/nom.
   Activez-le dans **Bot → Privileged Gateway Intents** du portail développeur
   Discord. Les commandes slash seules fonctionnent sans lui. **Server Members
   Intent** n'est pas requis par ce projet ; l'accès aux états vocaux est un
   intent Gateway standard.

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

En saisissant `/play query niska`, l’autocomplétion native propose jusqu’à 25
morceaux avec artiste/durée, puis des playlists et autres résultats. Si tu envoies
la requête sans choisir une suggestion, un menu privé paginé permet de parcourir
les morceaux, albums, artistes et playlists YouTube/Spotify/Deezer. Choisir un artiste Spotify
ouvre sa discographie publique. Les playlists affichées sont celles visibles
par la recherche du catalogue ; l’API Spotify actuelle peut toutefois refuser
leurs titres si le compte OAuth de l’application n’en est ni propriétaire ni
collaborateur. Une liste privée n’est pas accessible avec les seuls identifiants
d’application.

En laissant le champ `query` vide, l’autocomplétion propose le Top 25 mondial
Deezer, avec rang, artiste et durée. Les choix renvoient vers les morceaux Deezer,
que le lecteur résout ensuite pour la lecture. Le classement est mis en cache
10 minutes ; si l’API Deezer ne répond pas, cette liste peut être temporairement
indisponible.

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

Le projet est maintenu par ses contributeurs. Le dépôt utilise la licence
[MIT](LICENSE) : chacun peut utiliser, modifier et redistribuer le bot, y
compris dans un projet commercial. Les copies ou portions substantielles doivent
conserver l’avis de copyright et le texte de la licence. La commande `about`
présente les fonctionnalités et la licence.

## Structure

```
bot.js                         Entrée Discord (événements, commandes, démarrage)
supervisor.js                  Superviseur et redémarrage après mise à jour
commands/                      Adaptateurs Discord : une commande par fichier
core/                          Base SQLite, mise à jour et orchestration console
core/i18n/                     Langues générales et préférences
features/                      Fonctionnalités métier, indépendantes des commandes
  music/                       File, audio, voix, recherche et fournisseurs
  moderation/                  Persistance des avertissements
  presence/                    Statut et activité
  minecraft/                   Pont Minecraft/Discord
  web/                         Serveur du panneau et actifs dans public/
shared/                        Helpers réutilisés par plusieurs fonctions
  discord/                     Permissions, réponses et embeds Discord
  i18n/                        Traductions des embeds
tests/                         Tests automatisés exécutés par npm test
Test/                          Zone manuelle d’essai, jamais chargée par défaut
gui-app/                       Interface native Windows optionnelle
launch.sh, *.bat               Lanceurs locaux Linux/Windows
Dockerfile, .dockerignore      Image portable; secrets et données locales exclus
package.json                   Dépendances et scripts du projet
.env.example                   Modèle de configuration sans secret
```

`commands/` ne contient que les adaptateurs Discord. La logique réelle vit dans
`features/<domaine>/`; les fonctions utilisées par plusieurs domaines vont dans
`shared/` ou `core/`. Une commande réussie en essai est donc réécrite proprement
dans son module métier, puis reliée depuis `commands/` — on ne copie pas un prototype
entier tel quel dans la production.

`Test/` est conservé dans Git et dans l’image serveur pour les essais manuels, mais
ses hooks ne sont jamais chargés par défaut. Pour un test ponctuel seulement, règle
`ENABLE_TEST_HOOKS=true` et un `TEST_BRIDGE_TOKEN` aléatoire (au moins 32 octets),
puis redémarre le bot. Le pont écoute exclusivement sur `127.0.0.1:7777`; ne le
publie pas avec un reverse proxy. `Test/cmd.txt` reste ignoré par Git et exclu de
l’image Docker. Les tests automatisés reproductibles restent dans `tests/` et se
lancent avec `npm test`.

Pour générer un jeton d’essai, exécute localement
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`
et stocke le résultat uniquement dans `.env` ou les variables privées de Kinetic.
Le bot ignore aussi ses vérifications Git internes quand le dossier déployé n'a pas
de dépôt `.git`; dans ce cas, utilise le déploiement GitHub de Kinetic.
