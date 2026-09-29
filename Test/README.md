# Dossier `Test/` — essais manuels

Ce dossier reste présent en local et dans le déploiement serveur. Il contient des
prototypes et diagnostics temporaires; il ne constitue pas le code de production.

## Frontières du projet

- `Test/` : essais manuels et scripts de diagnostic, non chargés au démarrage par défaut.
- `tests/` : tests automatisés reproductibles, exécutés avec `npm test`.
- `commands/` : adaptateurs Discord minces, un fichier par commande.
- `features/<domaine>/` : logique réellement validée (musique, web, modération, etc.).
- `core/` et `shared/` : infrastructure et fonctions communes.

Quand une expérimentation fonctionne, ne copie pas le prototype entier en production.
Réécris la logique utile dans le bon module `features/` (ou `core/` si c’est de
l’infrastructure), ajoute un test sous `tests/`, puis relie-la depuis `commands/` si
elle doit devenir une commande Discord. Une fonctionnalité sans commande reste dans
son domaine `features/`.

## Utilisation sur le serveur

Les scripts suivis de `Test/` sont livrés avec le dépôt et l’image Docker. Les hooks
qui pilotent le bot restent éteints sauf activation volontaire :

1. Configure `ENABLE_TEST_HOOKS=true` et un `TEST_BRIDGE_TOKEN` aléatoire d’au moins
   32 octets dans l’environnement privé du bot.
2. Redémarre le bot uniquement pour la durée de l’essai.
3. Le pont WebSocket écoute uniquement sur `127.0.0.1:7777`; il ne faut pas le publier
   derrière Kinetic ni le lier à une interface publique.
4. `Test/cmd.txt` sert de fichier de passage local, mais est exclu de Git et des images.
5. Remets `ENABLE_TEST_HOOKS=false` après les essais.

Le client d’essai charge `.env` puis s’authentifie avec le jeton configuré :
`node Test/test_ws_client.js`.

Les tests vocaux et prototypes peuvent viser un serveur réel : vérifie toujours les
IDs de serveur/salon et évite de laisser tourner une lecture ou un hook de diagnostic
après la fin du test.

## Historique des correctifs vocaux (pour mémoire)
1. 4003 "Not authenticated" -> heartbeat envoyé AVANT l'IDENTIFY (corrigé : 1er heartbeat
   attend l'intervalle).
2. 4006 "Session is no longer valid" -> on retirait le PORT de l'endpoint WS vocal
   (`split(':')[0]`). Discord l'exige désormais -> on garde le port.
3. 4017 "E2EE/DAVE required" -> Discord rend le chiffrement E2EE obligatoire ->
   `max_dave_protocol_version: 1` dans l'IDENTIFY.
4. 4016 "Unknown encryption mode" -> xsalsa20 supprimé par Discord -> implémentation
   DAVE `aead_aes256_gcm_rtpsize` (AES-256-GCM natif Node, nonce 24o = header RTP + 12 zéros,
   AAD = header RTP, tag GCM appendu + counter 4o).
5. 4006 en mode normal (bot déjà dans le salon) -> leave via gateway opcode 4 (channel_id null)
   AVANT le join, pour fermer la session résiduelle côté serveur.
