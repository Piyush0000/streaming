import jwt from 'jsonwebtoken';
import type { AccessTokenClaims, RefreshTokenClaims } from '@streaming/shared-types';

/**
 * Signs a short-lived access JWT (HS256). Only auth-service calls this.
 */
export function signAccessToken(
  claims: Pick<AccessTokenClaims, 'sub' | 'username' | 'email'>,
  secret: string,
  ttl: string
): string {
  return jwt.sign({ ...claims, type: 'access' }, secret, {
    algorithm: 'HS256',
    expiresIn: ttl,
  } as jwt.SignOptions);
}

/**
 * Verifies an access JWT LOCALLY (no network call). Used by every service
 * that needs to authenticate a request/socket connection.
 */
export function verifyAccessToken(token: string, secret: string): AccessTokenClaims {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') {
    throw new Error('Malformed access token');
  }
  if (decoded.type !== 'access') {
    throw new Error('Not an access token');
  }
  return decoded as AccessTokenClaims;
}

export function signRefreshToken(
  claims: Pick<RefreshTokenClaims, 'sub' | 'jti'>,
  secret: string,
  ttlDays: number
): string {
  return jwt.sign({ ...claims, type: 'refresh' }, secret, {
    algorithm: 'HS256',
    expiresIn: `${ttlDays}d`,
  } as jwt.SignOptions);
}

export function verifyRefreshToken(token: string, secret: string): RefreshTokenClaims {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
  if (typeof decoded === 'string') {
    throw new Error('Malformed refresh token');
  }
  if (decoded.type !== 'refresh') {
    throw new Error('Not a refresh token');
  }
  return decoded as RefreshTokenClaims;
}

/** Extracts a bearer token from an `Authorization: Bearer xxx` header value. */
export function extractBearerToken(header: string | undefined | null): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
