# Autoresearch - fiabilite des cookies YouTube

## Objectif
Maximiser cookie_cases_passed sur une matrice fixe de 9 cas. Plus haut est mieux ; le maximum est 9.

## Fichier modifiable
- Modifier uniquement utils/audioSender.js.
- Le testeur evaluate.js, les tests existants, les dependances et tout autre fichier sont fixes.

## Cadre de securite
- Utiliser uniquement les cookies Netscape factices du testeur.
- Ne jamais lire, copier, afficher, transmettre ni utiliser .env, data/, des cookies de compte ou des identifiants.
- Aucun acces reseau, aucune requete YouTube et aucun test sur le bot distant.
- Ne pas ajouter de dependance.
- Chaque resultat doit garder npm test entierement vert.
- Le runner ne peut annuler que le dernier commit d'experience de cette branche dediee.

## Mesure
La commande node .autoresearch/engineering/youtube-cookie-reliability/evaluate.js verifie 9 cas locaux avec processus yt-dlp simules, puis execute npm test. Le score est le nombre de cas cookies reussis ; un echec de la suite existante invalide l'essai.

## Strategie
1. Mesurer le score de depart sans modifier la cible.
2. Corriger un comportement de cookies a la fois, en privilegiant le repli sans compte et la distinction entre jar manquant et binaire manquant.
3. Garder la solution la plus simple qui conserve les tests existants.
4. Ne pas repeter un essai rejete ; consulter results.tsv et le diff du commit precedent.

## Arret
Arreter des que les 9 cas passent et que npm test reste vert. Sinon, arreter apres 8 essais ou 5 echecs consecutifs, puis decrire les limites restantes.
