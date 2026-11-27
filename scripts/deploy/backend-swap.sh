#!/usr/bin/env bash
#
# Mentible prod backend swap to a verified `main` archive. Run as ROOT on the VPS
# (178.105.160.62). Codifies the ROOT block in Plans/PROD_BACKEND_REFRESH_TO_MAIN.md.
#
# Usage:
#   sudo bash backend-swap.sh <archive.tgz> <archive-sha256> <alembic-head>
#
# Example:
#   sudo bash /home/deploy/backend-swap.sh \
#     /home/deploy/mentible-main-795bdd33.tgz \
#     566b73b65581b80f659ea851a8be925ec3df0e1a8bb3f16c392e58621daddc29 \
#     0045
#
# Every pre-check runs BEFORE /opt/mentible is touched; any failure there leaves
# the live service exactly as it was. After the swap, a failure prints the manual
# rollback steps (see Rollback below) rather than auto-reverting, because a
# rollback also restarts the stack.
#
# Rollback (manual, if the script fails after the swap):
#   cd /opt
#   docker compose -f /opt/mentible/docker-compose.demo.yml --env-file /opt/mentible/.env.demo down
#   rm -rf /opt/mentible && mv /opt/mentible-old-<STAMP> /opt/mentible
#   cd /opt/mentible && docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
set -euo pipefail

ARCHIVE="${1:-}"
EXPECT_SHA="${2:-}"
EXPECT_HEAD="${3:-}"

# A string that exists only in the new code. Proves the staged and live trees are
# the release we meant to ship, not an older one (see the 2026-08-20 stale-tree note).
MARKER="coverThumb"
MARKER_FILE="backend/src/library/commons_metadata.py"
API="mentible-api"
COMPOSE=(docker compose -f docker-compose.demo.yml --env-file .env.demo)
ALEMBIC=(alembic -c /app/backend/alembic.ini)
READYZ="http://127.0.0.1:8092/readyz"

die() { echo "ABORT: $*" >&2; exit 1; }
log() { printf '\n== %s\n' "$*"; }

# ── pre-checks (no changes to the live service) ────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -n "$ARCHIVE" ] && [ -n "$EXPECT_SHA" ] && [ -n "$EXPECT_HEAD" ] \
  || die "usage: $0 <archive.tgz> <sha256> <alembic-head>"
[ -f "$ARCHIVE" ] || die "archive not found: $ARCHIVE"
echo "$EXPECT_SHA  $ARCHIVE" | sha256sum -c --status || die "archive checksum mismatch"

log "docker context"
docker context use default >/dev/null
[ -f /opt/mentible/docker-compose.demo.yml ] || die "/opt/mentible has no compose file"
[ -f /opt/mentible/.env.demo ] || die "/opt/mentible has no .env.demo (would be lost)"
docker ps --format '{{.Names}}' | grep -qx "$API" \
  || die "$API is not running on the default daemon; wrong context?"
STARTED_BEFORE=$(docker inspect -f '{{.State.StartedAt}}' "$API")
echo "live $API started at: $STARTED_BEFORE"

log "stage new tree"
STAMP=$(date +%Y%m%d-%H%M)
cd /opt
rm -rf /opt/mentible-new && mkdir -p /opt/mentible-new
tar xzf "$ARCHIVE" -C /opt/mentible-new
if ! grep -q "$MARKER" "/opt/mentible-new/$MARKER_FILE"; then
  rm -rf /opt/mentible-new
  die "staged tree lacks marker '$MARKER'; live tree untouched"
fi
cp -a /opt/mentible/.env.demo /opt/mentible-new/.env.demo

# ── swap (point of no return; failures from here print rollback steps) ─────────
log "swap"
mv /opt/mentible "/opt/mentible-old-$STAMP"
mv /opt/mentible-new /opt/mentible
cd /opt/mentible
trap 'echo "FAILED at line $LINENO. New code is in /opt/mentible; previous tree is in /opt/mentible-old-$STAMP. See Rollback in this script header." >&2' ERR

log "build api (no cache)"
"${COMPOSE[@]}" build --no-cache api

log "up"
"${COMPOSE[@]}" up -d --remove-orphans

log "migrate"
"${COMPOSE[@]}" run --rm api "${ALEMBIC[@]}" upgrade head

# ── verify the LIVE container changed, not just that compose exited 0 ──────────
log "verify"
ready=0
for _ in $(seq 1 30); do
  if curl -fsS "$READYZ" >/dev/null 2>&1; then ready=1; break; fi
  sleep 2
done
[ "$ready" -eq 1 ] || die "readyz did not return ok within 60s"
echo "readyz ok"

STARTED_AFTER=$(docker inspect -f '{{.State.StartedAt}}' "$API")
[ "$STARTED_AFTER" != "$STARTED_BEFORE" ] || die "$API start time did not change; not the new container"

docker exec "$API" grep -q "$MARKER" "/app/$MARKER_FILE" \
  || die "live container does not contain the new code"

HEAD_NOW=$(docker exec "$API" "${ALEMBIC[@]}" current | awk 'NF {print $1}' | tail -1)
[ "$HEAD_NOW" = "$EXPECT_HEAD" ] || die "alembic head is '$HEAD_NOW', expected '$EXPECT_HEAD'"
echo "alembic head: $HEAD_NOW"

trap - ERR
log "done"
echo "Live backend is on the new code. Rollback copy: /opt/mentible-old-$STAMP (delete in about a week)."
echo "Existing Author Commons books keep their old cover until each author publishes again."
