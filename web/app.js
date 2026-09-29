const basePath = document.querySelector('meta[name="web-base-path"]')?.content || '';
const apiPath = (path) => `${basePath}${path}`;
const loginView = document.querySelector('#login-view');
const appView = document.querySelector('#app-view');
const loginForm = document.querySelector('#login-form');
const loginError = document.querySelector('#login-error');
const accessToken = document.querySelector('#access-token');
const message = document.querySelector('#app-message');
const serverSelect = document.querySelector('#server-select');
const dashboard = document.querySelector('#dashboard');
const emptyState = document.querySelector('#empty-state');
let csrfToken = '';
let isAuthenticated = false;
let webmcpRegistered = false;
let refreshPending = false;

function setView(authenticated) {
  isAuthenticated = authenticated;
  loginView.hidden = authenticated;
  appView.hidden = !authenticated;
  if (!authenticated) {
    window.clearInterval(window.heussRefreshTimer);
    csrfToken = '';
  }
}

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (method !== 'GET' && csrfToken) headers.set('X-CSRF-Token', csrfToken);
  const response = await fetch(apiPath(path), { ...options, method, headers, credentials: 'same-origin', cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && isAuthenticated) {
    setView(false);
    loginError.textContent = 'Ta session a expiré. Reconnecte-toi.';
  }
  if (!response.ok) throw new Error(payload.error || `Erreur HTTP ${response.status}`);
  return payload;
}

function showMessage(text, isError = false) {
  message.textContent = text || '';
  message.classList.toggle('is-error', isError);
  if (text) window.setTimeout(() => { if (message.textContent === text) message.textContent = ''; }, 5000);
}

function duration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function renderState(state) {
  const current = state.current;
  const connected = Boolean(state.connected);
  const badge = document.querySelector('#connection-badge');
  badge.classList.toggle('online', connected);
  badge.classList.toggle('offline', !connected);
  badge.querySelector('span').textContent = connected ? 'Dans le vocal' : 'Déconnecté';
  document.querySelector('#server-kicker').textContent = `/ ${state.guild.name}`;
  document.querySelector('#play-state').textContent = current ? (current.paused ? 'EN PAUSE' : 'EN LECTURE') : (connected ? 'EN ATTENTE' : 'À L’ARRÊT');
  document.querySelector('#play-state').className = `state-label${current?.paused ? ' paused' : current ? ' active' : ''}`;
  document.querySelector('#track-title').textContent = current?.title || 'Rien ne joue pour l’instant';
  document.querySelector('#track-subtitle').textContent = current
    ? `${current.source} · ${duration(current.duration)}`
    : 'Lance une musique avec /play sur Discord.';
  document.querySelector('#voice-channel').textContent = state.voiceChannel?.name || 'Déconnecté';
  document.querySelector('#volume-value').textContent = `${state.volume}%`;
  document.querySelector('#volume-meter').style.width = `${state.volume}%`;
  document.querySelector('#queue-count').textContent = `${state.queueLength} titre${state.queueLength === 1 ? '' : 's'}`;
  document.querySelector('#queue-total').textContent = String(state.queueLength).padStart(2, '0');
  document.querySelector('#always-on-toggle').checked = Boolean(state.alwaysOn);

  const pauseButton = document.querySelector('#pause-button');
  pauseButton.disabled = !current;
  pauseButton.dataset.action = current?.paused ? 'resume' : 'pause';
  pauseButton.querySelector('span:last-child').textContent = current?.paused ? 'Reprendre' : 'Pause';
  pauseButton.querySelector('span:first-child').textContent = current?.paused ? '▶' : 'Ⅱ';
  document.querySelector('[data-action="skip"]').disabled = !current;
  document.querySelector('[data-action="stop"]').disabled = !current && state.queueLength === 0;
  document.querySelector('[data-action="leave"]').disabled = !connected;

  const list = document.querySelector('#queue-list');
  list.replaceChildren();
  for (const [index, song] of state.queue.entries()) {
    const row = document.createElement('li');
    const position = document.createElement('span');
    position.className = 'queue-position';
    position.textContent = String(index + 1).padStart(2, '0');
    const title = document.createElement('span');
    title.className = 'queue-name';
    title.textContent = song.title;
    const time = document.createElement('span');
    time.className = 'queue-duration';
    time.textContent = song.duration ? duration(song.duration) : '—';
    row.append(position, title, time);
    list.append(row);
  }
  document.querySelector('#queue-empty').hidden = state.queue.length > 0;
}

async function loadSelectedGuild() {
  const guildId = serverSelect.value;
  if (!guildId) return;
  const state = await api(`/api/guilds/${encodeURIComponent(guildId)}/music`);
  renderState(state);
}

async function refresh() {
  if (!isAuthenticated || refreshPending) return;
  refreshPending = true;
  try {
    const data = await api('/api/status');
    const priorId = serverSelect.value;
    serverSelect.replaceChildren();
    for (const guild of data.guilds) {
      const option = document.createElement('option');
      option.value = guild.id;
      option.textContent = guild.name;
      serverSelect.append(option);
    }
    const hasGuilds = data.guilds.length > 0;
    dashboard.hidden = !hasGuilds;
    emptyState.hidden = hasGuilds;
    if (hasGuilds) {
      serverSelect.value = data.guilds.some((guild) => guild.id === priorId) ? priorId : data.guilds[0].id;
      await loadSelectedGuild();
    }
  } catch (error) {
    if (isAuthenticated) showMessage(error.message, true);
  } finally {
    refreshPending = false;
  }
}

async function registerWebMcp() {
  const modelContext = window.navigator?.modelContext || document.modelContext;
  if (!modelContext?.registerTool || webmcpRegistered) return;
  await modelContext.registerTool({
    name: 'get_music_status',
    description: 'Read the current track, voice connection, volume, and upcoming queue for one Discord server already available in the Heuss control panel. Does not change playback.',
    inputSchema: {
      type: 'object',
      properties: { guild_id: { type: 'string', pattern: '^\\d{17,20}$', minLength: 17, maxLength: 20 } },
      required: ['guild_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      if (!isAuthenticated) throw new Error('Log in to the Heuss control panel first.');
      if (!input || typeof input !== 'object' || Array.isArray(input)
          || Object.keys(input).length !== 1 || typeof input.guild_id !== 'string'
          || !/^\d{17,20}$/.test(input.guild_id)) {
        throw new Error('Expected only a valid guild_id.');
      }
      return api(`/api/guilds/${encodeURIComponent(input.guild_id)}/music`);
    },
  });
  webmcpRegistered = true;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ token: accessToken.value }) });
    csrfToken = result.csrfToken;
    accessToken.value = '';
    setView(true);
    await registerWebMcp().catch(() => {});
    await refresh();
    window.heussRefreshTimer = window.setInterval(refresh, 5000);
  } catch (error) {
    loginError.textContent = error.message;
    accessToken.select();
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
  catch (_) { /* même si la session a expiré, le panneau est fermé côté client */ }
  setView(false);
  accessToken.focus();
});

document.querySelector('#refresh-button').addEventListener('click', refresh);
serverSelect.addEventListener('change', () => loadSelectedGuild().catch((error) => showMessage(error.message, true)));

document.querySelector('.control-buttons').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  let action = button.dataset.action;
  if (action === 'stop' && !window.confirm('Arrêter la lecture et vider la file de ce serveur ?')) return;
  if (action === 'leave' && !window.confirm('Faire quitter le salon vocal à ce serveur ?')) return;
  button.disabled = true;
  try {
    await api(`/api/guilds/${encodeURIComponent(serverSelect.value)}/music/action`, {
      method: 'POST', body: JSON.stringify({ action }),
    });
    await refresh();
    showMessage(action === 'skip' ? 'Passage à la piste suivante.' : 'Commande envoyée.');
  } catch (error) { showMessage(error.message, true); }
  finally { button.disabled = false; }
});

document.querySelector('#always-on-toggle').addEventListener('change', async (event) => {
  event.target.disabled = true;
  try {
    const result = await api(`/api/guilds/${encodeURIComponent(serverSelect.value)}/music/action`, {
      method: 'POST', body: JSON.stringify({ action: 'toggle-24-7' }),
    });
    renderState(result.state);
    showMessage(result.state.alwaysOn ? 'Mode 24/7 activé pour ce serveur.' : 'Déconnexion automatique réactivée pour ce serveur.');
  } catch (error) {
    event.target.checked = !event.target.checked;
    showMessage(error.message, true);
  } finally { event.target.disabled = false; }
});

async function initialize() {
  try {
    const session = await api('/api/auth');
    if (!session.authenticated) return setView(false);
    csrfToken = session.csrfToken;
    setView(true);
    await registerWebMcp().catch(() => {});
    await refresh();
    window.heussRefreshTimer = window.setInterval(refresh, 5000);
  } catch (error) {
    setView(false);
    loginError.textContent = error.message;
  }
}

initialize();
