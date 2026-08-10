@echo off
REM ============================================================
REM  Bot Discord « Heuss l'Enfoiré » — lanceur direct.
REM  Plus de menu : le bot + le panneau se lancent tout de suite.
REM  Cette fenetre sert de terminal du bot (on peut y ecrire /call, /play…).
REM  Le panneau web s'ouvre tout seul.
REM
REM  Variables d'environnement possibles (optionnelles) :
REM    GUI_PORT        (defaut 7777)
REM    GUI_AUTOCLOSE_MS (defaut 6000)
REM    GUI_TERMINAL    cmd | gui | both   (defaut cmd : terminal ici)
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

if not defined GUI_PORT set GUI_PORT=7777
if not defined GUI_AUTOCLOSE_MS set GUI_AUTOCLOSE_MS=6000
if not defined GUI_TERMINAL set GUI_TERMINAL=both
set GUI_AUTOSTART=1

REM --- Verification de Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERREUR] Node.js n'est pas installe.
  echo Telechargez-le sur https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

cls
echo.
echo  ==================================================
echo    BOT DISCORD - Heuss l'Enfoire
echo    Panneau : http://127.0.0.1:%GUI_PORT%
echo    Terminal du bot ci-dessous.
echo  ==================================================
echo.
echo   Commandes : /call #general salut   /play musique
echo              /join Vocal   /ban perso   /help
echo.
echo   Fermer cette fenetre arrete le bot et le panneau.
echo  ==================================================
echo.

start "" http://127.0.0.1:%GUI_PORT%
node gui/server.js
echo.
echo Le bot s'est arrete.
pause
endlocal
exit
