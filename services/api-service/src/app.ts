import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { pingDb } from './db';
import { channelsRouter } from './routes/channels';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

app.get('/readyz', async (_req, res) => {
  try {
    await pingDb();
    res.status(200).json({ status: 'ready' });
  } catch (err) {
    logger.error({ err }, 'readyz check failed');
    res.status(503).json({ status: 'not_ready', failing: 'postgres' });
  }
});

app.use('/channels', channelsRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal_error' });
});
