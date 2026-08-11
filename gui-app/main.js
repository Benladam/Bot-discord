/**
 * main.js — App native (Electron) pour le bot Heuss l'Enfoire.
 * - Demarre le bot + serveur GUI (node bot.js) en arriere-plan.
 * - Attend que le GUI reponde sur http://localhost:7777.
 * - Ouvre une fenetre native affichant le GUI (plus de navigateur).
 * - A la fermeture : tue le process bot (aucun zombie, regle enzom).
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

let botProcess = null;
let mainWindow = null;

const REPO_DIR = path.resolve(__dirname, '..'); // dossier parent = racine du bot
const PORT = 7777;

function startBot() {
  // Lance le bot (qui demarre aussi le serveur GUI sur :7777).
  botProcess = spawn('node', ['bot.js'], {
    cwd: REPO_DIR,
    windowsHide: true,
    env: { ...process.env },
  });
  botProcess.stdout.on('data', (d) => process.stdout.write('[bot] ' + d));
  botProcess.stderr.on('data', (d) => process.stderr.write('[bot] ' + d));
  console.log('[app] bot demarre (pid=' + botProcess.pid + ')');
}

function waitForGui(retries = 50) {
  return new Promise((resolve) => {
    const tryOnce = (n) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => {
        res.destroy();
        resolve(true);
      });
      req.on('error', () => {
        if (n <= 0) resolve(false);
        else setTimeout(() => tryOnce(n - 1), 400);
      });
      req.setTimeout(1000, () => { req.destroy(); if (n <= 0) resolve(false); else setTimeout(() => tryOnce(n - 1), 400); });
    };
    tryOnce(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: "Heuss l'Enfoire",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadURL('http://127.0.0.1:' + PORT + '/');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  console.log('[app] attente du GUI sur :' + PORT + ' ...');
  const ok = await waitForGui();
  if (!ok) {
    console.error('[app] GUI indisponible apres attente — ouverture fenetre quand meme');
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Le bot tourne deja en H24 (gui.bat) : on ne le tue pas ici pour eviter les zombies.
  if (process.platform !== 'darwin') app.quit();
});
