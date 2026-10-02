@echo off
setlocal
set "ROOT=%~dp0..\.."
cd /d "%ROOT%"
where node >nul 2>nul
if errorlevel 1 (
  echo Installez Node.js 22.5 ou plus pour ouvrir le dashboard.
  exit /b 1
)
echo Le navigateur va ouvrir automatiquement l'adresse affichee ci-dessous.
echo Fermez cette fenetre pour arreter le dashboard local.
set "DASHBOARD_OPEN_BROWSER=1"
node features\dashboard\localServer.js
exit /b %ERRORLEVEL%
