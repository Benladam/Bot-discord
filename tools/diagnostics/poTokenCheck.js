const { spawn } = require('node:child_process');
const { ensureManagedYtDlp } = require('../../features/music/ytDlp');
const { ensurePoToken, poTokenArgs } = require('../../features/music/youtubePoToken');

/** Classifies verbose yt-dlp output; never returns arbitrary upstream text. */
function classifyPoDiagnostic(text) {
  return {
    pluginLoaded: /PO Token Providers[^\r\n]*bgutil|\[pot:bgutil/i.test(text),
    generationRequested: /Generating (?:a )?gvs PO Token/i.test(text),
    loginRequired: /LOGIN_REQUIRED|Sign in to confirm|authentication|cookies.*no longer valid/i.test(text),
    version: text.match(/yt-dlp version[^\r\n]*?(\d{4}\.\d{2}\.\d{2})/)?.[1] || 'unknown',
  };
}
async function poTokenCheck(url, { log = console.info, ensure = ensurePoToken, binary = ensureManagedYtDlp, spawnImpl = spawn } = {}) {
  const config = await ensure();
  if (!config) { log('[potcheck] Helper privé indisponible.'); return { ready: false }; }
  const executable = await binary();
  return new Promise(resolve => {
    let diagnostic = ''; let finished = false;
    const child = spawnImpl(executable, ['--ignore-config', '--verbose', '--simulate', '--no-playlist',
      '--js-runtimes', `node:${process.execPath}`, '--remote-components', 'ejs:github',
      ...poTokenArgs(config), '--socket-timeout', '10', '--retries', '0', url], { windowsHide: true });
    const finish = code => {
      if (finished) return; finished = true; clearTimeout(timer);
      const result = { ready: true, ...classifyPoDiagnostic(diagnostic), extracted: code === 0 };
      log(`[potcheck] yt-dlp=${result.version}; plugin chargé=${result.pluginLoaded}; génération GVS demandée=${result.generationRequested}; authentification exigée=${result.loginRequired}; extraction=${result.extracted}. Aucun cookie transmis, aucun vocal rejoint.`);
      resolve(result);
    };
    const timer = setTimeout(() => { child.kill(); finish(-1); }, 45_000);
    child.stdout.resume();
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk.toString()).slice(-32_000); });
    child.once('error', () => finish(-1)); child.once('close', finish);
  });
}
module.exports = { poTokenCheck, classifyPoDiagnostic };
