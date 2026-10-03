#!/bin/bash
# Test Phase 4 Common Projects feature end-to-end via staging + mobile app

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "════════════════════════════════════════════════════════════════════════════"
echo "Phase 4 Staging + Mobile Test"
echo "════════════════════════════════════════════════════════════════════════════"

# ── Verify staging is running ──────────────────────────────────────────────────
echo ""
echo "Checking staging API health..."
if ! curl -s http://127.0.0.1:8093/healthz > /dev/null 2>&1; then
  echo "❌ Staging API not running on :8093"
  echo ""
  echo "Start staging first:"
  echo "  ./scripts/setup-staging.sh"
  exit 1
fi
echo "✅ Staging API healthy on :8093"

# ── Configure super-admin ──────────────────────────────────────────────────────
echo ""
echo "Setting super-admin email in .env.staging..."
if [ -f .env.staging ]; then
  # Update or add SUPER_ADMIN_EMAILS
  if grep -q "^SUPER_ADMIN_EMAILS=" .env.staging; then
    sed -i.bak "s/^SUPER_ADMIN_EMAILS=.*/SUPER_ADMIN_EMAILS=wegofwd2020@gmail.com/" .env.staging
    echo "✅ Updated SUPER_ADMIN_EMAILS"
  else
    echo "SUPER_ADMIN_EMAILS=wegofwd2020@gmail.com" >> .env.staging
    echo "✅ Added SUPER_ADMIN_EMAILS"
  fi
else
  echo "❌ .env.staging not found. Run: ./scripts/setup-staging.sh"
  exit 1
fi

# ── Restart API to pick up super-admin config ──────────────────────────────────
echo ""
echo "Restarting API container to pick up super-admin config..."
docker compose -f docker-compose.staging.yml --env-file .env.staging restart api > /dev/null 2>&1
echo "✅ API restarted"

# ── Wait for API to be ready ───────────────────────────────────────────────────
echo ""
echo "Waiting for API to be ready..."
for i in {1..15}; do
  if curl -s http://127.0.0.1:8093/healthz > /dev/null 2>&1; then
    echo "✅ API ready"
    break
  fi
  echo "  Waiting... ($i/15)"
  sleep 1
done

# ── Check if mobile dir exists ─────────────────────────────────────────────────
if [ ! -d mobile ]; then
  echo "❌ mobile/ directory not found"
  exit 1
fi

# ── Start mobile app ───────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Starting Mobile App (Expo)"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Configure mobile API endpoint before running:"
echo "  1. Edit: mobile/src/api/client.ts"
echo "  2. Set: const BASE_URL = 'http://127.0.0.1:8093';"
echo "  3. Or use env: REACT_APP_API_URL=http://127.0.0.1:8093"
echo ""
echo "Then start Expo:"
echo "  cd mobile"
echo "  npx expo start --android   # or --ios / --web"
echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Phase 4 Test Checklist"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""
echo "1. SIGN IN"
echo "   └─ Use email: wegofwd2020@gmail.com (will be auto-created)"
echo ""
echo "2. CREATE & SHARE PROJECT"
echo "   └─ Create project → Generate content → Share to Common Repository"
echo "   └─ Verify: project appears in Common Projects list"
echo ""
echo "3. TEST SEARCH & IMPORT"
echo "   └─ Search for project by title"
echo "   └─ Import project → verify title conflict handling (suffix (2))"
echo ""
echo "4. TEST QUOTA (Free plan = 10 publishes max)"
echo "   └─ Publish projects 1-10 (all succeed)"
echo "   └─ Publish project 11 (expect 429 \"upgrade to Pro\")"
echo ""
echo "5. TEST ADMIN MODERATION"
echo "   └─ Navigate to Admin → Common Projects"
echo "   └─ Takedown a project (provide reason)"
echo "   └─ Verify: project hidden from public list"
echo "   └─ Restore project"
echo "   └─ Verify: project visible again"
echo ""
echo "6. VERIFY IN DB"
echo "   └─ Check audit trail: SELECT * FROM admin_audit WHERE action LIKE 'common_project%';"
echo "   └─ Check quota: SELECT COUNT(*) FROM common_projects WHERE author_id=? AND taken_down_at IS NULL;"
echo ""
echo "════════════════════════════════════════════════════════════════════════════"
echo "Staging Backend Running on: http://127.0.0.1:8093"
echo "Mobile App: Ready to start (see above)"
echo "════════════════════════════════════════════════════════════════════════════"
echo ""
echo "Logs:"
echo "  docker compose -f docker-compose.staging.yml logs -f api"
echo ""
