# Commandes musicales et tickets

Toutes les commandes ci-dessous fonctionnent en slash et avec le préfixe configuré.
L’aide privée les range automatiquement par catégorie, sans imposer un préfixe.

## Musique

| Commande | Fonction |
| --- | --- |
| play query | Lien/suggestion sélectionnée : ajout à la file. Texte : recherche paginée déjà intégrée. |
| previous | Rejoue le précédent de la session; remet le titre interrompu juste après. |
| remove position | Retire un titre en attente, positions à partir de 1. |
| move depart arrivee | Déplace un titre en attente, sans couper la lecture actuelle. |
| filter mode | none, bass, soft, mono, vocal-reduce. Filtre en direct, durée inchangée. |
| lyrics titre | Paroles LRCLIB en privé, pages pendant 2 minutes. Titre facultatif : Artiste - Titre. |

Les contrôles modifiant le lecteur exigent de rejoindre son salon vocal, dans le
serveur concerné. L’historique ne contient que 20 titres de cette session et est
effacé par Stop, déconnexion ou redémarrage. Il ne déclenche jamais un ancien
morceau automatiquement. Les filtres restent isolés par lecteur/serveur et ne
modifient pas le fichier audio temporaire. L’atténuation des voix est une simple
soustraction stéréo, pas une séparation de stems par IA.

## Tickets et modération

- `ticket setup support categorie` : permission Gérer le serveur, rôle support
  obligatoire (pas everyone), catégorie facultative. Préfixe : identifiants ou mentions.
- `ticket open` : crée un salon privé, ou renvoie le ticket actif existant.
- `ticket close` : demandeur/support/Gérer les salons; archive en lecture seule
  pour le demandeur. **Ne supprime pas l’historique.**
- `unban id` et `untimeout membre` complètent les outils existants (ban, kick,
  timeout, warn, unwarn, warnings, clear). Les permissions Discord restent exigées.

Les tickets sont privés vis-à-vis des membres ordinaires. Les administrateurs
Discord gardent leur accès inhérent. Le bot doit pouvoir gérer les salons et les
rôles (pour gérer les permissions privées).
La configuration est sauvegardée par serveur dans la base privée, jamais dans Git.

## Fournisseur automatique PO token YouTube

Un PO token est une attestation de client, **pas un jeton de connexion Google**.
L’installation est facultative et explicite, sur la machine qui héberge le bot :

```sh
npm run music:pot:install
```

Sur Kinetic, dont la console reçoit les commandes du bot et non un shell, utiliser :

```text
musiccheck setup-pot
```

L’installateur télécharge **bgutil 2.0.1**, vérifie le commit source et le SHA-256
du plugin, installe ses dépendances verrouillées puis compile le fournisseur.
Prérequis : Node 22+, git, npm et dépendances natives compatibles avec canvas.
Le code amont reste sous sa licence GPL dans les données privées, pas dans ce dépôt MIT.
Les données se trouvent dans `BOT_DATA_DIR/.cache/youtube-pot/2.0.1`
(ou le répertoire de données habituel si BOT_DATA_DIR est vide).

Après installation, le bot démarre paresseusement un seul helper, uniquement
sur **127.0.0.1:4416**. Il s’arrête lorsque le processus du bot disparaît.
Ne publier ce port ni dans le proxy ni sur Internet. Le helper ne reçoit ni
DISCORD_TOKEN, ni secret du dashboard, ni cookie de compte via son environnement.
`YOUTUBE_PO_TOKEN_MODE=off` désactive son utilisation sans effacer les fichiers.
Le mode auto n’installe rien à chaque démarrage ni à chaque morceau.

La lecture YouTube utilise alors mweb et le plugin automatique. Les cookies
restent un secours séparé. Un helper prêt n’est **pas une preuve** qu’un PO token
a été accepté : exécuter `musiccheck https://www.youtube.com/watch?v=VIDEO_ID`
sur le serveur, puis contrôler une lecture complète dans Discord.
`musiccheck pot-info https://www.youtube.com/watch?v=VIDEO_ID` vérifie aussi
si yt-dlp a chargé le plugin et demandé une génération GVS. Il ne publie que
des indicateurs, jamais les sorties brutes, tokens ou URLs signées.

YouTube peut encore exiger une connexion, refuser une IP d’hébergement ou limiter
un contenu. Aucun fournisseur ne garantit des cookies éternels ou zéro blocage.
Si aucune source complète du **même** morceau n’est accessible, le bot refuse
plutôt que de substituer un autre titre.

Références : [guide yt-dlp](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide),
[fournisseur bgutil](https://github.com/Brainicism/bgutil-ytdlp-pot-provider),
[API LRCLIB](https://lrclib.net/docs).
