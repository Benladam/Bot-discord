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
