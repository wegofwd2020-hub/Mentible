#!/usr/bin/env bash
#
# Mentible prod backend refresh to a pinned commit on main. Run as ROOT on the
# VPS (178.105.160.62). Wraps scripts/deploy/backend-refresh.sh with the
# pre-checks and post-checks from Plans/PROD_BACKEND_REFRESH_TO_MAIN.md.
#
# Usage:
#   sudo bash backend-prod-refresh.sh            # check only: changes nothing
#   sudo bash backend-prod-refresh.sh --deploy   # check, deploy, verify
#
# Safe by default. Without --deploy it only reports the live state.
set -euo pipefail

COMMIT="0725d682a672a1b54d1210bb859b5461ea763f71"
EXPECTED_SHA="834c2342d23289ef18e2988825e4d239077a0aee509b2267910465a4ac3e40e3"
REPO="wegofwd2020-hub/Mentible"
ARCHIVE_URL="https://codeload.github.com/$REPO/tar.gz/$COMMIT"
REFRESH_URL="https://raw.githubusercontent.com/$REPO/$COMMIT/scripts/deploy/backend-refresh.sh"
READYZ="http://127.0.0.1:8092/readyz"
ACCOUNT="http://127.0.0.1:8092/account"
ALEMBIC=(alembic -c /app/backend/alembic.ini)
CONTAINERS=(mentible-api mentible-celery-worker mentible-celery-beat)

MODE="check"
[ "${1:-}" = "--deploy" ] && MODE="deploy"
[ -z "${1:-}" ] || [ "$MODE" = "deploy" ] || { echo "unknown argument: $1" >&2; exit 2; }

log() { printf '\n== %s\n' "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"

log "1) Live state (before)"
docker context use default >/dev/null
for c in "${CONTAINERS[@]}"; do
  if docker ps --format '{{.Names}}' | grep -qx "$c"; then
    echo "$c: $(docker inspect -f '{{.State.Status}} since {{.State.StartedAt}}' "$c")"
  else
    echo "$c: NOT RUNNING"
  fi
done
echo "alembic current:"
docker exec mentible-api "${ALEMBIC[@]}" current 2>&1 || echo "  (could not read: is mentible-api running?)"
echo "readyz: $(curl -s -o /dev/null -w '%{http_code}' "$READYZ" || true)"

if [ "$MODE" = "check" ]; then
  log "Check only. Re-run with --deploy to deploy $COMMIT."
  exit 0
fi

log "2) Fetch and verify the commit archive"
WORK="$(mktemp -d /root/mentible-prod-refresh.XXXXXX)"
chmod 700 "$WORK"
curl -fsSL --proto '=https' -o "$WORK/src.tgz" "$ARCHIVE_URL"
GOT_SHA="$(sha256sum "$WORK/src.tgz" | cut -d' ' -f1)"
[ "$GOT_SHA" = "$EXPECTED_SHA" ] || die "archive checksum mismatch: got $GOT_SHA"
echo "archive checksum ok"

log "3) Fetch the refresh script at the same commit"
curl -fsSL --proto '=https' -o "$WORK/backend-refresh.sh" "$REFRESH_URL"
echo "refresh script downloaded to $WORK/backend-refresh.sh"

log "4) Run the refresh (it verifies the checksum again and rolls back on failure)"
cd "$WORK"
COMMIT="$COMMIT" EXPECTED_SHA="$EXPECTED_SHA" bash ./backend-refresh.sh

log "5) Verify after the deploy"
docker ps --format '{{.Names}} {{.Status}}' | grep mentible || true
echo "alembic current:"
docker exec mentible-api "${ALEMBIC[@]}" current 2>&1 || echo "  (could not read)"
echo "readyz: $(curl -s -o /dev/null -w '%{http_code}' "$READYZ" || true) (expect 200)"
echo "account: $(curl -s -o /dev/null -w '%{http_code}' "$ACCOUNT" || true) (expect 401, no token sent)"

log "Done. The previous tree is kept under /opt; delete it after about a week."
