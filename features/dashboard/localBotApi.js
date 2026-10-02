'use strict';

const { createDashboardApi, send } = require('./api');
const { createHttpService } = require('../web/httpServer');

// Une API locale indépendante du service public, même si une extension possède
// ce dernier et son certificat TLS. Elle reste liée à l'interface loopback.
function createLocalBotApi({ client, database, telemetry, restartBot, logger = console, env = process.env }) {
  const configured = String(env.DASHBOARD_LOOPBACK_PORT || '').trim();
  if (!configured) return null;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DASHBOARD_LOOPBACK_PORT doit être un port entre 1 et 65535.');
  }
  const api = createDashboardApi({ client, database, telemetry, restartBot, env });
  const service = createHttpService({ client, logger, host: '127.0.0.1', port,
    handleRequest: async (request, response) => {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (!await api.handle(request, response, pathname)) send(response, 404, { error: 'Route locale inconnue.' });
    },
  });
  service.ready.then(() => {
    logger.info?.(`[dashboard] API du bot sur ce PC : http://127.0.0.1:${port} · protégée par DASHBOARD_API_TOKEN.`);
  }, () => {});
  return service;
}

module.exports = { createLocalBotApi };
