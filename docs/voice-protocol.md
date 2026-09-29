# Notes historiques sur le transport vocal

Ces notes documentent des incidents corrigés pendant l’évolution de la connexion
vocale maison. Elles servent de repères de diagnostic, pas de spécification Discord.

- Fermeture `4003` (« Not authenticated ») : le premier heartbeat était envoyé trop
  tôt. Il doit attendre l’intervalle annoncé par le serveur.
- Fermeture `4006` (« Session is no longer valid ») : le port de l’endpoint vocal
  avait été supprimé. Il faut conserver l’endpoint fourni par Discord, port compris.
- Fermeture `4017` (« E2EE/DAVE required ») : Discord exige le chiffrement vocal DAVE;
  l’IDENTIFY annonce `max_dave_protocol_version: 1`.
- Fermeture `4016` (« Unknown encryption mode ») : le mode `xsalsa20` n’était plus
  proposé. Le client utilise le mode `aead_aes256_gcm_rtpsize` avec DAVE.
- Fermeture `4006` lors d’une reconnexion : quitter d’abord l’ancien salon via
  l’opcode Gateway 4 (`channel_id: null`) évite de réutiliser une session résiduelle.
