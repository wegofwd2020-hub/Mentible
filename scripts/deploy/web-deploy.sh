#!/usr/bin/env bash
#
# Mentible web deploy — build + publish a web build to mambakkam.net (demo/app
# sub-paths) or mentible.app (mentible/mentible-demo, apex — the migration target).
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
#   scripts/deploy/web-deploy.sh demo            # DEMO_MODE → mambakkam.net/demos/mentible
#   scripts/deploy/web-deploy.sh app             # full app  → mambakkam.net/app/mentible
#   scripts/deploy/web-deploy.sh mentible        # full app  → mentible.app/ (root, same-origin /api)
#   scripts/deploy/web-deploy.sh mentible-demo   # DEMO_MODE → mentible.app/demo
#   scripts/deploy/web-deploy.sh demo --no-push  # build + stage only (dry run; no commit/push/deploy)
#
# Env overrides:
#   MAMBAKKAM_REPO  path to an existing mambakkam-net checkout (default: a fresh shallow clone)
#   API_BASE_URL    backend base baked into the build (default: per target — mambakkam.net/mentible-api
#                   for demo/app, https://mentible.app/api for mentible/mentible-demo)
#
# Requires: node/npx (expo), git, gh (authed for wegofwd2020-hub/mambakkam-net), curl.
set -euo pipefail

TARGET="${1:-}"
NO_PUSH=0
for a in "${@:2}"; do [ "$a" = "--no-push" ] && NO_PUSH=1; done

# TARGET → (BASEURL baked into the export, PUBDIR under mambakkam-net public/,
# VHOST for the live-verify probe, DEMO_FLAG, DEFAULT_API). demo/app serve the
# mambakkam.net sub-paths (unchanged); mentible* serve the mentible.app apex
# (D1 same-origin /api + D2 root — docs/DOMAIN_MIGRATION_mentible_app.md). The
# mentible* targets require the mentible.app host/container nginx vhost to exist
# first (see that doc §6) or the push publishes files nothing serves.
case "$TARGET" in
  demo)          BASEURL="/demos/mentible"; PUBDIR="demos/mentible"; VHOST="mambakkam.net"; DEMO_FLAG="1"; DEFAULT_API="https://mambakkam.net/mentible-api" ;;  # read-only public preview
  app)           BASEURL="/app/mentible";   PUBDIR="app/mentible";   VHOST="mambakkam.net"; DEMO_FLAG="";  DEFAULT_API="https://mambakkam.net/mentible-api" ;;  # full app (generate/author/accounts)
  mentible)      BASEURL="";                PUBDIR="mentible-app";   VHOST="mentible.app";  DEMO_FLAG="";  DEFAULT_API="https://mentible.app" ;;                 # full app at the mentible.app root — EMPTY baseUrl (NOT "/": Expo bakes registered assets as httpServerLocation "/assets/…", and "/"+"/assets"="//assets" → host "assets" → 404 → blank app; ""+"/assets"="/assets" is correct). DEFAULT_API has NO /api suffix: the client appends /api/v1 itself, and nginx `location /api/` proxies to the backend — a /api suffix here makes /api/api/v1 → 404.
  mentible-demo) BASEURL="/demo";           PUBDIR="mentible-demo";  VHOST="mentible.app";  DEMO_FLAG="1"; DEFAULT_API="https://mentible.app" ;;                 # read-only preview at mentible.app/demo (same no-/api-suffix rule as the `mentible` target)
  *) echo "usage: $0 <demo|app|mentible|mentible-demo> [--no-push]"; exit 2 ;;
esac

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_BASE_URL="${API_BASE_URL:-$DEFAULT_API}"
MB_URL="https://github.com/wegofwd2020-hub/mambakkam-net.git"
# Live-verify URL: the app's served origin+base. Root (BASEURL=/) → https://vhost/ .
VERIFY_URL="https://${VHOST}${BASEURL%/}/"
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
# Supabase is only baked into the full app. The demo is a read-only, no-account
# preview (no sign-up), so it ships WITHOUT Supabase — otherwise an auth/sign-in
# path appears in the demo (and a half-configured OAuth redirect leads astray).
if [ -z "$DEMO_FLAG" ]; then
  # Any full-app target (app, mentible) bakes Supabase for accounts/auth.
  [ -n "$SB_URL" ] && [ -n "$SB_KEY" ] || { echo "✗ missing EXPO_PUBLIC_SUPABASE_* in mobile/.env.local"; exit 1; }
fi

echo "▶ build '$TARGET' from origin/main  (baseUrl=$BASEURL, demo=${DEMO_FLAG:-off}, api=$API_BASE_URL)"
git -C "$SELF" fetch origin --quiet
git -C "$SELF" worktree add --detach "$WT" origin/main >/dev/null
MAIN_SHA="$(git -C "$WT" rev-parse --short HEAD)"
ln -s "$SELF/mobile/node_modules" "$WT/mobile/node_modules"
# Flip the (single, static) experiments.baseUrl for this build. The worktree is
# disposable, so no revert is needed.
sed -i "s#\"baseUrl\": \"/[A-Za-z0-9/_-]*\"#\"baseUrl\": \"$BASEURL\"#" "$WT/mobile/app.json"

(
  cd "$WT/mobile"
  export EXPO_PUBLIC_API_BASE_URL="$API_BASE_URL"
  if [ -n "$DEMO_FLAG" ]; then
    # Read-only demo: demo flag on, Supabase OFF (auth unavailable → no sign-in).
    export EXPO_PUBLIC_DEMO_MODE=1
  else
    # Full app: Supabase on (accounts), demo flag off.
    export EXPO_PUBLIC_SUPABASE_URL="$SB_URL"
    export EXPO_PUBLIC_SUPABASE_ANON_KEY="$SB_KEY"
  fi
  # --clear is REQUIRED: without it, an export reuses a stale metro asset cache
  # from a prior build with different env (e.g. an app build before a demo build)
  # and silently drops assets — the demo once shipped with 0 of its 55 fonts.
  npx expo export --platform web --clear >/dev/null
)

grep -q "${BASEURL%/}/_expo/" "$WT/mobile/dist/index.html" \
  || { echo "✗ baseUrl $BASEURL not baked into the build"; exit 1; }
BUILT="$(find "$WT/mobile/dist" -type f | wc -l)"
echo "  built $BUILT files from main@$MAIN_SHA"

# Open Graph / Twitter meta so shared links (WhatsApp, Slack, iMessage…) show a
# preview card. WhatsApp's crawler doesn't run JS, so the tags MUST be in the
# STATIC index.html — Expo bakes none, so we inject them post-export, per-surface.
# The og:image (mobile/public/og-image.jpg, 1200×630) + copy mirror the landing
# page (mambakkam.net/mentible). Idempotent: skips if a build ever ships its own.
SITE_URL="https://${VHOST}${BASEURL}"
cp -f "$WT/mobile/public/og-image.jpg" "$WT/mobile/dist/og-image.jpg" 2>/dev/null || true
OG_DESC="The content is the commodity — every model already has it. Mentible is the layer where you shape it: outline, scope, and generate a real book (EPUB3 / PDF) that is exactly what you decided it should be."
python3 - "$WT/mobile/dist/index.html" "$SITE_URL" "$OG_DESC" <<'PYOG'
import sys, html
path, site, desc = sys.argv[1], sys.argv[2], sys.argv[3]
doc = open(path, encoding="utf-8").read()
if "og:image" in doc:
    print("  OG meta already present — skipped"); raise SystemExit
d = html.escape(desc, quote=True)
tags = (
    '<meta property="og:type" content="website"/>'
    '<meta property="og:site_name" content="Mentible"/>'
    '<meta property="og:title" content="Mentible — Author Yourself"/>'
    f'<meta property="og:description" content="{d}"/>'
    f'<meta property="og:url" content="{site}/"/>'
    f'<meta property="og:image" content="{site}/og-image.jpg"/>'
    '<meta property="og:image:width" content="1200"/>'
    '<meta property="og:image:height" content="630"/>'
    f'<meta name="description" content="{d}"/>'
    '<meta name="twitter:card" content="summary_large_image"/>'
    '<meta name="twitter:title" content="Mentible — Author Yourself"/>'
    f'<meta name="twitter:description" content="{d}"/>'
    f'<meta name="twitter:image" content="{site}/og-image.jpg"/>'
)
open(path, "w", encoding="utf-8").write(doc.replace("</head>", tags + "</head>", 1))
print(f"  injected OG/Twitter meta ({site})")
PYOG

# Resolve the mambakkam-net checkout (fresh clone unless one is provided).
if [ -n "${MAMBAKKAM_REPO:-}" ]; then
  MB="$MAMBAKKAM_REPO"
  git -C "$MB" fetch origin --quiet && git -C "$MB" reset --hard origin/main --quiet
else
  MB="$WORK/mambakkam-net"
  git clone --quiet --depth 1 "$MB_URL" "$MB"
fi

rm -rf "${MB:?}/public/$PUBDIR"/*
mkdir -p "$MB/public/$PUBDIR"
cp -r "$WT/mobile/dist/." "$MB/public/$PUBDIR/"
git -C "$MB" add -f "public/$PUBDIR"   # -f: node_modules/-path fonts are gitignored otherwise
STAGED="$(git -C "$MB" ls-files "public/$PUBDIR" | wc -l)"
echo "  staged $STAGED files into public/$PUBDIR"
[ "$STAGED" -ge 80 ] || echo "  ⚠ only $STAGED files staged (expected ~87) — fonts may have been gitignored; check 'git add -f'"

if [ "$NO_PUSH" = 1 ]; then
  echo "▶ --no-push: built + staged in $MB, not committing. Dry run OK."
  exit 0
fi

git -C "$MB" commit -q -m "deploy(mentible): publish $TARGET web from main@$MAIN_SHA → public/$PUBDIR ($VERIFY_URL)"
git -C "$MB" push origin main >/dev/null
echo "▶ pushed → ${VHOST} auto-deploy triggered"

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
[ -z "$DEMO_FLAG" ] && echo "  reminder: Google sign-in needs $VERIFY_URL allowlisted in Supabase → Auth → URL Configuration."
exit 0
