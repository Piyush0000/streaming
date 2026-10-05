import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { logger } from './logger';
import { pingDb } from './db';
import { pingRedis } from './redis';
import { channelsRouter } from './routes/channels';
import { channelInvitesRouter, invitesRouter } from './routes/invites';
import { guidelinesRouter } from './routes/guidelines';
import { streamsRouter } from './routes/streams';
import { usersRouter } from './routes/users';
import { hubRouter } from './routes/hub';
import { profilesRouter } from './routes/profiles';
import { marketRouter } from './routes/market';
import { paperRouter } from './routes/paper';
import { internalRouter } from './routes/internal';

export const app = express();

app.use(cors());
app.use(express.json());
app.use(pinoHttp({ logger }));

app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

app.get('/readyz', async (_req, res) => {
  try {
    await pingDb();
  } catch (err) {
    logger.error({ err }, 'readyz: postgres check failed');
    return res.status(503).json({ status: 'not_ready', failing: 'postgres' });
  }
  try {
    await pingRedis();
  } catch (err) {
    logger.error({ err }, 'readyz: redis check failed');
    return res.status(503).json({ status: 'not_ready', failing: 'redis' });
  }
  res.status(200).json({ status: 'ready' });
});

app.use('/channels', channelsRouter);
app.use('/channels', channelInvitesRouter);
app.use('/invites', invitesRouter);
app.use('/guidelines', guidelinesRouter);
app.use('/streams', streamsRouter);
app.use('/users', profilesRouter);
app.use('/users', usersRouter);
app.use('/hub', hubRouter);
// Public market data (Binance tickers + Elonix signals); per-IP rate limited inside the router.
app.use('/market', marketRouter);
// Paper trading (virtual funds, real prices); auth + rate limits inside the router.
app.use('/paper', paperRouter);
// Service-to-service only; guarded by x-internal-secret and NOT proxied by the gateway.
app.use('/internal', internalRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'unhandled error');
  res.status(500).json({ error: 'internal_error' });
});
