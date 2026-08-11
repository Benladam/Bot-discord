#!/usr/bin/env bash
# Lance le bot Discord musique (YouTube + Spotify) et le met en ligne.
# Commandes slash (/) et prefixe (!) prises en charge.
# Installe les dependances listees dans requirements.txt.
# Usage : bash launch.sh   (ou : chmod +x launch.sh && ./launch.sh)

set -e

cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "📦 Installation des dependances depuis requirements.txt..."
  grep -v '^\s*#' requirements.txt | grep -v '^\s*$' | xargs -r npm install
fi

if [ ! -f ".env" ]; then
  echo "⚙️  Creation de .env a partir de .env.example..."
  cp .env.example .env
  echo "❗ Remplissez DISCORD_TOKEN (et SPOTIFY_CLIENT_ID/SECRET si besoin) dans .env, puis relancez ce script."
  exit 1
fi

echo "🎵 Demarrage du bot..."
node bot.js
