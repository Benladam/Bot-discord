#!/usr/bin/env bash
# ============================================================
#  Bot Discord « Heuss l'Enfoiré » — lanceur direct.
#  Plus de menu : le bot + le panneau se lancent tout de suite.
#  Ce terminal sert de terminal du bot (on peut y écrire /call, /play…).
#  Le panneau web s'ouvre tout seul.
#
#  Variables d'environnement possibles (optionnelles) :
#    GUI_PORT, GUI_AUTOCLOSE_MS, GUI_TERMINAL (cmd|gui|both)
# ============================================================
cd "$(dirname "$0")" || exit 1

export GUI_PORT="${GUI_PORT:-7777}"
export GUI_AUTOCLOSE_MS="${GUI_AUTOCLOSE_MS:-6000}"
export GUI_TERMINAL="${GUI_TERMINAL:-cmd}"
export GUI_AUTOSTART=1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "[ERREUR] Node.js n'est pas installé."
  echo "Téléchargez-le sur https://nodejs.org puis relancez ce fichier."
  echo ""
  exit 1
fi

URL="http://127.0.0.1:${GUI_PORT}"
echo ""
echo " =================================================="
echo "   BOT DISCORD - Heuss l'Enfoiré"
echo "   Panneau : $URL"
echo "   Terminal du bot ci-dessous."
echo " =================================================="
echo ""
echo "   Commandes : /call #général salut   /play musique"
echo "              /join Vocal   /ban perso   /help"
echo ""
echo "   Fermer ce terminal arrête le bot et le panneau."
echo " =================================================="
echo ""

( sleep 1
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
  elif command -v open >/dev/null 2>&1; then open "$URL"
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -NoProfile -Command "Start-Process '$URL'"
  fi ) >/dev/null 2>&1 &

trap 'kill $NODE_PID 2>/dev/null' INT TERM HUP EXIT
node gui/server.js &
NODE_PID=$!
wait $NODE_PID
