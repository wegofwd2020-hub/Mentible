# Export status indicators + reader-visible artifacts — build plan

Per-book **EPUB / PDF status indicators** on the Books and Library surfaces, plus
**reader-visible hosted artifacts** so a viewer can see a book's PDF/EPUB is
available and download it. Requested 2026-07-04.

**Decisions (confirmed with the architect):**
- **5 states per format:** `none` (grey) · `generating` (pulsing) · `done`
  (green, current) · `stale` (amber — book edited since export) · `failed` (red).
- **Both lists:** the Books tab (author's full set) and the Library shelf.
- **Reader-visible:** indicators + downloads must work for viewers, not just the
  author's device → requires hosting artifacts (Phase B). This **lifts the
  ADR-021 D8 build gate** and implements the ADR-027 Open-Library artifact slice.

This is why it is phased: Phase A is device-local and ships independently; Phase B
is the backend/hosting piece with real architecture decisions and an ADR gate.

---

## Background (as-built, 2026-07-04)

- Export is now an **async job** (`POST /export/jobs` → poll → `/artifact`); the
  compiled bytes live in Redis with a 1h TTL — **ephemeral, not hosted**.
- **EPUB** export state is the only thing persisted per book today: `saveEpub`
  (`mobile/src/storage/epubLibrary.ts`, `EpubMeta{compiledAt}`) via
  "Save to Library (EPUB3)" on the author edit screen. **PDF is not tracked** —
  checkout just downloads bytes.
- `EpubMeta` has **no version link** to `Book.updatedAt`, so staleness can't be
  detected today.
- Export triggers: `CheckoutButton` (`/book/read/[id]`, EPUB+PDF, ungated) and
  `SaveToLibraryButton` (`/book/saved/[id]`, EPUB only, behind `RequireSignIn`).
- The Library tab renders `EpubMeta[]` (`listEpubs()`), not the book store; the
  Books tab renders `BookMeta[]`. `BookCover` already has one overlay `badge`
  slot (used for "EPUB3") and the tile footer hosts icon chips.

---

## Phase A — author-facing indicators (device-local, no ADR gate)

Delivers the grey→generating→green→amber→red pills for the author, on both lists,
using local state only. Reader devices show grey until Phase B.

### A1. Local export-status store — `mobile/src/storage/exportStatus.ts`
A small AsyncStorage/localStorage index, one entry per book, tracking **both**
formats independently. Separate from `epubLibrary` (which stores the actual EPUB
bytes) — this is just status metadata.

```ts
type ExportFormat = "epub" | "pdf";
interface FormatStatus {
  state: "generating" | "done" | "failed";   // "none"/"stale" are DERIVED, not stored
  jobId?: string;            // active async job → reconcile on list focus
  compiledAt?: string;
  sourceUpdatedAt?: string;  // Book.updatedAt captured at export → staleness compare
  sizeBytes?: number;
  error?: string;
}
type BookExportStatus = Partial<Record<ExportFormat, FormatStatus>>;
// keyed by bookId
```
- `none` = no entry. `stale` = derived at read time: `state==="done" &&
  book.updatedAt > sourceUpdatedAt`.
- API: `getExportStatus(bookId)`, `setFormatStatus(bookId, fmt, patch)`,
  `deriveState(fmtStatus, bookUpdatedAt)`.

### A2. Tracked export wrapper — used by both buttons
A thin wrapper around `exportBook` that writes the status store around the call
(skip `cover`): set `generating` (with `jobId`, `sourceUpdatedAt`) → `done` /
`failed`. Centralises status so the two call sites stay simple.

### A3. Reconcile-on-focus
On Books/Library `useFocusEffect`, for any `state==="generating"` with a `jobId`,
poll `GET /export/jobs/{jobId}` once and settle to `done`/`failed`. Handles the
author navigating away mid-compile.

### A4. Indicator component — `mobile/src/components/ExportStatusPills.tsx`
Given `bookId` + `book.updatedAt`, render two compact pills (EPUB · PDF) coloured
by derived state, with accessible labels ("PDF: up to date", "EPUB: generating",
"PDF: needs re-export", "EPUB: failed"). `generating` uses a small pulse/spinner.

### A5. Placement
- Books tab items and Library tiles (tile footer row). Keep the reader/demo shelf
  otherwise unchanged (no new export controls).

### A6. Tests
Store round-trip + staleness derivation; wrapper transitions; pill state→style
mapping; reconcile settles generating→done/failed.

---

## Phase B — reader-visible hosted artifacts (ADR-027 slice; lifts ADR-021 D8)

Makes the indicators + downloads real for viewers. **Open architecture decisions
below need confirmation before building B.**

### B1. Durable artifact store (OPEN DECISION — storage backend)
Options: (a) filesystem on the VPS + nginx/FastAPI serve (pragmatic, no new infra;
single-host), (b) Postgres `bytea` (transactional, but multi-MB blobs in the DB),
(c) object store (S3/R2 — none configured). **Recommend (a)** for the single-VPS
reality, with a DB registry row pointing at the file.

### B2. Registry (DB) — new table `published_artifact` (alembic 0007)
`(book_id, format, content_hash, size_bytes, published_at, published_by, version)`,
one row per (book, format). `content_hash` ties the artifact to a book content
version so staleness is server-authoritative.

### B3. Publish step (OPEN DECISION — trigger)
Does a normal export auto-publish, or is there a deliberate **"Publish to Open
Library"** action (ADR-027 draft-vs-release distinction)? **Recommend a deliberate
publish action** — the author decides to release; personal checkout stays private.

### B4. Endpoints
- `GET /api/v1/library/{book_id}/artifacts` — **public metadata** (per ADR-027 D9:
  anon → status/size only). Drives reader indicators.
- `GET /api/v1/library/{book_id}/artifacts/{format}` — **registration-gated
  download** (auth required; ADR-027 D9 register-to-read).
- `POST /api/v1/library/{book_id}/publish` — author publishes an exported artifact
  (auth + ownership).

### B5. Catalog reach (OPEN DECISION — discovery)
A reader only sees indicators for books on their shelf. How do published books
reach a reader's Library — bundled/seeded only (v1), or a browsable published
catalog (full ADR-021 Everyone Library)? **Recommend v1 = indicators/downloads on
books already on the shelf (bundled + shared); defer a discovery catalog.**

### B6. Mobile reconciliation
`ExportStatusPills` reads **local** status (author) OR the **public** artifacts
endpoint (reader) for the book, so both audiences get correct colours.

### B7. ADR updates
- ADR-021: note D8 build-gate lifted for the artifact slice.
- ADR-027: move the release/artifact portion from Proposed → In progress; record
  storage/publish/gating decisions (B1/B3/B5).

---

## Sequencing
1. **Phase A** — ship the author indicators now (self-contained, tested).
2. **Confirm B1/B3/B5** (storage backend, publish trigger, catalog reach).
3. **Phase B** — registry + endpoints + hosting + reader reconciliation + ADRs.
