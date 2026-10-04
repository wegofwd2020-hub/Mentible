# Phase 4.1 Status: Common Projects Web Implementation

**Date:** 2026-10-04  
**Status:** Scaffolding complete. Core feature ready for integration & testing.

---

## Completed Tasks

### ✅ Task 1: Web API Client (30-45 min)
**Files:** `web/src/lib/api/common-projects.ts`, `web/src/lib/api/types.ts`, `web/src/lib/api/index.ts`

API client matching mobile trustClient pattern:
- `listCommonProjects(opts?)` — GET list with search/tags/pagination
- `getCommonProject(id, token?)` — GET detail
- `publishCommonProject(body, token)` — POST (authed)
- `updateCommonProject(id, body, token)` — PUT (author-only)
- `deleteCommonProject(id, token)` — DELETE (author-only)
- `importCommonProject(id, token, opts?)` — POST (authed, conflict handling)
- Admin: `takeDownCommonProject()`, `restoreCommonProject()`
- Optional auth support (public list + authed import)
- Type-safe error handling (`ApiError` class)

### ✅ Task 2 & 3: List & Detail Pages (2.5-3 hrs)
**Files:** 
- `web/src/pages/trust/common/index.tsx` — List page
- `web/src/pages/trust/common/[id].tsx` — Detail page

**List page features:**
- Grid layout (responsive 1/2/3 cols)
- Search by title/description
- Tag filtering (multiple select)
- Sort (newest/popular/author)
- 20-item pagination
- Project preview (title + truncated description + author + date)
- View + Import CTAs
- Empty state + loading skeletons
- Auth-gated import button

**Detail page features:**
- Full metadata (title, description, author, dates, tags)
- Expandable TOC (subjects → units → subtopics, ~first 5 units)
- Author-only Edit/Unpublish buttons
- Taken-down project notice + disabled import
- 404 fallback
- Loading state

### ✅ Task 4: Navigation & Routing (15-30 min)
**Files:** `web/src/app.tsx`, `web/src/components/Navigation.tsx`, `web/src/index.tsx`, `web/src/index.css`

React Router setup:
- `/trust/common` → list page
- `/trust/common/:id` → detail page
- `/` → fallback to list
- Navigation header with auth-gated links
- Active route indicator

### ✅ Task 5: Import Conflict Handling (30-45 min)
**Files:** `web/src/components/ImportConflictDialog.tsx`, `web/src/components/Toast.tsx`, updated `[id].tsx`

Conflict resolution UX:
- Modal on 409 title collision
- Three options: new with suffix (2)/(3), destructive replace, cancel
- Confirmation step before replace
- Toast notifications (success/error auto-dismiss)
- Auto-navigate to imported project on success
- Loading state during operation

---

## Architecture Notes

### API Client Pattern
Mirrors `mobile/src/api/trustClient.ts`:
- `trustFetch<T>()` helper wraps fetch with auth headers + error handling
- Optional auth (no token = public list endpoints)
- Clean error types (`ApiError` with status code)
- Per-function typed contracts

### Component Separation
- Pages: stateful, data-fetching, route-specific (`trust/common/*`)
- Components: reusable, composable (`components/*`)
- No shared state manager yet (hooks + localStorage only)

### Routing Strategy
React Router for web; mobile uses Expo Router (file-based).
Future: consider unified routing layer if web/mobile codebases merge.

---

## Known Limitations / TODO

1. **No build infrastructure yet**
   - No `package.json`, tsconfig, webpack/vite config
   - Web pages are TypeScript scaffolding; not runnable without wiring
   - Needs: React Router, Tailwind, React, TypeScript, build tool setup

2. **Auth integration incomplete**
   - Pages read token from `localStorage` as a placeholder
   - No AuthContext, login flow, or session management
   - TODO: Integrate with Supabase JWKS verification (ADR-014)
   - TODO: Create `/login` page

3. **Project navigation incomplete**
   - Import success navigates to `/projects/{id}` (not implemented)
   - TODO: Create `/projects`, `/projects/{id}`, `/settings` pages

4. **No conflict detection on backend**
   - API client expects 409 on title collision
   - Backend needs to implement conflict detection & return existing project metadata

5. **Admin pages deferred**
   - `Task 6: Super-Admin Moderation` — listed as optional, lower priority
   - Endpoints exist; UI not built

6. **Help content not added**
   - `Task 7: Help Content Updates` — mobile-focused (not web-specific)
   - Requires mobile help system integration (see `mobile/src/help-content/`)

7. **Tests not added**
   - `Task 8: Unit Tests` — minimum viable (API client + happy-path)
   - Needs: Jest, React Testing Library, mock Supabase
   - Deferred to Phase 4.1.1 if needed

---

## Next Steps (Priority Order)

### Phase 4.1.1: Web Buildability
1. Create `web/package.json` with React, React Router, Tailwind, TypeScript
2. Create `web/tsconfig.json`, `web/vite.config.ts` (or Webpack)
3. Create `web/public/index.html` entry point
4. Create `web/src/main.tsx` to replace `web/src/index.tsx`
5. Test local build: `npm run build` + `npm run dev`

### Phase 4.1.2: Auth & Routing Completion
1. Implement Supabase IdP login flow (ADR-014)
2. Create `/login` page + callback handler
3. Create `AuthContext` to replace localStorage reads
4. Wire auth state through all pages + API calls
5. Create `/projects`, `/projects/{id}`, `/settings` stubs
6. Test import → project detail flow end-to-end

### Phase 4.1.3: Backend Integration
1. Verify API endpoints return expected types (mobile API test)
2. Add conflict detection: `409 Conflict` with existing project metadata
3. Test import flow with real API (happy path + conflict case)

### Phase 4.1.4: Admin & Help (Optional)
1. Add `web/src/pages/admin/common-projects.tsx` (moderation UI)
2. Wire help topics for web (if needed; primary is mobile)
3. Add unit tests for API client + happy-path pages

### Phase 4.1.5: Deployment
1. Wire web build into CI (build + publish to mambakkam-net or mentible.app)
2. Test Expo web export vs. standalone React build (parity check)
3. Deploy & smoke test on mentible.app

---

## Commits This Session
- `b6acfb0` feat(web): add common-projects API client
- `b1f300b` feat(web): add common-projects list and detail pages
- `0c80a22` feat(web): add routing and navigation (Task 4)
- `acf8ba8` feat(web): add import conflict handling (Task 5)

**Total duration:** ~1.5–2 hrs (Tasks 1–5)

---

## Testing Checklist (Manual, Pre-Deployment)

- [ ] List page loads + renders projects grid
- [ ] Search + filters work (title, tags, sort)
- [ ] Pagination works
- [ ] Detail page loads TOC + author info
- [ ] Import button triggers conflict dialog on title collision
- [ ] Suffix option imports with "(2)" suffix
- [ ] Replace option shows confirmation + destroys old project
- [ ] Cancel closes dialog
- [ ] Toast shows success/error message
- [ ] Successful import navigates to project detail (once `/projects/{id}` page exists)
- [ ] Navigation links work (back buttons, auth-gated sections)
- [ ] Taken-down project shows notice + disabled import
- [ ] 404 on missing project
- [ ] Mobile comparison: check feature parity with `mobile/app/trust/common/`
