# Organisation du dépôt

Le dépôt garde les points d’entrée historiques à sa racine pour que les commandes et les
hébergeurs existants continuent de fonctionner. Le code est regroupé par responsabilité :

```text
bot.js / supervisor.js       démarrage du bot et redémarrage supervisé
.githooks/                   contrôles locaux avant commit et push
commands/                    commandes Discord
core/                        SQLite, mise à jour GitHub et synchronisation des commandes
features/
  dashboard/                 API distante, relais local et interface du dashboard
  music/                     lecteur vocal, catalogue et fournisseurs audio
  web/                       panneau web musical existant
  ai/ moderation/ presence/  fonctionnalités transversales
shared/discord/              helpers, embeds et icônes Discord partagés
assets/discord/              emblème et icônes de fournisseurs
tools/diagnostics/           outils de diagnostic et vérifications vocales
tools/security/              garde Git local contre les secrets et données privées
gui-app/                     interface Windows du lanceur local
scripts/windows/             lanceurs Windows canoniques
docs/                        documentation et guides d’exploitation
data/                        données runtime locales ignorées par Git
```

Les connexions sont synchronisées dans `.venv/local-dashboard/`, avec un `.env` privé
par bot dans `bots/<identifiant>/`. Ce stockage est ignoré par Git. Les modèles sans
secret autorisés au partage sont dans `.venv/examples/`. Le projet reste Node.js :
`.venv` sert ici au stockage local, ses dépendances sont dans `node_modules/`.

Les scripts racine (`npm start`, `npm run dashboard`, `launch.sh`, `GUI-local.bat` et
`Dashboard-local.bat`) sont conservés comme façades stables pour les installations existantes.
Les archives, raccourcis et sauvegardes locales ne sont pas mélangés au code suivi par Git.

`npm test` cible explicitement les tests de `commands/`, `core/`, `features/`, `shared/` et
`tools/`. Les copies de diagnostic conservées dans `private/` ne sont pas des sources de
production et ne sont donc pas lancées par erreur avec la suite principale.
