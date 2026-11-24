# Author Commons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authors publish a finished book from their Library to a shared shelf, "Author Commons", that any signed-in member can browse and download. Authors can hide their own books.

**Architecture:** Reuse the existing publish and download routes (ADR-027). Add one catalog table, `author_commons_entry`, written when a publish job completes. Add listing, detail and hide endpoints under `/api/v1/author-commons` and `/api/v1/library/{book_id}/hide`. Add a new tab after Library and move the Publish action from the saved-book screen into Library.

**Tech Stack:** FastAPI + asyncpg + Alembic (backend); React Native + Expo Router + Jest (mobile); Node compiler (unchanged).

**Spec:** `docs/superpowers/specs/2026-11-24-author-commons-design.md` (on main, self-approval update in its merged PR 646). Read it first.

## Global Constraints

- Name: **Author Commons**. No user-facing "Open Library" text remains.
- Publish gate: book title, author name, account name, date of publish and version are all required. A missing field refuses the publish.
- Version: starts at 1; increments once per publish action (see Review Focus 2).
- Hide keeps the project and its stored files; hidden entries are not listed and not downloadable.
- Listing, detail and download require a signed-in user.
- Listing page size: 20.
- Search: title and author, case-insensitive substring.
- Publish is offered only from Library, and only for a book with an exported EPUB or PDF.
- Cover: the book's `metadata.coverImage` if set; otherwise a placeholder. Not the `coverSvg` field.
- Every user-facing feature needs a `FEATURES` key and a Help topic in the same PR (project rule).

## Review Focus

1. **Book with no author or title.** A publish with a missing `metadata.author`, title or account name must be refused with 422 naming the missing field, and must not write a catalog row. Owning task: 4.
2. **EPUB + PDF publish counts as one publish.** The Publish action sends both formats. Version must go up by 1 per action, not 2. Owning task: 5.
3. **Republish after hide.** Hidden entry republished becomes live again, keeps its owner, and increments the version. Owning task: 5 and 7.
4. **Non-owner hide and hidden downloads.** A non-owner hide returns 403. A download of a hidden book returns 404 even with a valid token. Owning task: 7.
5. **Search input with SQL wildcards.** Query text containing `%` or `_` matches literally, and an empty query lists all live entries. Owning task: 6.

## File Structure

- Create: `backend/alembic/versions/0044_author_commons_entry.py` — migration.
- Create: `backend/src/library/commons_repo.py` — catalog table access.
- Create: `backend/src/library/commons_metadata.py` — the publish metadata gate (pure function).
- Create: `backend/src/library/commons_router.py` — listing, detail, hide routes.
- Modify: `backend/src/library/router.py` — gate at publish; mount hide route; download checks live status.
- Modify: `backend/src/export/tasks.py` — write the catalog row when a publish completes (near line 234).
- Modify: `backend/main.py` — mount `commons_router`.
- Create: `mobile/app/(tabs)/author-commons.tsx` — list screen.
- Create: `mobile/src/components/AuthorCommonsDetail.tsx` — detail view with downloads.
- Modify: `mobile/app/(tabs)/_layout.tsx` — add the tab after Library.
- Modify: `mobile/src/api/client.ts` — catalog and hide client functions.
- Modify: `mobile/app/(tabs)/library.tsx` — Publish and Hide actions for a book.
- Modify: `mobile/app/book/saved/[id].tsx` — remove the Publish action (moved to Library).
- Modify: `mobile/src/components/PublishButton.tsx` — accept `enabled` prop; copy rename.
- Modify: `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`, `mobile/src/help-content/tree.ts` — Help key and topic.
- Rename copy in the 8 files that contain "Open Library" under `mobile/src` and `mobile/app` (found on main), plus any help text.
- Tests: `backend/tests/test_commons_repo.py`, `backend/tests/test_commons_metadata.py`, `backend/tests/test_commons_router.py`, `mobile/__tests__/author-commons/*.test.tsx`, `mobile/__tests__/copy/author-commons-rename.test.ts`.

---

### Task 1: Rename copy to "Author Commons" (no behaviour change)

**Files:**
- Modify: every `mobile/src` and `mobile/app` file containing "Open Library" (run `git grep -l "Open Library" -- mobile/src mobile/app`).
- Test: `mobile/__tests__/copy/author-commons-rename.test.ts`

**Interfaces:**
- Produces: no code interfaces. The user-facing string "Author Commons" replaces "Open Library" everywhere in `mobile/src` and `mobile/app`.

- [ ] **Step 1: Write the failing test**

```ts
it("no user-facing copy says 'Open Library'", () => {
  // Walks mobile/src and mobile/app, excluding __tests__.
  // Expect zero matches for /Open Library/ in string literals and JSX text.
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd mobile && npx jest __tests__/copy/author-commons-rename.test.ts`
Expected: FAIL, listing the files that still contain "Open Library".

- [ ] **Step 3: Replace the copy**

Replace "Open Library" with "Author Commons" in the listed files. Keep code identifiers that are not user-facing (for example `openLibrary` props) unless the test flags them. The "Open Library →" link becomes "Author Commons →" and will point to the new tab in Task 9.

- [ ] **Step 4: Run the test and the help tests**

Run: `cd mobile && npx jest __tests__/copy __tests__/help`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/src mobile/app mobile/__tests__/copy
git commit -m "chore(copy): rename Open Library to Author Commons"
```

---

### Task 2: Move Publish from the saved-book screen into Library

**Files:**
- Modify: `mobile/app/book/saved/[id].tsx` (remove the `PublishButton` at about line 177).
- Modify: `mobile/app/(tabs)/library.tsx` (add the Publish action to the per-book window).
- Modify: `mobile/src/components/PublishButton.tsx` (accept `enabled: boolean` prop).
- Test: `mobile/__tests__/author-commons/publish-in-library.test.tsx`

**Interfaces:**
- Consumes: `exportStatus` for a book, from `@/storage/exportStatus` (`BookExportStatus`), which says whether an EPUB or PDF has been exported.
- Produces: `PublishButton` props `{ bookId: string; enabled: boolean }`. When `enabled` is false, the button renders disabled with the text "Export EPUB or PDF first".

- [ ] **Step 1: Write the failing test**

```tsx
it("library shows Publish only for a book with an exported EPUB or PDF", () => {
  // Render library with one book that has no export: expect no enabled Publish.
  // Render with an export present: expect Publish enabled.
});
it("saved-book screen no longer renders PublishButton", () => {
  // Render app/book/saved/[id]; expect queryByLabelText("Publish book to Author Commons") to be null.
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd mobile && npx jest __tests__/author-commons/publish-in-library.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Remove the `PublishButton` from the saved-book screen. In the Library per-book window, render `PublishButton` with `enabled` set from the book's export status (EPUB or PDF present). Keep the accessibility label "Publish book to Author Commons".

- [ ] **Step 4: Run and confirm pass**

Run: `cd mobile && npx jest __tests__/author-commons/publish-in-library.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app mobile/src/components/PublishButton.tsx mobile/__tests__/author-commons
git commit -m "feat(library): move Publish to Library, gated on an exported file"
```

---

### Task 3: Catalog table and repository

**Files:**
- Create: `backend/alembic/versions/0044_author_commons_entry.py`
- Create: `backend/src/library/commons_repo.py`
- Test: `backend/tests/test_commons_repo.py`

**Interfaces:**
- Produces, in `commons_repo.py`:
  - `@dataclass CommonsEntry`: `book_id, owner_sub, title, author_name, account_name, version, published_at, cover_data_uri | None, description | None, language | None, formats: list[str], status: str` (`"live"` or `"hidden"`).
  - `async def get_entry(conn, book_id) -> CommonsEntry | None`
  - `async def upsert_publish(conn, *, book_id, owner_sub, title, author_name, account_name, description, language, cover_data_uri, fmt, bump_version: bool) -> CommonsEntry`. Sets `status='live'`, adds `fmt` to `formats` (no duplicates), and increments `version` only when `bump_version` is True. Never changes `owner_sub` on conflict.
  - `async def set_status(conn, *, book_id, status) -> None`
  - `async def list_live(conn, *, query: str, language: str | None, limit: int, offset: int) -> tuple[list[CommonsEntry], int]`. Escapes `%` and `_` in `query`.
- Migration `0044` creates `author_commons_entry` with the columns from spec section 6.2 and `book_id` as primary key. Down-migration drops it.

- [ ] **Step 1: Write failing repo tests**

Tests (names and assertions):
- `test_upsert_creates_live_entry_version_1`: after one `upsert_publish(bump_version=True)`, status is `live`, version is 1, formats is `['epub']`.
- `test_second_format_does_not_bump_version`: `upsert_publish(fmt='pdf', bump_version=False)` leaves version 1 and formats `['epub','pdf']`.
- `test_republish_after_hide_is_live_and_bumps`: `set_status(hidden)` then `upsert_publish(bump_version=True)` gives status `live` and version 2.
- `test_upsert_never_changes_owner`: second upsert with a different `owner_sub` leaves the original owner.
- `test_list_live_excludes_hidden`: a hidden entry is not returned, and the total count excludes it.
- `test_list_live_escapes_wildcards`: query `"%"` returns zero entries when no title contains a literal `%`.

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && pytest tests/test_commons_repo.py -v`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the migration and repository**

Write `0044` with the spec's columns. Use `ON CONFLICT (book_id) DO UPDATE` in `upsert_publish`, adding to `formats` with `array(SELECT DISTINCT unnest(formats || $fmt))`, and `version = version + CASE WHEN $bump THEN 1 ELSE 0 END` on conflict. Use `ESCAPE '\'` for `ILIKE` in `list_live`.

- [ ] **Step 4: Run and confirm pass**

Run: `cd backend && pytest tests/test_commons_repo.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/0044_author_commons_entry.py backend/src/library/commons_repo.py backend/tests/test_commons_repo.py
git commit -m "feat(commons): catalog table and repository"
```

---

### Task 4: Publish metadata gate

**Files:**
- Create: `backend/src/library/commons_metadata.py`
- Modify: `backend/src/library/router.py` (call the gate before queueing the compile).
- Test: `backend/tests/test_commons_metadata.py`

**Interfaces:**
- Produces: `def missing_publish_fields(raw_book: dict, account_name: str | None) -> list[str]`. Returns the names of missing required fields, from `["title", "author", "account_name"]`. Title comes from the book's top-level `title`. Author comes from `metadata.author`. Account name comes from the argument. Empty or whitespace-only values count as missing.
- Router: when the result is non-empty, return 422 with `{"detail": "Missing required fields: <comma-separated names>"}` and do not queue the job or write any catalog row.

- [ ] **Step 1: Write failing tests**

- `test_all_present_returns_empty`
- `test_missing_author_reported`: `metadata` with no `author` yields `["author"]`.
- `test_whitespace_author_is_missing`
- `test_missing_title_and_account_reported_together`
- `test_publish_refused_422_without_author`: POST publish with no author returns 422, names `author`, and the router does not call `run_export` (patch it and assert not called).

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && pytest tests/test_commons_metadata.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement the gate and wire it into the publish route**

Account name is read from the signed-in account's display name. If the account has none, pass `None`, which is reported as missing.

- [ ] **Step 4: Run and confirm pass**

Run: `cd backend && pytest tests/test_commons_metadata.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/library/commons_metadata.py backend/src/library/router.py backend/tests/test_commons_metadata.py
git commit -m "feat(commons): refuse publish without title, author or account name"
```

---

### Task 5: Write the catalog row when a publish completes

**Files:**
- Modify: `backend/src/export/tasks.py` (in `run_export`, inside the `publish_book_id` branch near line 234, after `published_repo.upsert`).
- Modify: `backend/src/library/router.py` (pass `bump_version` into the job: `True` only when `fmt == "epub"`).
- Test: `backend/tests/test_commons_publish_hook.py`

**Interfaces:**
- Consumes: `commons_repo.upsert_publish` (Task 3); `raw_book` and the account name from the request.
- Produces: `run_export` gains a keyword argument `commons: dict | None` carrying `{owner_sub, title, author_name, account_name, description, language, cover_data_uri, bump_version}`. When set and the publish succeeds, the hook calls `upsert_publish` with `fmt`. Failure to write the catalog row logs an error and does not fail the artifact publish.

- [ ] **Step 1: Write failing tests**

- `test_epub_publish_creates_entry_v1` (run the hook with `fmt='epub'`, `bump_version=True`): entry live, version 1.
- `test_epub_then_pdf_is_one_publish`: run epub then pdf with `bump_version` set as the router sets it: version 1, formats `['epub','pdf']`.
- `test_catalog_failure_does_not_fail_artifact`: patch `upsert_publish` to raise; the artifact is still stored and the job reports done.

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && pytest tests/test_commons_publish_hook.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the `commons` argument to `run_export`. Pass it from `publish_book` in `router.py` (built from the validated `raw` book and the principal). Set `bump_version=(fmt == "epub")`. Call the repository inside the same `try` as the artifact write, but catch and log its exception separately.

- [ ] **Step 4: Run and confirm pass**

Run: `cd backend && pytest tests/test_commons_publish_hook.py tests/test_library_publish.py -v`
Expected: PASS (existing publish tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add backend/src/export/tasks.py backend/src/library/router.py backend/tests/test_commons_publish_hook.py
git commit -m "feat(commons): write catalog row on publish completion"
```

---

### Task 6: Listing and detail endpoints

**Files:**
- Create: `backend/src/library/commons_router.py`
- Modify: `backend/main.py` (mount the router).
- Test: `backend/tests/test_commons_router.py`

**Interfaces:**
- Consumes: `commons_repo.list_live`, `commons_repo.get_entry` (Task 3); `require_user` dependency used by `library/router.py`.
- Produces:
  - `GET /api/v1/author-commons?query=&language=&page=` → `{"items": [CommonsSummary], "total": int, "page": int, "page_size": 20}`. `CommonsSummary`: `book_id, title, author_name, account_name, version, published_at, formats, language, cover_data_uri`. Requires sign-in (401 without).
  - `GET /api/v1/author-commons/{book_id}` → `CommonsSummary` plus `description`. 404 when absent or not live. Requires sign-in.

- [ ] **Step 1: Write failing tests**

- `test_listing_requires_sign_in`: no token → 401.
- `test_listing_returns_only_live`: one live, one hidden → one item, total 1.
- `test_empty_query_lists_all_live`
- `test_search_matches_title_and_author_case_insensitive`
- `test_wildcard_query_is_literal` (Review Focus 5): query `%` returns total 0 when no title contains `%`.
- `test_detail_404_for_hidden`

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && pytest tests/test_commons_router.py -v`
Expected: FAIL (404 for every route, since the router is not mounted).

- [ ] **Step 3: Implement**

Use `require_user`. Page size is the constant 20. Pass `query` straight to `commons_repo.list_live`, which escapes it.

- [ ] **Step 4: Run and confirm pass**

Run: `cd backend && pytest tests/test_commons_router.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/library/commons_router.py backend/main.py backend/tests/test_commons_router.py
git commit -m "feat(commons): listing and detail endpoints"
```

---

### Task 7: Hide route, and downloads respect status

**Files:**
- Modify: `backend/src/library/commons_router.py` (add the hide route).
- Modify: `backend/src/library/router.py` (`download_artifact` returns 404 unless the entry is live).
- Test: `backend/tests/test_commons_hide.py`

**Interfaces:**
- Produces: `POST /api/v1/library/{book_id}/hide` → 200 `{"status": "hidden"}`. Owner only: 403 for any other signed-in user. 404 when no entry exists. Calls `commons_repo.set_status(status='hidden')`. Files are not deleted.
- `download_artifact`: looks up `get_entry`; when absent or not `live`, return 404 before reading bytes.

- [ ] **Step 1: Write failing tests**

- `test_hide_by_owner_sets_hidden`
- `test_hide_by_non_owner_is_403` (Review Focus 4)
- `test_hide_unknown_book_is_404`
- `test_download_after_hide_is_404` (Review Focus 4): valid token, hidden entry → 404.
- `test_hide_keeps_stored_files`: after hide, `artifact_store.read_artifact(path)` still returns bytes.
- `test_republish_after_hide_is_live_and_bumps` (Review Focus 3): hide, then the publish hook with `bump_version=True` → status live, version 2, same owner.

- [ ] **Step 2: Run and confirm failure**

Run: `cd backend && pytest tests/test_commons_hide.py -v`
Expected: FAIL.

- [ ] **Step 3: Implement**

Owner check: compare the principal's `sub` with `entry.owner_sub`. Download check goes before the file read.

- [ ] **Step 4: Run and confirm pass**

Run: `cd backend && pytest tests/test_commons_hide.py tests/test_library_publish.py tests/test_commons_router.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/library/commons_router.py backend/src/library/router.py backend/tests/test_commons_hide.py
git commit -m "feat(commons): owner-only hide; downloads respect status"
```

---

### Task 8: Mobile client functions

**Files:**
- Modify: `mobile/src/api/client.ts`
- Test: `mobile/__tests__/author-commons/client.test.ts`

**Interfaces:**
- Produces:
  - `export type CommonsSummary = { book_id: string; title: string; author_name: string; account_name: string; version: number; published_at: string; formats: ("epub"|"pdf")[]; language: string | null; cover_data_uri: string | null }`
  - `export type CommonsPage = { items: CommonsSummary[]; total: number; page: number; page_size: number }`
  - `listAuthorCommons(token: string, opts: { query?: string; language?: string; page?: number }): Promise<CommonsPage>`
  - `getAuthorCommons(token: string, bookId: string): Promise<CommonsSummary & { description: string | null }>`
  - `hideAuthorCommons(token: string, bookId: string): Promise<void>`

- [ ] **Step 1: Write failing tests**

- `listAuthorCommons` sends `query` and `page` in the URL and the Bearer header.
- `getAuthorCommons` 404 → throws `ApiError` with status 404.
- `hideAuthorCommons` POSTs to the hide route.

- [ ] **Step 2: Run and confirm failure**

Run: `cd mobile && npx jest __tests__/author-commons/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** using the existing `authedFetch`/`ApiError` helpers in `client.ts`.

- [ ] **Step 4: Run and confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/client.ts mobile/__tests__/author-commons/client.test.ts
git commit -m "feat(commons): mobile client for the Author Commons API"
```

---

### Task 9: Author Commons tab (list, search, language filter)

**Files:**
- Create: `mobile/app/(tabs)/author-commons.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx` (add `<Tabs.Screen name="author-commons" />` after `library`).
- Test: `mobile/__tests__/author-commons/list.test.tsx`

**Interfaces:**
- Consumes: `listAuthorCommons`, `CommonsSummary` (Task 8); `useAuth().accessToken`.
- Produces: screen with a search box (debounced 300 ms) and a language picker. Each row shows cover (or placeholder), title, author name, formats, and opens the detail view (Task 10) on press.

- [ ] **Step 1: Write failing tests**

- `renders a row per live item`
- `shows an empty state when total is 0`
- `typing in search re-queries with the query string`
- `tab order places Author Commons directly after Library` (inspect `_layout.tsx` children order).

- [ ] **Step 2: Run and confirm failure**

Run: `cd mobile && npx jest __tests__/author-commons/list.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the screen and layout entry.

- [ ] **Step 4: Run and confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/author-commons.tsx" "mobile/app/(tabs)/_layout.tsx" mobile/__tests__/author-commons/list.test.tsx
git commit -m "feat(commons): Author Commons tab with search and language filter"
```

---

### Task 10: Detail view and downloads; hide action in Library

**Files:**
- Create: `mobile/src/components/AuthorCommonsDetail.tsx`
- Modify: `mobile/app/(tabs)/library.tsx` (Hide action for the author's own books, with a confirm dialog).
- Test: `mobile/__tests__/author-commons/detail.test.tsx`

**Interfaces:**
- Consumes: `getAuthorCommons`, `hideAuthorCommons` (Task 8).
- Produces: `AuthorCommonsDetail({ bookId }: { bookId: string })` showing description, version, publish date, account name, formats, and Download EPUB / Download PDF. Downloads call the authenticated artifact route with the Bearer token and save through the existing share/save path. Library's Hide action shows a confirm dialog and calls `hideAuthorCommons`.

- [ ] **Step 1: Write failing tests**

- `detail shows version, publish date and account name`
- `download uses the Bearer token`
- `hide asks for confirmation and calls the hide route only after confirm`
- `Cancel on the hide dialog makes no request`

- [ ] **Step 2: Run and confirm failure**

Run: `cd mobile && npx jest __tests__/author-commons/detail.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement** the detail component and the Library Hide action.

- [ ] **Step 4: Run and confirm pass.**

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/AuthorCommonsDetail.tsx mobile/app/\(tabs\)/library.tsx mobile/__tests__/author-commons/detail.test.tsx
git commit -m "feat(commons): detail view, downloads and Hide action"
```

---

### Task 11: Help topic and FEATURES key

**Files:**
- Modify: `mobile/src/help-content/features.ts` (add `{ key: "author-commons", label: "Author Commons (sharing finished books)" }`).
- Modify: `mobile/src/help-content/topics.ts` (add a topic with `featureKey: "author-commons"`).
- Modify: `mobile/src/help-content/tree.ts` (place the topic in the tree).
- Test: existing `mobile/__tests__/help/coverage.test.ts` (must pass).

- [ ] **Step 1: Run the coverage test after adding the FEATURES key only**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: FAIL (no topic for the new key).

- [ ] **Step 2: Add the topic** covering: publish from Library after exporting an EPUB or PDF; that books show with the author and account name; Hide removes the listing but keeps the project.

- [ ] **Step 3: Run and confirm pass**

Run: `cd mobile && npx jest __tests__/help`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/help-content
git commit -m "docs(help): Author Commons topic"
```

---

### Task 12: Full verification and PR

**Files:** none changed unless a check fails.

- [ ] **Step 1: Backend full suite**

Run: `cd backend && pytest -q`
Expected: all pass, with the same skip count as on main.

- [ ] **Step 2: Mobile full suite, typecheck and lint**

Run: `cd mobile && npm test && npm run typecheck && npm run lint`
Expected: all pass; lint has no errors.

- [ ] **Step 3: Ruff (CI gate)**

Run: `ruff check backend/ pipeline/ && ruff format --check backend/ pipeline/`
Expected: no errors.

- [ ] **Step 4: Mutation checks**

For each, break the code, run the named test, expect FAIL, then restore:
- Owner check in hide → `test_hide_by_non_owner_is_403` fails.
- Live-only filter in listing → `test_listing_returns_only_live` fails.
- Metadata gate → `test_publish_refused_422_without_author` fails.
- Version bump on every format → `test_epub_then_pdf_is_one_publish` fails.

- [ ] **Step 5: Open the PR** with the spec link, the task list, and the mutation results. Do not merge until CI on the PR is green.

---

## Calls made in this plan (check these)

- The Publish action sends both EPUB and PDF, and the version bumps only on the EPUB publish. A PDF-only republish would not bump the version. Confirm this is acceptable.
- Account name is the signed-in account's display name at publish time; a missing name blocks publishing.
- The migration number 0044 follows the latest on main (0043).
- Downloads from the Author Commons detail view use the existing save path.

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-11-24-author-commons.md`. Please review it.

Which execution approach would you prefer?

- **Subagent-driven:** a fresh subagent implements each task and a fresh reviewer checks it before the next starts, then a whole-branch review. Most thorough; more cost.
- **Native:** I implement every task in this session, then one fresh reviewer checks the whole branch. Cheaper and faster; no independent review until the end.

I recommend **subagent-driven**. There are 12 tasks, and several (3 to 7) pass interfaces between backend modules, so an interface mistake is easy to make and expensive to find late.
