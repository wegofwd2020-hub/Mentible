# Author Commons — design (draft)

**Status:** Draft, revised with the user's answers 2026-11-24. Not approved. No code until approved.
**Related:** ADR-027 (publish + Open Library, partly built), ADR-021 (Everyone Library; review gate in D8), ADR-028 (Open Shelves, third-party catalog; unchanged), ADR-016 (content version), ADR-008 (release versions).

---

## 1. Intent and why

Authors publish a finished book (EPUB and/or PDF) from their Library to a shared shelf. Any registered Mentible member can browse that shelf and download the books.

**Why (proposed, to confirm):** give members a place to find finished books written by other authors. The user has not yet stated the why in their own words.

## 2. Name

**Author Commons.** Chosen over Open Library (collides with Internet Archive's Open Library and with our Open Shelves), Public Library (implies public domain), and Open Book Shelf (collides with Open Shelves and the Shelves tab). A trademark check is required before alpha.

## 3. Goals, non-goals, anti-goals

**Goals**
- A separate tab, next to Library, that lists published books.
- Browse by title and author, and by language.
- Download EPUB or PDF from a book's detail page.
- An author can publish and hide their own books.

**Non-goals (this design)**
- The approver or review step. Deferred until the user defines the approver roles (section 8.1).
- Ratings, comments, reviews, recommendations.
- Payment or paid books.
- Drafts. Not a goal for any path.
- Full-text search (title and author substring only).

**Anti-goals**
- A draft or hidden book must never appear in the listing or be downloadable.
- Nothing here changes Open Shelves, which browses third-party catalogs. ADR-028's rule that we never host third-party files stays intact.

## 4. Current state (verified on main)

- **Publish exists, but only from a saved book screen.** The Publish button lives in `mobile/app/book/saved/[id].tsx`. The route `POST /api/v1/library/{book_id}/publish?format=epub|pdf` takes book.json, runs an async export job, and registers the artifact. Ownership is first-publisher-wins (`published_book_owner`).
- **Artifacts are stored per (book, format).** One row per format in `published_artifact`; republish replaces it. Files live on disk, with a content hash, size and filename.
- **Metadata endpoint is anonymous.** `GET /api/v1/library/{book_id}/artifacts` returns format, size, hash and date only.
- **Download is registration-gated** (ADR-027 D9): `GET /api/v1/library/{book_id}/artifacts/{format}` requires a signed-in user.
- **The book type already has an optional `author` field** (`mobile/src/types/book.ts`) and an inline cover.
- **Gap 1: no listing.** Nothing lists other members' published books.
- **Gap 2: the registry has no title, author, version, publish-date or account name.** It holds file facts only.
- **Gap 3: no hide or unpublish route.**

## 5. Approaches

**A. Catalog table beside the registry (recommended).** Add one table, `author_commons_entry`, written when a publish job completes. It holds the required metadata, status and dates. Add list and detail endpoints, a hide route, and a new tab. Keeps the existing publish and download code.
- *Trade-off:* one migration and one new write path. The listing never reads the book content.

**B. Reuse the registry only, with the book.json copied at publish time.** Read the metadata from a stored copy of book.json.
- *Trade-off:* no new table, but we store the whole book content for every listing. Heavier, and the listing depends on the full book file.

**C. Publish an OPDS feed for Author Commons.** Serve a standards feed that other readers can consume.
- *Trade-off:* interoperable, but a bigger build, and it needs the feed work from ADR-028 first. Later, not now.

**Recommendation: A.** The smallest change that closes all three gaps, and it keeps the content-free listing that ADR-027 already assumes.

## 6. Design (under approach A)

Items marked **[my call]** are proposals to confirm.

### 6.1 Publish gate (the metadata rule)

A book can be published to Author Commons only when all of these are set:

| Field | Source | Notes |
|---|---|---|
| Book title | book.json `title` | |
| Author name | book.json `author` | Set when the author adds the cover page and tags, then adds the book to the Library. A book without an author cannot be published. |
| Date of publish | server clock | Set at publish time. |
| Version | **[my call]** publish counter for this book | Starts at 1; each republish increments it. Not in the book file today. |
| Account name | **[my call]** the account's display name | Not in the book file today. Pulled from the signed-in account at publish time. |

If any field is missing, the publish is refused with a message naming the missing field.

**Cover:** taken from the book file's inline cover. If the book has none, a placeholder is shown.

**Export precondition:** publish is offered only in the Library, and only for a book that already has an exported EPUB or PDF. The author's own check (the "analyzed" step) is assumed by the user and is not enforced by code.

### 6.2 Data

New table `author_commons_entry`:

| Column | Type | Notes |
|---|---|---|
| `book_id` | text, primary key | Same id as the publish route. |
| `owner_sub` | text | From `published_book_owner`. Only this subject may hide or republish. |
| `title` | text | Required (6.1). |
| `author_name` | text | Required (6.1). |
| `account_name` | text | Required (6.1). |
| `version` | integer | Required (6.1). |
| `published_at` | timestamptz | Required (6.1). |
| `cover_svg` | text, nullable | From the book file's inline cover. |
| `description` | text, nullable | From book.json, if present. |
| `language` | text | From book.json. |
| `formats` | text array | Subset of `epub`, `pdf` that are live. |
| `status` | text | `live` or `hidden`. A `pending_review` value can be added later with no schema change. |
| `updated_at` | timestamptz | |

Write rules:
- Created or updated when a publish job completes. Status becomes `live`.
- Republish updates the row and increments `version`. It never changes `owner_sub`.

### 6.3 API

All listing routes require a signed-in user (matches ADR-027 D9).

- `GET /api/v1/author-commons?query=&language=&page=` returns live entries only. **[my call]** Page size 20. Query matches title or author, case-insensitive substring.
- `GET /api/v1/author-commons/{book_id}` returns metadata for one live entry, plus its formats.
- `POST /api/v1/library/{book_id}/hide` is owner-only and sets status to `hidden`. The project and its stored files are kept; only the listing and downloads are turned off (user answer, 8.3).
- Republishing after a hide sets status back to `live` and increments `version`. **[my call]**
- Download reuses the existing `GET /api/v1/library/{book_id}/artifacts/{format}` route. It returns 404 when the entry is not live, so a hidden book cannot be downloaded.

The existing anonymous `GET /api/v1/library/{book_id}/artifacts` stays as it is. It is the reader indicator, and it exposes no title or author.

### 6.4 Mobile

- **New tab** "Author Commons" in `mobile/app/(tabs)/_layout.tsx`, placed after Library. Route file `author-commons.tsx`.
- **List:** cover (from the book file, or a placeholder), title, author, formats, search box, language filter.
- **Detail:** description, version, publish date, account name, formats, and Download EPUB / Download PDF. Downloads use the signed-in token and the existing share or save path.
- **Publish moves to Library.** The Publish action moves from the saved-book screen to the Library, next to the EPUB and PDF exports. It is enabled only when an exported EPUB or PDF exists for the book.
- **Hide action:** on the author's own Library entry, with a confirm dialog. The project stays.
- **Rename copy:** "Open Library" becomes "Author Commons" everywhere, about 51 occurrences in 23 files. The "Open Library →" link after a save points to the new tab.
- **Help:** per the project's Definition of Done, each user-facing feature needs a `FEATURES` key and a Help topic in the same PR.
- **Offline:** not supported in v1. Browsing needs a network.

### 6.5 Privacy

- The listing shows the author name and account name only. No email, no account id.
- Only the metadata in 6.2 is shown. No book content is listed.

## 7. Constraints

- **Review gate (ADR-021 D8).** A public shelf waits on legal review (takedown), moderation and demand. This design adds no review step. The `status` field is the seam where an approver step can be inserted later.
- **Hosting (ADR-027).** Our servers host the published files. Hiding keeps them, so a republish is quick.
- **Registration.** Browsing and downloading require a signed-in user.
- **Trademark.** Name check before alpha.

## 8. Open items

8.1 **Approver / review step.** Still open. Two kinds of approvers are being defined. This design leaves room for it.

8.2 **Account name vs author name.** The spec lists both (6.1). Confirm the account name is the login display name, and that the author name is the name on the book. If they are always the same for a user, one field would do.

8.3 **Hidden books keep their files.** Resolved by your answer ("hide it, the project should still exist"). Files are kept so a republish is quick. Confirm this is what you meant.

8.4 **Finished = exported and analyzed.** Resolved: publish is offered only from Library, for a book with an exported EPUB or PDF. The "analyzed" check is your step and is not enforced in code.

## 9. Calls I made (check these)

- **Version:** a per-book publish counter, starting at 1. Not in the book file today.
- **Account name:** the signed-in account's display name, taken at publish time.
- **Page size 20;** title and author substring search; exact language code filter.
- **Republish after hide** makes the entry live again and increments the version.
- **Listing requires sign-in;** the anonymous artifact-metadata route is unchanged.
- **Tab after Library;** Publish moves into Library.

## 10. Build sequence (after approval; the plan will break these into tasks)

1. Rename copy and help topics (no behaviour change).
2. Move Publish from the saved-book screen into Library, gated on an exported file.
3. `author_commons_entry` migration; the metadata gate at publish; the write on completion.
4. List and detail endpoints. Tests: sign-in required, only live entries returned, drafts never returned, hidden entries hidden.
5. Hide route, owner-only. Tests: non-owner refused, download returns 404 after hide, republish makes it live again.
6. Mobile tab: list, search, language filter, detail, download.
7. Full backend and mobile suites; mutation check on the owner guard and the live-only filter.

## 11. Test plan (summary)

- Backend: listing returns live entries only; no draft or hidden entry appears; anonymous calls refused; metadata gate refuses a book with a missing author; non-owner hide refused; download after hide returns 404.
- Mobile: tab renders list and empty state; search and language filter; download calls the authenticated route; hide confirm dialog; Publish appears in Library only when an export exists.
- Help coverage gate passes with the new topic.
