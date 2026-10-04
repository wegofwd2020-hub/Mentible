# Phase 5: Web Trust Workflow Core (Auth + Projects + Reviews)

**Goal:** Ship auth flow, Projects detail editing, Reviews approval UI on web. Complete SME trust loop (Create → Validate) online.

**Status:** Planning  
**Priority:** High (auth blocks all; projects/reviews = core surfaces)  
**Estimate:** 6.5–8.5 hrs (P0 + P1)

---

## P0: Ship-Blocking Tasks

### 1. Auth Flow (Web)
**Duration:** 1.5–2 hrs  
**Dependencies:** None (mobile auth exists; web just wires UI)  
**Files:** `web/src/contexts/AuthContext.tsx`, `web/src/pages/auth/callback.tsx`, `web/src/pages/login.tsx`, `web/src/lib/supabase.ts`

**Features:**
- Google sign-in (Supabase auth)
- Email/password login (Supabase auth)
- Guest mode (localStorage token, no Supabase)
- Token refresh on app load
- Logout
- Protected routes (redirect to /login if no token)
- PKCE flow for OAuth callback
- Error handling (invalid token, expired session)

**Acceptance:**
- [ ] Google sign-in works, redirects to /trust/projects after auth
- [ ] Email/password login works
- [ ] Guest mode loads /trust/common (public list only)
- [ ] Token persists across page reload
- [ ] 401 on expired token → redirects to /login
- [ ] /auth/callback parses code, swaps for token, redirects home

**Reference:** `mobile/app/contexts/AuthContext.tsx` + Supabase SDK docs

---

### 2. Projects Detail Page (Web) + Editing
**Duration:** 2.5–3 hrs  
**Dependencies:** Task 1 (auth); backend Projects API (already live)  
**Files:** `web/src/pages/trust/projects/[id].tsx`, `web/src/components/ProjectMetadataEditor.tsx`

**Features:**
- Display project metadata (title, topic, audience, goal, status, created_at)
- Editable fields: title, topic, audience, goal (inline or modal)
- Show topic tree (TOC) — read-only for now
- Display artifacts (EPUB, PDF, etc.) + versions
- Show version approval status (approved_at badge)
- "Generate" button if not generating (triggers gen job)
- "Publish to Common Projects" button (author-only, requires approval)
- Edit mode: click title/field → edit → save (PATCH /api/v1/trust/projects/{id})
- Save feedback (toast on success/error)

**Acceptance:**
- [ ] Page loads with full project data
- [ ] Edit title → save → API call succeeds → toast "Saved"
- [ ] Edit goal → cancel → no API call
- [ ] Can't edit if not owner (UI buttons hidden)
- [ ] Artifacts list shows version count + approval status
- [ ] TOC renders (reuse from /trust/projects list)

**Reference:** `mobile/app/trust/projects/[id].tsx` (structure), `web/src/pages/projects/[id].tsx` (stub)

---

### 3. Reviews Page + Approval UI (Web)
**Duration:** 2–2.5 hrs  
**Dependencies:** Task 1 (auth); backend Reviews API (already live)  
**Files:** `web/src/pages/trust/reviews/index.tsx`, `web/src/components/ReviewDetailModal.tsx`

**Features:**
- List projects invited to review (from /api/v1/trust/session/sync)
- For each: title, owner, creation_date, progress bar (X/Y versions approved)
- Click → opens detail modal or navigates to /trust/reviews/{projectId}
- Detail view:
  - Project metadata (read-only)
  - Artifacts list
  - For each artifact version: status, created_at, approval button
  - "Approve" button → POST /api/v1/trust/artifacts/{id}/approve
  - "Reject" button (optional, for later phase)
  - Toast feedback on approve/reject
  - Real-time refresh or "Refresh" button

**Acceptance:**
- [ ] Reviews list loads (calls /api/v1/trust/session/sync)
- [ ] Each project shows progress (2/3 approved)
- [ ] Click project → detail modal opens
- [ ] "Approve" button works (calls API, updates UI, shows toast)
- [ ] Only reviewer can see (auth-gated)
- [ ] Invalid project_id → 404 or error message

**Reference:** `mobile/app/trust/reviews.tsx` + mobile review detail

---

## P1: High-Value Tasks

### 4. Import Conflict Handling (Web)
**Duration:** 1–1.5 hrs  
**Dependencies:** Task 2 (Projects detail), Task 3 + import endpoints  
**Files:** `web/src/components/ImportConflictDialog.tsx`, wire into Common Projects [id] page

**Features:**
- On "Publish to Common Projects" click:
  - Show publish dialog (title, description, tags, cover image)
  - Check quota: Free=1 publish, Pro=unlimited
  - On submit → POST /api/v1/trust/common-projects
  - If success → navigate to /trust/common/{id} + toast "Published"
  - If conflict (title exists) → show dialog: "Title exists. Use suffix?"
  - Options: suffix (2), rename, or cancel
- On "Import" from Common Projects:
  - Check user quota (Free=10, Pro=unlimited)
  - If at limit → "Quota full" error
  - If conflict → dialog: "Title exists. Import as 'Title (2)'?"
  - On success → navigate to /trust/projects/{id} + toast

**Acceptance:**
- [ ] Publish dialog opens, submits to API
- [ ] Conflict detection → shows options
- [ ] Quota check prevents exceed
- [ ] Success redirects + toast

**Reference:** Task 5 from PHASE4.1 + mobile conflict flow

---

### 5. Analytics Dashboard (Web)
**Duration:** 1–1.5 hrs  
**Dependencies:** Task 1 (auth); backend analytics API (live)  
**Files:** `web/src/pages/analytics/project-ux.tsx` (stub exists, needs UI)

**Features:**
- Copy mobile journey analytics dashboard structure
- Per-project dropdown selector (list owned projects)
- Graph: stalled users over time (line chart, recharts)
- Intervention buttons (email escalation)
- Email log (recent sent + responses)
- Stalled user threshold config (if super-admin)

**Acceptance:**
- [ ] Page loads, project selector works
- [ ] Graph renders (API data → recharts)
- [ ] Intervention button works
- [ ] Mobile + web match visually

**Reference:** `mobile/app/analytics/[projectId].tsx` + recharts docs

---

### 6. Help Content Updates (Web)
**Duration:** 30–45 min  
**Dependencies:** All tasks above  
**Files:** `web/src/help-content/features.ts` (new), `topics.ts` (new)

**Features:**
- Add topics:
  - "How to create a project" (Capture)
  - "How to invite a reviewer" (Validate)
  - "How to publish to Common Projects" (Share)
  - "Managing your projects" (viewing, editing, versions)
  - "Reviewing other projects" (approving, feedback)
- Wire into Help page (if exists) or inline tooltips

**Acceptance:**
- [ ] Topics load in Help UI
- [ ] Links to relevant pages work

**Reference:** `mobile/src/help-content/features.ts` + `topics.ts`

---

## Implementation Order (Dependency-Safe)

1. **Auth Flow** (Task 1) — foundation for all
2. **Projects Detail** (Task 2) — uses auth, independent
3. **Reviews** (Task 3) — uses auth, independent from Task 2
4. **Conflict Handling** (Task 4) — depends on Tasks 2+3
5. **Analytics** (Task 5) — independent, can run in parallel with Task 4
6. **Help Content** (Task 6) — last, after all UI done

**Parallelizable:** Tasks 2, 3, 5 can run in parallel after Task 1.

---

## File Structure

```
web/src/
  contexts/
    AuthContext.tsx           ← updated: add token refresh, guest mode
  pages/
    auth/
      callback.tsx             ← new: handle OAuth redirect
    login.tsx                  ← updated: add Google button + guest mode
    trust/
      projects/
        [id].tsx               ← new: detail + edit
      reviews/
        index.tsx              ← updated: full approval UI
        [projectId].tsx        ← new: detail modal (optional)
    analytics/
      project-ux.tsx           ← updated: fill stub with graph + controls
    settings.tsx               ← stub (can defer)
  components/
    ProjectMetadataEditor.tsx   ← new: inline editor for title/goal/etc
    ReviewDetailModal.tsx       ← new: modal for review detail
    ImportConflictDialog.tsx    ← new: publish/import conflict dialog
    ApprovalButton.tsx          ← new: approve version button + loading
  help-content/
    features.ts                ← new: feature keys
    topics.ts                  ← new: help topics
  lib/
    api/
      projects.ts              ← update: add PATCH, POST publish
      reviews.ts               ← new: sync, list, approve
      analytics.ts             ← update: fetch dashboard data
    supabase.ts                ← update: token refresh logic
```

---

## API Endpoints Needed (Backend)

All live (Phase 4 + Phase 4.1):
- `GET /api/v1/trust/projects` (list owned)
- `GET /api/v1/trust/projects/{id}` (detail)
- `PATCH /api/v1/trust/projects/{id}` (edit metadata)
- `POST /api/v1/trust/session/sync` (get memberships for reviews)
- `GET /api/v1/trust/projects/{id}/artifacts` (list + versions)
- `POST /api/v1/trust/artifacts/{id}/approve` (approval)
- `POST /api/v1/trust/common-projects` (publish)
- `GET /api/v1/analytics/dashboards/project-ux/{projectId}` (analytics)

---

## Design Questions / Decisions

- [ ] Publish dialog: modal or separate page?
- [ ] Review detail: modal or separate page (/trust/reviews/{id})?
- [ ] Edit fields: inline click-to-edit or edit mode toggle?
- [ ] Analytics: show all projects or single selector?
- [ ] Conflict dialog: auto-suffix or ask user?
- [ ] Help: inline tooltips or Help tab with topics list?

---

## Risk / Gotchas

- **Auth token lifecycle:** Ensure refresh on app load, handle expiry gracefully
- **Protected routes:** Use middleware/wrapper to gate /trust/* pages
- **Real-time updates:** Reviews list might stale if reviewer approves elsewhere; add refresh button or polling
- **Quota enforcement:** Verify plan limits from backend before submit
- **API error handling:** All PATCH/POST calls need error toast + fallback
- **Mobile parity:** Ensure edit UX matches mobile (inline vs modal)

---

## Success Criteria (Phase 5 Complete)

- [ ] Auth flow: Google + email + guest all work
- [ ] Projects detail: view + edit metadata + see artifacts
- [ ] Reviews: list invited projects + approve versions
- [ ] Import: publish + conflict handling work
- [ ] Analytics: dashboard shows journey graph
- [ ] Help: 5 topics created + wired
- [ ] Web matches mobile UX/behavior (screenshots side-by-side)
- [ ] All P0 + P1 routes load without errors
- [ ] Deployed to mentible.app (auto-deploy on main)

---

## Estimated Effort Breakdown

| Task | Low | High | Likely |
|------|-----|------|--------|
| 1. Auth | 1h | 2h | 1.5h |
| 2. Projects | 2.5h | 3h | 2.5h |
| 3. Reviews | 1.5h | 2.5h | 2h |
| 4. Conflict | 0.75h | 1.5h | 1h |
| 5. Analytics | 1h | 1.5h | 1.25h |
| 6. Help | 0.3h | 0.5h | 0.4h |
| **Total** | **7.05h** | **10.5h** | **8.65h** |

**Realistic:** 8–9 hrs with debugging/testing.

---

## Links to Reference

- ADR-037: `docs/adr/ADR-037-reposition-to-expert-validation-studio.md`
- Mobile Projects: `mobile/app/trust/projects/[id].tsx`
- Mobile Reviews: `mobile/app/trust/reviews.tsx`
- Backend API: Backend commit 1e27398 + recent (Phase 4)
- Current web routes: `web/src/app.tsx`
- Supabase SDK: https://supabase.com/docs/reference/javascript/auth

---

## Next Steps (Ready to Start)

1. Create skeleton files for Tasks 1–6
2. Start with Task 1 (Auth) — most foundational
3. Parallelize Tasks 2+3 once auth wired
4. Integrate Tasks 4+5 after core surfaces done
5. Ship at end of P0 (after Task 3)
6. P1 ships day after P0 validated

**Estimated ship date (P0): +1 day from now | P1: +2 days**
