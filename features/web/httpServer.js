'use strict';

const http = require('node:http');

function createHttpService({ client, handleRequest, logger = console, env = process.env }) {
  const port = Number(env.SERVER_PORT || env.PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Le port HTTP configuré est invalide.');
  const server = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ status: 'ok', discord: client.isReady() ? 'online' : 'starting' }));
      return;
    }
    Promise.resolve().then(() => handleRequest(request, response)).catch(() => {
      logger.error?.('[web] Impossible de traiter la requête HTTP.');
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      if (!response.writableEnded) response.end('Internal server error');
    });
  });
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      logger.info?.(`[web] Serveur HTTP prêt sur le port ${server.address().port}.`);
      resolve(server.address());
    });
  });
  server.on('error', () => logger.error?.('[web] Impossible d’ouvrir ou de maintenir le serveur HTTP.'));
  // Le propriétaire du service peut attendre ready; cette branche protège aussi le démarrage du bot.
  ready.catch(() => {});
  return { server, ready, close: () => new Promise((resolve) => server.close(resolve)) };
}

module.exports = { createHttpService };
