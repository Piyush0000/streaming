# RUNBOOK — running and verifying Phase 1 locally

## 1. Start everything

```bash
cd D:\streaming
cp .env.example .env
# Optional: edit MEDIASOUP_ANNOUNCED_IP in .env if you'll test from a second
# device on your LAN rather than the same machine as Docker (127.0.0.1 works
# fine for same-machine browser testing).

docker compose --env-file .env -f infra/docker-compose.dev.yml up --build
```

First build takes a few minutes (media-service compiles mediasoup's native
worker from source). Wait for log lines like:

```
auth-service listening on :4001
api-service listening on :4002
chat-service listening on :4003
media-service listening on :4004 (announced IP: 127.0.0.1)
```

Then open **http://localhost:8080** — that's the nginx gateway serving the
web frontend and proxying `/api/*` and `/ws/*` to the services above.

## 2. Sanity-check health/readiness

```bash
curl http://localhost:8080/api/auth/healthz
curl http://localhost:8080/api/channels/healthz
curl http://localhost:8080/ws/chat/healthz
curl http://localhost:8080/ws/media/healthz
```

Each should return `{"status":"ok"}`. For readiness (actually pings
Postgres/Redis):

```bash
curl http://localhost:4001/readyz   # auth-service, direct port
curl http://localhost:4002/readyz   # api-service
curl http://localhost:4003/readyz   # chat-service (pings Postgres + Redis)
curl http://localhost:4004/readyz   # media-service (pings Redis)
```

To see a `readyz` failure on purpose: `docker compose -f infra/docker-compose.dev.yml stop postgres`,
re-curl `4001/readyz` or `4002/readyz` — expect HTTP 503 with
`{"status":"not_ready","failing":"postgres"}`. Start postgres back up
(`docker compose ... start postgres`) before continuing.

## 3. Exit criteria: two sessions chatting in real time

1. Open `http://localhost:8080` in two different browser sessions (e.g. one
   normal window, one incognito/private window — Socket.IO sessions are
   independent so two tabs of the same window also work, just use different
   accounts).
2. In session A: sign up as `alice` / `alice@example.com` / a password 8+
   chars. You'll land on the empty channel list — create a channel (e.g.
   `general`).
3. In session B: sign up as `bob` / `bob@example.com` / any 8+ char
   password. The `general` channel should already be visible in the list
   (proves api-service + Postgres are shared and working) — click into it.
4. In session A, click into `general` too.
5. Type a message in session A's chat box, hit Send. **Verify**: it appears
   in session B's chat panel within ~1 second, without B reloading — proves
   the Socket.IO → Redis Streams → Socket.IO fan-out path.
6. Type a reply in session B. **Verify**: it appears in session A.
7. Reload session B's browser tab entirely, re-open `general`. **Verify**:
   both prior messages are still there (loaded from Postgres history, not
   just from the live socket) — this is the `chat:history` payload (last 50
   messages) sent on join.

## 4. Exit criteria: two sessions on voice, hearing each other

1. With both sessions still in `general`, click **Join Voice** in session A.
   Your browser will prompt for microphone permission — allow it.
2. Click **Join Voice** in session B too.
3. **Verify**: each session's Voice panel lists the other session's
   username, and you can hear the other session's microphone audio (test
   with two physical devices, or one device with headphones on one session
   to avoid feedback/echo).
4. Have one session mute their OS mic or step away and talk — confirm only
   that direction of audio is heard by the other.
5. Click **Leave Voice** in session A. **Verify**: session B's peer list
   updates to remove A (via the `peer-left` notification) and A's audio
   stops.

This exercises the full mediasoup flow: `join-room` (Worker+Router created
on first join) → `create-webrtc-transport` (send + recv) →
`connect-webrtc-transport` → `produce` → `consume` → `resume-consumer`.

## 5. Exit criteria: killing chat-service doesn't drop the voice call

1. With both sessions still connected to Voice (from step 4 above, rejoin if
   needed), run:

   ```bash
   docker compose -f infra/docker-compose.dev.yml stop chat-service
   ```

2. **Verify**: voice audio between the two sessions keeps working —
   media-service has no dependency on chat-service, so this is expected.
   The chat panel will start erroring/disconnecting (Socket.IO reconnect
   attempts) — that's expected too, and proves the services are properly
   decoupled rather than sharing a process.
3. Bring chat back:

   ```bash
   docker compose -f infra/docker-compose.dev.yml start chat-service
   ```

4. **Verify**: within a few seconds the chat panel reconnects (Socket.IO
   auto-reconnects) and sending a new message works again, and — reload the
   page to force a fresh `chat:join` — history is intact (it was never
   lost, since messages are in Postgres, not in chat-service's process
   memory).

## 6. Restart resilience (Postgres is the only source of truth)

```bash
docker compose -f infra/docker-compose.dev.yml restart auth-service api-service chat-service
```

**Verify**: users, the `general` channel, and all chat history are still
present after every service restarts — nothing was lost, because none of it
lived only in a service process or only in Redis.

## Troubleshooting

- **Voice connects but no audio**: almost always `MEDIASOUP_ANNOUNCED_IP` in
  `.env` doesn't match an IP your browser can actually reach the Docker host
  on. For same-machine testing, `127.0.0.1` is correct. For a second device
  on your LAN, set it to your host machine's LAN IP and restart
  `media-service`.
- **`docker compose build` fails on media-service**: it compiles mediasoup's
  native addon (needs `python3`, `make`, `g++`, handled inside the
  Dockerfile's build stage automatically) — if it fails, re-run with
  `docker compose ... build --no-cache media-service` and check the full
  log for the actual compiler error.
- **A service exits immediately with a `[config] FATAL:` message**: a
  required env var is missing/invalid — check `.env` against
  `.env.example`, and confirm `docker compose --env-file .env -f
  infra/docker-compose.dev.yml up` (not just `docker compose up`, which
  won't pick up the root `.env` from inside `infra/`).
