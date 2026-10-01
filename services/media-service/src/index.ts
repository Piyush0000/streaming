import http from 'http';
import { env } from './env';
import { logger } from './logger';
import { app } from './app';
import { createMediaWsServer } from './ws';

async function main() {
  const httpServer = http.createServer(app);
  createMediaWsServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`media-service listening on :${env.PORT} (announced IP: ${env.MEDIASOUP_ANNOUNCED_IP})`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
