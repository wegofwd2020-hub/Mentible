# Author Commons — design (draft)

**Status:** Draft, not approved. No code until approved.
**Date:** 2026-11-24
**Related:** ADR-027 (publish + Open Library, partly built), ADR-021 (Everyone Library; review gate in D8), ADR-028 (Open Shelves, third-party catalog; unchanged), ADR-020 (super-admin audit, not used here).

---

## 1. Intent and why

Authors publish a finished book (EPUB and/or PDF) to a shared shelf. Any registered Mentible member can browse that shelf and download the books.

**Why (proposed, to confirm):** give members a place to find finished books written by other authors. The user has not yet stated the why in their own words. Confirm this before the plan.

## 2. Name

**Author Commons.** Chosen over Open Library (collides with Internet Archive's Open Library and with our Open Shelves), Public Library (implies public domain), and Open Book Shelf (collides with Open Shelves and the Shelves tab). A trademark check is required before alpha.

## 3. Goals, non-goals, anti-goals

**Goals**
- A separate tab, next to Library, that lists published finished books.
- Browse by title and author, and by language.
- Download EPUB or PDF from a book's detail page.
- An author can publish and unpublish their own books.

**Non-goals (this design)**
- The approver or review step. Deferred until the user defines the approver roles (see section 8).
- Ratings, comments, reviews, recommendations.
- Payment or paid books.
- Drafts. Not a goal for any path.
- Full-text search (title and author substring only).

**Anti-goals**
- A draft or unpublished book must never appear in the listing or be downloadable.
- Nothing here changes Open Shelves, which browses third-party catalogs. ADR-028's rule that we never host third-party files stays intact.

## 4. Current state (verified on main)

- **Publish exists.** `POST /api/v1/library/{book_id}/publish?format=epub|pdf` takes book.json, runs an async export job, and registers the artifact. Ownership is first-publisher-wins (`published_book_owner`).
- **Artifacts are stored per (book, format).** One row per format in `published_artifact`; republish replaces it. Files live on disk, with a content hash, size and filename.
- **Metadata endpoint is anonymous.** `GET /api/v1/library/{book_id}/artifacts` returns format, size, hash and date only.
- **Download is registration-gated** (ADR-027 D9): `GET /api/v1/library/{book_id}/artifacts/{format}` requires a signed-in user.
- **Gap 1: no listing.** Nothing lists other members' published books. The "Open Library →" link after a save goes to the user's own Library.
- **Gap 2: no title, author, description or cover in the registry.** The registry holds only file facts.
- **Gap 3: no unpublish.** There is no delete or unpublish route.

## 5. Approaches

**A. Catalog table beside the registry (recommended).** Add one table, `author_commons_entry`, written when a publish job completes. It holds title, author display name, description, language, formats, status and dates. Add list and detail endpoints, a new unpublish route, and a new tab. Keeps the existing publish and download code.
- *Trade-off:* one migration and one new write path. Clean separation: the listing never reads the book content.

**B. Reuse the registry only, with the book.json copied at publish time.** Read title and author from a stored copy of book.json.
- *Trade-off:* no new table, but we store the whole book content for every listing. Heavier, and it makes the listing depend on the full book file.

**C. Publish an OPDS feed for Author Commons.** Serve a standards feed that other readers can consume.
- *Trade-off:* interoperable, but a bigger build, and it needs the feed work from ADR-028 first. Later, not now.

**Recommendation: A.** It is the smallest change that closes all three gaps, and it keeps the content-free listing that ADR-027 already assumes.

## 6. Design (under approach A)

Items marked **[my call]** are proposals to confirm.

### 6.1 Data

New table `author_commons_entry`:

| Column | Type | Notes |
|---|---|---|
| `book_id` | text, primary key | Same id as the publish route. |
| `owner_sub` | text | From `published_book_owner`. Only this subject may unpublish. |
| `title` | text | Taken from book.json at publish time. |
| `author_name` | text | **[my call]** Author's display name, see open item 8.2. |
| `description` | text, nullable | From book.json, if present. |
| `language` | text | From book.json. |
| `formats` | text array | Subset of `epub`, `pdf` that are live. |
| `status` | text | `live` or `unpublished`. A `pending_review` value can be added later with no schema change. |
| `published_at` / `updated_at` | timestamptz | |

Write rules:
- Created or updated when a publish job completes. Status becomes `live`.
- Republish updates the row. It never changes `owner_sub`.

### 6.2 API

All new listing routes require a signed-in user (matches ADR-027 D9).

- `GET /api/v1/author-commons?query=&language=&page=` returns live entries only. **[my call]** Page size 20. Query matches title or author, case-insensitive substring.
- `GET /api/v1/author-commons/{book_id}` returns metadata for one live entry, plus its formats.
- `POST /api/v1/library/{book_id}/unpublish` is owner-only and sets status to `unpublished`. **[my call]** Hides the entry and deletes the stored files. See open item 8.3.
- Download reuses the existing `GET /api/v1/library/{book_id}/artifacts/{format}` route. It returns 404 if the entry is not live, so an unpublished book cannot be downloaded.

The existing anonymous `GET /api/v1/library/{book_id}/artifacts` stays as it is. It is the reader indicator, and it exposes no title or author.

### 6.3 Mobile

- **New tab** "Author Commons" in `mobile/app/(tabs)/_layout.tsx`, placed after Library. Route file `author-commons.tsx`. **[my call]** Placement after Library; see open item 8.5.
- **List:** cover placeholder, title, author, formats, search box, language filter.
- **Detail:** description, formats, and Download EPUB / Download PDF. Downloads use the signed-in token and the existing share or save path.
- **Rename copy:** "Open Library" becomes "Author Commons" everywhere, about 51 occurrences in 23 files. The "Open Library →" link after a save points to the new tab.
- **Publish button:** unchanged in behaviour. Copy updated.
- **Unpublish:** an action on the author's own book screen, with a confirm dialog.
- **Help:** per the project's Definition of Done, each user-facing feature needs a `FEATURES` key and a Help topic in the same PR.
- **Offline:** not supported in v1. Browsing needs a network.

### 6.4 Privacy

- The listing shows the author's display name only. No email, no account id.
- Only title, author, description, language and formats are shown. No book content is listed.

## 7. Constraints

- **Review gate (ADR-021 D8).** A public shelf waits on legal review (takedown), moderation and demand. This design adds no review step. The `status` field is the seam where an approver step can be inserted later.
- **Hosting (ADR-027).** Our servers host the published files. Unpublish removes them.
- **Registration.** Browsing and downloading require a signed-in user.
- **Trademark.** Name check before alpha.

## 8. Open items (for the user)

8.1 **Approver / review step.** Deferred. Two kinds of approvers are being defined. This design leaves room for it.

8.2 **Author display name.** Which name appears on a listing: the account's display name, a name typed at publish time, or the name inside book.json? Not established.

8.3 **Unpublish behaviour.** Delete the files, or only hide the listing and keep the files? This design deletes them.

8.4 **What "finished" means.** Does publish require the book to be finished, and who decides? Not checked. The publish button may allow publishing a work in progress.

8.5 **Tab placement.** After Library, as proposed. The nav bar already has ten tabs.

8.6 **Cover image.** Use the book's cover from book.json, a placeholder, or none in v1?

## 9. Calls I made (check these)

- Page size 20; title and author substring search; language filter by exact code.
- Unpublish deletes stored files.
- Listing requires sign-in; the anonymous artifact-metadata route is unchanged.
- Tab after Library.

## 10. Build sequence (after approval; the plan will break these into tasks)

1. Rename copy and help topics (no behaviour change).
2. `author_commons_entry` migration, and a write on publish completion.
3. List and detail endpoints, with tests for: sign-in required, only live entries returned, drafts never returned, unpublished entries hidden.
4. Unpublish route, owner-only, with tests for: non-owner refused, files removed, download returns 404 after unpublish.
5. Mobile tab: list, search, language filter, detail, download.
6. Author unpublish action on the book screen.
7. Full backend and mobile suites; mutation check on the owner guard and the live-only filter.

## 11. Test plan (summary)

- Backend: listing returns live entries only; no draft or unpublished entry appears; anonymous calls refused; non-owner unpublish refused; download after unpublish returns 404.
- Mobile: tab renders list and empty state; search and language filter; download calls the authenticated route; unpublish confirm dialog.
- Help coverage gate passes with the new topic.
