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

```bash
git clone <repo>
cd Bot-discord
npm install
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
| `SPOTIFY_CLIENT_ID` | pour Spotify | ID d'application Spotify |
| `SPOTIFY_CLIENT_SECRET` | pour Spotify | Secret d'application Spotify |

### Obtenir un token Discord
1. https://discord.com/developers/applications → New Application
2. Section **Bot** → Reset Token
3. Section **OAuth2 → URL Generator** → cochez `applications.commands` + `bot`,
   activez les intents **Server Members Intent**, **Message Content Intent** et
   **Voice State Intent**, puis utilisez l'URL générée pour inviter le bot.

### Obtenir les identifiants Spotify (uniquement pour les liens Spotify)
1. https://developer.spotify.com/dashboard → Create app
2. Copiez le **Client ID** et le **Client Secret** dans `.env`.

## Interface graphique (GUI)

À la place de `launch.bat` / `launch.sh`, une petite interface web locale permet
de tout piloter depuis une page (serveur Node natif, **zéro dépendance externe**) :

- **Mise à jour GitHub** : indiquer l'URL du dépôt puis bouton *Mettre à jour (pull)*
- **Dépendances** : bouton *Installer / Mettre à jour* (lance `npm install` depuis `requirements.txt`)
- **Tokens** : saisir le token du bot Discord et les identifiants Spotify, enregistrés dans `.env`
- **Contrôle du bot** : boutons *Lancer* / *Arrêter* / *Redémarrer*
- **Terminal en direct** : affiche en temps réel les logs du bot (les erreurs apparaissent en rouge)

Lancer l'interface :

```bash
# Windows
gui.bat
# Linux / macOS
bash gui.sh      # ou : chmod +x gui.sh && ./gui.sh
```

Le script ouvre automatiquement http://127.0.0.1:7777 dans le navigateur.
Le serveur tourne tant que la fenêtre du script reste ouverte.

> Astuce : le port par défaut est `7777`. Pour le changer : `GUI_PORT=8080 node gui/server.js`.

## Lancement (en ligne de commande)

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
gui/                    Interface graphique locale (server.js + public/index.html)
  gui.bat / gui.sh      Lanceurs de l'interface (remplacent launch.bat / launch.sh)
commands/               Une commande par fichier
utils/
  musicPlayer.js        Logique de lecture (connexion vocale, file, boucle)
  spotify.js            Résolution des liens Spotify -> YouTube
  resolve.js            Résolution YouTube/Spotify/recherche
  embeds.js             Embeds (messages enrichis)
  respond.js            Helpers de réponse unifiés
requirements.txt        Dépendances (installées via la GUI ou npm install)
```
