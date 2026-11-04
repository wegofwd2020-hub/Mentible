#!/usr/bin/env bash
#
# Mentible prod backend refresh. Run as ROOT on the VPS (178.105.160.62).
#
# Swaps /opt/mentible to a pinned commit of the public repo, keeps the live
# .env.demo, rebuilds the backend image, runs migrations and checks the new
# containers are the ones serving. Rolls back automatically if anything fails
# after the swap. Runbook: Plans/PROD_BACKEND_REFRESH_TO_MAIN.md.
#
# Usage (both values are required, nothing is guessed):
#   sudo COMMIT=<40-char commit on main> \
#        EXPECTED_SHA=<sha256 of the commit archive> \
#        bash backend-refresh.sh
#
# The commit archive is downloaded from GitHub and must match EXPECTED_SHA
# before anything on the live stack changes.
set -euo pipefail

REPO="wegofwd2020-hub/Mentible"
COMMIT="${COMMIT:?set COMMIT to the 40-char commit on main to deploy}"
EXPECTED_SHA="${EXPECTED_SHA:?set EXPECTED_SHA to the sha256 of that commit archive}"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "COMMIT must be a full 40-char sha"; exit 1; }

ARCHIVE="/tmp/mentible-${COMMIT:0:7}.tgz"
LIVE=/opt/mentible
NEW=/opt/mentible-new
STAMP="$(date +%Y%m%d-%H%M%S)"
OLD="/opt/mentible-old-$STAMP"
FAILED="/opt/mentible-failed-$STAMP"
COMPOSE=(docker compose -f docker-compose.demo.yml --env-file .env.demo)
ALEMBIC=(alembic -c /app/backend/alembic.ini)
CONTAINERS=(mentible-api mentible-celery-worker mentible-celery-beat)
READYZ="http://127.0.0.1:8092/readyz"
SWAPPED=0

log() { printf '\n== %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

rollback() {
  local rc=$?
  if [ "$SWAPPED" -eq 1 ]; then
    log "FAILED (exit $rc) after swap: rolling back"
    cd /opt
    if [ -d "$LIVE" ]; then
      (cd "$LIVE" && "${COMPOSE[@]}" down) || true
      mv "$LIVE" "$FAILED"
    fi
    mv "$OLD" "$LIVE"
    (cd "$LIVE" && "${COMPOSE[@]}" up -d) || true
    echo "Rolled back. Previous tree restored. Failed tree kept at $FAILED."
  else
    log "FAILED (exit $rc) before the swap: the live stack was not changed"
  fi
  exit "$rc"
}
trap rollback ERR

[ "$(id -u)" -eq 0 ] || die "run as root"

log "1) Fetch and verify the commit archive"
if [ ! -f "$ARCHIVE" ]; then
  curl -fsSL --proto '=https' -o "$ARCHIVE.part" \
    "https://codeload.github.com/$REPO/tar.gz/$COMMIT"
  mv "$ARCHIVE.part" "$ARCHIVE"
fi
GOT_SHA="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
[ "$GOT_SHA" = "$EXPECTED_SHA" ] || die "checksum mismatch: got $GOT_SHA"
echo "checksum ok"

log "2) Preflight: the live stack must be the one serving traffic"
docker context use default >/dev/null
[ -f "$LIVE/.env.demo" ] || die "no $LIVE/.env.demo to carry over"
declare -A BEFORE
for c in "${CONTAINERS[@]}"; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || die "$c is not running"
  BEFORE[$c]="$(docker inspect -f '{{.State.StartedAt}}' "$c")"
  echo "$c running (started ${BEFORE[$c]})"
done

log "3) Stage the new tree"
rm -rf "$NEW" && mkdir -p "$NEW"
tar xzf "$ARCHIVE" -C "$NEW" --strip-components=1
[ -f "$NEW/docker-compose.demo.yml" ] || die "archive has no docker-compose.demo.yml"
cp -a "$LIVE/.env.demo" "$NEW/.env.demo"

log "4) Swap (previous tree kept at $OLD)"
cd /opt
mv "$LIVE" "$OLD"
mv "$NEW" "$LIVE"
SWAPPED=1
cd "$LIVE"

log "5) Rebuild the backend image, no cache"
# No cache: main pins wegofwd-llm v0.2.0; a cached pip layer can keep the old one.
"${COMPOSE[@]}" build --no-cache api

log "6) Restart the stack on the new image"
"${COMPOSE[@]}" up -d --remove-orphans

log "7) Verify the new containers replaced the old ones"
for c in "${CONTAINERS[@]}"; do
  now="$(docker inspect -f '{{.State.StartedAt}}' "$c")"
  [ "$now" != "${BEFORE[$c]}" ] || die "$c was not recreated"
  echo "$c recreated"
done
docker exec mentible-api test -f /app/compiler/dist/cli.js \
  || die "compiler is missing from the new image"

log "8) Migrations"
"${COMPOSE[@]}" run --rm api "${ALEMBIC[@]}" current
"${COMPOSE[@]}" run --rm api "${ALEMBIC[@]}" upgrade head
"${COMPOSE[@]}" run --rm api "${ALEMBIC[@]}" current

log "9) Liveness"
ok=0
for _ in $(seq 1 30); do
  if curl -fsS "$READYZ" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[ "$ok" -eq 1 ] || die "readyz did not return 200"
echo "readyz ok"
echo "public /account (expect 401 without a token):"
curl -s -o /dev/null -w '%{http_code}\n' https://mambakkam.net/mentible-api/api/v1/account || true

SWAPPED=0
log "DONE. Previous tree kept at $OLD; delete it once the new build is confirmed healthy."
