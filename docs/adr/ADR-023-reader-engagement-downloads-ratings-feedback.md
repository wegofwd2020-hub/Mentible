# ADR-023 — Reader engagement: downloads, ratings (1–5★) & feedback on published books

**Status:** Proposed — 2026-06-28
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-021 (Everyone Library & moderation — this is the build-trigger
for its Open decision 7, engagement slice), ADR-017 (default shareable library),
ADR-018 (system-owner signing), ADR-020 (super-admin operator + `admin_audit`),
ADR-014 (accounts + zero-knowledge sync), ADR-008 (release lifecycle / versioning),
ADR-004 (artifacts / email-PDF share, SBQ-EXP-001), ADR-027 (sharing & permission
model — gates who may rate/comment).

> **Amendment (2026-07-03, ADR-027 D6 / ADR-021 D9):** rating + feedback on an
> Open-Library book are **registered-users-only**. An **anonymous** visitor gets
> **metadata-only** (title/description/tags/cover/aggregate rating) and must register
> to read the content — so it cannot rate or comment. Where this ADR's mechanics assume
> a public reader, read "registered reader."

---

## Context

We let users build books; we want **reader/consumer engagement** on the books that
are published for others to read:

1. **Track downloads** by readers/consumers.
2. Let readers **rate** a book **1–5 stars**.
3. Let readers **provide feedback** on a book.

None of this exists today. Tracing the repo:

- `POST /api/v1/export` compiles and returns an EPUB/PDF **synchronously** — a
  download *mechanism* with **no counter, no event, no persistence**.
- Mobile `reviewStore.ts` is **author-side, local-only**: the author pastes in
  feedback they *received* (e.g. emailed reviewer notes). It is **not** a
  reader→author channel and carries **no numeric rating**.
- ADR-008 already gives us **DRAFT vs RELEASE** branding and per-book **version /
  edition** metadata — so features (1) and (2) of the broader request are *built*;
  this ADR is about the three engagement features above.

The blocker all three share is the same one ADR-021 named: there is no
server-hosted, publicly-readable surface where a "reader" (someone other than the
author) acts on a book — and ADR-021 **deferred** the Everyone Library (its D1)
pending hosting, discovery, moderation, and content-liability decisions.

**Key observation that unblocks us:** engagement does **not** need the Everyone
Library to exist. The **default library** (ADR-017) is *already* published to
everyone — owner-curated, bundled, publicly readable. Readers already consume those
books. So we can build a clean **engagement service against already-public books
now**, with zero new content-liability exposure (we publish that content), and
extend the *same* service to the Everyone Library when ADR-021 builds. This ADR
makes that the load-bearing decision.

---

## Decision (proposed)

### D1 — Build engagement now, scoped to already-public books; extend later

We **build** a reader-engagement service (downloads + ratings + feedback). Its
**publishable surface at this ADR** is the **owner-curated default library
(ADR-017)** — content that is already public, so it adds **no UGC hosting,
discovery, or content-liability** burden that ADR-021 deferred. The data model and
endpoints are designed so that when the **Everyone Library** is built, its published
books plug into the **same** engagement tables and routes with no schema break.

This **satisfies ADR-021 Open decision 7 for the engagement slice only**: it does
**not** trigger UGC hosting (Open decisions 1–3 there remain open).

### D2 — Engagement is a new, deliberately **non-private** data class

ADR-014 makes the backend a **blind store** for *private library content*
(zero-knowledge by default). Engagement is the opposite by nature: a download count,
a public star average, and a public review are **public-facing signals about public
books**. We therefore declare engagement a **distinct, server-readable data class**:

- It is **never** mixed with the e2e private-library store and never weakens it.
- It concerns **published** books only. A **private/draft** book has **no**
  engagement rows (you cannot rate or review what isn't published).
- This preserves the ADR-014 promise exactly: zero-knowledge still covers private
  content; engagement is simply not private content.

### D3 — Reader identity model: anonymous downloads, authenticated ratings/feedback

| Signal | Identity required | Why |
|---|---|---|
| **Download** | No — anonymous aggregate | A count of artifact fetches; no per-reader PII needed (D5). |
| **Rating (1–5★)** | **Yes** — signed-in account (ADR-014) | One rating per reader per book; prevents ballot-stuffing; lets the reader change/remove it. |
| **Feedback** | **Yes** — signed-in account | UGC needs an accountable author for moderation + takedown (D7). |

- **One rating per `(account, book)`** — a re-submit **updates** the prior rating
  (upsert), it does not add a second vote.
- Downloads store **no IP, no reader identifier** — only an aggregate increment plus
  optional coarse, non-identifying dimensions (D4/D5). Public BYOK usage (ADR-020 O6)
  is unaffected: downloading a public book never requires sign-in.

### D4 — Data model (Postgres / Alembic, server-side engagement store)

New tables, namespaced by **library tier** so default-library and (future)
Everyone-Library rows coexist. `library` ∈ {`default`, `everyone`}; `book_id` is the
manifest/book id.

```text
book_engagement                      -- one aggregate row per published book
  library            text   not null
  book_id            text   not null
  download_count     bigint not null default 0
  rating_count       int    not null default 0
  rating_sum         bigint not null default 0      -- avg = sum/count, computed
  updated_at         timestamptz not null
  primary key (library, book_id)

book_rating                          -- one row per reader per book (upsertable)
  library            text   not null
  book_id            text   not null
  account_id         uuid   not null references account(id)
  stars              smallint not null check (stars between 1 and 5)
  version_at_rating  text                              -- book version the reader saw (ADR-008)
  created_at         timestamptz not null
  updated_at         timestamptz not null
  primary key (library, book_id, account_id)

book_feedback                        -- reader → author/public review (UGC)
  id                 uuid   primary key
  library            text   not null
  book_id            text   not null
  account_id         uuid   not null references account(id)
  body               text   not null                  -- length-capped (D7)
  linked_rating      smallint                          -- optional 1–5 shown with the review
  version_at_feedback text                             -- ADR-008 version stamp
  state              text   not null default 'visible' -- visible | hidden | removed (D7)
  created_at         timestamptz not null
  updated_at         timestamptz not null

book_download_event                  -- append-only, privacy-minimal (D5)
  id                 bigserial primary key
  library            text   not null
  book_id            text   not null
  version            text                              -- which edition was pulled (ADR-008)
  format             text                              -- epub | pdf
  occurred_at        timestamptz not null
  -- NO ip, NO account_id, NO device id by default
```

- **Downloads are tracked per `version`/`format`** (ADR-008) so we can see which
  edition readers actually pull. The **aggregate counter** (`book_engagement`) is the
  hot read; the **event log** is the audit/analytics trail and is the writer of
  record (the counter is derived/denormalised for fast reads).
- **Ratings and feedback are book-level** (they aggregate across editions) but each
  row **stamps the version the reader was on**, so "this 2★ was on v0.3, fixed in
  v1.2" is answerable.

### D5 — What counts as a "download" (precise, so the metric means something)

A **download event** is recorded when a **published artifact is produced/served for
a reader to keep** — i.e. a successful `epub`/`pdf` response from the export path
**for a published book**. Concretely:

- **Now (default library):** the existing `POST /api/v1/export` increments the count
  **only when** the compiled book's manifest id resolves to a **published** entry
  (ADR-017 manifest, `status = published`). Drafts and ad-hoc author compiles do
  **not** count.
- **Later (Everyone Library):** a server fetch of a hosted published artifact is the
  event.
- The cover-thumbnail format (`cover`) and any **author self-export of their own
  draft** are explicitly **not** downloads.

This keeps "downloads by readers/consumers" honest: it counts reader acquisitions of
published editions, not authoring activity.

### D6 — Endpoints (extend `/api/v1`)

Reader/public (rate-limited via the existing `enforce_rate_limit` dependency):

```
GET    /api/v1/books/{library}/{book_id}/engagement     -- { downloads, rating_count, rating_avg }
PUT    /api/v1/books/{library}/{book_id}/rating         -- auth; body {stars:1..5}; upsert
DELETE /api/v1/books/{library}/{book_id}/rating         -- auth; remove caller's rating
GET    /api/v1/books/{library}/{book_id}/feedback       -- public list (state=visible), paginated
POST   /api/v1/books/{library}/{book_id}/feedback       -- auth; body {body, linked_rating?}
DELETE /api/v1/books/{library}/{book_id}/feedback/{id}  -- auth; author-of-feedback only
POST   /api/v1/books/{library}/{book_id}/feedback/{id}/report  -- auth; raises a complaint (D7)
```

Download counting is **not** a public write endpoint — it is recorded **server-side
inside the export path** (D5) so a client cannot inflate it.

Admin (extends ADR-020's audited operator surface; every action writes
`admin_audit` — actor sub/email, action, target, timestamp):

```
POST   /api/v1/admin/feedback/{id}/hide      -- moderation: state -> hidden
POST   /api/v1/admin/feedback/{id}/remove    -- moderation: state -> removed (terminal)
POST   /api/v1/admin/feedback/{id}/restore   -- state -> visible (after review)
```

### D7 — Moderation, abuse & integrity

Ratings are low-surface (a bounded integer) but stuffable; feedback is full UGC.

- **Anti-stuffing (ratings):** the `(library, book_id, account_id)` primary key makes
  one vote per reader structural; re-rating updates in place.
- **Feedback is UGC → ADR-021 D5 / ADR-020 audit applies.** Default `state =
  visible`, but every review is **reportable** (`/report`), and the super-admin can
  **hide / remove / restore**, all audited. A reported review enters the same
  **AI-assisted-triage-then-human-decides** workflow ADR-021 D5 defines (Claude
  returns a recommendation + rationale; the operator decides).
- **Caps & limits:** feedback `body` length cap (e.g. 4 000 chars); per-account
  publish rate limits on ratings + feedback (`enforce_rate_limit`); reject feedback
  on a non-published book.
- **No reader PII in downloads** (D4/D5) keeps the count cheap and privacy-clean.

### D8 — One engagement writer; wire to product telemetry

All three signals flow through a **single backend engagement module** (one writer,
consistent event shape) rather than being sprinkled across routers. It is the
natural home for the existing **product-tracking** instrumentation: a `download`,
`rating`, and `feedback` event each emit a typed telemetry event so analytics
(downloads-by-edition, rating distribution, completion vs. rating) come for free.

### D9 — Relationship to existing ADRs

- **ADR-021 is advanced, not replaced:** this builds the engagement slice of its
  Open decision 7; its UGC-hosting Open decisions (1–3) stay open. Everyone-Library
  books, when built, reuse these tables via `library = 'everyone'`.
- **ADR-017 / ADR-018 untouched:** the default library stays owner-curated and
  HMAC-signed. Engagement rows hang *off* a published manifest entry; they never
  participate in the owner signature.
- **ADR-014 preserved:** engagement is a non-private data class (D2); the
  zero-knowledge promise over private content is unchanged.
- **ADR-008 leveraged:** downloads are per-version; ratings/feedback stamp the
  version (D4).
- **ADR-020 extended:** feedback moderation actions join the audited operator
  surface and `admin_audit` trail.

### D10 — Implementation conventions

Backend code follows the repo standard: Python, typed, structured (OpenSpec-style)
docstrings, explicit exception types (mirroring `PublishError` / `CompilerError`),
`pytest` suites with **mock fixtures** for accounts, manifests, and events. No new
secret material; no key custody changes.

---

## Consequences

**Positive**
- Ships features (1) downloads, (2) ratings, (3) feedback against books that are
  **already public**, with **no new content-liability** exposure.
- Clean separation of a **non-private engagement data class** that never touches the
  ADR-014 zero-knowledge store.
- **Future-proof:** the Everyone Library plugs into the same tables/routes via a
  `library` discriminator — no migration when ADR-021 builds.
- Honest, version-aware metrics (per-edition downloads; ratings stamped to the
  version reviewed).
- Feedback moderation rides the existing audited operator surface (ADR-020).

**Costs / risks**
- Introduces the **first server-side store of public reader data** — a real
  (if small) reversal of the local-first posture, scoped deliberately to *public*
  books only.
- Ratings/feedback need **sign-in** (ADR-014); anonymous readers can download and
  read but not rate/review.
- Feedback is UGC → ongoing **moderation cost** even for default-library books.
- "Download" semantics (D5) must be communicated so the number isn't misread as
  reads/opens.

---

## Open questions

1. **Edition reset:** when a book ships a major new **edition** (not a point version),
   do ratings carry over or reset? (Leaning: carry over, surface a per-edition
   breakdown.)
2. **Review visibility default:** visible-on-submit (chosen) vs. hold-for-review.
   Revisit if abuse appears.
3. **Author replies** to feedback — in scope later, or never? (Out of scope here.)
4. **Aggregate exposure:** show exact download counts publicly, or banded
   ("1k+")? (Leaning: banded public, exact in admin.)
5. **Anonymous "helpful" signals** on reviews — deferred.
6. **Retention** of `book_download_event` rows (raw events) vs. rolled-up counters.

---

## Scope — what this ADR is *not*

- **Not** the Everyone Library build: no UGC **hosting, discovery/ranking, or
  content-liability/ToS** decisions (ADR-021 Open decisions 1–3 stay open).
- **Not** a change to the default library (ADR-017/018) or to account moderation
  (ADR-020).
- **Not** monetization, payouts, or paid-copy DRM/watermarking.
- **Not** a change to ADR-014 zero-knowledge for private content.

---

## Staged plan (post-acceptance)

1. Alembic migration: `book_engagement`, `book_rating`, `book_feedback`,
   `book_download_event` (D4).
2. Engagement module (D8) + repo layer; record a **download** inside the export path,
   gated on published-manifest resolution (D5).
3. Ratings endpoints (PUT/DELETE/GET engagement) with one-vote upsert (D3/D6).
4. Feedback endpoints (POST/GET/DELETE/report) with length + rate caps (D6/D7).
5. Admin moderation actions + `admin_audit` wiring (D6/D7, ADR-020).
6. Mobile reader UI: star control, review list/compose, download/rating badges
   (reuse `reviewStore.ts` patterns but pointed at the server for *published* books).
7. Telemetry events for download/rating/feedback (D8).

---

## Follow-up tickets

- **SBQ-ENG-001** — engagement store migration + module + download-on-export (D2–D5, D8).
- **SBQ-ENG-002** — ratings API (1–5★, one-vote upsert) + public aggregate (D3, D6).
- **SBQ-ENG-003** — feedback API + report + admin moderation/audit (D6, D7, ADR-020).
- **SBQ-UI-003** — mobile reader engagement UI (stars, reviews, badges).
- *(carried, ADR-021)* Everyone-Library hosting/discovery/ToS — still gated on
  ADR-021 Open decisions 1–3; engagement reuses these tables when it lands.
