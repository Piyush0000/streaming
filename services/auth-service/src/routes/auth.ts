import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '@streaming/auth-shared';
import { pool } from '../db';
import { env } from '../env';
import { logger } from '../logger';

export const authRouter = Router();

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

const signupSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(1),
});

/** Formats zod issues into a human-readable "field: message" list so API
 * consumers (and anyone staring at a failed request) know exactly which
 * field was wrong and why, instead of a bare "invalid_input". */
function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueTokenPair(user: { id: string; username: string; email: string }) {
  const jti = uuidv4();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const refreshToken = signRefreshToken({ sub: user.id, jti }, env.JWT_REFRESH_SECRET, env.REFRESH_TOKEN_TTL_DAYS);

  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [jti, user.id, hashToken(refreshToken), expiresAt]
  );

  const accessToken = signAccessToken(
    { sub: user.id, username: user.username, email: user.email },
    env.JWT_ACCESS_SECRET,
    env.ACCESS_TOKEN_TTL
  );

  return { accessToken, refreshToken };
}

authRouter.post('/signup', async (req: Request, res: Response) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_input', message: formatIssues(parsed.error).join('; '), details: parsed.error.issues });
  }
  const { username, email, password } = parsed.data;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, username, email, created_at`,
      [username, email, passwordHash]
    );
    const user = rows[0];
    const tokens = await issueTokenPair(user);
    return res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email, createdAt: user.created_at },
      ...tokens,
    });
  } catch (err: any) {
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'username_or_email_taken' });
    }
    logger.error({ err }, 'signup failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_input', message: formatIssues(parsed.error).join('; '), details: parsed.error.issues });
  }
  const { email, password } = parsed.data;

  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, password_hash FROM users WHERE email = $1`,
      [email]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    const tokens = await issueTokenPair(user);
    return res.json({
      user: { id: user.id, username: user.username, email: user.email },
      ...tokens,
    });
  } catch (err) {
    logger.error({ err }, 'login failed');
    return res.status(500).json({ error: 'internal_error' });
  }
});

authRouter.post('/google', async (req: Request, res: Response) => {
  const parsed = googleAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_input', message: formatIssues(parsed.error).join('; '), details: parsed.error.issues });
  }
  const { idToken } = parsed.data;

  try {
    // Never trust client-supplied email/name — only the verified payload
    // from Google counts. The idToken itself is the only thing we accept
    // from the client; everything else is derived from it.
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      return res.status(401).json({ error: 'invalid_google_token' });
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name;
    const avatarUrl = payload.picture ?? null;

    // Find by google_id first, then fall back to email — this links the
    // Google identity to an existing password-auth account instead of
    // erroring out or creating a duplicate user.
    let { rows } = await pool.query(
      `SELECT id, username, email FROM users WHERE google_id = $1`,
      [googleId]
    );
    let user = rows[0];

    if (!user) {
      ({ rows } = await pool.query(
        `SELECT id, username, email FROM users WHERE email = $1`,
        [email]
      ));
      user = rows[0];

      if (user) {
        await pool.query(
          `UPDATE users SET google_id = $1, avatar_url = COALESCE($2, avatar_url) WHERE id = $3`,
          [googleId, avatarUrl, user.id]
        );
      }
    }

    if (!user) {
      let username = (name ?? email.split('@')[0]).trim().replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 32) || 'user';
      if (username.length < 3) username = username.padEnd(3, '0');

      // Handle username collisions with a short random suffix.
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = attempt === 0 ? username : `${username.slice(0, 25)}_${crypto.randomBytes(3).toString('hex')}`;
        try {
          const { rows: inserted } = await pool.query(
            `INSERT INTO users (username, email, password_hash, google_id, avatar_url)
             VALUES ($1, $2, NULL, $3, $4)
             RETURNING id, username, email`,
            [candidate, email, googleId, avatarUrl]
          );
          user = inserted[0];
          break;
        } catch (err: any) {
          if (err?.code === '23505' && attempt < 4) continue;
          throw err;
        }
      }
    }

    if (!user) {
      return res.status(500).json({ error: 'internal_error' });
    }

    const tokens = await issueTokenPair(user);
    return res.json({
      user: { id: user.id, username: user.username, email: user.email },
      ...tokens,
    });
  } catch (err) {
    logger.error({ err }, 'google auth failed');
    return res.status(401).json({ error: 'invalid_google_token' });
  }
});

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_input', message: formatIssues(parsed.error).join('; '), details: parsed.error.issues });
  }
  const { refreshToken } = parsed.data;

  try {
    const claims = verifyRefreshToken(refreshToken, env.JWT_REFRESH_SECRET);
    const { rows } = await pool.query(
      `SELECT rt.id, rt.user_id, rt.token_hash, rt.revoked_at, rt.expires_at,
              u.username, u.email
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.id = $1`,
      [claims.jti]
    );
    const row = rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }
    if (hashToken(refreshToken) !== row.token_hash) {
      return res.status(401).json({ error: 'invalid_refresh_token' });
    }

    // Rotate: revoke the old row, issue a brand-new pair.
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);

    const tokens = await issueTokenPair({ id: row.user_id, username: row.username, email: row.email });
    return res.json(tokens);
  } catch (err) {
    logger.warn({ err }, 'refresh rejected');
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'invalid_input', message: formatIssues(parsed.error).join('; '), details: parsed.error.issues });
  }
  try {
    const claims = verifyRefreshToken(parsed.data.refreshToken, env.JWT_REFRESH_SECRET);
    await pool.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [claims.jti]);
    return res.status(204).send();
  } catch {
    // Already invalid/expired — logout is idempotent either way.
    return res.status(204).send();
  }
});
