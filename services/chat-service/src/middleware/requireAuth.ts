import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, extractBearerToken } from '@streaming/auth-shared';
import type { AccessTokenClaims } from '@streaming/shared-types';
import { env } from '../env';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AccessTokenClaims;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'missing_token' });
  }
  try {
    req.user = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}
