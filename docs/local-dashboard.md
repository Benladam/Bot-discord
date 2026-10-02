# Dashboard local Discord

## Démarrer sur votre ordinateur

Avec Node.js 22.5+ et les dépendances du projet installées, double-cliquez sur
`Dashboard-local.bat`, ou lancez :

```sh
npm run dashboard
```

`Dashboard-local.bat` ouvre automatiquement **http://127.0.0.1:3090** dans le navigateur.
`npm run dashboard` ouvre aussi le navigateur. `DASHBOARD_OPEN_BROWSER=0` permet de désactiver cette ouverture.
Le service écoute uniquement sur cet ordinateur.
Il ne démarre aucun bot Discord : le bot peut continuer de tourner sur son hébergeur.
Le port peut être modifié avec `DASHBOARD_LOCAL_PORT`.

## Installer l’API sur l’hôte du bot

1. Installez cette version du bot sur son hôte via le système de mise à jour existant
   ou manuellement, puis redémarrez-le avec son superviseur habituel.
2. Générez une clé de diagnostic distincte du token Discord :

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

3. Ajoutez cette clé à la configuration privée du bot sous `DASHBOARD_API_TOKEN`.
   Les données du tableau de bord utilisent une API en lecture seule, protégée par ce jeton.
4. Rendez le service HTTP du bot accessible via **HTTPS** : son port est
   `SERVER_PORT`, puis `PORT`, sinon `8080`. Utilisez le proxy HTTPS de votre hébergeur
   ou un tunnel privé qui termine TLS. Le service partage le port HTTP du panneau musical
   existant et du pont privé, lorsqu’il est activé. Ne désactivez pas la vérification TLS.
5. Dans le dashboard, cliquez sur **Connexion API**, puis entrez le nom, l’adresse
   HTTPS du service du bot et la clé. **Enregistrer et verrouiller** conserve la connexion.

L’adresse est celle du **bot**, par exemple `https://bot.exemple.fr`, pas l’API de gestion
du panneau Kinetic/Pterodactyl. Une API d’hébergeur seule ne contient ni les playlists SQLite,
ni l’état des lecteurs musicaux. Le dashboard nécessite donc son module dans le bot.
Si votre proxy publie le service sous `/bot`, configurez `WEB_BASE_PATH=/bot` sur le bot
et renseignez `https://exemple.fr/bot` dans le dashboard. N’ajoutez pas `/api/dashboard`.
HTTP est accepté seulement pour une API sur localhost pendant le développement.

`WEB_ADMIN_TOKEN` n’est pas nécessaire pour cette API de diagnostic. Le panneau musical
public conserve son authentification et ses commandes propres.

## Verrouiller et déverrouiller l’API

Les connexions sont verrouillées après enregistrement. **Afficher** permet de lire
l’adresse sans modification. **Déverrouiller** rend l’adresse et le nom modifiables ;
vous pouvez saisir une nouvelle clé ou laisser ce champ vide pour conserver l’ancienne.
**Enregistrer et verrouiller** applique les modifications puis verrouille les champs.
**Verrouiller** abandonne les changements non enregistrés. Le verrouillage prévient les
modifications accidentelles ; il ne constitue pas un mot de passe d’accès au PC.

Vous pouvez enregistrer plusieurs bots. **Retirer du dashboard** supprime seulement
la connexion locale, sans effacer les données du bot distant.

Les noms, adresses et verrous sont dans `.venv/local-dashboard/connections.json`.
Les clés sont dans `.venv/local-dashboard/.env`, exclu de Git et du contexte Docker.
Chaque enregistrement crée ou actualise aussi `.venv/local-dashboard/bots/<identifiant>/.env`.
Les anciennes connexions de `data/local-dashboard/` sont copiées automatiquement au premier lancement.
Gardez ce dossier privé ; les clés ne sont jamais renvoyées au navigateur après enregistrement.
Le dashboard peut ainsi gérer plusieurs bots sans mélanger leurs clés. Vous pouvez aussi
préparer le fichier d’environnement avant le démarrage avec des groupes
`DASHBOARD_BOT_1_NAME`, `DASHBOARD_BOT_1_URL`, `DASHBOARD_BOT_1_TOKEN`, puis les mêmes
variables avec `_2_`, `_3_`, etc. L’interface les importera et les verrouillera.
Le dashboard utilise ici `.venv` comme dossier de stockage local. Les modèles publics
se trouvent dans `.venv/examples/`, tandis que `.venv/local-dashboard/` et `.venv/bots/`
restent privés et ignorés par Git. Aucun environnement Python n’est nécessaire ; les
clés sont des fichiers locaux en clair, pas un coffre chiffré.
Le service local vérifie l’origine, le Host et la session locale et protège les modifications
avec un jeton CSRF. Il ne faut pas exposer son port sur Internet.

## Données affichées

- Liste réelle des serveurs Discord, nom, icône, nombre de membres et état vocal.
- **Tous les serveurs** : vue et journaux de l’ensemble du bot.
- **Journal du bot** : événements sans serveur associé (démarrage, connexion, erreurs globales).
- Sélection d’un serveur : journaux, erreurs, file d’attente, playlists et historique de lecture
  propres à ce serveur, sans mélanger les autres serveurs.
- Recherche, période, niveau, catégorie, détail avec utilisateur/commande/trace d’erreur,
  pagination et export JSON des événements actuellement affichés.
- Mesures du processus distant : latence Discord, mémoire, CPU, version Node et durée du processus.
  La première mesure CPU peut être indisponible. Le cumul des membres compte une même personne
  plusieurs fois lorsqu’elle appartient à plusieurs serveurs.

Les journaux sont persistés dans le SQLite du bot (`BOT_DATA_DIR` / `BOT_DB_PATH`),
conservés **14 jours**, avec une limite d’environ **50 000 événements** (purge toutes les
200 écritures). Les tokens, secrets de l’environnement et paramètres sensibles connus sont
masqués dans ces journaux. Les URL internes des flux audio ne sont pas exposées par l’API.
La collecte débute avec cette version ; elle ne reconstitue pas les anciennes sorties console.
Les événements dont le serveur n’est pas identifiable apparaissent dans le journal global.

Le dashboard reçoit l’état du bot toutes les 3 secondes. Il utilise un relais local,
donc n’exige pas de configuration CORS sur le bot. L’accès aux commandes musicales et
à la mise à jour n’est pas proposé dans cette interface de diagnostic.

## Terminal et redémarrage

Le terminal affiche les connexions, erreurs, événements reçus et ordres de redémarrage,
sans attente « appuyez pour continuer ». Le lien affiché s’ouvre avec Ctrl+clic dans
Windows Terminal ; si votre console ne reconnaît pas les liens, copiez-le dans le navigateur.
Le lanceur ouvre aussi le navigateur lorsqu’une instance du dashboard tourne déjà.

Pour activer **Redémarrer le bot** dans l’onglet système, générez une seconde clé privée
distincte et configurez-la sous `DASHBOARD_CONTROL_TOKEN` sur le bot et dans le champ
**Clé administrateur** de sa connexion locale. Partagez cette clé uniquement avec les
administrateurs. Lancez le bot avec `npm start` pour utiliser le superviseur. Le bouton
demande confirmation, ferme la connexion Discord et les lecteurs, puis relance le bot.

## Si la connexion échoue

- **API absente** : déployez le nouveau module, vérifiez le préfixe du proxy et son port cible.
- **Clé refusée** : déverrouillez la connexion et saisissez le même `DASHBOARD_API_TOKEN` que sur l’hôte.
- **API non configurée** : renseignez cette variable sur l’hôte et redémarrez le bot.
- **API inaccessible** : vérifiez l’adresse HTTPS, le certificat, le proxy et la disponibilité du bot.
- **API connectée mais Discord déconnecté** : l’API fonctionne ; consultez les erreurs du journal du bot.

Un bot déjà hébergé sans endpoint HTTP accessible ne peut pas transmettre ces informations
à votre PC par la seule API Discord. Il faut d’abord lui donner un accès HTTPS ou un tunnel.

## Routes de diagnostic

Sous le préfixe facultatif `WEB_BASE_PATH`, avec `Authorization: Bearer <clé>` :

| Route GET | Contenu |
| --- | --- |
| `/api/dashboard/status` | État, métriques et serveurs du bot |
| `/api/dashboard/logs` | Logs filtrables par `guildId`, `level`, `category`, `search`, `since`, `before`, `limit` |
| `/api/dashboard/history` | Titres joués, filtrables par serveur |
| `/api/dashboard/guilds/:id` | État musical, playlists et compteurs du serveur |
| `/api/dashboard/guilds/:id/playlists/:nom` | Titres de la playlist, nom encodé comme segment URL |

`guildId=global` sélectionne les événements sans serveur. L’absence de `guildId` sélectionne
tous les événements. Les identifiants de serveur inconnus sont refusés. Les appels qui
modifient le bot sont refusés par cette API.
