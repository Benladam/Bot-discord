# Protection des fichiers locaux avant GitHub

Le dépôt contient une protection locale pour éviter d’envoyer par erreur des données
Minecraft, des modèles IA, des journaux, des sauvegardes ou des secrets.

## Activer la protection

Dans ce checkout, lance une fois :

```bash
npm run security:install
```

Sous Windows, `scripts/windows/install-git-guard.bat` fait la même chose. La commande
configure `core.hooksPath` uniquement dans `.git/config` de ce checkout ; ce réglage
n’est pas envoyé sur GitHub.

Après activation :

- `pre-commit` vérifie les fichiers placés dans l’index ;
- `pre-push` vérifie les nouveaux commits qui vont être envoyés ;
- les chemins locaux connus et les signatures de clés, tokens et webhooks sont refusés ;
- aucun secret n’est affiché dans le message d’erreur.

Le contrôle manuel de l’état suivi par Git est disponible avec :

```bash
npm run security:audit
```

Pour contrôler uniquement ce qui sera inclus dans le prochain commit :

```bash
npm run security:check
```

## Ce qui reste local

`.env*` sauf `.env.example`, `private/`, `data/`, les fichiers `.pem` et `.key`, les
bases SQLite, les journaux, les archives, les raccourcis, les données Minecraft et les
dossiers `ia-privee/`, `models/`, `checkpoints/`, `lora/` et `weights/` sont ignorés et
également refusés par le garde Git même avec `git add -f`.

Le code public de l’intégration IA reste dans `features/ai/`. Seuls les modèles, poids,
conversations et configurations privées doivent rester dans les dossiers locaux ignorés.

## Limite importante

`.gitignore` protège les fichiers non suivis ; le garde Git protège les commits locaux.
Un secret déjà envoyé sur GitHub doit être révoqué ou renouvelé, puis retiré de
l’historique avec une procédure Git dédiée. Ne force pas un fichier sensible avec
`git add -f` : le garde le bloquera volontairement. Les options Git `--no-verify`
désactivent les hooks ; ne les utilise pas pour un commit ou un push de ce dépôt.
