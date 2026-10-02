@echo off
setlocal
set "ROOT=%~dp0..\..\"
cd /d "%ROOT%"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.5 ou plus est requis pour activer la protection Git.
  pause
  exit /b 1
)
node tools\security\installGitGuard.js
if errorlevel 1 pause
exit /b %ERRORLEVEL%
