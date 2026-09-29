'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  WebhookClient,
} = require('discord.js');
const { WebSocket, WebSocketServer } = require('ws');
const { resolveQuery } = require('./resolve');
const { cleanMediaQuery } = require('./mediaQuery');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DISCORD_ID_PATTERN = /^[0-9]{17,20}$/;
const MAX_FRAME_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 20_000;

function createMinecraftBridge({ client, getPlayer, database, logger = console, handleWebRequest }) {
  const token = String(process.env.MINECRAFT_BRIDGE_TOKEN || '').trim();
  const guildId = String(process.env.MINECRAFT_GUILD_ID || '').trim();
  const minecraftChannelId = String(process.env.MINECRAFT_CHANNEL_ID || '').trim();
  const minecraftNewsWebhookUrl = String(process.env.MINECRAFT_NEWS_WEBHOOK_URL || '').trim();
  let minecraftNewsWebhook = null;
  if (minecraftNewsWebhookUrl) {
    try {
      minecraftNewsWebhook = new WebhookClient({ url: minecraftNewsWebhookUrl });
    } catch {
      logger.error('[Minecraft bridge] MINECRAFT_NEWS_WEBHOOK_URL invalide; valeur masquée.');
    }
  }
  const port = Number(process.env.SERVER_PORT || process.env.PORT || 8080);
  const pending = new Map();
  let activeSocket = null;

  const httpServer = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      const body = JSON.stringify({
        status: 'ok',
        discord: client.isReady() ? 'online' : 'starting',
        minecraftBridge: token.length >= 32 ? 'configured' : 'disabled',
        minecraftConnected: activeSocket?.readyState === WebSocket.OPEN,
      });
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(body);
      return;
    }
    if (typeof handleWebRequest === 'function') {
      void handleWebRequest(request, response);
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  });

  const webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname !== '/minecraft-bridge' || !isAuthorized(request.headers.authorization, token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit('connection', webSocket, request);
    });
  });

  webSocketServer.on('connection', (webSocket) => {
    activeSocket = webSocket;
    logger.info('[Minecraft bridge] Serveur Minecraft connecté.');
    webSocket.on('message', (data) => {
      if (data.byteLength > MAX_FRAME_BYTES) {
        webSocket.close(1009, 'Message too large');
        return;
      }
      void handleFrame(webSocket, data.toString());
    });
    webSocket.on('close', () => {
      if (activeSocket === webSocket) activeSocket = null;
      for (const [id, entry] of pending) {
        if (entry.socket !== webSocket) continue;
        clearTimeout(entry.timeout);
        pending.delete(id);
        entry.reject(new Error('La connexion au serveur Minecraft a été interrompue.'));
      }
      logger.warn('[Minecraft bridge] Serveur Minecraft déconnecté.');
    });
    webSocket.on('error', (error) => logger.error('[Minecraft bridge] ' + error.message));
  });

  httpServer.listen(port, '0.0.0.0', () => {
    logger.info('[Minecraft bridge] Vérification HTTP sur le port ' + port
      + (token.length >= 32 ? '; jeton configuré.' : '; jeton non configuré, pont désactivé.'));
  });

  async function handleFrame(webSocket, raw) {
    let frame;
    try {
      frame = JSON.parse(raw);
      if (!frame || typeof frame !== 'object' || typeof frame.id !== 'string') {
        throw new Error('Format de message invalide.');
      }
      if (frame.type === 'response') {
        const entry = pending.get(frame.id);
        if (!entry || entry.socket !== webSocket) return;
        clearTimeout(entry.timeout);
        pending.delete(frame.id);
        entry.resolve(frame);
        return;
      }
      if (frame.type !== 'request') {
        throw new Error('Type de message inconnu.');
      }

      let result;
      if (frame.action === 'link_request') {
        result = await sendLinkRequest(frame.payload || {});
      } else if (frame.action === 'music_control') {
        result = await controlMusic(frame.payload || {});
      } else if (frame.action === 'minecraft_changelog') {
        result = await postMinecraftChangelog(frame.payload || {});
      } else {
        result = { ok: false, message: 'Action inconnue du bot Discord.' };
      }
      sendFrame(webSocket, { type: 'response', id: frame.id, ...result });
    } catch (error) {
      logger.error('[Minecraft bridge] ' + error.message);
      if (frame && typeof frame.id === 'string') {
        sendFrame(webSocket, {
          type: 'response',
          id: frame.id,
          ok: false,
          message: safeMessage(error),
        });
      }
    }
  }

  async function fetchGuildMember(discordUserId) {
    if (!guildId) throw new Error('Le serveur Discord lié au pont n’est pas configuré.');
    if (!DISCORD_ID_PATTERN.test(String(discordUserId || ''))) throw new Error('ID utilisateur Discord invalide.');
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordUserId);
    if (member.user.bot) throw new Error('Les comptes de bot Discord ne peuvent pas être liés.');
    return { guild, member };
  }

  async function postMinecraftChangelog(payload) {
    const eventId = String(payload.event_id || '');
    const changes = String(payload.changes || '').trim();
    const modVersion = String(payload.mod_version || '').trim().slice(0, 80);
    if (!UUID_PATTERN.test(eventId) || !changes || changes.length > 1200) {
      throw new Error('Le changelog Minecraft contient des données invalides.');
    }
    if (!guildId || !DISCORD_ID_PATTERN.test(guildId)) {
      throw new Error('Le serveur Discord du pont n’est pas configuré.');
    }
    if (!DISCORD_ID_PATTERN.test(minecraftChannelId)) {
      throw new Error('Configure MINECRAFT_CHANNEL_ID avec l’ID du salon Discord Minecraft.');
    }

    if (database?.getGuildSetting(guildId, 'lastMinecraftChangelogId') === eventId) {
      return { ok: true, message: 'Ce changelog Minecraft a déjà été publié.' };
    }

    const guild = await client.guilds.fetch(guildId);
    let channel = guild.channels.cache.get(minecraftChannelId);
    if (!channel) channel = await guild.channels.fetch(minecraftChannelId).catch(() => null);
    if (!channel || channel.guildId !== guild.id || typeof channel.send !== 'function') {
      throw new Error('Le salon Discord Minecraft configuré est introuvable ou non textuel.');
    }

    const botMember = guild.members.me;
    const permissions = botMember && channel.permissionsFor?.(botMember);
    if (!minecraftNewsWebhookUrl && permissions && !permissions.has(PermissionFlagsBits.SendMessages)) {
      throw new Error('Le bot ne peut pas écrire dans le salon Discord Minecraft.');
    }
    if (minecraftNewsWebhookUrl && !minecraftNewsWebhook) {
      throw new Error('Le webhook des nouvelles Minecraft est mal configuré. Vérifie MINECRAFT_NEWS_WEBHOOK_URL.');
    }

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('Minecraft — redémarrage terminé')
      .setDescription('**Changements Minecraft**\n' + changes)
      .setFooter({ text: 'Journal Minecraft uniquement' })
      .setTimestamp();
    if (modVersion && modVersion !== 'inconnue') {
      embed.addFields({ name: 'Version du mod Minecraft', value: modVersion, inline: true });
    }
    const messageOptions = { embeds: [embed], allowedMentions: { parse: [] } };
    if (minecraftNewsWebhook) {
      await minecraftNewsWebhook.send(messageOptions);
    } else {
      await channel.send(messageOptions);
    }
    try {
      database?.setGuildSetting(guildId, 'lastMinecraftChangelogId', eventId);
    } catch (error) {
      logger.warn('[Minecraft bridge] Changelog publié, mais son ID anti-doublon n’a pas pu être mémorisé: ' + error.message);
    }
    return { ok: true, message: 'Changelog Minecraft publié dans le salon configuré.' };
  }

  async function sendLinkRequest(payload) {
    const requestId = String(payload.request_id || '');
    const discordUserId = String(payload.discord_user_id || '');
    const playerName = String(payload.mc_player_name || 'Joueur').slice(0, 32);
    if (!UUID_PATTERN.test(requestId) || !DISCORD_ID_PATTERN.test(discordUserId)) {
      throw new Error('La demande de liaison contient des identifiants invalides.');
    }

    const { member } = await fetchGuildMember(discordUserId);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('mc-link:yes:' + requestId)
        .setLabel('Oui, lier mon compte')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('mc-link:no:' + requestId)
        .setLabel('Non')
        .setStyle(ButtonStyle.Danger),
    );
    await member.send({
      content: 'Heuss l’Enfoiré a reçu une demande pour relier le compte Minecraft **'
        + playerName + '** à ton compte Discord. Si tu as lancé cette demande, confirme ci-dessous. '
        + 'Sinon, refuse-la. La demande expire dans 10 minutes.',
      components: [buttons],
    });
    return { ok: true, message: 'DM envoyé : confirme la liaison avec le bouton Oui ou Non.' };
  }

  async function sendRequest(action, payload) {
    const webSocket = activeSocket;
    if (!webSocket || webSocket.readyState !== WebSocket.OPEN) {
      throw new Error('Le serveur Minecraft est hors ligne. Réessaie quand le pont sera reconnecté.');
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Le serveur Minecraft ne répond pas. La demande expirera automatiquement.'));
      }, REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      pending.set(id, { socket: webSocket, resolve, reject, timeout });
      sendFrame(webSocket, { type: 'request', id, action, payload }, (error) => {
        if (!error) return;
        clearTimeout(timeout);
        pending.delete(id);
        reject(error);
      });
    });
  }

  async function handleLinkButton(interaction) {
    const match = /^mc-link:(yes|no):([0-9a-f-]{36})$/i.exec(interaction.customId || '');
    if (!match) return false;
    if (interaction.inGuild?.()) {
      await interaction.reply({ content: 'Cette confirmation est valable uniquement dans le DM envoyé par le bot.', ephemeral: true });
      return true;
    }
    if (interaction.message?.author?.id !== client.user?.id) {
      await interaction.reply({ content: 'Ce bouton ne vient pas du bot de liaison.', ephemeral: true });
      return true;
    }

    await interaction.deferUpdate();
    try {
      const result = await sendRequest('link_decision', {
        request_id: match[2],
        discord_user_id: interaction.user.id,
        accepted: match[1] === 'yes',
      });
      const message = String(result.message || 'Réponse enregistrée.');
      await interaction.message.edit({ content: message, components: [] }).catch(() => {});
    } catch (error) {
      await interaction.followUp({
        content: safeMessage(error),
        ephemeral: true,
      }).catch(() => {});
    }
    return true;
  }

  async function controlMusic(payload) {
    const action = String(payload.action || '');
    const discordUserId = String(payload.discord_user_id || '');
    const { guild, member } = await fetchGuildMember(discordUserId);
    const player = getPlayer(guild.id);
    const state = player.getState();

    if (action === 'status') {
      const current = state.current ? 'Lecture : **' + state.current.title + '**' : 'Aucune musique en lecture.';
      return { ok: true, message: current + ' File d’attente : ' + state.queue.length + '.' };
    }

    const voiceChannel = member.voice.channel;
    if (!voiceChannel) throw new Error('Rejoins un salon vocal Discord avant d’utiliser cette commande.');
    const connectedChannelId = player.connection?.connected ? player.connection.channelId : null;
    if (connectedChannelId && connectedChannelId !== voiceChannel.id) {
      throw new Error('Le bot est déjà dans un autre salon vocal. Rejoins son salon pour le contrôler.');
    }

    if (action === 'join') {
      await player.ensureConnection(voiceChannel);
      return { ok: true, message: 'Le bot a rejoint « ' + voiceChannel.name + ' ».' };
    }

    if (action === 'play') {
      const query = cleanMediaQuery(String(payload.query || '').slice(0, 300));
      if (!query) throw new Error('Indique un titre ou un lien musical.');
      const resolved = await resolveQuery(query);
      const wasTruncated = resolved.length > 25;
      const songs = resolved.slice(0, 25);
      if (!songs.length) throw new Error('Aucun morceau jouable trouvé.');
      await player.enqueueSongs(songs, {
        voiceChannel,
        addedBy: String(payload.mc_player_name || 'Minecraft').slice(0, 32),
        lastChannel: null,
        lang: 'fr',
      });
      const omitted = wasTruncated ? ' (file limitée à 25 morceaux par demande)' : '';
      return { ok: true, message: songs.length + ' morceau(x) ajouté(s) à la file Discord.' + omitted };
    }

    if (!player.connection?.connected || player.connection.channelId !== voiceChannel.id) {
      throw new Error('Le bot n’est pas dans ton salon vocal. Utilise /discord join.');
    }

    if (action === 'skip') {
      if (!player.isPlaying) throw new Error('Aucune musique à passer.');
      await player.skip();
      return { ok: true, message: 'Morceau passé.' };
    }
    if (action === 'pause') {
      if (!player.isPlaying || player.isPaused) throw new Error('La lecture ne peut pas être mise en pause.');
      player.pause();
      return { ok: true, message: 'Lecture mise en pause.' };
    }
    if (action === 'resume') {
      if (!player.isPaused) throw new Error('La lecture n’est pas en pause.');
      player.resume();
      return { ok: true, message: 'Lecture reprise.' };
    }
    if (action === 'queue') {
      const lines = state.queue.slice(0, 10).map((song, index) =>
        (index + 1) + '. ' + String(song.title || 'Musique inconnue').replace(/[\r\n]/g, ' ').slice(0, 100));
      const text = lines.length ? lines.join('\n') : 'La file d’attente est vide.';
      return { ok: true, message: text + (state.queue.length > 10 ? '\n… et ' + (state.queue.length - 10) + ' autre(s).' : '') };
    }
    if (action === 'stop') {
      player.stop();
      return { ok: true, message: 'Lecture arrêtée et file vidée.' };
    }
    if (action === 'leave') {
      player.destroy();
      return { ok: true, message: 'Le bot a quitté le salon vocal.' };
    }
    return { ok: false, message: 'Commande musicale inconnue.' };
  }

  return {
    handleLinkButton,
    close() {
      for (const [id, entry] of pending) {
        clearTimeout(entry.timeout);
        entry.reject(new Error('Le pont Minecraft ferme.'));
        pending.delete(id);
      }
      minecraftNewsWebhook?.destroy();
      webSocketServer.close();
      httpServer.close();
    },
  };
}

function isAuthorized(header, token) {
  if (token.length < 32) return false;
  const match = /^Bearer\s+(.+)$/i.exec(String(header || ''));
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function sendFrame(webSocket, frame, callback) {
  if (webSocket.readyState !== WebSocket.OPEN) {
    if (callback) callback(new Error('La connexion au serveur Minecraft est fermée.'));
    return;
  }
  webSocket.send(JSON.stringify(frame), callback);
}

function safeMessage(error) {
  const message = String(error?.message || 'Une erreur inattendue est survenue.');
  return message.length > 300 ? message.slice(0, 297) + '…' : message;
}

module.exports = { createMinecraftBridge };
