# Dossier Test/

Ce dossier sert à isoler le travail de diagnostic/experimentation **non validé à 100%**
avant de le pousser sur GitHub ou d'écraser les fichiers de production.

## Règle d'or
- Tout ce qui est **incertain** (nouveau module vocal, correctif de connexion,
  test de flux audio, etc.) va d'abord ici.
- On ne pousse sur GitHub / on ne modifie les fichiers de prod (`utils/`, `bot.js`,
  `commands/`) QUE quand le comportement est validé à 100% (le bot rejoint le salon,
  `secretKey=oui`, et le son sort dans Discord).
- Quand c'est validé, on copie le fichier validé depuis `Test/` vers la racine du repo
  (via PowerShell `Copy-Item` car le dossier racine est protégé CFA), puis `git commit` + `git push`.

## Contenu typique
- `Test/voice_test.js` — petit script qui ouvre le WS vocal et loggue les opcodes.
- `Test/test_mode_normal.js` — reproduit le scénario `!play` en mode normal (bot déjà
  dans le salon) pour valider le leave gateway.
- `Test/README.md` — ce fichier.

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
