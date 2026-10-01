import pino from 'pino';
import { env } from './env';

export const logger = pino({
  name: 'media-service',
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
});
