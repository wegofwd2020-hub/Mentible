# ADR-027 — Collaborative draft sharing & the release / Open-Library permission model

**Status:** Proposed — 2026-07-03 · **D2–D4 BUILT 2026-07-05 (2026-07-11 currency pass).** The invite-based hosted draft-sharing slice shipped (PRs #267/#268/#271): `shared_draft`/`draft_invitation`/`draft_comment` (migrations 0007/0008), `backend/src/sharing/router.py` mounted in `main.py`, mobile `DraftCommentThread`/`FeedbackBadge`. **D5–D8** (Open-Library publish, registration-gated reading, `tags`) remain **unbuilt**, gated on ADR-021 D8. The ADR's original "capture-only / none built now" framing is superseded.
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-021 (Everyone / "Open" Library & moderation — this ADR sets its
read-access + engagement permission matrix and **amends its D3 "publicly readable"**;
recorded there as ADR-021 D9), ADR-023 (ratings / feedback — now registered-gated),
ADR-004 (two-product split + artifacts — a RELEASE edition is the EPUB3/PDF; email-PDF
share SBQ-EXP-001), ADR-008 (release lifecycle / version & edition — comments are
version-scoped), ADR-014 (accounts + zero-knowledge sync — hosted sharing is a
deliberate, scoped exception), ADR-020 (super-admin moderation + `admin_audit`),
ADR-017 (owner-curated default library — a *distinct* tier), ADR-003 (book authoring).

---

## Context

Authors want two things the product does not yet offer:

1. Circulate a **work-in-progress draft** to specific individuals for feedback *before*
   release, and get that feedback back.
2. Publish a finished **RELEASE edition** to a public **Open Library** that others can
   discover and read.

Today the only sharing is a **file/artifact handoff** — export `.book.json` or an
EPUB/PDF and send it manually (`ExportBookJsonButton` → `importBook`; `POST
/api/v1/export`). There is **no hosted, invite-based, commentable draft**, and the
public shelf (ADR-021 "Everyone Library") is **design-only** and left reader
read-access loosely defined as "publicly readable." The app is otherwise **local-first**
with **no server-side per-account book storage** (sync is deferred, ADR-014).

This ADR **decides the sharing + permission model** that spans the private (draft) and
public (release) tiers. It is **capture-only**: no code lands with it, and the build
stays gated behind **ADR-021 D8**'s prerequisites (legal/DMCA, moderation-ready, real
demand, money-model fit).

## Decision (proposed)

### D1 — Two sharing surfaces, one permission spine

- **Draft sharing** (pre-release, *private* tier): the author invites **named
  individuals** to a specific draft; feedback comes back as **comments**.
- **Open Library** (post-release, *public* tier — = the ADR-021 Everyone Library):
  finished **RELEASE** editions, publicly listed, engagement via **ratings + comments**
  (ADR-023).

Two axes gate every capability below: **invitation** (for drafts) and **registration
status** (anonymous vs registered) — for both tiers.

### D2 — Draft sharing is HOSTED and INVITE-BASED

- The author shares a draft to specific recipients **by email / account** — **not** an
  open "anyone-with-the-link." The **invitation is the access grant**.
- The shared draft **and its comments live server-side** (a hosted draft store), so the
  author can *see* recipients' feedback. This is a deliberate exception to ADR-014's
  device-local / zero-knowledge default (see **D8**), and is **distinct from** the
  deferred zero-knowledge *library sync* — it covers only content the author chose to
  share.

### D3 — Draft permission matrix

| Recipient | Read the draft | Comment |
|---|---|---|
| Invited **+ registered** | ✓ | ✓ |
| Invited **+ not registered** | ✓ (read-only guest) | ✗ |
| **Not** invited | ✗ | ✗ |

A non-registered invitee reads through a **guest / claim path** tied to the invited
email (see **O5**); **commenting requires an account**.

### D4 — Comments are draft-version-scoped and never promoted to the release

A comment attaches to the specific **draft version** (ADR-008 versioning). Advancing /
regenerating the version, or publishing the **RELEASE**, does **not** carry comments
forward — they remain feedback *on that version*, never part of the published edition.

### D5 — Only a RELEASE reaches the Open Library; the edition is EPUB3 / PDF

Only a book marked **RELEASE** (ADR-008 `status: "release"`) may be published to the
Open Library. The Open-Library edition is the **compiled EPUB3 or PDF artifact**
(ADR-004 D2) — not the raw `book.json`.

### D6 — Open-Library read access: registered-only content; anonymous = metadata-only

- **Anonymous** visitor → **metadata only** (title, description, tags, cover, aggregate
  rating) and must **register to read** the content.
- **Registered** user → reads the full edition and may **rate + comment** (ADR-023).

This **amends ADR-021 D3's "publicly readable"** → **registration is the gate to
reading** (recorded as **ADR-021 D9**). Rationale: registration-as-read-gate is a
deliberate **growth / lead-gen** lever *and* an **accountability** one — every reader
has an identity, which shrinks the anonymous-abuse surface moderation has to police.

### D7 — Metadata additions: `description` (exists) + `tags` (new)

- **`tags`** — **NEW**: author-entered, **free-form** string list on the book, for
  search / discovery once the library grows. Distinct from the generation-time
  `subjects: string[]` (which the model populates); see **O4**.
- **`description`** — the **existing** `BookMetadata.description`. Add an
  **author-supplied-description ingestion path**: a blurb/file the author provides during
  authoring populates it. Both `description` and `tags` feed the Open-Library card and
  its search index.

### D8 — Not zero-knowledge; build stays gated

Hosting drafts + comments (D2) and Open-Library editions places author content **on our
servers**, readable by us and by moderation (ADR-020 D5). This is a **deliberate,
opt-in exception** to ADR-014's zero-knowledge default, **scoped to shared / published
content only** — a user's private, *unshared* library stays device-local / zero-knowledge.
Build remains gated behind **ADR-021 D8**'s four prerequisites; **this ADR captures
decisions only**.

## Open decisions

1. **Subscriber gate (O1)** — is hosted draft sharing a **subscriber-gated (paid)**
   author capability, or available to **any registered author**? (hosting/storage cost
   vs adoption friction). _Recommendation:_ authoring is already the paid app; treat
   sharing as an author capability and revisit a paid gate only if hosting cost warrants.
2. **Comment visibility & threading (O2)** — author-only vs all invitees seeing each
   other's comments; author replies; resolve/close.
3. **Retention, revocation & draft moderation (O3)** — draft/comment retention windows;
   **invitation revocation**; and how far ADR-020 D5 moderation reaches into shared but
   **unpublished** (private-tier) drafts.
4. **Tag vocabulary (O4)** — `tags` free-form now vs a **controlled vocabulary** later;
   migration and relationship to the existing `subjects[]`.
5. **Guest / claim flow (O5)** — how a non-registered invitee authenticates to an
   invitation **without a full account** (e.g. an email magic-link guest session), and
   how that upgrades to an account when they want to comment.

## Consequences

- Delivers the **author → reviewer feedback loop** the current file-handoff can't — the
  comments come *back* to the author, attached to the version they reviewed.
- **Registration-gated reading** (D6) turns the Open Library into a **growth surface**
  and shrinks the anonymous-moderation surface — at the cost of reach vs a fully public
  shelf.
- **Reverses ADR-021's "publicly readable"** (recorded as ADR-021 D9); anyone citing
  that line must now use D6.
- New backend surfaces **when built**: a hosted draft store, invitation + guest-read,
  version-scoped comments, ratings (ADR-023), and an Open-Library listing with
  metadata/tags. **None built now.**
- A real **privacy / cost / moderation footprint** (hosted author content) — governed by
  D8, the ADR-021 D8 gates, and ADR-020 moderation.

## Scope — what this ADR is *not*

- **Not a build spec.** ADR-021 D8's gates still bind before any code.
- **Not the moderation policy** (ADR-021 D5/D6) nor the **ratings mechanics** (ADR-023) —
  this ADR decides *who may do what*; those own *how*.
- **Does not change ADR-017's** owner-curated, HMAC-signed default library — a separate
  tier that ships with the app.

## Follow-up tickets (only when unlocked by ADR-021 D8)

- Hosted draft store + invite / guest-read + version-scoped comments (D2–D4).
- Open-Library listing with **registration-gated read** + metadata/tags (D5–D7).
- Book-schema: add **`tags`**; wire **author-description ingestion** into
  `BookMetadata.description` (D7).
