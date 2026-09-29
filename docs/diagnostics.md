# Diagnostics et tests

Les tests automatisés sont rangés à côté du code qu’ils couvrent : musique dans
`features/music/`, panneau dans `features/web/`, base de données dans `core/`, etc.
`npm test` les découvre dans tout le projet. Le chargeur Discord ignore les fichiers
`*.test.js` et `*.spec.js` : ils ne deviennent jamais des commandes du bot.

Les outils de diagnostic réservés aux développeurs sont dans `tools/diagnostics/`.
Ils ne sont pas lancés par défaut. Le fichier temporaire qui transmet les commandes
du pont est créé dans `data/diagnostics/commands.txt`; `data/` est ignoré par Git et
exclu de l’image Docker. Au démarrage, l’ancien fichier local `Test/cmd.txt` est
migré automatiquement. L’ancien dossier n’est retiré que s’il est vide; les autres
fichiers locaux ne sont jamais supprimés.

## Pont local de diagnostic

Pour l’activer volontairement, configure `ENABLE_DIAGNOSTIC_HOOKS=true` et un
`DIAGNOSTIC_BRIDGE_TOKEN` aléatoire d’au moins 32 octets dans l’environnement privé,
puis redémarre le bot. Les anciens noms `ENABLE_TEST_HOOKS` et `TEST_BRIDGE_TOKEN`
restent acceptés pour compatibilité.

Le pont WebSocket écoute uniquement sur `127.0.0.1:7777`. Ne le publie pas sur une
interface réseau ou derrière un proxy. Le client local peut vérifier la connexion :

```sh
node tools/diagnostics/ws-client.js
```

Désactive `ENABLE_DIAGNOSTIC_HOOKS` après l’essai. Ne partage jamais le jeton.

## Vérification de la lecture vocale

`tools/diagnostics/vocal-playback.js` teste la commande de lecture avec un membre
réel présent dans le salon vocal. Renseigne ces variables privées dans `.env` ou dans
l’environnement du processus, puis lance `node tools/diagnostics/vocal-playback.js` :

- `DIAGNOSTIC_GUILD_ID` : identifiant du serveur à vérifier.
- `DIAGNOSTIC_VOICE_CHANNEL_ID` : identifiant du salon vocal.
- `DIAGNOSTIC_REQUESTER_ID` : identifiant du membre, qui doit être dans ce salon.
- `DIAGNOSTIC_TEXT_CHANNEL_ID` : salon textuel où le bot peut envoyer le retour (facultatif si le salon vocal prend en charge le chat).
- `DIAGNOSTIC_MUSIC_QUERY` : titre ou lien à lire.

Le script démarre le bot et le laisse connecté après la commande pour vérifier le son.
Arrête le processus quand le contrôle est terminé. Les identifiants du serveur ne sont
pas enregistrés dans le code.
