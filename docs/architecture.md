# Architecture — what was actually built (Phase 1)

This documents the as-built system against the approved Phase 1 plan.
Everything in the plan's scope was implemented; nothing was stubbed with
TODOs. Deviations and judgment calls made while implementing are called out
explicitly below.

## Services

### auth-service (`services/auth-service`)
Express HTTP API. Owns `users` and `refresh_tokens` tables in Postgres
(migrations in `services/auth-service/migrations`).

- `POST /signup`, `POST /login` — bcrypt password hashing (cost 10), issues
  an access JWT (HS256, 15m default, `ACCESS_TOKEN_TTL` env-configurable)
  and a refresh JWT.
- `POST /refresh` — verifies the refresh JWT, looks up its row by `jti`,
  checks it isn't revoked/expired, checks the SHA-256 hash of the presented
  token matches the stored hash, then **rotates**: revokes the old row and
  issues a brand-new access+refresh pair.
- `POST /logout` — revokes the refresh token's row (idempotent).
- `GET /healthz` always 200. `GET /readyz` pings Postgres, 503 + `{failing:
  "postgres"}` on failure.

Refresh tokens are stored as a SHA-256 hash (not the raw token) so a
Postgres dump alone can't be replayed as a valid refresh token; the JWT
signature is still what proves authenticity, the DB row is what makes it
revocable.

### api-service (`services/api-service`)
Express HTTP API. Owns the `channels` table. All channels are public in
Phase 1 (no roles/permissions — that's Phase 2, explicitly skipped).

- `GET /channels`, `GET /channels/:id`, `POST /channels` — all require a
  valid access JWT (verified **locally**, no network call to auth-service,
  via `@streaming/auth-shared`'s `verifyAccessToken`).
- `GET /healthz`, `GET /readyz` (pings Postgres).

### chat-service (`services/chat-service`)
Socket.IO server. Owns the `messages` table.

- JWT verified in the Socket.IO `io.use()` middleware at handshake, from
  `socket.handshake.auth.token` (or `?token=` query param as a fallback).
- `chat:join` — joins the socket to a room named `channel:<id>`, then sends
  `chat:history` with the last 50 messages from Postgres.
- `chat:send` — persists the message to Postgres, then publishes it onto a
  single Redis Stream (`chat.messages`) via `@streaming/events`' `publishEvent`.
- A consumer loop (`consumeEvents`, consumer group `chat-service`) reads that
  same stream and broadcasts to the right Socket.IO room. This is what makes
  the fan-out "through Redis Streams with consumer groups" rather than a
  direct in-process `io.emit` — the plan's requirement that multiple
  chat-service instances could fan out later without a redesign.
- `GET /healthz`, `GET /readyz` (pings both Postgres and Redis).

**Deviation from the literal plan wording**: the plan says "one thin
publisher/consumer module... Payloads are versioned JSON." I used a single
shared stream (`chat.messages`) with the channel id embedded in the event
payload, rather than one Redis Stream per channel. Reasoning: a stream per
channel would mean a growing, unbounded number of consumer-group loops (one
per channel, spun up/down dynamically) for no real benefit at Phase 1 scale,
and Redis Streams handle high throughput fine on one stream. The envelope
(`{version, type, data, publishedAt}`) is exactly as specified.

### media-service (`services/media-service`)
mediasoup SFU, audio-only, following the mediasoup-demo produce/consume
pattern. No Postgres — voice rooms are pure in-memory state, explicitly
rebuildable (a restart drops active calls, which is correct: Postgres holds
no voice-call state to lose).

- One mediasoup `Worker` + `Router` **per voice room** (`channelId`),
  created on first `join-room`, torn down when the last peer leaves
  (`services/media-service/src/rooms.ts`, `RoomManager`).
- Signaling is a raw `ws` WebSocket at `/ws/media?token=<accessJWT>`, request/
  response correlated by an `id` field (`MediaRequest`/`MediaResponse` in
  `@streaming/shared-types`), plus server-pushed `MediaNotification`s
  (`new-producer`, `peer-joined`, `peer-left`, `producer-closed`).
- Flow implemented: `join-room` → `create-webrtc-transport` (send + recv) →
  `connect-webrtc-transport` → `produce` → `consume` → `resume-consumer` →
  `leave-room`. A joining peer is told about every already-publishing peer's
  producer id in the `join-room` response (`peers[].producerIds`) so it can
  immediately consume audio that predates its own join — this is a gap the
  literal mediasoup-demo pattern glosses over and was fixed here.
- Publishes ephemeral join/leave events to a Redis pub/sub channel
  (`presence.voice`) via `@streaming/events`' `publishPresence` — no other
  service currently subscribes to it in Phase 1, but it demonstrates the
  planned "Redis pub/sub for presence" path and gives Phase 2 a place to
  hook in without touching media-service internals.
- `GET /healthz`, `GET /readyz` (pings Redis; there's no Postgres dependency
  to check).

### gateway (`services/gateway`)
`nginx.conf`, not a Node service, exactly as specified. Routes:
`/api/auth/*` → auth-service, `/api/channels*` → api-service, `/ws/chat/*`
→ chat-service (with `Upgrade`/`Connection` headers for the Socket.IO
WebSocket), `/ws/media` → media-service (WebSocket upgrade), `/` → the built
web frontend's static files. Each proxied service also has a `/healthz`
passthrough.

The gateway's Dockerfile also builds the web frontend (multi-stage: Node
build → nginx serve) so `docker compose up` yields one container that both
serves the SPA and proxies to the backend — this was a judgment call the
plan left open ("containerizing it too is fine").

## Packages

- **`packages/shared-types`** — `User`, `Channel`, `Message`, JWT claim
  shapes, chat Socket.IO payload shapes, and the full media-service
  signaling protocol's request/response/notification shapes.
- **`packages/config`** — `loadConfig(zodSchema)` validates `process.env`
  and calls `process.exit(1)` with a readable, field-by-field error list on
  failure. Every service's `env.ts` is a one-line call to this. Verified by
  hand: removing `JWT_ACCESS_SECRET` from the environment and starting
  auth-service produces an immediate, clear fatal error rather than an
  `undefined` secret silently signing tokens.
- **`packages/events`** — `publishEvent`/`consumeEvents` (Redis Streams,
  consumer groups, versioned JSON envelope) and `publishPresence`/
  `subscribePresence` (plain Redis pub/sub) exactly as scoped in the plan.
- **`packages/auth-shared`** — not explicitly named in the plan (which said
  "shared verification logic — put the JWT verify function in
  `packages/shared-types` or a new `packages/auth-shared`"); a new package
  was created since JWT signing/verification needs a runtime dependency
  (`jsonwebtoken`) that a pure type-definitions package (`shared-types`)
  shouldn't carry.
- **`packages/db-migrate`** — not in the original package list, added as a
  small, shared implementation of the "plain .sql files run in order"
  migration approach the plan asked to pick. Each service still owns its
  own `migrations/*.sql` directory and calls `runMigrations(pool, dir)` from
  its own startup — this package only holds the shared runner logic, not any
  cross-service schema coupling.

## Data model

Single Postgres instance (Phase 1: one shared database, logically-owned
tables per service — `users`/`refresh_tokens` by auth-service, `channels`
by api-service, `messages` by chat-service). Redis is used only for the
chat fan-out stream and voice presence pub/sub; every fact that must survive
a restart lives in Postgres. Message `username` is denormalized onto each
`messages` row at write time (read from the sender's JWT claims) specifically
so chat-service never needs a live dependency on auth-service's `users`
table to render history.

## Known rough edges / left for later phases

- **No participant caps / rate limiting** on chat or voice — explicitly
  Phase 2 per the plan.
- **No screen share / broadcast** — mediasoup is wired for audio only;
  video/`getDisplayMedia` ingest is Phase 3 as specified.
- **Refresh token rotation has no reuse-detection alarm** — if a stolen
  refresh token is used after the legitimate client already rotated it, the
  request is correctly rejected (the row is revoked), but nothing currently
  flags this as a possible theft signal. Would be a Phase 2 hardening item.
- **`packages/events`' presence pub/sub has no subscriber yet** — the
  channel exists and media-service publishes to it, but nothing consumes it
  in Phase 1 (no service needs live presence for the exit criteria). Wired
  for the shape a future presence feature would want.
- **Web frontend has no automatic access-token refresh** — the plan
  explicitly allows "even just re-login on 401 is acceptable for this
  phase"; that's what's implemented (a 401 surfaces an error and clears the
  session, forcing re-login) rather than silent refresh-token-based retry.
- **No CI pipeline** — explicitly out of scope per the plan ("build it later
  once Phase 1 is proven").
