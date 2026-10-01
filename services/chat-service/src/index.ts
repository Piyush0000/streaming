import path from 'path';
import http from 'http';
import { runMigrations } from '@streaming/db-migrate';
import { env } from './env';
import { logger } from './logger';
import { pool } from './db';
import { app } from './app';
import { createSocketServer } from './socket';

async function main() {
  await runMigrations(pool, path.join(__dirname, '..', 'migrations'), 'chat-service');

  const httpServer = http.createServer(app);
  createSocketServer(httpServer);

  httpServer.listen(env.PORT, () => {
    logger.info(`chat-service listening on :${env.PORT}`);
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
