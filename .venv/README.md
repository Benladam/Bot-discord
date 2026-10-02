# Modèles publics et données privées

Ce dossier sert au stockage local du dashboard. Il ne s'agit pas d'un environnement
virtuel Python.

- `examples/` contient uniquement des modèles sans clé réelle. Ces fichiers peuvent
  être suivis par Git et déployés sur le serveur du bot.
- `local-dashboard/` contient les connexions, les journaux et les clés saisies dans
  le dashboard. Il reste sur cet ordinateur et est ignoré par Git et Docker.
- `bots/`, les fichiers `.env`, les bases SQLite et les journaux restent également
  privés.

Copiez un modèle de `examples/` vers le stockage privé de l'installation concernée,
puis remplacez les valeurs d'exemple localement. Ne mettez jamais un vrai token dans
ce dossier public.
