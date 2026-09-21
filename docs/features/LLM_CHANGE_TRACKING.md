# LLM Provider Change Tracking (Super-Admin Visibility)

Feature for super-admin monitoring of per-user LLM provider selection and configuration changes.

## What's tracked

- **Current active provider** — which LLM each user has selected (`account.active_provider_id`)
- **Change history** — every add/remove/update/activate of a provider, with actor attribution (who changed it + when)

## Data model

```
provider_change_log
├── id (uuid)
├── account_id (uuid, nullable — log survives account deletion)
├── provider_id (text)
├── action (text)  — 'added', 'removed', 'verified', 'failed', 'activated', 'deactivated'
├── actor_sub (text) — who made the change (user's sub or admin's sub)
├── actor_email (text)
├── reason (text) — context (e.g., "source=device_local, status=valid")
└── created_at (timestamptz)
```

## Endpoints

### User-level (authenticated user)

**PUT /api/v1/account/credentials/{provider_id}**
- User adds or updates a provider credential
- Logs: "added" (new) or "verified" (status changed to valid)

**DELETE /api/v1/account/credentials/{provider_id}**
- User removes a provider credential
- Logs: "removed"

**POST /api/v1/account/active-provider/{provider_id}**
- User sets their active LLM provider
- Logs: "activated"

### Admin-level (super-admin only)

**GET /api/v1/admin/users/{sub}**
- Returns `AdminUserDetail` with:
  - `active_provider_id` (current selection)
  - `provider_changes` (array of `ProviderChange`, newest-first, limit 50)

**POST /api/v1/admin/users/{sub}/active-provider/{provider_id}**
- Admin sets a user's active LLM provider
- Logs to both `provider_change_log` (action="activated") and `admin_audit` (action="provider.set:{provider_id}")

## Testing

### Automated tests

```bash
# Run with local Postgres (requires DATABASE_URL set):
DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest backend/tests/test_account_api.py::test_set_active_provider -v
DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest backend/tests/test_admin_api.py::test_admin_detail_includes_provider_changes -v
DATABASE_URL=postgresql://postgres:devlocal@localhost:5439/mentible_test pytest backend/tests/test_admin_api.py::test_admin_set_active_provider -v
```

### Manual E2E scenario

1. **Run migrations** (if on main):
   ```bash
   cd backend && alembic upgrade head
   ```

2. **User adds providers** (via mobile app Settings → Add Providers):
   - Add "anthropic" with source=device_local
   - Add "openai" with source=device_local
   - Each triggers `PUT /api/v1/account/credentials/{provider_id}` → logged as "added"

3. **User selects active provider** (via mobile app Settings → Select LLM):
   - Select "anthropic" as active
   - Triggers `POST /api/v1/account/active-provider/anthropic` → logged as "activated"

4. **Super-admin views user profile** (mobile admin console → Users → click a user):
   - See "LLM Provider" card showing "anthropic"
   - See "LLM Change History" section:
     - anthropic · added · by user@example.com · 2026-09-21T12:34:56
     - openai · added · by user@example.com · 2026-09-21T12:35:00
     - anthropic · activated · by user@example.com · 2026-09-21T12:36:00

5. **Super-admin forces provider change** (admin can call the endpoint directly):
   - Call `POST /api/v1/admin/users/{sub}/active-provider/openai`
   - Appears in history as "openai · activated · by admin@example.com · reason: admin-set"

## Migration

**Revision 0034** (`backend/alembic/versions/0034_provider_change_tracking.py`):
- Adds `account.active_provider_id` column
- Creates `provider_change_log` table with indexes
- Indexes for fast queries by account + provider

## Code changes

| File | Changes |
|------|---------|
| `backend/src/accounts/models.py` | Added `Account.active_provider_id`, `ProviderChangeLogEntry` class |
| `backend/src/accounts/schemas.py` | Added `ProviderChangeView`, updated `AdminUserDetail` |
| `backend/src/accounts/repo.py` | Added `log_provider_change()`, `list_provider_changes()`, `set_active_provider()` |
| `backend/src/accounts/router.py` | Wired logging into PUT/DELETE credential endpoints, added POST /active-provider |
| `backend/src/admin/router.py` | Updated `get_user()` to fetch changes, added POST /users/{sub}/active-provider |
| `mobile/src/api/accountClient.ts` | Added `setActiveProvider()`, `ProviderChange` type |
| `mobile/src/api/adminClient.ts` | Added `setUserActiveProvider()`, `ProviderChange` type, updated `AdminUserDetail` |
| `mobile/app/admin/[sub].tsx` | Display "LLM Provider" card + "LLM Change History" section |

## Notes

- Logs are immutable (never updated/deleted), only read for audit
- Logs survive account deletion (account_id can be NULL)
- All changes attributed to actor (user or admin)
- Admin detail view limited to 50 most-recent changes (pagination not yet wired, but query supports limit/offset)
