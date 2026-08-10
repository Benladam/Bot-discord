@echo off
REM Lance le bot Discord musique (YouTube + Spotify) et le met en ligne.
REM Commandes slash (/) et prefixe (!) prises en charge.
REM Installe les dependances listees dans requirements.txt.

cd /d "%~dp0"

if not exist node_modules (
  echo 📦 Installation des dependances depuis requirements.txt...
  for /f "usebackq tokens=*" %%i in (`findstr /b /v "#" requirements.txt`) do (
    if not "%%i"=="" call npm install %%i
  )
)

if not exist .env (
  echo ⚙️  Création de .env à partir de .env.example...
  copy .env.example .env
  echo ❗ Remplissez DISCORD_TOKEN (et SPOTIFY_CLIENT_ID/SECRET si besoin) dans .env, puis relancez ce fichier.
  pause
  exit /b 1
)

echo 🎵 Démarrage du bot...
node bot.js
pause
