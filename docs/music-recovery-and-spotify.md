# Sources audio et playlists Spotify

Le bot utilise Spotify/Deezer pour les métadonnées. Il cherche le morceau public
sur YouTube, puis SoundCloud si aucune source YouTube correspondante n'est lisible.
Il compare titre, artiste, version et durée : un extrait, remix ou autre titre
n'est pas un remplacement acceptable. Une recherche YouTube est limitée à 6 s.

Les playlists Spotify sont mises en file à partir de leurs métadonnées, dans
l'ordre d'origine. La source audio de chaque piste est recherchée au moment de
la lecture, sans rechercher les 100 pistes avant de commencer. Les flux ne sont
ni persistés ni partagés entre serveurs.

## Coupure audio

Le lecteur tente au maximum deux reprises d'un flux interrompu : d'abord une
réouverture de sa source, puis une recherche du même titre sur YouTube/SoundCloud,
en excluant les sources déjà défaillantes. La reprise saute la position réellement
envoyée à Discord, pas la quantité seulement téléchargée. Pause, volume, Stop et
skip restent actifs pendant la recherche. Une impossibilité définitive est encore
signalée : aucun code ne peut garantir la disponibilité d'un fournisseur externe.

## Spotify : HTTP 401/403

Les requêtes de playlist utilisent `/v1/playlists/{id}/items`, par pages de 50.
Un HTTP 401 renouvelle le jeton une seule fois. L'accès complet nécessite une
autorisation OAuth du propriétaire ou d'un collaborateur de la playlist.

Dans le `.env` privé du serveur :

```dotenv
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
SPOTIFY_REFRESH_TOKEN=
```

Le refresh token doit provenir du flux Authorization Code Spotify, après consentement
du compte, avec les droits `playlist-read-private` et `playlist-read-collaborative`
nécessaires. Ce n'est pas un cookie Google ni un token Discord. Ne le publiez pas et
ne le collez pas dans le chat. Le bot renouvelle le jeton d'accès avant expiration.
La configuration OAuth n'accorde pas l'accès aux playlists privées d'autres comptes.

Sans autorisation API valide, une playlist publique peut utiliser les métadonnées
de son embed Spotify officiel. Cet aperçu peut n'exposer que 50 titres : le bot
indique explicitement que l'import peut être partiel. Il ne lit **jamais** les
extraits audio Spotify de cet aperçu. Si celui-ci est indisponible, l'erreur API
est conservée. Import API limité à 100 morceaux.

Références : [Spotify Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items),
[renouvellement OAuth](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens),
[FFmpeg seek](https://ffmpeg.org/ffmpeg.html).
