#!/bin/bash
# StudyBuddy Q — local dev orchestration

set -euo pipefail

cd "$(dirname "$0")"

cmd="${1:-up}"

# ── Helpers ───────────────────────────────────────────────────────────────────

_wait_for_api() {
  echo "→ Waiting for /healthz..."
  for i in {1..30}; do
    if curl -fs http://localhost:8001/healthz >/dev/null 2>&1; then
      echo "✓ API healthy at http://localhost:8001"
      return 0
    fi
    sleep 1
  done
  echo "✗ API did not become healthy in 30s"
  docker compose logs --tail=50 api
  return 1
}

_ensure_mobile_env() {
  local env_file="mobile/.env.local"
  if [ ! -f "$env_file" ]; then
    cp mobile/env.example "$env_file"
    echo "→ Created $env_file from env.example"
    echo "  Edit EXPO_PUBLIC_API_BASE_URL if using a physical device."
  else
    echo "→ Using existing $env_file"
  fi
}

_ensure_mobile_deps() {
  if [ ! -d mobile/node_modules ]; then
    echo "→ Installing mobile dependencies (first run — takes ~1 min)..."
    (cd mobile && npm install)
  else
    echo "→ Mobile node_modules present (skip install)"
  fi
}

# ── Commands ──────────────────────────────────────────────────────────────────

case "$cmd" in
  up)
    echo "→ Starting stack..."
    docker compose up -d --build
    _wait_for_api
    ;;

  smoke)
    # ── 1. Backend ────────────────────────────────────────────────────────────
    echo "→ Starting backend stack..."
    docker compose up -d --build
    _wait_for_api || exit 1

    # ── 2. Mobile env ─────────────────────────────────────────────────────────
    _ensure_mobile_env
    _ensure_mobile_deps

    # ── 3. Print checklist ────────────────────────────────────────────────────
    API_URL=$(grep EXPO_PUBLIC_API_BASE_URL mobile/.env.local | cut -d= -f2)
    echo ""
    echo "┌──────────────────────────────────────────────────────────────┐"
    echo "│  StudyBuddy Q — Smoke Test Ready                            │"
    echo "│                                                              │"
    printf "│  Backend:  http://localhost:8001           %-16s│\n" ""
    printf "│  API docs: http://localhost:8001/docs      %-16s│\n" ""
    printf "│  Readyz:   http://localhost:8001/readyz    %-16s│\n" ""
    printf "│  Mobile →  %-50s│\n" "$API_URL"
    echo "│                                                              │"
    echo "│  MVP smoke checklist (docs/MVP_v1.md):                      │"
    echo "│    1. Settings — paste your sk-ant-* key                    │"
    echo "│    2. Topic: 'Quadratic formula'     → KaTeX renders        │"
    echo "│    3. Topic: 'TCP three-way handshake' → Mermaid renders    │"
    echo "│    4. Kill + reopen app              → last lesson loads    │"
    echo "│    5. grep -i 'sk-ant' backend/logs/ → zero results        │"
    echo "│                                                              │"
    echo "│  Connect a device (choose one):                              │"
    echo "│    A) Expo Go on Android phone — scan the QR code below     │"
    echo "│       (phone + this machine must be on the same WiFi)       │"
    echo "│    B) Android emulator — press 'a' in Metro once it starts  │"
    echo "│       (requires Android Studio + SDK installed first)       │"
    echo "│                                                              │"
    echo "│  Ctrl+C stops Metro only; backend keeps running.            │"
    echo "│  './dev_start.sh stop' tears down Redis + API.              │"
    echo "└──────────────────────────────────────────────────────────────┘"
    echo ""

    # ── 4. Start Metro (interactive — stays in foreground) ────────────────────
    # No --android flag: lets the user choose Expo Go (QR scan) or emulator
    # ('a' key in Metro). Avoids hard-failing when Android SDK is not installed.
    (cd mobile && npx expo start)
    ;;

  test)
    echo "→ Running backend tests..."
    docker compose exec api pytest -v
    ;;

  stop)
    echo "→ Stopping stack..."
    docker compose down
    ;;

  reset)
    echo "→ Wiping volumes and stopping..."
    docker compose down -v
    ;;

  logs)
    docker compose logs -f --tail=100 api
    ;;

  *)
    echo "Usage: $0 {up|smoke|test|stop|reset|logs}"
    exit 2
    ;;
esac
