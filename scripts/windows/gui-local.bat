@echo off
setlocal
set "ROOT=%~dp0..\..\"
cd /d "%ROOT%"
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell est introuvable. Windows PowerShell est requis.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%gui-app\launcher.ps1"
exit /b %ERRORLEVEL%
