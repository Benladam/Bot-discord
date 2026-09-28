#!/usr/bin/env bash
# Lance le bot depuis le dossier du projet.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
fail() { printf 'Erreur: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail 'Node.js est absent. Installe Node.js 20 ou plus récent.'
command -v npm >/dev/null 2>&1 || fail 'npm est absent. Réinstalle Node.js avec npm inclus.'
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || fail "Node.js 20+ requis. Version trouvée: $(node --version)"
[ -f package.json ] || fail "package.json introuvable dans $ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env 2>/dev/null || true
  printf 'Fichier .env créé.\n'
fi

if ! grep -Eq '^[[:space:]]*DISCORD_TOKEN[[:space:]]*=[[:space:]]*[^[:space:]#]+' .env; then
  [ -t 0 ] || fail 'DISCORD_TOKEN manque dans .env. Ajoute-le puis relance.'
  printf 'Token du bot Discord (saisie masquée): '
  IFS= read -r -s token
  printf '\n'
  [ -n "$token" ] || fail 'Le token ne peut pas être vide.'
  DISCORD_TOKEN_INPUT="$token" node -e 'const fs=require("node:fs");let s=fs.readFileSync(".env","utf8");const v=process.env.DISCORD_TOKEN_INPUT;if(/^\s*DISCORD_TOKEN\s*=/m.test(s))s=s.replace(/^\s*DISCORD_TOKEN\s*=.*$/m,"DISCORD_TOKEN="+v);else s="DISCORD_TOKEN="+v+"\n"+s;fs.writeFileSync(".env",s,{mode:0o600})'
  unset token
  chmod 600 .env 2>/dev/null || true
fi

if [ ! -f node_modules/discord.js/package.json ] || [ ! -f node_modules/@snazzah/davey/package.json ]; then
  printf 'Installation des dépendances npm…\n'
  npm install --no-audit --no-fund
fi

if ! command -v yt-dlp >/dev/null 2>&1 && [ -z "${YTDLP_PATH:-}" ] && ! python3 -m yt_dlp --version >/dev/null 2>&1; then
  printf 'Attention: yt-dlp absent; la lecture YouTube ne fonctionnera pas avant installation.\n' >&2
fi
printf 'Démarrage du bot…\n'
exec node supervisor.js
