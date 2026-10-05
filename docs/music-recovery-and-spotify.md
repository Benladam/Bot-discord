# Sources audio et playlists Spotify

Le bot utilise Spotify/Deezer pour les métadonnées. Il cherche le morceau public
sur YouTube, puis SoundCloud si aucune source YouTube correspondante n'est lisible.
Il compare titre, artiste, version et durée : un extrait, remix ou autre titre
n'est pas un remplacement acceptable. Une recherche YouTube est limitée à 6 s.

Les playlists Spotify sont mises en file à partir de leurs métadonnées, dans
l'ordre d'origine. La source audio de chaque piste est recherchée au moment de
la lecture, sans rechercher les 100 pistes avant de commencer. Les flux ne sont
ni partagés entre serveurs ni réutilisés après un redémarrage.

## Audio temporaire complet avant lecture

Par défaut (`MUSIC_CACHE_ENABLED=true`), chaque morceau accessible est préparé
en **Opus stéréo 128 kb/s VBR** sous `BOT_DATA_DIR/.cache/audio-playback-v1/`.
Ce format compact ne rétablit pas la qualité d'une mauvaise source. La lecture
attend le téléchargement/encodage complet avant de rejoindre le vocal; cela
ajoute un temps de préparation, mais évite les coupures du fournisseur pendant
la lecture du fichier. Aucune vidéo ni fichier PCM volumineux n'est conservé.

Limites : 32 Mio par lecture, 128 Mio de cache total, réserve disque de 64 Mio,
90 secondes de préparation et 20 minutes par morceau. Avec une durée catalogue,
la durée audio réellement encodée est vérifiée (tolérance 3 %, entre 2 et 12 s).
Sans durée connue, la fin du flux et les limites sont contrôlées, sans pouvoir
prouver sa complétude par comparaison. Les morceaux annoncés de plus de 20 min
restent en streaming. Un cache interrompu est refusé; une seule recherche du
même morceau sur une autre source est permise avant lecture. Les candidats
YouTube/SoundCloud sont validés avant leur sélection définitive (au plus cinq
candidats YouTube et trois SoundCloud); une correspondance dont le téléchargement
est incomplet n'empêche pas l'essai du candidat suivant.

Un fichier unique est créé pour chaque lecteur et supprimé en fin de lecture,
Stop, skip, annulation ou erreur. Les sessions abandonnées après un crash sont
nettoyées à la préparation suivante après 2 h; aucun ancien fichier n'est rejoué.
Les permissions sont privées (0700/0600 sous Linux), aucun chemin ni titre ne
sert de nom de fichier et le cache n'est pas publié dans GitHub.

Si le disque est plein ou le quota atteint avant téléchargement, le flux intact
reste en streaming avec reprises. `MUSIC_CACHE_ENABLED=false` désactive le cache.
Ce cache **ne contourne pas** un refus d'authentification et ne génère aucun cookie.
Il n'est utilisé que sur un flux auquel l'hôte a déjà accès.

Console de diagnostic, sans rejoindre Discord :
`soundcloudcheck --cache=148 Ninho - Coco` cherche ce titre, compare sa durée,
prépare l'audio complet puis vérifie la suppression du fichier. Ce n'est pas
une preuve d'écoute réelle dans un salon vocal.

## Cookies YouTube facultatifs

La lecture essaie YouTube sans compte avant les fichiers de cookies configurés.
Une session absente ou expirée ne bloque donc pas un flux public accessible sans
compte. Les configurations externes de yt-dlp sont ignorées afin qu'elles ne
puissent pas réintroduire des cookies ou changer le morceau sélectionné.
Si YouTube refuse toutes les tentatives, le bot recherche le même morceau sur
SoundCloud, avec les mêmes contrôles d'identité, version et durée.
La console `musiccheck <lien vidéo YouTube>` indique si les premiers octets reçus
proviennent d'une lecture sans compte ou d'un essai avec cookies de secours.
Ce diagnostic ne rejoint pas Discord et ne prouve pas une lecture complète.

Un refus de correspondance musicale n'est pas un refus d'authentification : le
message ne demande plus de cookies dans ce cas. Les alias d'artiste doivent être
vérifiés dans `features/music/artistAliases.js`; aucun nom approchant n'est accepté
automatiquement. Mari Froes / Mariana Froes sont reconnus comme une même identité.
Un suffixe de fichier audio tel que `.mp3` ne fait plus échouer un titre autrement
identique; artiste, version et durée doivent toujours correspondre.

Il n'existe pas de cookie permanent garanti. La session peut être révoquée et
YouTube peut refuser l'hébergeur même avec une session valide. Le bot ne génère pas
de faux cookies et n'automatise pas de connexion Google. Les fichiers de cookies
restent privés et ne sont jamais publiés ni modifiés par yt-dlp (copie temporaire).
Voir [la documentation yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies).

## Reprise d'un flux interrompu

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
