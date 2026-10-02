@echo off
setlocal
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"
where node >nul 2>nul
if errorlevel 1 (
  echo Installez Node.js 22.5 ou plus pour ouvrir le dashboard.
  pause
  exit /b 1
)
echo Ouvrez l'adresse affichee ci-dessous dans votre navigateur.
echo Fermez cette fenetre pour arreter le dashboard local.
node features\dashboard\localServer.js
if errorlevel 1 pause
