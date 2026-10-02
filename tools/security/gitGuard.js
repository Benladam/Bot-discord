'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
const ZERO_SHA = /^0+$/;

const SENSITIVE_DIRECTORIES = [
  [/^(?:private|\.private)(?:\/|$)/i, 'dossier privé'],
  [/^(?:data|\.data|runtime|local|\.local|logs)(?:\/|$)/i, 'données locales'],
  [/^(?:minecraft|server)(?:\/|$)/i, 'fichiers de serveur Minecraft'],
  [/^(?:ia|ia-privee|ai-local)(?:\/|$)/i, 'données IA locales'],
  [/^(?:models?|checkpoints?|lora|weights)(?:\/|$)/i, 'modèles ou poids IA'],
  [/^(?:backups?|secrets?|credentials?)(?:\/|$)/i, 'sauvegarde ou identifiants locaux'],
  [/^(?:\.venv|node_modules|\.cache)(?:\/|$)/i, 'dépendances ou cache local'],
];

const SENSITIVE_FILENAMES = [
  [/^\.env(?:\..*)?$/i, 'fichier d’environnement local'],
  [/(?:^|\/)(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials(?:\..*)?|secrets?(?:\..*)?)$/i, 'fichier d’identifiants'],
  [/\.(?:pem|key|p12|pfx|jks|keystore)$/i, 'certificat ou clé privée'],
  [/\.(?:sqlite(?:-.+)?|sqlite3(?:-.+)?|db(?:-.+)?|dump)$/i, 'base de données locale'],
  [/\.(?:mcpack|mcworld|mca|schem|schematic|nbt|jar)$/i, 'artefact Minecraft local'],
  [/\.(?:zip|7z|rar|tar|gz|bak|backup|log|lnk)$/i, 'archive, journal ou raccourci local'],
  [/(?:^|\/)Bot-discord-kinetic-.*\.zip$/i, 'archive de déploiement locale'],
];

const SECRET_PATTERNS = [
  { name: 'clé privée', pattern: /-----BEGIN [^-]*PRIVATE KEY-----/i },
  { name: 'webhook Discord', pattern: /https?:\/\/(?:discord(?:app)?\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9._-]{20,}/i },
  { name: 'jeton Discord', pattern: /(?:^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}(?:$|[^A-Za-z0-9_-])/ },
  { name: 'clé fournisseur', pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/ },
];

const SECRET_ASSIGNMENT = /(?:^|[\s{,;])([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY|WEBHOOK_URL|CLIENT_SECRET|ACCESS_KEY|AUTHORIZATION)[A-Z0-9_]*)\s*[:=]\s*(['"]?)([^\s'",;}\]()<>{]{20,})\2/;

function normalisePath(file) {
  return String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function runGit(args, { encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = String(result.stderr || '').trim().replace(/\S{32,}/g, '[masqué]');
    throw new Error(detail || `git ${args.join(' ')} a échoué (code ${result.status}).`);
  }
  return result.stdout;
}

function gitText(args) {
  return String(runGit(args, { encoding: 'utf8' }) || '');
}

function gitBlob(args) {
  const output = runGit(args, { encoding: 'buffer' });
  return Buffer.isBuffer(output) ? output : Buffer.from(output || '');
}

function splitNul(output) {
  return String(output || '').split('\0').filter(Boolean);
}

function isPlaceholder(value) {
  const text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  return !text || /^(?:<[^>]+>|\$\{[^}]+\}|your(?:[-_]|$)|replace(?:[-_]|$)|example(?:[-_]|$)|placeholder(?:[-_]|$)|change(?:[-_]|$)|changeme$|dummy$|fake$|test(?:[-_]|$)|secret-for-test$|cle(?:[-_]|$)|none$|null$|empty$)/i.test(text);
}

function pathReason(file) {
  const normalised = normalisePath(file);
  if (normalised === '.env.example') return null;

  for (const [pattern, reason] of SENSITIVE_DIRECTORIES) {
    if (pattern.test(normalised)) return reason;
  }
  for (const [pattern, reason] of SENSITIVE_FILENAMES) {
    if (pattern.test(normalised)) return reason;
  }
  return null;
}

function contentIssues(buffer) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer || '');
  if (buffer.length > MAX_TEXT_BYTES) return [{ reason: 'fichier trop volumineux pour un audit automatique' }];
  if (buffer.includes(0)) return [];

  const text = buffer.toString('utf8');
  const issues = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const { name, pattern } of SECRET_PATTERNS) {
      if (!pattern.test(line)) continue;
      const key = `${name}:${index + 1}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ reason: name, line: index + 1 });
      }
    }

    const assignment = SECRET_ASSIGNMENT.exec(line);
    if (assignment && !isPlaceholder(assignment[3])) {
      const key = `configuration:${index + 1}`;
      if (!seen.has(key)) {
        seen.add(key);
        issues.push({ reason: `valeur sensible (${assignment[1]})`, line: index + 1 });
      }
    }
  }
  return issues;
}

function inspectFile(file, read, context) {
  const normalised = normalisePath(file);
  const issues = [];
  const pathMessage = pathReason(normalised);
  if (pathMessage) issues.push({ file: normalised, context, reason: pathMessage });

  let buffer;
  try {
    buffer = read(normalised);
  } catch (error) {
    // A deleted file or a submodule cannot expose a new secret through this check.
    return issues;
  }
  for (const issue of contentIssues(buffer)) issues.push({ file: normalised, context, ...issue });
  return issues;
}

function stagedFiles() {
  return splitNul(gitText(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT']));
}

function trackedFiles() {
  return splitNul(gitText(['ls-files', '-z']));
}

function stagedIssues() {
  const files = stagedFiles();
  const issues = [];
  for (const file of files) issues.push(...inspectFile(file, (name) => gitBlob(['show', `:${name}`]), 'index'));
  return { files, issues };
}

function trackedIssues() {
  const files = trackedFiles();
  const issues = [];
  for (const file of files) issues.push(...inspectFile(file, (name) => gitBlob(['show', `HEAD:${name}`]), 'HEAD'));
  return { files, issues };
}

function pushCommits(input) {
  const commits = [];
  for (const line of String(input || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const localSha = parts[1];
    const remoteSha = parts[3];
    if (!localSha || ZERO_SHA.test(localSha)) continue;
    const range = ZERO_SHA.test(remoteSha || '') ? localSha : `${remoteSha}..${localSha}`;
    const rangeCommits = gitText(['rev-list', range]).split(/\r?\n/).filter(Boolean);
    commits.push(...rangeCommits);
  }
  return [...new Set(commits)];
}

function pushIssues(input) {
  const commits = pushCommits(input);
  const issues = [];
  const seen = new Set();
  for (const commit of commits) {
    const files = splitNul(gitText(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', '-z', commit]));
    for (const file of files) {
      const key = `${commit}:${file}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(...inspectFile(file, (name) => gitBlob(['show', `${commit}:${name}`]), commit.slice(0, 10)));
    }
  }
  return { files: commits, issues };
}

function printIssues(issues, mode) {
  if (!issues.length) return;
  console.error(`[git-guard] ${mode} bloqué : des données locales ou sensibles seraient publiées.`);
  for (const issue of issues) {
    const location = issue.line ? `${issue.file}:${issue.line}` : issue.file;
    const context = issue.context ? ` [${issue.context}]` : '';
    console.error(`  - ${location}${context} : ${issue.reason}`);
  }
  console.error('[git-guard] Laisse ces fichiers dans les dossiers locaux ignorés et utilise .env.example pour les modèles de configuration.');
}

function printHelp() {
  console.log('Usage: node tools/security/gitGuard.js [--staged|--pre-push|--tracked]');
  console.log('  --staged    vérifie les fichiers placés dans l’index avant un commit');
  console.log('  --pre-push  vérifie les nouveaux commits reçus sur stdin avant un push');
  console.log('  --tracked   audite le dernier état suivi par Git');
}

function main(argv = process.argv.slice(2)) {
  const mode = argv[0] || '--staged';
  if (mode === '--help' || mode === '-h') {
    printHelp();
    return 0;
  }

  let result;
  let label;
  if (mode === '--staged') {
    result = stagedIssues();
    label = 'Commit';
  } else if (mode === '--tracked') {
    result = trackedIssues();
    label = 'Audit';
  } else if (mode === '--pre-push') {
    result = pushIssues(fs.readFileSync(0, 'utf8'));
    label = 'Push';
  } else {
    printHelp();
    return 2;
  }

  printIssues(result.issues, label);
  if (result.issues.length) return 1;
  if (mode === '--tracked') console.log(`[git-guard] ${result.files.length} fichiers suivis audités; aucun secret détecté.`);
  else if (result.files.length) console.log(`[git-guard] ${result.files.length} fichier(s) vérifié(s).`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`[git-guard] Vérification impossible : ${String(error.message || error).replace(/\S{32,}/g, '[masqué]')}`);
    process.exitCode = 2;
  }
}

module.exports = {
  contentIssues,
  normalisePath,
  pathReason,
};
