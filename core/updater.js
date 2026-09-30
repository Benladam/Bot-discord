const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { PermissionFlagsBits } = require('discord.js');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const REMOTE = process.env.UPDATE_REMOTE || 'origin';
const CHECK_INTERVAL_MINUTES = parseInterval(process.env.UPDATE_CHECK_INTERVAL_MINUTES);
const CHECK_ENABLED = !/^(0|false|no)$/i.test(String(process.env.UPDATE_CHECK_ENABLED || 'true'));
const AUTO_INSTALL_ENABLED = /^(1|true|yes)$/i.test(String(process.env.UPDATE_AUTO_INSTALL || 'false'));
const RESTART_COUNTDOWN_SECONDS = parseCountdown(process.env.UPDATE_RESTART_COUNTDOWN_SECONDS);

function parseInterval(value) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 5;
}

function parseCountdown(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 10 && seconds <= 3600 ? seconds : 60;
}

function logWith(log, level, message) {
  if (typeof log === 'function') log(level, message);
}

async function runGit(args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    return String(result.stdout || '').trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || 'erreur git').trim();
    const wrapped = new Error(detail.slice(0, 800));
    wrapped.exitCode = typeof error.code === 'number' ? error.code : null;
    throw wrapped;
  }
}

async function hasGitCheckout(root = ROOT) {
  try {
    const result = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    return String(result.stdout || '').trim() === 'true';
  } catch (_) {
    return false;
  }
}

function githubRepoFromRemote(remoteUrl) {
  const value = String(remoteUrl || '').trim();
  let host = '';
  let repoPath = '';

  // Kinetic may add the configured Git username (and token, when present) to
  // the HTTPS remote. Parse the URL so credentials never become part of the
  // repository name or an error message.
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      host = parsed.hostname.toLowerCase();
      repoPath = parsed.pathname;
    } else if (parsed.protocol === 'ssh:') {
      host = parsed.hostname.toLowerCase();
      repoPath = parsed.pathname;
    }
  } catch (_) {
    // Git also accepts SCP-style SSH remotes such as git@github.com:owner/repo.
  }
  if (host !== 'github.com') {
    const scp = value.match(/^(?:[^@/]+@)?github\.com:([^?#]+)$/i);
    if (scp) {
      host = 'github.com';
      repoPath = scp[1];
    }
  }

  repoPath = repoPath.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (host !== 'github.com') repoPath = '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repoPath)) {
    throw new Error('Le dépôt origin doit être un dépôt GitHub au format owner/repo.');
  }
  return repoPath;
}

function sanitizeSubject(value) {
  return String(value || '(sans titre)')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/@/g, '@\u200b')
    .slice(0, 160);
}

async function readCommitSummary(sha) {
  const output = await runGit(['show', '-s', '--format=%H%x1f%s%x1f%an%x1f%cI', sha]);
  const [fullSha, subject, author, committedAt] = output.split('\x1f');
  return {
    sha: fullSha,
    subject: sanitizeSubject(subject),
    author: sanitizeSubject(author),
    committedAt: String(committedAt || '').trim(),
  };
}

function createUpdater({ client, database, log }) {
  let lastStatus = null;
  let lastObservedRemoteSha = null;
  let checkPromise = null;
  let interval = null;
  let automaticInstallTimer = null;
  let automaticInstallActive = false;
  let applyPromise = null;
  const countdownTimers = new Set();

  async function getBranch() {
    const override = String(process.env.UPDATE_BRANCH || '').trim();
    const branch = override || await runGit(['branch', '--show-current']) || 'main';
    await runGit(['check-ref-format', '--branch', branch]);
    return branch;
  }

  async function fetchStatus() {
    if (!(await hasGitCheckout())) {
      throw new Error('Ce dossier ne contient pas de dépôt Git (.git). Utilise une installation Kinetic reliée à GitHub pour activer /update.');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(REMOTE) || REMOTE.startsWith('-')) {
      throw new Error('UPDATE_REMOTE contient un nom de remote Git invalide.');
    }
    const remoteUrl = await runGit(['remote', 'get-url', REMOTE]);
    const repo = githubRepoFromRemote(remoteUrl);
    const branch = await getBranch();
    const remoteRef = `refs/remotes/${REMOTE}/${branch}`;

    await runGit(['fetch', '--quiet', '--no-tags', REMOTE, `+refs/heads/${branch}:${remoteRef}`]);

    const localSha = await runGit(['rev-parse', 'HEAD']);
    const remoteSha = await runGit(['rev-parse', remoteRef]);
    const [localCommit, remoteCommit] = await Promise.all([
      readCommitSummary(localSha),
      readCommitSummary(remoteSha),
    ]);
    const porcelain = await runGit(['status', '--porcelain']);
    const changedFiles = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];

    let canFastForward = true;
    try {
      await runGit(['merge-base', '--is-ancestor', 'HEAD', remoteRef]);
    } catch (error) {
      if (error.exitCode === 1) canFastForward = false;
      else throw error;
    }

    let remoteIsAncestor = false;
    if (!canFastForward) {
      try {
        await runGit(['merge-base', '--is-ancestor', remoteRef, 'HEAD']);
        remoteIsAncestor = true;
      } catch (error) {
        if (error.exitCode !== 1) throw error;
      }
    }

    const hasUpdate = canFastForward ? localSha !== remoteSha : !remoteIsAncestor;
    const aheadCount = hasUpdate && canFastForward
      ? Number(await runGit(['rev-list', '--count', `HEAD..${remoteRef}`]))
      : 0;
    let commits = [];
    if (aheadCount > 0) {
      const output = await runGit(['log', '-n', '5', '--format=%H%x1f%s', `HEAD..${remoteRef}`]);
      commits = output.split(/\r?\n/).filter(Boolean).map((line) => {
        const [sha, ...subjectParts] = line.split('\x1f');
        return { sha, subject: sanitizeSubject(subjectParts.join('\x1f')) };
      });
    }

    return {
      repo,
      branch,
      remoteRef,
      localSha,
      remoteSha,
      localCommit,
      remoteCommit,
      hasUpdate,
      diverged: hasUpdate && !canFastForward,
      localAhead: localSha !== remoteSha && remoteIsAncestor,
      aheadCount,
      commits,
      changedFiles,
      workingTreeClean: changedFiles.length === 0,
    };
  }

  function formatNotice(status) {
    const branchName = status.branch.replace(/[`<>]/g, '');
    if (status.diverged) {
      return `⚠️ GitHub a reçu une mise à jour sur \`${branchName}\`, mais le dépôt local a divergé. L’installation automatique est bloquée; une intervention manuelle est nécessaire.`;
    }

    const count = status.aheadCount;
    const commits = status.commits
      .map((commit) => `• \`${commit.sha.slice(0, 7)}\` ${commit.subject}`)
      .join('\n');
    const more = count > status.commits.length ? `\n• … et ${count - status.commits.length} autre(s) commit(s)` : '';
    const commitLink = `https://github.com/${status.repo}/commit/${status.remoteSha}`;
    const blocked = !status.workingTreeClean
      ? '\n⚠️ Des fichiers locaux ont changé : l’installation automatique est bloquée pour ne rien écraser.'
      : '';
    const nextStep = AUTO_INSTALL_ENABLED && status.workingTreeClean
      ? `\nSituation : nouvelle version du bot Discord. Redémarrage prévu dans ${RESTART_COUNTDOWN_SECONDS} secondes.`
      : '\nUn administrateur peut lancer `/update` pour l’installer.';
    return `🔔 Mise à jour disponible sur \`${branchName}\` (${count} commit${count > 1 ? 's' : ''}).\n${commits}${more}\n[Voir le dernier commit](${commitLink})${blocked}${nextStep}`;
  }

  async function announceGuild(guild, status, customContent = null) {
    if (!guild || (!status?.hasUpdate && !customContent)) return false;
    const channelId = database.getGuildSetting(guild.id, 'updateLogChannelId');
    if (!channelId) return false;
    let channel = guild.channels.cache.get(String(channelId));
    if (!channel) channel = await guild.channels.fetch(String(channelId)).catch(() => null);
    if (!channel || channel.guildId !== guild.id || typeof channel.send !== 'function') {
      logWith(log, 'warn', `Salon de mise à jour introuvable sur ${guild.name}; relance /updatelog dans le salon choisi.`);
      return false;
    }

    const botMember = guild.members.me;
    const permissions = botMember && channel.permissionsFor?.(botMember);
    if (permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
      logWith(log, 'warn', `Permission d'envoi absente dans le salon de mise à jour de ${guild.name}.`);
      return false;
    }

    const payload = customContent && typeof customContent === 'object'
      ? { ...customContent, allowedMentions: { parse: [] } }
      : { content: customContent || formatNotice(status), allowedMentions: { parse: [] } };
    await channel.send(payload);
    return true;
  }

  async function announceConfiguredGuilds(status, customContent = null) {
    let sent = 0;
    for (const guild of client.guilds.cache.values()) {
      try {
        if (await announceGuild(guild, status, customContent)) sent += 1;
      } catch (error) {
        logWith(log, 'warn', `Notification de mise à jour impossible sur ${guild.name}: ${error.message}`);
      }
    }
    if (sent === 0) logWith(log, 'info', 'Annonce de mise à jour ignorée : aucun salon /updatelog accessible (cela ne bloque pas /update).');
    return sent;
  }

  function cancelAutomaticCountdown() {
    if (automaticInstallTimer) clearTimeout(automaticInstallTimer);
    automaticInstallTimer = null;
    for (const timer of countdownTimers) clearTimeout(timer);
    countdownTimers.clear();
  }

  function countdownNotice(status, seconds) {
    const sha = String(status.remoteSha || '').slice(0, 7);
    return `⏳ Mise à jour du bot Discord ${sha ? `\`${sha}\`` : ''} : redémarrage dans ${seconds} seconde${seconds === 1 ? '' : 's'}. Motif : nouvelle version du bot.`;
  }

  function scheduleAutomaticInstall(status) {
    if (!AUTO_INSTALL_ENABLED || !CHECK_ENABLED || !status?.hasUpdate
        || status.diverged || !status.workingTreeClean || automaticInstallActive
        || automaticInstallTimer) return false;

    automaticInstallTimer = setTimeout(() => {
      automaticInstallTimer = null;
      void runAutomaticInstall();
    }, RESTART_COUNTDOWN_SECONDS * 1000);
    automaticInstallTimer.unref?.();

    for (const seconds of [30, 10, 5, 3, 2, 1]) {
      if (seconds >= RESTART_COUNTDOWN_SECONDS) continue;
      const timer = setTimeout(() => {
        countdownTimers.delete(timer);
        void announceConfiguredGuilds(status, countdownNotice(status, seconds));
      }, (RESTART_COUNTDOWN_SECONDS - seconds) * 1000);
      timer.unref?.();
      countdownTimers.add(timer);
    }
    logWith(log, 'info', `Mise à jour automatique programmée dans ${RESTART_COUNTDOWN_SECONDS} secondes.`);
    return true;
  }

  async function runAutomaticInstall() {
    if (automaticInstallActive) return;
    automaticInstallActive = true;
    cancelAutomaticCountdown();
    try {
      const result = await applyUpdate();
      if (!result.updated) {
        const explanation = result.reason === 'local-changes'
          ? '⚠️ Mise à jour du bot annulée : des fichiers locaux ont changé; rien n’a été écrasé.'
          : result.reason === 'diverged'
            ? '⚠️ Mise à jour du bot annulée : la branche locale a divergé de GitHub.'
            : `ℹ️ Aucune mise à jour du bot à appliquer (${String(result.status?.localSha || '').slice(0, 7)}).`;
        await announceConfiguredGuilds(result.status, explanation);
        return;
      }

      await announceConfiguredGuilds(result.status,
        `✅ Mise à jour du bot Discord installée (${result.newSha.slice(0, 7)}). `
        + 'Motif : nouvelle version du bot. Redémarrage du bot dans 5 secondes.');
      const timer = setTimeout(() => {
        void restartProcess().catch((error) => {
          logWith(log, 'error', `Redémarrage automatique du bot impossible: ${error.message}`);
        });
      }, 5000);
      timer.unref?.();
    } catch (error) {
      logWith(log, 'error', `Mise à jour automatique du bot impossible: ${error.message}`);
      await announceConfiguredGuilds(lastStatus,
        `❌ Mise à jour automatique du bot échouée : ${String(error.message).slice(0, 700)}. Le processus n’a pas été redémarré.`);
    } finally {
      automaticInstallActive = false;
    }
  }

  async function checkForUpdates() {
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      const status = await fetchStatus();
      const remoteChanged = status.remoteSha !== lastObservedRemoteSha;
      lastObservedRemoteSha = status.remoteSha;
      lastStatus = status;
      if (status.hasUpdate && remoteChanged) {
        const sent = await announceConfiguredGuilds(status);
        if (AUTO_INSTALL_ENABLED && status.workingTreeClean && !status.diverged) {
          if (sent > 0) scheduleAutomaticInstall(status);
          else logWith(log, 'warn', 'Mise à jour auto non programmée : configure d’abord un salon /updatelog.');
        }
      }
      return status;
    })();
    try {
      return await checkPromise;
    } finally {
      checkPromise = null;
    }
  }

  function installDependencies() {
    const isWindows = process.platform === 'win32';
    const command = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const args = isWindows
      ? ['/d', '/s', '/c', 'npm install --omit=dev --no-audit --no-fund']
      : ['install', '--omit=dev', '--no-audit', '--no-fund'];

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: ROOT,
        env: process.env,
        stdio: 'inherit',
        windowsHide: true,
      });
      child.once('error', reject);
      child.once('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`npm install s’est terminé avec le code ${code ?? 'inconnu'}.`));
      });
    });
  }

  async function applyUpdate() {
    if (applyPromise) return applyPromise;
    cancelAutomaticCountdown();
    applyPromise = (async () => {
      const status = await checkForUpdates();
      if (!status.hasUpdate) return { updated: false, status };
      if (status.diverged) return { updated: false, status, reason: 'diverged' };
      if (!status.workingTreeClean) return { updated: false, status, reason: 'local-changes' };

      await runGit(['merge', '--ff-only', status.remoteSha]);
      const newSha = await runGit(['rev-parse', 'HEAD']);
      const installedCommit = await readCommitSummary(newSha);
      try {
        await installDependencies();
      } catch (error) {
        logWith(log, 'error', `Code mis à jour (${newSha.slice(0, 7)}), mais npm install a échoué: ${error.message}`);
        return { updated: false, codeUpdated: true, status, newSha, installedCommit, error };
      }

      return { updated: true, status, newSha, installedCommit };
    })();
    try {
      return await applyPromise;
    } finally {
      applyPromise = null;
    }
  }

  async function checkOnce() {
    try {
      const status = await checkForUpdates();
      logWith(log, 'info', status.hasUpdate
        ? `Mise à jour disponible: ${status.remoteSha.slice(0, 7)} (${status.branch}).`
        : status.localAhead
          ? `La branche locale est en avance sur GitHub (${status.localSha.slice(0, 7)}).`
          : `Bot à jour (${status.localSha.slice(0, 7)}).`);
    } catch (error) {
      logWith(log, 'warn', `Vérification GitHub impossible: ${error.message}`);
    }
  }

  let startPromise = null;

  async function start() {
    if (!CHECK_ENABLED) {
      logWith(log, 'info', 'Vérification automatique des mises à jour désactivée (UPDATE_CHECK_ENABLED=false).');
      return false;
    }
    if (interval) return true;
    if (startPromise) return startPromise;
    startPromise = (async () => {
      if (!(await hasGitCheckout())) {
        logWith(log, 'info', 'Mise à jour Git interne ignorée : aucun dépôt .git dans ce déploiement.');
        return false;
      }
      await checkOnce();
      interval = setInterval(() => { void checkOnce(); }, CHECK_INTERVAL_MINUTES * 60 * 1000);
      interval.unref?.();
      logWith(log, 'info', `Vérification GitHub toutes les ${CHECK_INTERVAL_MINUTES} minute(s).`);
      return true;
    })();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  return {
    start,
    checkForUpdates,
    applyUpdate,
    announceGuild,
    scheduleAutomaticInstall,
    getLastStatus: () => lastStatus,
    restartProcess,
  };
}

async function restartProcess() {
  if (process.env.BOT_SUPERVISED === '1' && typeof process.send === 'function') {
    await new Promise((resolve, reject) => {
      process.send({ type: 'update-restart' }, (error) => error ? reject(error) : resolve());
    });
    process.exit(0);
    return;
  }

  const child = spawn(process.execPath, process.argv.slice(1), {
    cwd: ROOT,
    env: process.env,
    detached: true,
    stdio: 'inherit',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', resolve);
  });
  child.unref();
  process.exit(0);
}

module.exports = { createUpdater, hasGitCheckout };
