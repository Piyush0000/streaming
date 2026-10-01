import path from 'path';
import { runMigrations } from '@streaming/db-migrate';
import { env } from './env';
import { logger } from './logger';
import { pool } from './db';
import { app } from './app';

async function main() {
  await runMigrations(pool, path.join(__dirname, '..', 'migrations'), 'auth-service');

  const server = app.listen(env.PORT, () => {
    logger.info(`auth-service listening on :${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});
