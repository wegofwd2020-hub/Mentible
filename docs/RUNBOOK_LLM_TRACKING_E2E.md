# E2E Test Runbook: LLM Provider Tracking

**Goal:** Run migration 0034, populate test data, verify admin UI displays current provider + change history.

**Prerequisites:**
- Local Postgres running (test database)
- Backend running locally
- Mobile emulator or web app running
- Super-admin credentials set in `.env`

---

## Step 1: Run Migration

```bash
cd backend
export DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test
alembic upgrade head
```

Verify tables created:
```bash
psql $DATABASE_URL -c "
  SELECT table_name FROM information_schema.tables 
  WHERE table_name IN ('account', 'provider_credential', 'provider_change_log') 
  ORDER BY table_name;
"
```

Expected output:
```
     table_name      
---------------------
 account
 provider_change_log
 provider_credential
```

---

## Step 2: Start Backend

```bash
cd backend
uvicorn main:app --reload
```

Verify it's running:
```bash
curl http://localhost:8000/health
```

---

## Step 3: Create Test User & Provider Changes

Use curl to simulate user adding providers:

```bash
# Set test values
TEST_SUB="test-user-$(date +%s)"
TEST_EMAIL="testuser@example.com"
BEARER_TOKEN="fake-jwt-for-test"  # In real flow, this is a Supabase JWT

# 1. GET account (provisions it)
curl -X GET http://localhost:8000/api/v1/account \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json"

# 2. Add anthropic provider
curl -X PUT http://localhost:8000/api/v1/account/credentials/anthropic \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "device_local", "status": "valid"}'

# 3. Add openai provider
curl -X PUT http://localhost:8000/api/v1/account/credentials/openai \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source": "device_local", "status": "valid"}'

# 4. Set anthropic as active
curl -X POST http://localhost:8000/api/v1/account/active-provider/anthropic \
  -H "Authorization: Bearer $BEARER_TOKEN" \
  -H "Content-Type: application/json"
```

---

## Step 4: Verify in Database

```bash
psql $DATABASE_URL -c "
  SELECT id, idp_sub, active_provider_id 
  FROM account 
  WHERE idp_sub = '$TEST_SUB';
"
```

Expected: One row with `active_provider_id = 'anthropic'`

Check the change log:
```bash
psql $DATABASE_URL -c "
  SELECT provider_id, action, actor_sub, created_at 
  FROM provider_change_log 
  WHERE account_id = (SELECT id FROM account WHERE idp_sub = '$TEST_SUB')
  ORDER BY created_at ASC;
"
```

Expected:
```
 provider_id |  action   | actor_sub | created_at
-------------+-----------+-----------+---------------------
 anthropic   | added     | <test-sub>| 2026-09-21 12:34:00
 openai      | added     | <test-sub>| 2026-09-21 12:35:00
 anthropic   | activated | <test-sub>| 2026-09-21 12:36:00
```

---

## Step 5: Verify Admin API Response

```bash
# Set super-admin token
ADMIN_TOKEN="fake-admin-jwt"

curl -X GET http://localhost:8000/api/v1/admin/users/$TEST_SUB \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" | jq '.'
```

Expected response includes:
```json
{
  "sub": "test-user-...",
  "email": "testuser@example.com",
  "active_provider_id": "anthropic",
  "provider_changes": [
    {
      "provider_id": "anthropic",
      "action": "added",
      "actor_sub": "test-user-...",
      "actor_email": null,
      "reason": "source=device_local, status=valid",
      "created_at": "2026-09-21T12:34:00Z"
    },
    {
      "provider_id": "openai",
      "action": "added",
      "actor_sub": "test-user-...",
      "actor_email": null,
      "reason": "source=device_local, status=valid",
      "created_at": "2026-09-21T12:35:00Z"
    },
    {
      "provider_id": "anthropic",
      "action": "activated",
      "actor_sub": "test-user-...",
      "actor_email": null,
      "reason": null,
      "created_at": "2026-09-21T12:36:00Z"
    }
  ]
}
```

---

## Step 6: View in Admin UI

### Mobile App:
1. Run emulator:
   ```bash
   cd mobile
   npx expo start --android
   ```

2. Sign in with super-admin account (configure in `.env` as `SUPER_ADMIN_EMAILS`)

3. Tap Admin tab → Users → click the test user

4. Verify:
   - "LLM Provider" card shows "anthropic"
   - "LLM Change History" section shows all 3 changes (newest-first):
     - anthropic · activated · 2026-09-21T12:36:00
     - openai · added · 2026-09-21T12:35:00
     - anthropic · added · 2026-09-21T12:34:00

### Web App (if available):
1. Navigate to `https://mentible.app/admin/[sub-of-test-user]`
2. Scroll to LLM Provider section
3. Verify display matches mobile

---

## Step 7: Test Admin Override

Admin can set user's provider directly:

```bash
curl -X POST http://localhost:8000/api/v1/admin/users/$TEST_SUB/active-provider/openai \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

Verify in database:
```bash
psql $DATABASE_URL -c "
  SELECT active_provider_id FROM account WHERE idp_sub = '$TEST_SUB';
"
```

Expected: `openai`

Check log:
```bash
psql $DATABASE_URL -c "
  SELECT provider_id, action, actor_sub, reason 
  FROM provider_change_log 
  WHERE account_id = (SELECT id FROM account WHERE idp_sub = '$TEST_SUB')
  ORDER BY created_at DESC
  LIMIT 1;
"
```

Expected newest entry:
```
 provider_id | action    | actor_sub  | reason
-------------+-----------+------------+----------
 openai      | activated | admin-sub  | admin-set
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Migration fails with "active_provider_id column already exists" | Run `alembic current` to check version; may already be at 0034 |
| Auth 403 on admin endpoints | Verify `SUPER_ADMIN_EMAILS` config includes test admin email |
| Mobile app doesn't show new sections | Clear app cache, rebuild APK |
| No change history showing | Verify provider_change_log table has rows for the account |

---

## Success Criteria

- ✅ Migration 0034 runs without errors
- ✅ `provider_change_log` table created with data
- ✅ `account.active_provider_id` populated
- ✅ Admin API returns `provider_changes` array
- ✅ Mobile admin detail shows "LLM Provider" card
- ✅ Mobile admin detail shows "LLM Change History" section
- ✅ History is newest-first with correct actor/action/timestamp
