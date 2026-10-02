# Exemples `.venv`

Ces fichiers sont des modèles publics. Ils indiquent les variables attendues par le
dashboard local et par l'API de diagnostic du bot.

1. Copiez le modèle vers le fichier privé de votre installation.
2. Générez des clés distinctes pour chaque bot avec `crypto.randomBytes(32)`.
3. Remplacez les valeurs d'exemple uniquement dans `.venv/local-dashboard/` ou dans
   la configuration privée de l'hôte du bot.

Les modèles peuvent être envoyés sur GitHub puis récupérés par le serveur du bot avec
le mécanisme de mise à jour existant (`/update`, réservé aux administrateurs). Les clés réelles,
les adresses internes, les playlists et les journaux ne doivent jamais être ajoutés
ici.
