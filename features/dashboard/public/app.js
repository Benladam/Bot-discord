'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const paths = {
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    link: '<path d="m10 14 4-4m-7 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m1-1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
    shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Zm-4 9 3 3 5-6"/>',
    servers: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01m4-11h6m-6 11h6"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
    music: '<path d="M9 18V5l12-2v13M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
    alert: '<path d="m12 3 10 18H2ZM12 9v5m0 3h.01"/>',
    terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3m6 0h4"/>',
    activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5m10-1a7 7 0 0 0-12-5L4 9m16 6-3 3a7 7 0 0 1-12-5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    unlock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0m-4 8v2"/>',
    plus: '<path d="M12 4v16M4 12h16"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
  const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); }); }
  const number = (value) => Number.isFinite(Number(value)) && value !== null ? Number(value).toLocaleString('fr-FR') : '—';
  const date = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('fr-FR') : '—';
  const time = (value) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString('fr-FR') : '—';
  const duration = (seconds) => { const n = Math.max(0, Math.floor(Number(seconds) || 0)); return n ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` : '—'; };
  const uptime = (seconds) => { const n = Math.floor(seconds || 0); return `${Math.floor(n / 86400)} j ${Math.floor(n % 86400 / 3600)} h ${Math.floor(n % 3600 / 60)} min`; };
  function avatar(guild) {
    let image = null;
    try { if (new URL(guild.icon).protocol === 'https:') image = guild.icon; } catch (_) {}
    return image ? `<img class="guild-avatar" src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : `<span class="guild-avatar" aria-hidden="true">${esc(String(guild.name).trim().slice(0, 2).toUpperCase())}</span>`;
  }
  let connections = []; let csrf = ''; let selectedId = null; let snapshot = null;
  let scope = 'all'; let tab = 'journal'; let stream = null; let live = true;
  let before = null; let logResult = { logs: [], hasMore: false }; let editorId = null;
  let revision = 0; let loadingRevision = null; let sidebarSignature = ''; let toastTimer;
  let detailStats = null;

  async function request(route, options = {}) {
    const response = await fetch(route, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' ? { 'x-dashboard-csrf': csrf } : {}), ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Erreur HTTP ${response.status}.`);
    return data;
  }
  function botRequest(resource) { return request(`/api/bots/${encodeURIComponent(selectedId)}/${resource}`); }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500); }
  function notice(message) { $('connection-notice').textContent = message || ''; $('connection-notice').hidden = !message; }
  const connected = () => snapshot?.connected === true;
  const guilds = () => connected() ? snapshot.data.guilds : [];
  const currentGuild = () => guilds().find((guild) => guild.id === scope);
  function scopeTitle() { return scope === 'all' ? 'Vue d’ensemble' : scope === 'global' ? 'Journal du bot' : currentGuild()?.name || 'Serveur Discord'; }

  function renderSidebar() {
    const query = $('guild-search').value.trim().toLocaleLowerCase('fr');
    const list = guilds().filter((guild) => guild.name.toLocaleLowerCase('fr').includes(query));
    $('guild-count').textContent = connected() ? number(guilds().length) : '—';
    const signature = JSON.stringify([list, scope, query, selectedId, connected()]);
    if (sidebarSignature === signature) return;
    sidebarSignature = signature;
    const special = (id, name, mark, caption) => `<button class="guild-button special ${scope === id ? 'active' : ''}" data-scope="${id}" aria-current="${scope === id ? 'page' : 'false'}"><span class="guild-avatar">${icon(mark)}</span><span class="guild-copy"><span class="guild-name">${name}</span><span class="guild-meta">${caption}</span></span></button>`;
    $('guild-list').innerHTML = special('all', 'Tous les serveurs', 'servers', connected() ? `${number(guilds().length)} serveurs au total` : 'Vue globale')
      + special('global', 'Journal du bot', 'terminal', 'Démarrage, connexion, erreurs globales') + '<div class="guild-divider"></div>'
      + list.map((guild) => `<button class="guild-button ${scope === guild.id ? 'active' : ''}" data-scope="${esc(guild.id)}" aria-current="${scope === guild.id ? 'page' : 'false'}">${avatar(guild)}<span class="guild-copy"><span class="guild-name">${esc(guild.name)}</span><span class="guild-meta">${number(guild.members)} membres${guild.music.connected ? ' · en vocal' : ''}</span></span>${guild.music.playing ? '<i class="live-dot" aria-label="Lecture en cours"></i>' : ''}</button>`).join('')
      + (!list.length ? `<p class="sidebar-empty">${query ? 'Aucun serveur correspondant.' : connected() ? 'Le bot n’est dans aucun serveur.' : 'Les serveurs apparaîtront après connexion à l’API.'}</p>` : '');
  }
  function renderHeader() {
    const title = scopeTitle();
    $('page-title').textContent = title; $('scope-breadcrumb').textContent = title;
    $('page-subtitle').textContent = scope === 'all' ? 'Vos serveurs, vos journaux et votre musique, réunis ici.'
      : scope === 'global' ? 'Événements sans serveur associé : processus, connexion et erreurs globales.'
      : 'Journaux et musique de ce serveur uniquement.';
    $('connection-badge').className = `badge ${connected() ? 'connected' : selectedId ? 'offline' : ''}`;
    $('connection-badge').innerHTML = `<i></i> ${connected() ? 'API connectée' : selectedId ? 'API hors ligne' : 'Non connecté'}`;
    $('last-sync').textContent = connected() ? `Synchronisé à ${time(snapshot.data.timestamp)}` : 'En attente de connexion';
    const totals = connected() ? snapshot.data.totals : null;
    $('metric-guilds').textContent = totals ? number(totals.guilds) : '—';
    $('metric-members').textContent = totals ? number(totals.members) : '—';
    $('metric-voice').textContent = totals ? number(totals.activeVoice) : '—';
    $('metric-errors').textContent = totals ? number(currentGuild() && detailStats ? detailStats.errors24h : totals.errors24h) : '—';
    $('errors-caption').textContent = currentGuild() ? 'Erreurs de ce serveur uniquement' : 'Total des erreurs du bot';
    if (currentGuild() && !detailStats) $('metric-errors').textContent = '—';
    $('empty-start').hidden = Boolean(selectedId);
    for (const name of ['journal', 'music', 'system']) $(`panel-${name}`).hidden = !selectedId || tab !== name;
    $('refresh').disabled = !selectedId;
    if (selectedId && !connected()) notice(snapshot?.error || 'Connexion à l’API du bot…');
    else if (connected() && !snapshot.data.bot.ready) notice('L’API répond, mais le bot n’est pas connecté à Discord. Consultez le journal du bot.');
    else notice('');
  }

  function renderConnections() {
    const selectedBefore = selectedId;
    $('bot-select').innerHTML = connections.length ? connections.map((source) => `<option value="${esc(source.id)}">${esc(source.name)}</option>`).join('') : '<option value="">Aucun bot configuré</option>';
    $('bot-select').disabled = !connections.length;
    if (selectedBefore) $('bot-select').value = selectedBefore;
    $('saved-connections').innerHTML = connections.map((source) => `<article class="saved-connection ${editorId === source.id ? 'active' : ''}"><div class="saved-connection-top"><h3>${esc(source.name)}</h3><span class="tag">${icon(source.locked ? 'lock' : 'unlock')} ${source.locked ? 'Verrouillée' : 'Déverrouillée'}</span></div><p>${esc(source.url)}</p><div class="saved-connection-actions"><button class="button small" data-edit="${esc(source.id)}">Afficher</button><button class="button small" data-unlock="${esc(source.id)}">${icon('unlock')} Déverrouiller</button><button class="button small danger" data-remove="${esc(source.id)}">Retirer du dashboard</button></div></article>`).join('');
  }
  function editConnection(id = null) {
    editorId = id; const source = connections.find((item) => item.id === id);
    const locked = Boolean(source?.locked);
    $('connection-form-title').textContent = source ? `${source.name} · ${locked ? 'verrouillée' : 'modifiable'}` : 'Nouvelle connexion';
    $('connection-name').value = source?.name || '';
    $('connection-url').value = source?.url || '';
    $('connection-token').value = '';
    ['connection-name', 'connection-url', 'connection-token'].forEach((field) => { $(field).disabled = locked; });
    $('connection-token').required = !source;
    $('connection-token').minLength = source ? 0 : 32;
    $('connection-token').placeholder = source ? 'Clé enregistrée · laisser vide pour la conserver' : 'DASHBOARD_API_TOKEN · 32 caractères minimum';
    $('token-help').textContent = source ? 'La clé enregistrée n’est jamais renvoyée au navigateur. Un champ vide la conserve.' : 'Utilisez la clé DASHBOARD_API_TOKEN du bot, jamais son token Discord.';
    $('save-connection').disabled = locked;
    $('lock-connection').hidden = !source || locked;
    $('form-error').hidden = true;
    renderConnections();
  }
  function openSettings() { editConnection(selectedId); $('settings-dialog').showModal(); }

  function selectBot(id) {
    stream?.close(); stream = null;
    selectedId = id || null; snapshot = null; scope = 'all'; before = null; detailStats = null;
    revision++; loadingRevision = null; logResult = { logs: [], hasMore: false };
    try { if (id) localStorage.setItem('observatoire-bot', id); else localStorage.removeItem('observatoire-bot'); } catch (_) {}
    renderConnections(); renderSidebar(); renderHeader(); clearPanels();
    if (!id) return;
    stream = new EventSource(`/api/stream?botId=${encodeURIComponent(id)}`);
    stream.addEventListener('snapshot', (event) => {
      if (id !== selectedId) return;
      try {
        snapshot = JSON.parse(event.data);
        if (connected() && scope !== 'all' && scope !== 'global' && !currentGuild()) { scope = 'all'; detailStats = null; revision++; }
        renderSidebar(); renderHeader();
        if (connected()) { if (live && !before || tab !== 'journal') void loadPanel(); }
        else { revision++; loadingRevision = null; detailStats = null; clearPanels(); }
      } catch (_) { notice('Réponse de diagnostic invalide.'); }
    });
    stream.onerror = () => {
      if (id !== selectedId) return;
      snapshot = { connected: false, error: 'Connexion locale interrompue. Reconnexion automatique en cours…' };
      revision++; loadingRevision = null; detailStats = null; renderHeader(); renderSidebar(); clearPanels();
    };
  }
  function selectScope(id) {
    scope = id; before = null; detailStats = null; revision++; loadingRevision = null;
    $('sidebar').classList.remove('open'); $('sidebar-toggle').setAttribute('aria-expanded', 'false');
    renderSidebar(); renderHeader(); clearPanels(); void loadPanel();
  }
  function setTab(name) {
    tab = name; revision++; loadingRevision = null;
    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.tab === name)); button.tabIndex = button.dataset.tab === name ? 0 : -1;
    });
    renderHeader(); void loadPanel();
  }
  function queryString(history = false) {
    const query = new URLSearchParams({ limit: history ? '30' : '150' });
    if (scope !== 'all') query.set('guildId', scope);
    if (!history) {
      if ($('log-level').value) query.set('level', $('log-level').value);
      if ($('log-category').value) query.set('category', $('log-category').value);
      if ($('log-search').value.trim()) query.set('search', $('log-search').value.trim());
      if ($('log-period').value) query.set('since', new Date(Date.now() - Number($('log-period').value) * 3600000).toISOString());
      if (before) query.set('before', before);
    }
    return query.toString();
  }
  function logsEmpty(message) { $('log-rows').innerHTML = `<tr><td colspan="5" class="table-empty">${esc(message)}</td></tr>`; $('log-count').textContent = 'Aucun événement chargé'; $('logs-older').disabled = true; $('export-logs').disabled = true; }
  function clearPanels() {
    logResult = { logs: [], hasMore: false };
    logsEmpty(selectedId ? connected() ? 'Chargement des journaux…' : 'Connectez l’API du bot pour consulter ses journaux.' : 'Aucune connexion configurée.');
    $('music-content').innerHTML = '<div class="empty-message">Les données musicales seront disponibles après connexion à l’API.</div>';
    $('system-content').innerHTML = '<div class="empty-message">Aucune mesure distante disponible.</div>';
  }
  function renderLogs(result) {
    logResult = result;
    $('log-caption').textContent = scope === 'all' ? 'Tous les serveurs et le processus du bot.' : scope === 'global' ? 'Processus et événements sans serveur associé.' : 'Événements rattachés à ce serveur uniquement.';
    if (!result.logs.length) logsEmpty('Aucun événement pour ces filtres. Les journaux sont collectés à partir de l’installation de cette version du bot.');
    else $('log-rows').innerHTML = result.logs.map((entry) => {
      const guild = guilds().find((item) => item.id === entry.guildId);
      const level = ['error', 'warn', 'info'].includes(entry.level) ? entry.level : 'info';
      return `<tr><td>${esc(time(entry.timestamp))}<small class="guild-meta">${esc(new Date(entry.timestamp).toLocaleDateString('fr-FR'))}</small></td><td><span class="level ${level}">${level}</span></td><td class="log-context"><strong>${esc(guild?.name || (entry.guildId ? entry.guildId : 'Bot global'))}</strong>${esc(entry.command ? `/${entry.command}` : entry.category)}</td><td class="log-message">${esc(entry.message)}</td><td><button class="icon-button" data-log-id="${esc(entry.id)}" aria-label="Détails de l’événement ${esc(entry.id)}">${icon('arrow')}</button></td></tr>`;
    }).join('');
    $('log-count').textContent = `${number(result.logs.length)} événements affichés${result.hasMore ? ' · d’autres sont disponibles' : ''}`;
    $('logs-older').disabled = !result.hasMore;
    $('logs-latest').hidden = !before;
    $('export-logs').disabled = !result.logs.length;
  }
  function trackList(tracks) {
    return '<ol class="track-list">' + tracks.map((track, index) => `<li><span class="track-number">${index + 1}</span><span class="track-copy">${esc(track.title)}<small>${esc(track.source || track.provider || 'Source inconnue')}${track.requesterId ? ` · demandé par ${esc(track.requesterId)}` : ''}</small></span><span class="track-duration">${esc(duration(track.duration))}</span></li>`).join('') + '</ol>';
  }
  function renderMusic(detail, history) {
    if (!detail) {
      const active = guilds();
      $('music-content').innerHTML = scope === 'global' ? '<div class="empty-message">Sélectionnez un serveur dans la liste pour voir sa musique et ses playlists.</div>'
        : active.length ? `<div class="music-grid">${active.map((guild) => `<button class="music-card" data-scope="${esc(guild.id)}"><div class="music-card-header">${avatar(guild)}<span>${esc(guild.name)}</span><span class="tag">${guild.music.paused ? 'En pause' : guild.music.playing ? 'Lecture' : guild.music.connected ? 'En vocal' : 'Au repos'}</span></div><h3>${esc(guild.music.title || 'Aucun titre en cours')}</h3><p>${number(guild.music.queueLength)} titre(s) en attente${guild.music.voiceChannel ? ` · ${esc(guild.music.voiceChannel)}` : ''}</p><p>Voir la file et les playlists ${icon('arrow')}</p></button>`).join('')}</div>` : '<div class="empty-message">Le bot n’est présent dans aucun serveur.</div>';
      return;
    }
    const music = detail.music;
    $('music-content').innerHTML = `<div class="music-current"><span class="empty-symbol">${icon('music')}</span><div><div class="eyebrow">${music.paused ? 'EN PAUSE' : music.playing ? 'EN LECTURE' : 'AU REPOS'}</div><h3>${esc(music.current?.title || 'Aucun titre en cours')}</h3><p>${esc(music.voiceChannel || 'Aucun salon vocal')} · Volume ${number(music.volume)} % · Boucle ${['désactivée', 'titre', 'file'][music.loopMode] || 'inconnue'}${music.alwaysOn ? ' · Mode 24/7 activé' : ''}</p></div></div>
      <div class="music-columns"><div><h3 class="section-title">File d’attente <span class="count">${number(music.queueLength)}</span></h3>${music.queue.length ? trackList(music.queue) : '<p class="muted">La file est vide.</p>'}${music.queueLength > 100 ? '<small>Les 100 premiers titres sont affichés.</small>' : ''}</div>
      <div><h3 class="section-title">Playlists du serveur <span class="count">${number(detail.playlists.length)}</span></h3>${detail.playlists.length ? detail.playlists.map((playlist) => `<button class="playlist-button" data-playlist="${esc(playlist.name)}">${icon('music')}<span class="playlist-copy">${esc(playlist.name)}<small>${number(playlist.trackCount)} titres · créateur ${esc(playlist.ownerId || 'inconnu')}</small></span>${icon('arrow')}</button>`).join('') : '<p class="muted">Aucune playlist enregistrée sur ce serveur.</p>'}</div></div>
      <div class="history-section"><h3 class="section-title">Derniers titres joués</h3>${history?.logs?.length ? `<ol class="track-list">${history.logs.map((entry) => `<li><span class="track-duration">${esc(time(entry.timestamp))}</span><span class="track-copy">${esc(entry.metadata?.title || entry.message)}<small>${esc(date(entry.timestamp))}${entry.userId ? ` · demandé par ${esc(entry.userId)}` : ''}</small></span></li>`).join('')}</ol>` : '<p class="muted">Aucun titre enregistré depuis l’activation du journal.</p>'}</div>`;
  }
  function renderSystem() {
    const bot = snapshot.data.bot; const source = connections.find((item) => item.id === selectedId);
    const metrics = [['Connexion Discord', bot.ready ? 'Connecté' : 'Déconnecté'], ['Latence Discord', bot.pingMs === null ? '—' : `${number(bot.pingMs)} ms`],
      ['Durée du processus', uptime(bot.processUptimeSeconds)], ['Mémoire du processus', `${number(Math.round(bot.memoryBytes / 1048576))} Mo`],
      ['Charge CPU du processus', bot.cpuPercent === null ? 'Mesure en attente' : `${number(bot.cpuPercent)} %`], ['Version Node.js', bot.nodeVersion],
      ['Commandes · 24 h', number(snapshot.data.totals.commands24h)], ['Titres joués · 24 h', number(snapshot.data.totals.tracks24h)], ['Conservation des journaux', `${number(snapshot.data.totals.retentionDays)} jours`]];
    $('system-content').innerHTML = `<div class="system-grid">${metrics.map(([label, value]) => `<article class="system-item"><small>${esc(label)}</small><strong>${esc(value)}</strong></article>`).join('')}<article class="system-item wide"><small>API du bot · ${source?.locked ? 'adresse verrouillée' : 'adresse déverrouillée'}</small><strong>${esc(source?.url)}</strong></article></div>`;
  }
  async function loadPanel() {
    if (!connected() || loadingRevision === revision) return;
    const version = revision; const panel = tab; loadingRevision = version;
    try {
      let detail = null;
      if (currentGuild()) detail = await botRequest(`guilds/${scope}`);
      if (version !== revision) return;
      detailStats = detail?.stats || null; renderHeader();
      if (panel === 'journal') {
        const result = await botRequest(`logs?${queryString()}`);
        if (version === revision) renderLogs(result);
      } else if (panel === 'music') {
        const history = detail ? await botRequest(`history?${queryString(true)}`) : null;
        if (version === revision) renderMusic(detail, history);
      } else renderSystem();
    } catch (error) {
      if (version !== revision) return;
      // Clear previous values when a live request fails; never present stale server data as current.
      clearPanels(); notice(error.message);
    } finally { if (loadingRevision === version) loadingRevision = null; }
  }
  function showLog(id) {
    const entry = logResult.logs.find((row) => String(row.id) === id); if (!entry) return;
    const fields = [['Date', date(entry.timestamp)], ['Niveau / catégorie', `${entry.level} / ${entry.category}`], ['Serveur', entry.guildId || 'Bot global'], ['Utilisateur', entry.userId || '—'], ['Commande', entry.command || '—'], ['Événement', `#${entry.id}`]];
    $('detail-title').textContent = 'Détail de l’événement';
    $('detail-content').innerHTML = `<div class="detail-grid">${fields.map(([name, value]) => `<div><small>${esc(name)}</small><span>${esc(value)}</span></div>`).join('')}</div><div class="detail-message">${esc(entry.message)}</div>${entry.stack ? `<div class="detail-stack"><h3>Trace de l’erreur</h3><pre>${esc(entry.stack)}</pre></div>` : ''}<div class="detail-stack"><h3>Contexte enregistré</h3><pre>${esc(JSON.stringify(entry.metadata, null, 2))}</pre></div>`;
    $('detail-dialog').showModal();
  }
  async function showPlaylist(name) {
    const version = revision;
    try {
      const playlist = await botRequest(`guilds/${scope}/playlists/${encodeURIComponent(name)}`);
      if (version !== revision) return;
      $('detail-title').textContent = playlist.name;
      $('detail-content').innerHTML = `<p class="dialog-intro">${number(playlist.tracks.length)} titres · serveur ${esc(scopeTitle())}</p>${playlist.tracks.length ? trackList(playlist.tracks) : '<p class="muted">Cette playlist est vide.</p>'}`;
      $('detail-dialog').showModal();
    } catch (error) { if (version === revision) toast(error.message); }
  }

  $('settings-open').onclick = openSettings; $('connect-first').onclick = openSettings;
  $('settings-close').onclick = () => $('settings-dialog').close();
  $('settings-dialog').addEventListener('close', () => { $('connection-token').value = ''; });
  $('detail-close').onclick = () => $('detail-dialog').close();
  $('new-connection').onclick = () => { editConnection(); $('connection-name').focus(); };
  $('saved-connections').onclick = async (event) => {
    const button = event.target.closest('button'); if (!button) return;
    button.disabled = true;
    try {
      if (button.dataset.edit) editConnection(button.dataset.edit);
      if (button.dataset.unlock) {
        const data = await request(`/api/connections/${button.dataset.unlock}/lock`, { method: 'POST', body: JSON.stringify({ locked: false }) });
        connections = connections.map((source) => source.id === data.id ? data : source); editConnection(data.id); $('connection-url').focus();
      }
      if (button.dataset.remove) {
        await request(`/api/connections/${button.dataset.remove}`, { method: 'DELETE' });
        connections = connections.filter((source) => source.id !== button.dataset.remove);
        if (selectedId === button.dataset.remove) selectBot(connections[0]?.id || null);
        editConnection(); renderConnections(); toast('Connexion locale retirée.');
      }
    } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
    finally { button.disabled = false; }
  };
  $('lock-connection').onclick = async () => {
    try {
      const data = await request(`/api/connections/${editorId}/lock`, { method: 'POST', body: JSON.stringify({ locked: true }) });
      connections = connections.map((source) => source.id === data.id ? data : source); editConnection(data.id); toast('Adresse et clé verrouillées.');
    } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
  };
  $('connection-form').onsubmit = async (event) => {
    event.preventDefault(); $('save-connection').disabled = true; $('form-error').hidden = true;
    try {
      const payload = { name: $('connection-name').value, url: $('connection-url').value, token: $('connection-token').value };
      const saved = await request(editorId ? `/api/connections/${editorId}` : '/api/connections', { method: editorId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      connections = connections.some((source) => source.id === saved.id) ? connections.map((source) => source.id === saved.id ? saved : source) : [...connections, saved];
      editConnection(saved.id); selectBot(saved.id); toast('Connexion enregistrée et verrouillée.');
    } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; $('save-connection').disabled = false; }
  };
  $('bot-select').onchange = () => selectBot($('bot-select').value);
  $('guild-search').oninput = renderSidebar;
  $('guild-list').onclick = (event) => { const button = event.target.closest('[data-scope]'); if (button) selectScope(button.dataset.scope); };
  $('music-content').onclick = (event) => {
    const scopeButton = event.target.closest('[data-scope]'); if (scopeButton) selectScope(scopeButton.dataset.scope);
    const playlist = event.target.closest('[data-playlist]'); if (playlist) void showPlaylist(playlist.dataset.playlist);
  };
  $('log-rows').onclick = (event) => { const button = event.target.closest('[data-log-id]'); if (button) showLog(button.dataset.logId); };
  document.querySelectorAll('[data-tab]').forEach((button, index, buttons) => {
    button.onclick = () => setTab(button.dataset.tab);
    button.onkeydown = (event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
      buttons[target].focus(); setTab(buttons[target].dataset.tab);
    } };
  });
  $('sidebar-toggle').onclick = () => { const open = $('sidebar').classList.toggle('open'); $('sidebar-toggle').setAttribute('aria-expanded', String(open)); };
  $('refresh').onclick = async () => {
    if (!selectedId) return; const id = selectedId;
    try { const data = await botRequest('status'); if (id !== selectedId) return; snapshot = data; renderSidebar(); renderHeader(); if (connected()) { revision++; loadingRevision = null; await loadPanel(); } else clearPanels(); }
    catch (error) { notice(error.message); }
  };
  function updateLive() { $('live-toggle').innerHTML = live ? '<i class="live-dot"></i> En direct' : 'Actualisation en pause'; $('live-toggle').setAttribute('aria-pressed', String(live)); }
  $('live-toggle').onclick = () => { live = !live; if (live) { before = null; revision++; loadingRevision = null; void loadPanel(); } updateLive(); };
  $('logs-older').onclick = () => { before = logResult.logs.at(-1)?.id; live = false; updateLive(); revision++; loadingRevision = null; void loadPanel(); };
  $('logs-latest').onclick = () => { before = null; revision++; loadingRevision = null; void loadPanel(); };
  let searchTimer;
  ['log-level', 'log-category', 'log-period', 'log-search'].forEach((id) => {
    $(id).addEventListener(id === 'log-search' ? 'input' : 'change', () => {
      clearTimeout(searchTimer); before = null; revision++; loadingRevision = null;
      searchTimer = setTimeout(() => { void loadPanel(); }, id === 'log-search' ? 250 : 0);
    });
  });
  $('export-logs').onclick = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), bot: connections.find((source) => source.id === selectedId)?.name, scope, filters: Object.fromEntries(new URLSearchParams(queryString())), logs: logResult.logs }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `journaux-${scope}-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  hydrateIcons(); renderSidebar(); renderHeader(); clearPanels();
  request('/api/bootstrap').then((data) => {
    csrf = data.csrfToken; connections = data.connections;
    let stored; try { stored = localStorage.getItem('observatoire-bot'); } catch (_) {}
    selectBot(connections.some((source) => source.id === stored) ? stored : connections[0]?.id || null);
  }).catch((error) => { notice(`Le service local ne répond pas : ${error.message}`); $('settings-open').disabled = true; $('connect-first').disabled = true; });
})();
