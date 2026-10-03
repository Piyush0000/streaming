import { z, ZodTypeAny } from 'zod';

/**
 * Validates `process.env` (or a supplied source) against a zod schema.
 *
 * Hard requirement: if a required env var is missing/invalid, this throws a
 * clear, readable error and the process exits(1) immediately. No service may
 * silently start with undefined config.
 */
export function loadConfig<T extends ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`
    );
    // eslint-disable-next-line no-console
    console.error(
      `\n[config] FATAL: invalid/missing environment configuration.\n${lines.join('\n')}\n`
    );
    process.exit(1);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Common env fragments reused by every service.
// ---------------------------------------------------------------------------

export const commonEnvSchema = {
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive(),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 chars'),
};

export const postgresEnvSchema = {
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres connection string'),
};

export const redisEnvSchema = {
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
};

/** Treats an empty string (e.g. `VAR=` or compose `${VAR:-}`) as "unset". */
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

/** Shared secret for service-to-service calls to api-service's /internal routes. */
export const internalApiEnvSchema = {
  INTERNAL_API_SECRET: z.string().min(16, 'INTERNAL_API_SECRET must be at least 16 chars'),
};

/** How chat-service / media-service reach api-service's internal endpoints. */
export const apiClientEnvSchema = {
  ...internalApiEnvSchema,
  API_SERVICE_INTERNAL_URL: z.preprocess(
    emptyToUndefined,
    z.string().url('API_SERVICE_INTERNAL_URL must be a URL').default('http://api-service:4002')
  ),
};

/** Live-stream hosting rules + the optional Elonix (LR21) premium bridge. */
export const streamEnvSchema = {
  STREAM_MIN_FOLLOWERS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().nonnegative().default(500)
  ),
  // Comma-separated emails -> lowercased, trimmed, de-blanked array.
  STREAM_ADMIN_EMAILS: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .default('')
      .transform((s) =>
        s
          .split(',')
          .map((e) => e.trim().toLowerCase())
          .filter(Boolean)
      )
  ),
  LR21_BRIDGE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url('LR21_BRIDGE_URL must be a URL').optional()
  ),
  LR21_BRIDGE_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
};

/** Positive integer env var with a default; empty/unset -> default, invalid -> fatal at startup. */
function intEnv(name: string, def: number, min = 1, max = 100_000) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ invalid_type_error: `${name} must be a number` })
      .int(`${name} must be an integer`)
      .min(min, `${name} must be >= ${min}`)
      .max(max, `${name} must be <= ${max}`)
      .default(def)
  );
}

/** Platform-wide room / membership capacity limits (protects the shared 4-CPU host). */
export const roomLimitsEnvSchema = {
  /** Upper bound for a voice channel's owner-settable maxParticipants; also the default when unset. */
  VOICE_ROOM_MAX_PEERS: intEnv('VOICE_ROOM_MAX_PEERS', 25, 2, 1000),
  /** Max unique users in a live stream room (host + platform admins always allowed). */
  STREAM_ROOM_MAX_PEERS: intEnv('STREAM_ROOM_MAX_PEERS', 150, 2, 10_000),
  /** Max members of a private channel. */
  PRIVATE_CHANNEL_MAX_MEMBERS: intEnv('PRIVATE_CHANNEL_MAX_MEMBERS', 200, 2, 100_000),
};

/** chat-service rate limiting (Redis counters; fails open if Redis is down). */
export const chatRateLimitEnvSchema = {
  CHAT_RATE_LIMIT_MESSAGES: intEnv('CHAT_RATE_LIMIT_MESSAGES', 10, 1, 10_000),
  CHAT_RATE_LIMIT_WINDOW_SEC: intEnv('CHAT_RATE_LIMIT_WINDOW_SEC', 10, 1, 3600),
  /** Max file uploads per user per minute. */
  UPLOAD_RATE_LIMIT_PER_MINUTE: intEnv('UPLOAD_RATE_LIMIT_PER_MINUTE', 5, 1, 1000),
};

/** media-service: how long a listener must wait after a denied speak request. */
export const speakRequestEnvSchema = {
  SPEAK_REQUEST_COOLDOWN_SEC: intEnv('SPEAK_REQUEST_COOLDOWN_SEC', 10, 0, 3600),
};

export const authServiceEnvSchema = z.object({
  ...commonEnvSchema,
  ...postgresEnvSchema,
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
});
export type AuthServiceEnv = z.infer<typeof authServiceEnvSchema>;

export const apiServiceEnvSchema = z.object({
  ...commonEnvSchema,
  ...postgresEnvSchema,
  ...redisEnvSchema, // publishes stream events (pub/sub)
  ...internalApiEnvSchema,
  ...streamEnvSchema,
  ...roomLimitsEnvSchema,
});
export type ApiServiceEnv = z.infer<typeof apiServiceEnvSchema>;

export const chatServiceEnvSchema = z.object({
  ...commonEnvSchema,
  ...postgresEnvSchema,
  ...redisEnvSchema,
  ...apiClientEnvSchema,
  ...chatRateLimitEnvSchema,
});
export type ChatServiceEnv = z.infer<typeof chatServiceEnvSchema>;

export const mediaServiceEnvSchema = z.object({
  ...commonEnvSchema,
  ...redisEnvSchema,
  ...apiClientEnvSchema,
  VOICE_ROOM_MAX_PEERS: roomLimitsEnvSchema.VOICE_ROOM_MAX_PEERS,
  ...speakRequestEnvSchema,
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_ANNOUNCED_IP: z.string().min(1, 'MEDIASOUP_ANNOUNCED_IP is required'),
  MEDIASOUP_MIN_PORT: z.coerce.number().int().positive().default(40000),
  MEDIASOUP_MAX_PORT: z.coerce.number().int().positive().default(40100),
});
export type MediaServiceEnv = z.infer<typeof mediaServiceEnvSchema>;

export { z };
