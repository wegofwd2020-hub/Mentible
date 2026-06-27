#!/usr/bin/env bash
#
# Mentible web deploy — build + publish a web build to mambakkam.net.
#
# This is the codified pipeline for WEB stages 2 (demo) and 3 (production). It
# ALWAYS builds from a clean `origin/main` worktree (never your working tree) and
# force-adds the export, so the two traps from the early manual deploys cannot
# recur:
#   • stale-tree build — a feature missing live because the local checkout was
#     behind main (build is from origin/main, not the working tree).
#   • gitignored fonts — `.gitignore`'s node_modules/ rule silently drops the
#     ~70 vendor/Google fonts under assets/node_modules/ → 404s + blank fonts
#     (we `git add -f` and assert the file count).
#
# Usage:
#   scripts/deploy/web-deploy.sh demo            # build DEMO_MODE → /demos/mentible, deploy + verify
#   scripts/deploy/web-deploy.sh app             # build full app  → /app/mentible,  deploy + verify
#   scripts/deploy/web-deploy.sh demo --no-push  # build + stage only (dry run; no commit/push/deploy)
#
# Env overrides:
#   MAMBAKKAM_REPO  path to an existing mambakkam-net checkout (default: a fresh shallow clone)
#   API_BASE_URL    backend base baked into the build (default: https://mambakkam.net/mentible-api)
#
# Requires: node/npx (expo), git, gh (authed for wegofwd2020-hub/mambakkam-net), curl.
set -euo pipefail

TARGET="${1:-}"
NO_PUSH=0
for a in "${@:2}"; do [ "$a" = "--no-push" ] && NO_PUSH=1; done

case "$TARGET" in
  demo) SUBPATH="demos/mentible"; DEMO_FLAG="1" ;;   # read-only public preview
  app)  SUBPATH="app/mentible";   DEMO_FLAG=""  ;;    # full app (generate/author/accounts)
  *) echo "usage: $0 <demo|app> [--no-push]"; exit 2 ;;
esac

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_BASE_URL="${API_BASE_URL:-https://mambakkam.net/mentible-api}"
MB_URL="https://github.com/wegofwd2020-hub/mambakkam-net.git"
VERIFY_URL="https://mambakkam.net/${SUBPATH}/"
WORK="$(mktemp -d)"
WT="$WORK/build"
cleanup() {
  rm -f "$WT/mobile/node_modules" 2>/dev/null || true
  git -C "$SELF" worktree remove --force "$WT" 2>/dev/null || true
  git -C "$SELF" worktree prune 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

# Supabase public client config (the anon key is public by design — RLS/JWT
# protect data). Read from mobile/.env.local so we don't hardcode a project here.
SB_URL="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$SELF/mobile/.env.local" | head -1 | cut -d= -f2-)"
SB_KEY="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$SELF/mobile/.env.local" | head -1 | cut -d= -f2-)"
[ -n "$SB_URL" ] && [ -n "$SB_KEY" ] || { echo "✗ missing EXPO_PUBLIC_SUPABASE_* in mobile/.env.local"; exit 1; }

echo "▶ build '$TARGET' from origin/main  (baseUrl=/$SUBPATH, demo=${DEMO_FLAG:-off}, api=$API_BASE_URL)"
git -C "$SELF" fetch origin --quiet
git -C "$SELF" worktree add --detach "$WT" origin/main >/dev/null
MAIN_SHA="$(git -C "$WT" rev-parse --short HEAD)"
ln -s "$SELF/mobile/node_modules" "$WT/mobile/node_modules"
# Flip the (single, static) experiments.baseUrl for this build. The worktree is
# disposable, so no revert is needed.
sed -i "s#\"baseUrl\": \"/[A-Za-z0-9/_-]*\"#\"baseUrl\": \"/$SUBPATH\"#" "$WT/mobile/app.json"

(
  cd "$WT/mobile"
  export EXPO_PUBLIC_API_BASE_URL="$API_BASE_URL"
  export EXPO_PUBLIC_SUPABASE_URL="$SB_URL"
  export EXPO_PUBLIC_SUPABASE_ANON_KEY="$SB_KEY"
  # Demo build gates generate/author/sign-in; the full app leaves the flag unset.
  [ -n "$DEMO_FLAG" ] && export EXPO_PUBLIC_DEMO_MODE=1
  npx expo export --platform web >/dev/null
)

grep -q "/$SUBPATH/_expo/" "$WT/mobile/dist/index.html" \
  || { echo "✗ baseUrl /$SUBPATH not baked into the build"; exit 1; }
BUILT="$(find "$WT/mobile/dist" -type f | wc -l)"
echo "  built $BUILT files from main@$MAIN_SHA"

# Resolve the mambakkam-net checkout (fresh clone unless one is provided).
if [ -n "${MAMBAKKAM_REPO:-}" ]; then
  MB="$MAMBAKKAM_REPO"
  git -C "$MB" fetch origin --quiet && git -C "$MB" reset --hard origin/main --quiet
else
  MB="$WORK/mambakkam-net"
  git clone --quiet --depth 1 "$MB_URL" "$MB"
fi

rm -rf "${MB:?}/public/$SUBPATH"/*
mkdir -p "$MB/public/$SUBPATH"
cp -r "$WT/mobile/dist/." "$MB/public/$SUBPATH/"
git -C "$MB" add -f "public/$SUBPATH"   # -f: node_modules/-path fonts are gitignored otherwise
STAGED="$(git -C "$MB" ls-files "public/$SUBPATH" | wc -l)"
echo "  staged $STAGED files into public/$SUBPATH"
[ "$STAGED" -ge 80 ] || echo "  ⚠ only $STAGED files staged (expected ~87) — fonts may have been gitignored; check 'git add -f'"

if [ "$NO_PUSH" = 1 ]; then
  echo "▶ --no-push: built + staged in $MB, not committing. Dry run OK."
  exit 0
fi

git -C "$MB" commit -q -m "deploy(mentible): publish $TARGET web from main@$MAIN_SHA → /$SUBPATH"
git -C "$MB" push origin main >/dev/null
echo "▶ pushed → mambakkam.net auto-deploy triggered"

# Verify: wait for the deploy run, then probe the live URL.
sleep 8
RUN="$(gh run list --repo wegofwd2020-hub/mambakkam-net --workflow 'Deploy mambakkam.net' --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
if [ -n "$RUN" ]; then
  gh run watch "$RUN" --repo wegofwd2020-hub/mambakkam-net --exit-status --interval 15 >/dev/null \
    && echo "  ✓ deploy run $RUN succeeded" || echo "  ⚠ deploy run $RUN did not report success — check Actions"
fi
sleep 3
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$VERIFY_URL")"
echo "  $VERIFY_URL → HTTP $CODE"
[ "$CODE" = 200 ] || { echo "✗ live URL not 200"; exit 1; }
echo "✓ $TARGET live at $VERIFY_URL  (main@$MAIN_SHA)"
echo
[ "$TARGET" = app ] && echo "  reminder: Google sign-in needs $VERIFY_URL allowlisted in Supabase → Auth → URL Configuration."
exit 0
