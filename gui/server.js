/**
 * server.js — Interface graphique locale pour le bot Discord musique.
 *
 * Remplace launch.bat / launch.sh par une petite application web servie en
 * local (http://127.0.0.1:7777). Zéro dépendance externe : uniquement les
 * modules natifs de Node (http, child_process, fs, path, url).
 *
 * Fonctionnalités de la GUI :
 *   - Mise à jour Git en UN clic (le lien du dépôt est pré-rempli automatiquement)
 *   - Mise à jour des dépendances (npm install depuis requirements.txt / package.json)
 *   - Saisie / sauvegarde du token Discord et des identifiants Spotify (.env)
 *   - Lancement / Arrêt / Redémarrage du bot
 *   - Terminal en direct (logs + erreurs du bot en temps réel via Server-Sent Events)
 *
 * Lancer :  node gui/server.js   (puis ouvrir l'URL affichée)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { URL } = require('url');
const { DiscordPresence, fetchBotName } = require('./rpc');

// --- Chemins ---
// Racine du projet Bot-discord (parent de gui/). GUI_ROOT permet de forcer un
// chemin (utile pour les tests), sinon déduit depuis l'emplacement du fichier.
const ROOT = process.env.GUI_ROOT
  ? path.resolve(process.env.GUI_ROOT)
  : path.resolve(__dirname, '..');
const GUI_DIR = __dirname;
const PUBLIC_DIR = path.join(GUI_DIR, 'public');
const ENV_PATH = path.join(ROOT, '.env');

// Préférences de la GUI (langue…). Stockées dans le dossier de l'utilisateur
// car Documents peut être protégé en écriture par Windows.
const PREFS_PATH = path.join(os.homedir(), '.bot-gui-prefs.json');

// Lien du dépôt utilisé par défaut si aucun remote n'est configuré.
const DEFAULT_REPO = 'https://github.com/Benladam/Bot-discord.git';

const PORT = process.env.PORT || process.env.GUI_PORT || 7777;
const HOST = process.env.HOST || '0.0.0.0';

// --- État du bot ---
let botProc = null;          // processus enfant du bot
let botConnected = false;    // le bot est connecté à Discord (online)
let updating = false;        // vrai pendant une mise à jour Git/deps
let shuttingDown = false;    // évite de fermer deux fois
const sseClients = [];       // clients connectés au flux de logs

// Contact du support affiché dans la carte « Aide ».
const SUPPORT = {
  discordUser: 'lefauxmaghrebin',
  discordInvite: 'https://discord.gg/YpAyfZ9Bs7',
};

// --- Présence Discord (« Joue à Bot Gui ») ---
const presence = new DiscordPresence((lvl, msg) => broadcast(lvl, msg));

/** Met à jour ce que Discord affiche sur le profil. */
function updatePresence() {
  presence.setActivity({
    // « Écoute … » : le nom affiché est celui du bot (imposé par Discord).
    details: botProc ? 'Bot musique en ligne' : 'Bot musique arrêté',
    state: 'Panneau de contrôle',
  });
}

// Vrai nom du bot (récupéré auprès de Discord), affiché dans la page.
let botName = null;

/** Où afficher les messages du bot : 'cmd', 'gui' ou 'both'. */
function terminalMode() {
  const m = String(readPrefs().terminal || process.env.GUI_TERMINAL || 'both').toLowerCase();
  return ['cmd', 'gui', 'both'].includes(m) ? m : 'both';
}

// ====================================================================
// Préférences (langue)
// ====================================================================

/** Lit les préférences de la GUI (langue choisie…). */
function readPrefs() {
  try { return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8')); } catch (_) { return {}; }
}

/** Sauvegarde les préférences pour ne pas rechoisir la langue à chaque fois. */
function writePrefs(patch) {
  const prefs = { ...readPrefs(), ...patch };
  try { fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf8'); } catch (_) { /* non bloquant */ }
  return prefs;
}

// ====================================================================
// Utilitaires
// ====================================================================

/** Petite pause (utilisée entre l'arrêt et le redémarrage du bot). */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Envoie une ligne au terminal choisi par l'utilisateur.
 * Selon le réglage : la fenêtre noire (cmd), la page (gui), ou les deux.
 * Les messages du panneau lui-même passent toujours dans la page, sinon
 * l'utilisateur ne verrait rien en mode « cmd ».
 */
function broadcast(level, text, opts = {}) {
  const mode = terminalMode();
  const fromBot = !!opts.fromBot;
  const shell = !!opts.shell;

  // Sortie du bot : selon le réglage cmd/gui/both, on l'écrit aussi dans le cmd.
  // Mais on l'envoie TOUJOURS au GUI (le panneau doit refléter le terminal du .bat/.sh).
  if (fromBot && (mode === 'cmd' || mode === 'both')) {
    const out = level === 'err' ? process.stderr : process.stdout;
    try { out.write(text + '\n'); } catch (_) { /* ignore */ }
  }
  // (On ne return plus ici : le GUI affiche toujours les logs du bot,
  //  comme le voulait l'utilisateur — le terminal du GUI = celui du .bat.)

  // Sortie du shell système : elle va TOUJOURS dans la page (onglet Shell),
  // peu importe le réglage « où afficher le terminal ».
  const line = { t: Date.now(), level: shell ? 'shell' : level, text, shell };
  for (const res of sseClients) {
    try { res.write(`data: ${JSON.stringify(line)}\n\n`); } catch (_) { /* ignore */ }
  }
}

/** Exécute une commande git/npm en silence et renvoie sa sortie (ou ''). */
function quiet(cmd, args) {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) { return ''; }
}

/** Lance une commande et diffuse sa sortie (stdout+stderr) vers la GUI. */
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    broadcast('info', `▶ ${cmd} ${args.join(' ')}`);
    // GIT_TERMINAL_PROMPT=0 : évite que git reste bloqué à demander un
    // identifiant sur un dépôt privé (on affiche une erreur claire à la place).
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.env || {}) };
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd || ROOT,
        shell: opts.shell || false,
        env,
      });
    } catch (e) {
      broadcast('err', `Erreur lancement: ${e.message}`);
      return resolve({ code: -1, out: '' });
    }
    let out = '';
    const push = (level) => (buf) => {
      const s = buf.toString();
      out += s;
      s.split(/\r?\n/).forEach((l) => { if (l.trim()) broadcast(level, l); });
    };
    child.stdout.on('data', push('out'));
    child.stderr.on('data', push('err'));
    child.on('error', (e) => broadcast('err', `Erreur lancement: ${e.message}`));
    child.on('close', (code) => {
      broadcast(code === 0 ? 'ok' : 'err', `■ terminé (code ${code})`);
      resolve({ code, out });
    });
  });
}

/** Lit .env en objet { KEY: VALUE }. */
function readEnv() {
  const env = {};
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (_) { /* pas de .env */ }
  return env;
}

/**
 * Écrit/écrase certaines clés dans .env en conservant le reste du fichier
 * (commentaires, autres variables). Met à jour les lignes existantes et ajoute
 * les clés manquantes à la fin. Une valeur vide ne remplace jamais l'existant.
 */
function writeEnv(patch) {
  let lines = [];
  try { lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/); } catch (_) {}
  const known = new Set(Object.keys(patch));
  const remaining = new Set(known);
  const out = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && known.has(m[1])) {
      if (patch[m[1]] === '') { out.push(line); continue; }
      out.push(`${m[1]}=${patch[m[1]]}`);
      remaining.delete(m[1]);
    } else {
      out.push(line);
    }
  }
  for (const k of remaining) if (patch[k] !== '') out.push(`${k}=${patch[k]}`);
  const content = out.join('\n').replace(/\n+$/, '\n');

  // Le dossier Documents/GitHub est protégé (Controlled Folder Access) : un
  // fs.writeFileSync direct peut échouer. On écrit dans %TEMP% puis on copie
  // via PowerShell Copy-Item, qui contourne le blocage.
  const tmp = path.join(process.env.TEMP || process.env.TMP || '/tmp', `.env.gui.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(ENV_PATH, content);
    return;
  } catch (_) { /* on tente la voie PowerShell */ }
  try {
    fs.writeFileSync(tmp, content);
    execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Copy-Item -Path '${tmp.replace(/'/g, "''")}' -Destination '${ENV_PATH.replace(/'/g, "''")}' -Force`,
    ], { encoding: 'utf8' });
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// ====================================================================
// Git : helpers
// ====================================================================

/** Nom de la branche courante (main par défaut). */
function currentBranch() {
  return quiet('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
}

/** URL du remote origin, sinon celle mémorisée dans .env, sinon celle par défaut. */
function currentRemote() {
  return quiet('git', ['remote', 'get-url', 'origin'])
    || readEnv().GITHUB_REPO_URL
    || DEFAULT_REPO;
}

/** Définit (ou crée) le remote origin. */
function setRemote(url) {
  const has = quiet('git', ['remote']).split(/\s+/).includes('origin');
  execFileSync('git', ['remote', has ? 'set-url' : 'add', 'origin', url], { cwd: ROOT });
  broadcast('ok', `🔗 Lien du dépôt : ${url}`);
}

/** Nombre de fichiers modifiés localement (non commités). */
function dirtyCount() {
  const s = quiet('git', ['status', '--porcelain']);
  return s ? s.split(/\r?\n/).filter(Boolean).length : 0;
}

// ====================================================================
// Mise à jour complète en un clic
// ====================================================================

/**
 * Mise à jour : lien du dépôt -> fetch -> pull (ou reset --hard si force)
 * -> npm install (optionnel) -> redémarrage du bot s'il tournait.
 */
async function doUpdate({ url, withDeps = true, force = false }) {
  if (updating) { broadcast('warn', 'Une mise à jour est déjà en cours…'); return { ok: false, error: 'déjà en cours' }; }
  updating = true;
  const wasRunning = !!botProc;
  try {
    const target = (url && url.trim()) || currentRemote();
    if (!/^https?:\/\/\S+$/.test(target)) {
      broadcast('err', `❌ Lien GitHub invalide : ${target}`);
      return { ok: false, error: 'Lien GitHub invalide' };
    }

    if (wasRunning) {
      broadcast('info', '⏸ Arrêt du bot avant la mise à jour…');
      stopBot();
      await wait(1500);
    }

    // 1) Dépôt git présent ?
    if (!fs.existsSync(path.join(ROOT, '.git'))) {
      broadcast('warn', 'Aucun dépôt git ici — initialisation…');
      if ((await runCommand('git', ['init'])).code !== 0) return { ok: false, error: 'git init a échoué' };
    }

    // 2) Lien du dépôt (pris automatiquement du champ, ou du remote existant)
    try { setRemote(target); } catch (e) { broadcast('err', `Remote: ${e.message}`); }
    writeEnv({ GITHUB_REPO_URL: target });

    // 3) Récupération
    const branch = currentBranch();
    if ((await runCommand('git', ['fetch', 'origin'])).code !== 0) {
      broadcast('err', '❌ Impossible de contacter GitHub (réseau ou dépôt privé ?).');
      return { ok: false, error: 'fetch impossible' };
    }

    // 4) Application
    if (force) {
      broadcast('warn', `⚠ Réinitialisation forcée sur origin/${branch} (les modifs locales sont écrasées)…`);
      const r = await runCommand('git', ['reset', '--hard', `origin/${branch}`]);
      if (r.code !== 0) return { ok: false, error: 'reset a échoué' };
    } else {
      const r = await runCommand('git', ['pull', '--ff-only', 'origin', branch]);
      if (r.code !== 0) {
        const n = dirtyCount();
        broadcast('warn', n
          ? `⚠ Mise à jour bloquée : ${n} fichier(s) modifié(s) localement. Utilisez « Forcer la mise à jour » (attention : cela écrase vos modifications).`
          : '⚠ Mise à jour impossible en fast-forward. Utilisez « Forcer la mise à jour ».');
        return { ok: false, needForce: true, error: 'pull impossible' };
      }
    }

    // 5) Dépendances
    if (withDeps) {
      broadcast('info', '📦 Mise à jour des dépendances…');
      await installDeps();
    }

    broadcast('ok', '✅ Mise à jour terminée.');
    if (wasRunning) { broadcast('info', '▶ Redémarrage du bot…'); startBot(); }
    return { ok: true };
  } finally {
    updating = false;
  }
}

// ====================================================================
// Lancement / arrêt du bot
// ====================================================================

/**
 * Installe/met à jour les dépendances.
 * Sur ce PC, le dossier Documents peut être protégé par Windows (Controlled
 * Folder Access / OneDrive) : npm n'arrive alors pas à écrire package-lock.json
 * et sort en erreur EPERM/ENOENT. On réessaie donc sans fichier de verrou, et
 * si node_modules est déjà complet on considère que c'est bon.
 */
async function installDeps() {
  const npm = process.platform === 'win32';
  let r = await runCommand('npm', ['install'], { shell: npm });
  if (r.code !== 0 && /EPERM|ENOENT|package-lock/i.test(r.out)) {
    broadcast('warn', '⚠ Windows bloque l’écriture de package-lock.json — nouvelle tentative sans verrou…');
    r = await runCommand('npm', ['install', '--no-package-lock', '--no-audit', '--no-fund'], { shell: npm });
  }
  if (r.code !== 0) {
    // Dernier contrôle : les paquets requis sont-ils déjà présents ?
    if (depsPresent()) {
      broadcast('ok', '✅ Les dépendances sont déjà installées (l’erreur npm concerne seulement le fichier de verrou).');
      return { ok: true, code: 0, warned: true };
    }
    broadcast('err', '❌ Installation impossible. Le dossier Documents est protégé par Windows : déplacez le projet (ex. C:\\dev\\Bot-discord) ou autorisez Node dans « Accès contrôlé aux dossiers ».');
  }
  return { ok: r.code === 0, code: r.code };
}

/** Vérifie que chaque dépendance de package.json est bien dans node_modules. */
function depsPresent() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    return deps.length > 0 && deps.every((d) => fs.existsSync(path.join(ROOT, 'node_modules', d)));
  } catch (_) { return false; }
}

// ====================================================================
// Lancement / arrêt du bot
// ====================================================================

function startBot() {
  if (botProc) { broadcast('warn', 'Bot déjà en cours d’exécution.'); return; }
  const env = readEnv();
  if (!env.DISCORD_TOKEN) {
    broadcast('err', '❌ DISCORD_TOKEN manquant. Renseignez-le dans la carte « Tokens » puis enregistrez.');
    return;
  }
  // Installe node_modules si absent
  if (!depsPresent()) {
    broadcast('warn', 'Dépendances manquantes — installation…');
    installDeps().then(() => {
      if (!botProc) launchNow(env);
    });
  } else {
    launchNow(env);
  }
}

function launchNow(env) {
  broadcast('info', '🎵 Démarrage du bot…');
  botConnected = false;
  botProc = spawn('node', ['bot.js'], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    // stdin ouvert en « pipe » : c'est par là qu'on envoie /call, /join, /ban…
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // La sortie du bot suit le réglage « où afficher le terminal ».
  botProc.stdout.on('data', (b) => b.toString().split(/\r?\n/)
    .forEach((l) => {
      if (l.includes('Bot connecté en tant que')) { botConnected = true; updatePresence(); }
      if (l.includes('Échec de connexion')) { botConnected = false; updatePresence(); }
      l.trim() && broadcast('out', l, { fromBot: true });
    }));
  botProc.stderr.on('data', (b) => b.toString().split(/\r?\n/)
    .forEach((l) => l.trim() && broadcast('err', l, { fromBot: true })));
  botProc.on('error', (e) => broadcast('err', `Erreur: ${e.message}`));
  botProc.on('exit', (code) => {
    broadcast(code === 0 ? 'warn' : 'err', `Bot arrêté (code ${code})`);
    botProc = null;
    botConnected = false;
    updatePresence();
  });
  updatePresence();
}

/**
 * Envoie une commande console au bot (/call, /join, /ban…).
 * Le bot la lit sur son entrée standard, exactement comme si on l'avait
 * tapée dans la fenêtre noire.
 */
function sendConsole(line) {
  const cmd = String(line || '').trim();
  if (!cmd) return { ok: false, error: 'commande vide' };
  if (!botProc || !botProc.stdin || botProc.stdin.destroyed) {
    broadcast('err', '❌ Le bot doit être démarré pour utiliser les commandes.');
    return { ok: false, error: 'bot arrêté' };
  }
  broadcast('info', `⌨ ${cmd}`);
  try {
    botProc.stdin.write(cmd + '\n');
    return { ok: true };
  } catch (e) {
    broadcast('err', `Erreur envoi : ${e.message}`);
    return { ok: false, error: e.message };
  }
}

function stopBot() {
  if (!botProc) { broadcast('warn', 'Aucun bot en cours d’exécution.'); return; }
  broadcast('info', '⏹ Arrêt du bot…');
  botProc.kill('SIGTERM');
  setTimeout(() => { if (botProc) botProc.kill('SIGKILL'); }, 4000);
}

function restartBot() { stopBot(); setTimeout(startBot, 1500); }

// ====================================================================
// Fermeture liée : la fenêtre noire (cmd) et la page se ferment ensemble
// ====================================================================

/**
 * Arrêt complet et propre : bot -> présence Discord -> pages ouvertes -> serveur.
 * Appelé quand on ferme la page (bouton Quitter) OU quand on ferme la fenêtre
 * noire (Ctrl+C / croix), pour que les deux ne restent jamais orphelins.
 */
function shutdown(reason = 'demande') {
  if (shuttingDown) return;
  shuttingDown = true;
  broadcast('warn', `⏻ Fermeture du panneau (${reason})…`);

  // 1) On coupe le bot
  if (botProc) { try { botProc.kill('SIGTERM'); } catch (_) {} }

  // 2) On enlève la présence Discord
  try { presence.destroy(); } catch (_) {}

  // 3) On prévient les pages ouvertes puis on ferme leur connexion,
  //    ce qui déclenche la fermeture automatique de l'onglet côté navigateur.
  for (const res of sseClients.slice()) {
    try {
      res.write(`event: shutdown\ndata: {}\n\n`);
      res.end();
    } catch (_) {}
  }

  // 4) On laisse une seconde au bot pour se terminer, puis on quitte.
  setTimeout(() => {
    if (botProc) { try { botProc.kill('SIGKILL'); } catch (_) {} }
    try { server.close(); } catch (_) {}
    console.log('Panneau de contrôle fermé.');
    process.exit(0);
  }, 1000);
}

// Fermeture de la fenêtre noire (Ctrl+C, croix Windows, arrêt système)
// -> le bot et la page se ferment aussi.
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(sig, () => shutdown('fenêtre fermée'));
}
// Sous Windows, la croix de la fenêtre cmd ferme aussi stdin.
process.stdin.on('close', () => shutdown('fenêtre fermée'));
process.on('exit', () => { if (botProc) { try { botProc.kill('SIGKILL'); } catch (_) {} } });

/**
 * Sens inverse : quand la dernière page est fermée, on ferme la fenêtre noire.
 * Délai de grâce pour ne pas tout couper sur un simple F5 (le navigateur se
 * reconnecte en ~2 s) ni pendant une mise à jour en cours.
 *
 * IMPORTANT : tant qu'aucune page ne s'est jamais connectée, on ne ferme pas —
 * sinon le panneau se couperait pendant que le navigateur est encore en train
 * de démarrer. On laisse un délai large pour la toute première ouverture.
 */
let noClientTimer = null;
let everConnected = false;
const AUTO_CLOSE_DELAY = Number(process.env.GUI_AUTOCLOSE_MS || 6000);
const FIRST_OPEN_DELAY = Number(process.env.GUI_FIRSTOPEN_MS || 120000);

function scheduleAutoClose() {
  clearTimeout(noClientTimer);
  if (shuttingDown || AUTO_CLOSE_DELAY <= 0) return;
  // Première ouverture : on patiente longtemps (démarrage du navigateur).
  const delay = everConnected ? AUTO_CLOSE_DELAY : FIRST_OPEN_DELAY;
  noClientTimer = setTimeout(() => {
    if (sseClients.length === 0 && !updating && !shuttingDown) {
      console.log(everConnected
        ? 'Page fermée — fermeture du panneau.'
        : 'Aucune page ouverte — fermeture du panneau.');
      shutdown(everConnected ? 'page fermée' : 'aucune page ouverte');
    }
  }, delay);
  if (noClientTimer.unref) noClientTimer.unref();
}

// ====================================================================
// Serveur HTTP
// ====================================================================

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/** Lit le corps d'une requête POST en JSON (tolérant au corps vide). */
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;

  // --- Flux SSE (terminal live) ---
  if (p === '/api/logs' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    sseClients.push(res);
    everConnected = true;
    clearTimeout(noClientTimer);
    broadcast('info', 'Terminal connecté.');
    const ping = setInterval(() => { try { res.write(`: ping\n\n`); } catch (_) {} }, 15000);
    req.on('close', () => {
      clearInterval(ping);
      const i = sseClients.indexOf(res);
      if (i >= 0) sseClients.splice(i, 1);
      // Plus aucune page ouverte -> on ferme aussi la fenêtre noire.
      // Petit délai de grâce : un simple rafraîchissement (F5) ne doit pas
      // tout couper, seule une vraie fermeture d'onglet compte.
      scheduleAutoClose();
    });
    return;
  }

  // --- API : statut ---
  if (p === '/api/status' && req.method === 'GET') {
    const env = readEnv();
    let behind = '0', ahead = '0';
    const raw = quiet('git', ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
    if (raw) { const parts = raw.split(/\s+/); behind = parts[0] || '0'; ahead = parts[1] || '0'; }
    return sendJson(res, 200, {
      running: !!botProc,
      updating,
      branch: currentBranch(),
      commit: quiet('git', ['rev-parse', '--short', 'HEAD']),
      behind, ahead,
      remote: currentRemote(),
      defaultRemote: DEFAULT_REPO,
      dirty: dirtyCount(),
      hasToken: !!env.DISCORD_TOKEN,
      hasSpotify: !!(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
      presence: presence.status,
      botName,                    // vrai nom du bot (et non « Bot Gui »)
      terminal: terminalMode(),
      mode: process.env.BOT_MODE || 'all',
      discord: botConnected,
      hasToken: !!env.DISCORD_TOKEN,
    });
  }

  // --- API : envoyer une commande au bot (/call, /join, /ban, /language…) ---
  // Le bot la lit sur son entrée standard, comme dans la fenêtre noire.
  if (p === '/api/console' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, sendConsole(body.line));
  }

  // --- API : terminal système réel (onglet Shell de la page) ---
  // Lance la commande dans le shell de l'OS (PowerShell sous Windows,
  // bash sinon) et diffuse la sortie dans le terminal de la page (via SSE).
  if (p === '/api/shell' && req.method === 'POST') {
    const body = await readBody(req);
    const line = String(body.line || '').trim();
    if (!line) return sendJson(res, 200, { ok: false, error: 'commande vide' });
    // Sécurité minimale : on refuse les commandes de suppression destructive.
    if (/\b(rm\s+-rf|del\s+\/s|format\s+|:\(|\brd\s+\/s)/i.test(line)) {
      return sendJson(res, 200, { ok: false, error: 'commande refusée (potentiellement destructive)' });
    }
    const isWin = process.platform === 'win32';
    // Réponse immédiate (une seule fois) ; la sortie arrive par le flux SSE.
    sendJson(res, 200, { ok: true });
    const child = spawn(isWin ? 'powershell.exe' : 'bash', [isWin ? '-NoProfile' : '-c', line], {
      cwd: ROOT, env: process.env,
    });
    const push = (level) => (buf) => {
      buf.toString().split(/\r?\n/).forEach((l) => {
        if (l.trim()) broadcast(level, l, { shell: true });
      });
    };
    child.stdout.on('data', push('out'));
    child.stderr.on('data', push('err'));
    child.on('error', (e) => broadcast('err', `Erreur shell : ${e.message}`, { shell: true }));
    child.on('close', (code) => broadcast('info', `■ shell terminé (code ${code})`, { shell: true }));
    return;
  }

  // --- API : préférences (langue, terminal) ---
  if (p === '/api/prefs' && req.method === 'GET') {
    const prefs = readPrefs();
    return sendJson(res, 200, {
      lang: prefs.lang || null,          // null = jamais choisie
      terminal: terminalMode(),
      support: SUPPORT,
    });
  }

  if (p === '/api/prefs' && req.method === 'POST') {
    const body = await readBody(req);
    const patch = {};
    // On n'accepte qu'un code langue simple (fr, en, es, ar…)
    if (typeof body.lang === 'string' && /^[a-z]{2}$/.test(body.lang)) patch.lang = body.lang;
    // Où afficher le terminal : fenêtre noire, page, ou les deux.
    if (['cmd', 'gui', 'both'].includes(body.terminal)) patch.terminal = body.terminal;
    const prefs = writePrefs(patch);
    if (patch.lang) broadcast('info', `🌐 Langue enregistrée : ${patch.lang}`);
    if (patch.terminal) {
      const label = { cmd: 'fenêtre noire', gui: 'page web', both: 'les deux' }[patch.terminal];
      broadcast('ok', `🖥 Affichage du terminal : ${label}.`);
    }
    return sendJson(res, 200, { ok: true, lang: prefs.lang, terminal: terminalMode() });
  }

  // --- API : fermer le panneau (bot + page + fenêtre noire) ---
  if (p === '/api/quit' && req.method === 'POST') {
    sendJson(res, 200, { ok: true });
    setTimeout(() => shutdown('bouton Quitter'), 150);
    return;
  }

  // --- API : changer le mode rapide (music / admin / all) ---
  // Relance le bot avec la nouvelle variable d'environnement.
  if (p === '/api/mode' && req.method === 'POST') {
    const body = await readBody(req);
    const m = String(body.mode || '').toLowerCase();
    if (!['music', 'admin', 'all'].includes(m)) return sendJson(res, 400, { ok: false, error: 'mode invalide' });
    process.env.BOT_MODE = m;
    // On relance proprement le bot pour appliquer le mode.
    if (botProc) {
      try { botProc.kill('SIGTERM'); } catch (_) {}
      botProc = null;
    }
    setTimeout(() => { launchNow({ BOT_MODE: m }); }, 500);
    return sendJson(res, 200, { ok: true, mode: m });
  }

  // --- API : lire .env (valeurs sensibles masquées) ---
  if (p === '/api/config' && req.method === 'GET') {
    const env = readEnv();
    return sendJson(res, 200, {
      DISCORD_TOKEN: env.DISCORD_TOKEN ? '•'.repeat(12) : '',
      COMMAND_PREFIX: env.COMMAND_PREFIX || '!',
      SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID || '',
      SPOTIFY_CLIENT_SECRET: env.SPOTIFY_CLIENT_SECRET ? '•'.repeat(12) : '',
      CLIENT_ID: env.CLIENT_ID || '',
      GITHUB_REPO_URL: currentRemote(),
    });
  }

  // --- API : sauvegarder le token / .env ---
  if (p === '/api/config' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const patch = {};
      for (const k of ['DISCORD_TOKEN', 'COMMAND_PREFIX', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'CLIENT_ID']) {
        // Ne jamais écraser une vraie valeur par le masque affiché (••••)
        if (typeof body[k] === 'string' && body[k] && !/^•+$/.test(body[k])) patch[k] = body[k];
      }
      writeEnv(patch);
      broadcast('ok', '💾 Configuration (.env) enregistrée.');
      return sendJson(res, 200, { ok: true });
    } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  // --- API : mise à jour en un clic (lien pris automatiquement) ---
  if (p === '/api/update' && req.method === 'POST') {
    const body = await readBody(req);
    const r = await doUpdate({
      url: body.url,
      withDeps: body.deps !== false,
      force: !!body.force,
    });
    return sendJson(res, 200, r);
  }

  // --- API : mise à jour des dépendances seules ---
  if (p === '/api/deps' && req.method === 'POST') {
    return sendJson(res, 200, await installDeps());
  }

  // --- API : contrôle du bot ---
  if (p === '/api/bot/start' && req.method === 'POST') { startBot(); return sendJson(res, 200, { ok: true, running: !!botProc }); }
  if (p === '/api/bot/stop' && req.method === 'POST') { stopBot(); return sendJson(res, 200, { ok: true, running: !!botProc }); }
  if (p === '/api/bot/restart' && req.method === 'POST') { restartBot(); return sendJson(res, 200, { ok: true }); }

  // --- Page statique ---
  if (req.method === 'GET') {
    const file = p === '/' ? '/index.html' : p;
    const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  // --- API : état de la file d'attente (lu depuis le fichier écrit par le bot) ---
  // En POST pour ne pas être capturé par la redirection des fichiers statiques (GET).
  if (p === '/api/queue' && req.method === 'POST') {
    // Le bot écrit le fichier dans %APPDATA%/bot-discord/queue_state.json
    // (le dossier du projet est protégé en écriture par Windows).
    const APPDATA = process.env.APPDATA || process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const file = path.join(APPDATA, 'bot-discord', 'queue_state.json');
    try {
      const states = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
      return sendJson(res, 200, { queues: states });
    } catch (e) {
      return sendJson(res, 200, { queues: {} });
    }
  }

  // --- API : recherche multi-résultats (YouTube) pour le GUI et le choix ---
  if (p === '/api/search' && req.method === 'POST') {
    const body = await readBody(req);
    const q = (body.q || '').toString().trim();
    if (!q) return sendJson(res, 200, { results: [] });
    try {
      const play = require('play-dl');
      let results = [];
      // play-dl échoue parfois au 1er essai (bug YouTube intermittent) -> on retry.
      for (let attempt = 0; attempt < 3 && results.length === 0; attempt++) {
        try { results = await play.search(q, { limit: 8 }); } catch (_) { results = []; }
      }
      return sendJson(res, 200, { results: results.map((r) => ({
        title: r.title, url: r.url,
        thumbnail: r.thumbnail && r.thumbnail.url ? r.thumbnail.url : null,
        duration: r.durationInSec || 0,
      })) });
    } catch (e) {
      return sendJson(res, 200, { results: [], error: e.message });
    }
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`\n🖥  Interface du bot dispo sur  http://${HOST}:${PORT}`);
  console.log(`   Fermer cette fenêtre ferme aussi la page et le bot.\n`);

  // Présence Discord : « Joue à Bot Gui ».
  // Utilise l'identifiant public de l'application, déduit du token du bot.
  const token = readEnv().DISCORD_TOKEN;
  if (token) {
    // Vrai nom du bot, demandé à Discord (affiché dans la page).
    fetchBotName(token).then((name) => {
      if (name) {
        botName = name;
        broadcast('ok', `🤖 Bot : ${name}`);
        updatePresence();
      }
    });
    // autoReconnect : si Discord est ouvert plus tard, la présence s'active seule.
    presence.autoReconnect(token);
    updatePresence();
  }

  // Le bot peut être démarré tout de suite (choix fait dans le .bat/.sh).
  if (process.env.GUI_AUTOSTART === '1') {
    broadcast('info', '▶ Démarrage automatique du bot…');
    startBot();
  }

  // Si personne n'ouvre la page, on n'attend pas indéfiniment.
  scheduleAutoClose();
});
