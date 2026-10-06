#!/usr/bin/env bash
# Deploy one commit of this repo to the production VPS: build, switch over, wait
# until every service reports ready, and roll back automatically if it doesn't.
#
#   infra/deploy/deploy.sh <commit-sha | origin/main>
#
# Normally started by CI through a restricted SSH key whose forced command is
# /usr/local/bin/streaming-deploy (which only accepts "deploy <40-hex sha>").
# Safe to run by hand on the server too.
#
# Exit codes: 0 deployed | 1 failed and rolled back cleanly | 2 failed and the
# rollback is NOT healthy (needs a human) | 3 refused / bad usage.
#
# Environment knobs (manual runs only; CI cannot set them):
#   HEALTH_TIMEOUT=120            seconds to wait for the new version to become ready
#   ROLLBACK_HEALTH_TIMEOUT=180   seconds to wait for the rollback to become ready
#   STABLE_SECONDS=10             all services must then stay up, without restarts, this long
set -Eeuo pipefail

# `git reset --hard` below rewrites this very file, so run from a private copy.
if [[ -z "${STREAMING_DEPLOY_COPY:-}" ]]; then
  self_copy="$(mktemp /tmp/streaming-deploy.XXXXXX)"
  cp "${BASH_SOURCE[0]}" "$self_copy"
  STREAMING_DEPLOY_COPY="$self_copy" exec bash "$self_copy" "$@"
fi
trap 'rm -f "$STREAMING_DEPLOY_COPY"' EXIT

APP_DIR=/var/www/streaming
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
ROLLBACK_HEALTH_TIMEOUT="${ROLLBACK_HEALTH_TIMEOUT:-180}"
STABLE_SECONDS="${STABLE_SECONDS:-10}"
SERVICES=(auth-service api-service chat-service media-service gateway)

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "REFUSED: $*"; exit 3; }

cd "$APP_DIR"
exec 9>/var/lock/streaming-deploy.lock
flock -n 9 || die "another deploy is already running"

TARGET="${1:-}"
[[ -n "$TARGET" ]] || die "usage: deploy.sh <commit-sha | origin/main>"
[[ -f "$APP_DIR/.env" ]] || die "$APP_DIR/.env is missing (it is never deployed from git)"

export REGISTRY_PREFIX=""   # prod compose references it; it is unused on this host
COMPOSE=(docker compose --env-file "$APP_DIR/.env" -f "$APP_DIR/infra/docker-compose.prod.yml")

env_value() { grep -E "^$1=" "$APP_DIR/.env" | tail -1 | cut -d= -f2- || true; }
AUTH_PORT="$(env_value AUTH_SERVICE_PORT)";   AUTH_PORT="${AUTH_PORT:-4001}"
API_PORT="$(env_value API_SERVICE_PORT)";     API_PORT="${API_PORT:-4002}"
CHAT_PORT="$(env_value CHAT_SERVICE_PORT)";   CHAT_PORT="${CHAT_PORT:-4003}"
MEDIA_PORT="$(env_value MEDIA_SERVICE_PORT)"; MEDIA_PORT="${MEDIA_PORT:-4004}"

git fetch --quiet --prune origin main
NEW_SHA="$(git rev-parse --verify --quiet "${TARGET}^{commit}")" || die "unknown commit: $TARGET"
git merge-base --is-ancestor "$NEW_SHA" origin/main || die "$NEW_SHA is not on origin/main"
OLD_SHA="$(git rev-parse HEAD)"
NEW_TAG="${NEW_SHA:0:12}"
log "deploying ${NEW_SHA:0:12} (currently checked out: ${OLD_SHA:0:12})"

# --- helpers -----------------------------------------------------------------

gateway_id() { "${COMPOSE[@]}" ps -q gateway 2>/dev/null | head -1; }

ready() { # <service> <port>
  docker exec "$GW" wget -qO- -T 3 "http://$1:$2/readyz" 2>/dev/null | grep -q '"status":"ready"'
}

snapshot_state() { # prints "<running>|<restarts>" per service, for the stability check
  local s id
  for s in "${SERVICES[@]}"; do
    id="$("${COMPOSE[@]}" ps -q "$s" 2>/dev/null | head -1)"
    [[ -n "$id" ]] || { echo "$s|missing"; continue; }
    docker inspect -f '{{.Name}}|{{.State.Running}}|{{.RestartCount}}' "$id"
  done
}

wait_healthy() { # <timeout-seconds>
  local deadline=$(( $(date +%s) + $1 )) before after
  while :; do
    GW="$(gateway_id)"
    if [[ -n "$GW" ]] \
       && ready auth-service "$AUTH_PORT" && ready api-service "$API_PORT" \
       && ready chat-service "$CHAT_PORT" && ready media-service "$MEDIA_PORT" \
       && docker exec "$GW" wget -qO- -T 3 http://127.0.0.1:8080/ >/dev/null 2>&1; then
      before="$(snapshot_state)"
      sleep "$STABLE_SECONDS"
      after="$(snapshot_state)"
      if [[ "$before" == "$after" ]] && ! grep -qE '\|(false|missing)' <<<"$after"; then
        return 0
      fi
      log "services were ready but unstable (restart/exit detected) - still waiting"
    fi
    (( $(date +%s) < deadline )) || return 1
    sleep 3
  done
}

# Docker runs one docker-proxy per published port (101 ports x tcp/udp x v4/v6),
# and they release slowly after a container is removed. Recreating media-service
# before they are gone fails with "address already in use" no matter how often
# it is retried, so wait for the whole range to be free first.
media_ports_in_use() {
  ss -H -lntu 2>/dev/null | awk '{print $5}' | grep -cE ':(410[0-9]{2}|41100)$' || true
}

wait_media_ports_free() { # [timeout-seconds]
  local deadline=$((SECONDS + ${1:-90})) n
  while :; do
    n="$(media_ports_in_use)"
    [[ "${n:-0}" -eq 0 ]] && return 0
    if (( SECONDS >= deadline )); then
      log "media ports still in use after wait ($n listeners)"
      return 1
    fi
    sleep 2
  done
}

bring_up() { # <image-tag> [extra `up` flags...]
  local tag="$1" attempt; shift
  # If the media-service image is changing, stop the old container first and let
  # its ports drain, instead of racing the recreate against them.
  local running_img target_img
  running_img="$(docker inspect -f '{{.Image}}' infra-media-service-1 2>/dev/null || true)"
  target_img="$(docker image inspect -f '{{.Id}}' "media-service:$tag" 2>/dev/null || true)"
  if [[ -n "$running_img" && -n "$target_img" && "$running_img" != "$target_img" ]]; then
    log "media-service image changed: stopping it so its ports drain before recreate"
    IMAGE_TAG="$tag" "${COMPOSE[@]}" rm -sf media-service >/dev/null 2>&1 || true
    wait_media_ports_free 90 || true
  fi
  for attempt in 1 2 3; do
    if IMAGE_TAG="$tag" "${COMPOSE[@]}" up -d "$@" >/tmp/streaming-up.log 2>&1; then
      return 0
    fi
    cat /tmp/streaming-up.log
    if grep -q "address already in use" /tmp/streaming-up.log; then
      # Docker occasionally keeps a stale binding for media-service's big
      # UDP/TCP port range after a recreate. Removing the container clears it.
      log "port-bind race (attempt $attempt/3): recreating media-service"
      IMAGE_TAG="$tag" "${COMPOSE[@]}" rm -sf media-service >/dev/null 2>&1 || true
      wait_media_ports_free 90 || true
    fi
    sleep 4
  done
  return 1
}

snapshot_prev_images() {
  local s src
  for s in "${SERVICES[@]}"; do
    src=""
    if docker image inspect "$s:current" >/dev/null 2>&1; then src="$s:current"
    elif docker image inspect "$s:latest" >/dev/null 2>&1; then src="$s:latest"
    fi
    [[ -z "$src" ]] || docker tag "$src" "$s:prev"
  done
}

have_prev_images() {
  local s
  for s in "${SERVICES[@]}"; do docker image inspect "$s:prev" >/dev/null 2>&1 || return 1; done
}

rollback() {
  log "ROLLING BACK to ${OLD_SHA:0:12}"
  # Restore the old checkout FIRST so the old images run with the old compose
  # file (a failed release may have changed env vars, ports or volumes).
  git reset --hard --quiet "$OLD_SHA"
  if have_prev_images; then
    bring_up prev --no-build || true
  else
    log "no previous images saved; rebuilding ${OLD_SHA:0:12}"
    IMAGE_TAG=rollback "${COMPOSE[@]}" build && bring_up rollback || true
  fi
  if wait_healthy "$ROLLBACK_HEALTH_TIMEOUT"; then
    log "rollback healthy: running the previous version again. DEPLOY OF ${NEW_SHA:0:12} FAILED."
    exit 1
  fi
  log "!!! rollback is NOT healthy - manual intervention needed (docker compose -f infra/docker-compose.prod.yml ps / logs)"
  exit 2
}

# --- deploy --------------------------------------------------------------------

snapshot_prev_images
git reset --hard --quiet "$NEW_SHA"

log "building images tagged $NEW_TAG (running containers are untouched until this succeeds)"
if ! IMAGE_TAG="$NEW_TAG" "${COMPOSE[@]}" build; then
  git reset --hard --quiet "$OLD_SHA"
  log "BUILD FAILED - nothing was changed; the running version is still serving."
  exit 1
fi

log "switching over"
if ! bring_up "$NEW_TAG"; then
  log "could not start the new containers"
  rollback
fi

log "waiting up to ${HEALTH_TIMEOUT}s for every service to be ready and stable"
if ! wait_healthy "$HEALTH_TIMEOUT"; then
  log "new version did not become healthy. Recent app logs (health probes and postgres/redis noise filtered out):"
  "${COMPOSE[@]}" logs --no-color --tail 40 auth-service api-service chat-service media-service gateway 2>&1 \
    | grep -v '"url":"/readyz"' | tail -60 || true
  rollback
fi

for s in "${SERVICES[@]}"; do
  docker tag "$s:$NEW_TAG" "$s:current"
  docker tag "$s:$NEW_TAG" "$s:latest"   # so a manual `docker compose up` runs this build
done
# keep only this build and the previous one; drop older sha-tagged images
for s in "${SERVICES[@]}"; do
  docker images "$s" --format '{{.Tag}}' | grep -E '^[0-9a-f]{12}$' \
    | grep -vxF -e "$NEW_TAG" -e "${OLD_SHA:0:12}" \
    | xargs -r -I{} docker rmi "$s:{}" >/dev/null 2>&1 || true
done
docker image prune -f >/dev/null 2>&1 || true
docker builder prune -f --filter "until=72h" >/dev/null 2>&1 || true   # bound build-cache growth on the shared disk

log "DEPLOYED ${NEW_SHA:0:12} (was ${OLD_SHA:0:12}) - all services ready and stable"
