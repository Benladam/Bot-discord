const VALID_STATUSES = new Set(['online', 'dnd', 'idle', 'invisible']);
const ACTIVITY_TYPES = Object.freeze({ playing: 0, listening: 2, watching: 3, competing: 5 });
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 86_400;
const MAX_MESSAGES = 20;

function splitMessages(value) {
  return String(value || '').split(/[|\n]/).map((line) => line.trim()).filter(Boolean);
}

function envDefaults() {
  const prefix = process.env.COMMAND_PREFIX || '!';
  const status = String(process.env.BOT_PRESENCE_STATUS || 'online').toLowerCase();
  const activityType = String(process.env.BOT_PRESENCE_TYPE || 'watching').toLowerCase();
  const intervalSeconds = Number(process.env.BOT_PRESENCE_INTERVAL_SECONDS || 60);
  return {
    status: VALID_STATUSES.has(status) ? status : 'online',
    activityType: Object.hasOwn(ACTIVITY_TYPES, activityType) ? activityType : 'watching',
    intervalSeconds: Number.isInteger(intervalSeconds) && intervalSeconds >= MIN_INTERVAL_SECONDS && intervalSeconds <= MAX_INTERVAL_SECONDS
      ? intervalSeconds : 60,
    messages: splitMessages(process.env.BOT_PRESENCE_TEXTS || `la musique avec ${prefix}play|${prefix}help pour les commandes`).slice(0, MAX_MESSAGES),
  };
}

function mergeStoredConfig(stored, defaults) {
  if (!stored || typeof stored !== 'object') return { ...defaults, messages: [...defaults.messages] };
  const status = VALID_STATUSES.has(stored.status) ? stored.status : defaults.status;
  const activityType = Object.hasOwn(ACTIVITY_TYPES, stored.activityType) ? stored.activityType : defaults.activityType;
  const intervalSeconds = Number(stored.intervalSeconds);
  const messages = Array.isArray(stored.messages)
    ? stored.messages.map((line) => String(line).trim().slice(0, 128)).filter(Boolean).slice(0, MAX_MESSAGES)
    : [...defaults.messages];
  return {
    status,
    activityType,
    intervalSeconds: Number.isInteger(intervalSeconds) && intervalSeconds >= MIN_INTERVAL_SECONDS && intervalSeconds <= MAX_INTERVAL_SECONDS
      ? intervalSeconds : defaults.intervalSeconds,
    messages,
  };
}

class PresenceManager {
  constructor({ client, database, log = () => {} }) {
    this.client = client;
    this.database = database;
    this.log = log;
    this.defaults = envDefaults();
    this.config = { ...this.defaults, messages: [...this.defaults.messages] };
    this.musicActivities = new Map();
    this.messageIndex = 0;
    this.timer = null;
    this.ready = false;
  }

  start() {
    try {
      this.config = mergeStoredConfig(this.database.getGlobalSetting('botPresence', null), this.defaults);
    } catch (error) {
      this.log('warn', `Réglages de présence ignorés : ${error.message}`);
    }
    this.ready = true;
    this.apply();
    this.resetTimer();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ready = false;
  }

  getConfig() {
    return { ...this.config, messages: [...this.config.messages] };
  }

  update(patch) {
    const next = this.getConfig();
    if (patch.status !== undefined) {
      const value = String(patch.status).toLowerCase();
      if (!VALID_STATUSES.has(value)) throw new Error('Choisis online, dnd, idle ou invisible.');
      next.status = value;
    }
    if (patch.activityType !== undefined) {
      const value = String(patch.activityType).toLowerCase();
      if (!Object.hasOwn(ACTIVITY_TYPES, value)) throw new Error('Choisis playing, listening, watching ou competing.');
      next.activityType = value;
    }
    if (patch.intervalSeconds !== undefined) {
      const value = Number(patch.intervalSeconds);
      if (!Number.isInteger(value) || value < MIN_INTERVAL_SECONDS || value > MAX_INTERVAL_SECONDS) {
        throw new Error(`L’intervalle doit être compris entre ${MIN_INTERVAL_SECONDS} et ${MAX_INTERVAL_SECONDS} secondes.`);
      }
      next.intervalSeconds = value;
    }
    if (patch.messages !== undefined) {
      const messages = Array.isArray(patch.messages) ? patch.messages : splitMessages(patch.messages);
      if (messages.length > MAX_MESSAGES) throw new Error(`Tu peux configurer au maximum ${MAX_MESSAGES} textes.`);
      if (messages.some((line) => String(line).trim().length > 128)) throw new Error('Chaque texte doit contenir au maximum 128 caractères.');
      next.messages = messages.map((line) => String(line).trim()).filter(Boolean);
      this.messageIndex = 0;
    }

    this.config = next;
    this.database.setGlobalSetting('botPresence', this.config);
    this.resetTimer();
    this.apply();
    return this.getConfig();
  }

  setMusicActivity(key, info) {
    const activityKey = String(key);
    const text = info && String(info.details || info.title || info.state || '').trim().slice(0, 128);
    this.musicActivities.delete(activityKey);
    if (text) this.musicActivities.set(activityKey, text);
    this.apply();
  }

  resetTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.ready || this.config.messages.length < 2) return;
    this.timer = setInterval(() => {
      if (this.musicActivities.size) return;
      this.messageIndex = (this.messageIndex + 1) % this.config.messages.length;
      this.apply();
    }, this.config.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  apply() {
    if (!this.ready || !this.client.user) return;
    const currentMusic = Array.from(this.musicActivities.values()).at(-1);
    const template = currentMusic || this.config.messages[this.messageIndex] || '';
    const name = String(template).replaceAll('{prefix}', process.env.COMMAND_PREFIX || '!').slice(0, 128);
    const type = currentMusic ? ACTIVITY_TYPES.listening : ACTIVITY_TYPES[this.config.activityType];
    const activities = name ? [{ name, type }] : [];
    try {
      this.client.user.setPresence({ status: this.config.status, activities });
    } catch (error) {
      this.log('warn', `Mise à jour de présence impossible : ${error.message}`);
    }
  }
}

module.exports = { PresenceManager, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS, MAX_MESSAGES };
