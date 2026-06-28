# ADR-025 — New-edition redistribution: keeping readers' copies current

**Status:** Proposed — 2026-06-28
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-008 (release lifecycle / version & edition — the "stale copy"
problem starts here), ADR-023 (engagement — an update is a distinct event), ADR-024
(QR resolver — the natural "latest version" lookup channel; at-rest integrity),
ADR-018 (system-owner signing), ADR-015 (content-trust manifest), ADR-017 (default
library / bundled), ADR-021 (Everyone Library — the live-server fetch channel is
gated here), ADR-014 (local-first / zero-knowledge — reader state must survive).

---

## Context

We **record** versions and editions (ADR-008) and now **count downloads** (ADR-023)
and **link a QR to a published edition** (ADR-024). Nothing closes the loop: once a
book is a **downloadable artifact in a reader's hands**, there is no path for that
reader to learn a **newer edition exists**, or to **update** to it.

This is the gap the prior ADRs create by stacking up:

- A reader holding **v1.0** has no signal that **v1.2** shipped, and no way to move to
  it. The author's `revisionHistory` (ADR-008) is invisible to that reader.
- **Default-library** books (ADR-017) are **bundled** — frozen at app-build time — so
  a content fix only reaches readers on the **next app release**, with no in-app
  notion of "this book is out of date."
- **Everyone-Library** books (ADR-021, deferred) will be server-hosted and *can* have
  a live latest version — but there is still no defined **update-apply** behaviour.

The hard part is **not** the notification — it's the **apply**. Updating a book the
reader is *inside* must not destroy their **private overlay** (progress, annotations,
their own rating/feedback) and must not let an **unverified** artifact overwrite a
trusted one. That apply contract is identical no matter how the new edition arrives,
so this ADR nails the contract and scopes the *fetch channel* per library tier —
mirroring how ADR-023/024 scoped buildable-now slices against already-public books.

---

## Decision (proposed)

### D1 — Define the durable **update contract** now; scope the fetch channel per tier

We adopt the version-check + update-apply machinery below as a **channel-agnostic
contract**. The *discovery/fetch channel* differs by tier and is scoped accordingly
(D5): **default library updates ride app releases at MVP** (no new infra), and the
**Everyone-Library live-server fetch** lights up the *same* contract when ADR-021
builds. This ADR does **not** trigger ADR-021's UGC hosting.

### D2 — A book's **stable id** is durable; the reader's **private overlay survives** an update

The `book_id` is the permanent key (ADR-017/008). An update **replaces the content**
(`book.json` / artifact) but **never touches the reader's private overlay**, which is
keyed by `book_id` and stays device-local / e2e (ADR-014):

- **Reading progress**, position, and any **annotations/highlights**.
- The reader's **own rating and feedback** (ADR-023) — those belong to the reader, not
  the edition.

This is the zero-knowledge-preserving core: content is public and swappable; the
overlay is private and persistent. An update is a **content swap under a stable id**,
not a new book.

### D3 — Version-check: detect a stale installed edition

The app compares the **installed `version`** (ADR-008 metadata) against the
**latest published** version for that `book_id` (source per tier, D5) and surfaces an
in-app **"update available"** affordance on the book (Library badge + detail screen).
No silent mutation (D4).

### D4 — Update is **reader-initiated and changelog-transparent** by default

- The reader is **shown what changed** — the new edition's `revisionHistory` /
  changelog (ADR-008) — and **chooses** to update. We never silently rewrite a book
  the reader is partway through.
- **One exception, still non-silent:** the owner may mark a default-library edition as
  a **critical correction** (e.g. a factual/safety fix); the app may prompt **more
  prominently**, but the apply is still the reader's action.

### D5 — Fetch channel per tier

| Tier | "Latest version" source | Fetch of the new edition | Built |
|---|---|---|---|
| **Default** (ADR-017) | bundled signed manifest, refreshed on **app update**; (optional signed **manifest-refresh endpoint** later) | from the refreshed bundle (or endpoint later) | **Now** (app-update path) |
| **Everyone** (ADR-021) | live server row | live server fetch | **Deferred → ADR-021** |

At MVP, default-library freshness rides the app-release cadence (cheap, no server). The
contract is built so a **signed manifest-refresh endpoint** (default) and the
**Everyone-Library server fetch** slot in without changing the apply behaviour (D2,
D6).

### D6 — **Integrity gate before swap** — fail closed

An incoming edition must **verify before it replaces** the installed copy, reusing the
existing trust chain:

- owner **HMAC signature** over the manifest entry (ADR-018),
- **content-trust manifest** (ADR-015), and
- **at-rest artifact integrity** (ADR-024 D1b/provenance).

If verification fails, the **old copy is kept** and the update is refused (logged). A
reader is never moved onto an unverified artifact.

### D7 — Version vs edition semantics (ADR-008) decide replace-in-place vs choice

- A **minor `version` bump** (e.g. v1.0 → v1.2) = an in-place update of the **same
  work**; the library does **not** fork.
- A **major `edition`** change = the author's call whether it's an update or a
  **distinct work**; default is an update with a prominent "new edition" changelog, but
  rating/engagement **carry-over follows ADR-023 Open question 1**. Keeping the prior
  edition alongside the new one (reader keeps both) is an Open question here, not a
  default.

### D8 — An update is a **distinct engagement event** (ADR-023), not a fresh download

To keep download metrics honest, **applying an update is its own event**, separate
from a first acquisition:

```text
book_update_event                    -- append-only, privacy-minimal (mirrors ADR-023 D4/D5)
  id            bigserial primary key
  library       text   not null      -- default | everyone
  book_id       text   not null
  from_version  text                 -- the edition the reader left (ADR-008)
  to_version    text                 -- the edition adopted
  occurred_at   timestamptz not null
  -- NO ip, NO account_id, NO device id by default
```

`update_count` joins `book_engagement` (ADR-023 D4), written by the same engagement
module (ADR-023 D8). The **QR resolver (ADR-024)** gains a **"latest version for
`book_id`"** lookup — so scanning an *older* edition's stamped QR can itself surface
"a newer edition exists," reusing the resolver rather than adding a channel.

### D9 — Endpoints

```
GET /api/v1/books/{library}/{book_id}/latest
    -> { latest_version, edition, releaseDate, changelog_summary,
         integrity: { sha256, signature } }     -- the D3 version-check + D6 verify source
POST /api/v1/books/{library}/{book_id}/update-applied   -- client reports an apply (D8); privacy-minimal
```

`/latest` is served from the **owner-signed default-library manifest now** (ADR-017/018)
and from **Everyone-Library rows later** (ADR-021) — same shape both ways.

### D10 — Implementation conventions

Python, typed, structured (OpenSpec-style) docstrings, explicit exception types
(mirroring `PublishError` / `CompilerError`), `pytest` with **mock fixtures** for
manifests, installed-vs-latest version pairs, verify success/failure, and overlay
preservation. No secret material leaves the server; the device never holds the owner
key (ADR-018).

---

## Consequences

**Positive**
- Closes the loop the prior ADRs opened: version (ADR-008) + downloads (ADR-023) + QR
  (ADR-024) finally **pay off for readers**, who can stay current.
- **Reader trust preserved two ways:** their private state survives an update (D2), and
  no unverified edition can replace a trusted one (D6).
- **Channel-agnostic contract:** Everyone-Library live updates and an optional
  default-library refresh endpoint slot in **without re-specifying apply behaviour**.
- **Honest metrics:** updates are counted distinctly from first downloads (D8).
- Reuses the existing trust chain (ADR-015/018/024) and engagement writer (ADR-023) —
  little net-new surface at MVP.

**Costs / risks**
- **Annotation/progress re-anchoring** across editions is genuinely hard: if chapter/
  section ids shift between v1.0 and v1.2, the reader's saved position/highlights may
  no longer map cleanly (Open question 3). MVP is best-effort re-anchor with a graceful
  fallback, not a guarantee.
- Default-library freshness is tied to **app-release cadence** until a refresh endpoint
  is built (D5) — a content fix waits for the next app update.
- Adds another privacy-minimal event class to operate (retention/rollup).
- A "critical correction" prompt (D4) needs a sober policy so it isn't overused.

---

## Open questions

1. **Manifest-refresh endpoint timing** — when to build the signed default-library
   refresh endpoint so fixes don't wait on app releases (D5).
2. **Major-edition handling** — replace-in-place vs **keep-both** (reader keeps "First
   Edition" and adopts "Second Edition" as a separate library entry) (D7).
3. **Re-anchoring** reader progress/annotations when content structure changes between
   editions — best-effort heuristic now, or a stable per-section id scheme authored
   into `book.json` so anchors survive (the durable fix)?
4. **Critical-correction policy** — what qualifies, who sets the flag, how forceful the
   prompt (D4).
5. **Offline readers** — update applies opportunistically on next connectivity; confirm
   the stale-copy badge is computed from the last-known `/latest`.

---

## Scope — what this ADR is *not*

- **Not** push-notification infrastructure — the signal is an **in-app** stale-copy
  affordance (D3); OS push is a separate, later concern.
- **Not** the Everyone-Library server build — the live-server fetch channel stays
  **ADR-021** (this ADR only defines the contract it will use).
- **Not** a full annotation-migration engine — re-anchoring is best-effort at MVP
  (Open question 3 owns the durable fix).
- **Not** monetization / paid-upgrade between editions.
- **Not** a change to ADR-014 zero-knowledge for the private overlay (D2 preserves it).

---

## Staged plan (post-acceptance)

1. `GET /latest` served from the owner-signed default-library manifest (D9, D3).
2. Mobile: installed-vs-latest version compare + **"update available"** affordance on
   the Library + detail screen (D3).
3. Update-apply on the device: fetch new `book.json` → **verify (D6)** → swap content
   while **preserving the overlay keyed by `book_id`** (D2) → record `update_applied`
   (D8).
4. Changelog surfacing from `revisionHistory` in the update prompt (D4, ADR-008).
5. `update_count` on `book_engagement` + `book_update_event` + telemetry (D8, ADR-023).
6. QR resolver "latest version" lookup so an old edition's QR surfaces the newer one
   (D8, ADR-024).
7. *(later)* signed default-library **manifest-refresh endpoint** (D5, Open question 1);
   *(when ADR-021 builds)* Everyone-Library live-server fetch on the same contract.

---

## Follow-up tickets

- **SBQ-UPD-001** — `GET /latest` over the signed manifest + version-check affordance
  in mobile (D3, D9).
- **SBQ-UPD-002** — device update-apply: verify-before-swap + overlay preservation +
  `update_applied` (D2, D6, D8).
- **SBQ-UPD-003** — changelog surfacing in the update prompt (D4; reads ADR-008
  `revisionHistory`).
- **SBQ-UPD-004** — `update_count` / `book_update_event` + telemetry, and the QR-resolver
  latest-version lookup (D8; extends ADR-023/024).
- *(carried)* signed default-library manifest-refresh endpoint (Open question 1);
  Everyone-Library live fetch (ADR-021).
