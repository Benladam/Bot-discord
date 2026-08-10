#!/usr/bin/env bash
# Lance le bot Discord musique (YouTube + Spotify)
# Commandes slash (/) et préfixe (!) prises en charge.

set -e

# Se place dans le dossier du script, peu importe d'où on le lance
cd "$(dirname "$0")"

# Installe les dépendances si jamais elles ne sont pas présentes
if [ ! -d "node_modules" ]; then
  echo "📦 Installation des dépendances (npm install)..."
  npm install
fi

# Crée le .env à partir de l'exemple si besoin
if [ ! -f ".env" ]; then
  echo "⚙️  Création de .env à partir de .env.example..."
  cp .env.example .env
  echo "❗ Remplissez DISCORD_TOKEN (et SPOTIFY_CLIENT_ID/SECRET si besoin) dans .env, puis relancez ce script."
  exit 1
fi

echo "🎵 Démarrage du bot..."
node bot.js
