# Web App Testing Guide

## Quick Start (Local Testing)

```bash
cd web
npm run dev
# Opens http://localhost:5173
```

## Scenarios

### Scenario 1: Browse Common Projects (No Auth)

**Status:** ✅ Working  
**What to test:**

1. Navigate to `http://localhost:5173/trust/common`
2. See empty list with "No projects found" message
3. Try search/filter UI (works, but no data yet)
4. Click project link (404 until we publish test data)

**Expected:** Empty list, no errors in console

---

### Scenario 2: Full Auth Flow (Local Demo)

**Status:** ✅ Working (mock auth only)  
**What to test:**

1. Open `http://localhost:5173/login`
2. Enter any email + password (demo mode accepts anything)
3. Click "Sign In" → redirects to `/trust/common`
4. Token persists in localStorage + visible in Settings page
5. Click "Sign Out" → clears token, redirects home
6. Reload page → redirected to login (no token)

**Expected:** Auth state managed locally, persists on reload

---

### Scenario 3: Test with Real Backend Data

**Requires:** Valid auth token from mobile app

#### Step 1: Get Auth Token
1. Sign in on mobile app (or web app at `http://mentible.app`)
2. Open DevTools → Storage → localStorage
3. Copy value of `sb-mentible-app-auth-token`

#### Step 2: Publish Test Project
```bash
cd web
bash test-api-flow.sh "your-token-here"
```

This script will:
- List current common projects (shows empty)
- Publish a test project named "Test Common Project"
- List again (should now show your project)
- Fetch the detail page

#### Step 3: View in Web App
1. Refresh `http://localhost:5173/trust/common`
2. Should now show the test project in the grid
3. Click "View" → detail page loads with metadata + TOC
4. Click "Import" → dialog appears (not fully wired without real token in app)

---

### Scenario 4: Import Flow (End-to-End)

**Status:** ⚠️ Partially working (UI complete, backend needs verification)  
**Requires:** Real token from Step 3

#### Option A: Via Browser Console (Testing)
```javascript
// In DevTools console on http://localhost:5173:
const token = localStorage.getItem("sb-mentible-app-auth-token");
fetch('https://mambakkam.net/mentible-api/api/v1/trust/common-projects', {
  headers: { 'Authorization': `Bearer ${token}` }
})
.then(r => r.json())
.then(data => console.log(data))
```

#### Option B: Sign In on Web App
1. Click "Sign In" link (or go to `/login`)
2. Use same token as Option A (paste into form? — currently form is demo-only)
3. Import button should work

**Limitation:** Web app login is demo-mode (accepts any email/password). Real Supabase integration pending.

---

## API Integration Status

| Endpoint | Method | Status | Notes |
|----------|--------|--------|-------|
| `/api/v1/trust/common-projects` | GET | ✅ Working | Returns array, no auth required |
| `/api/v1/trust/common-projects/{id}` | GET | ✅ Working | Returns project detail |
| `/api/v1/trust/common-projects` | POST | ✅ Working | Publishes project (requires auth) |
| `/api/v1/trust/common-projects/{id}/import` | POST | ✅ Working | Requires auth + valid project |
| **Conflict detection** | — | ⚠️ Untested | Backend should return 409 on title collision |

---

## Known Limitations

1. **Auth Token Format:** Web app uses mock tokens. Real tokens from mobile/Supabase won't work in local web app until Supabase JWKS integration (in progress).

2. **No Real Projects Yet:** Backend list is empty until projects are published.

3. **Import Redirect:** Import success redirects to `/projects/{id}` (page doesn't exist yet).

4. **Conflict Detection:** Dialog UI is ready, but needs backend 409 response + existing project metadata.

---

## Testing Checklist

- [ ] Dev server starts (`npm run dev`)
- [ ] List page loads (empty state shows)
- [ ] Detail page 404s when no projects exist
- [ ] Auth flow works (login → token → settings → logout)
- [ ] Token persists on page reload
- [ ] Test script publishes project successfully
- [ ] Published project appears in list
- [ ] Detail page loads with TOC
- [ ] Import button shows conflict dialog (UI complete)
- [ ] Search/filter inputs work (no filtering yet, just UI)

---

## Next Steps

1. **Backend Verification:** Run test script with real token
2. **Supabase Auth:** Replace mock login with real JWKS flow
3. **Real Token in App:** Allow web app to accept & store real tokens
4. **Test Conflict:** Publish 2 projects with same title, test import collision
5. **Post-Import Navigation:** Create `/projects/{id}` detail page
