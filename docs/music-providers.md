# Fournisseurs de musique

`play-dl` a été retiré. Le transport vocal, les files par serveur, les boutons
et les commandes slash/préfixe restent ceux du bot.

| Usage | Fournisseur principal | Secours |
| --- | --- | --- |
| Recherche et flux YouTube | `discord-player-youtubei` | yt-dlp |
| Playlist YouTube | yt-dlp (métadonnées publiques) | aucun |
| Recherche et résolution Deezer | API publique Deezer | aucun |
| Métadonnées Spotify | API Spotify / aperçu public existants | recherche audio YouTube puis SoundCloud |
| Recherche et flux SoundCloud | yt-dlp | HTTP SoundCloud avec `SOUNDCLOUD_CLIENT_ID` |

YouTubei n’est configuré avec aucun cookie ni accès aux navigateurs.
yt-dlp conserve les cookies privés explicitement configurés **sur son hôte**
en dernier recours ; le bot ne les récupère pas depuis Chrome ou Edge.
Aucun extracteur ne garantit l’accès si la plateforme refuse l’hébergeur.

## Essai Lavalink sur Kinetic ou un autre hôte

Dans la **console du bot hébergé** :

```text
musiccheck setup-lavalink
musiccheck lavalink --cache=170 Niska - Salé
```

L'installation explicite télécharge Lavalink 4.2.2 et youtube-plugin 1.18.2
depuis leurs releases officielles, vérifie leurs SHA-256 et, sur Linux x64
sans Java, installe une JRE Temurin 21 portable. Prévoir 600 MiB libres et
environ 300 MiB de RAM supplémentaire (heap Java plafonné à 192 MiB).
Elle ne modifie ni Docker, ni les cookies, ni les navigateurs.

Le service écoute **uniquement sur 127.0.0.1:2333**, avec un mot de passe
aléatoire privé. Tout est stocké dans `BOT_DATA_DIR/.cache/lavalink/` et exclu
de Git, y compris les JAR et Java. Le processus Java s'arrête avec le bot.

Une fois installé, le bot essaie **Lavalink → YouTubei → yt-dlp → SoundCloud**.
L'essai utilise `/v4/loadtracks` pour les métadonnées et la route documentée
`/youtube/stream/{videoId}` du plugin pour l'audio. Ce n'est pas une migration
du transport vocal vers Lavalink : la file par serveur, DAVE, les commandes,
les boutons et le cache complet contrôlé restent ceux du bot.

`LAVALINK_MODE=off` dans l'environnement de l'hôte restaure le parcours précédent.
Pour un service Lavalink v4 séparé, configure `LAVALINK_URL` (HTTPS) et
`LAVALINK_PASSWORD` dans le `.env` privé ; youtube-plugin doit être installé.
Ne publie pas le port privé via le proxy du dashboard.

Pour essayer OAuth YouTube sur l'instance Lavalink privée, lance ensuite
`musiccheck setup-lavalink-oauth` depuis la console Kinetic. La console affiche
le lien d'activation officiel et un code temporaire. Termine toi-même
l'autorisation Google avec un compte jetable. Le refresh token n'est jamais
affiché ni envoyé à Discord : il est stocké dans le `application.yml` privé,
avec les permissions du fichier limitées au propriétaire du processus.
Le plugin recommande un compte jetable et avertit que l'OAuth peut échouer ou
entraîner la fermeture du compte. L'activation ne garantit pas la lecture.

Le diagnostic valide le candidat et la durée de l'audio récupéré, puis supprime
le cache. Il ne remplace pas l'écoute du titre complet sur Discord.

## Vérification sur l’hébergeur

Depuis la console du bot, après installation des dépendances et redémarrage :

```text
musiccheck catalog Niska - Salé
musiccheck youtubei --cache=170 Niska - Salé
soundcloudcheck --cache=170 Niska - Salé
```

La première commande vérifie les catalogues et l’absence de `play-dl` installé.
Les deux suivantes vérifient la récupération d’un morceau complet, sans
rejoindre un vocal. La durée doit être celle du morceau demandé, pas celle
d’une autre version. Elles suppriment leur cache privé à la fin.

Il faut ensuite tester `play` sur Discord et écouter le morceau complet.
Un catalogue disponible ou un cache validé ne prouve pas l’écoute vocale.
Ne transférez ni cookies de navigateur, ni `.env`, ni fichiers privés sur GitHub.
