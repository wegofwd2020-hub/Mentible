# ADR-035 — Hosted media sync: attached figures follow the user, end-to-end encrypted

**Status:** Proposed — 2026-07-16
**Decision-maker:** Sivakumar Mambakkam
**Amends:** ADR-033 D2 (hosted content scope — adds a fourth content class), ADR-033 D4 (bounds the
"hosted is not zero-knowledge" concession so it does **not** reach media).
**Reuses:** ADR-014 D10 (per-user LMK → per-book Data Key envelope encryption — no new crypto).
**Constrains:** ADR-014 D11 and ADR-027 (sharing must not carry figures — D4 below).
**Extends:** ADR-033 D4's purge obligation to hosted media blobs (D7). *Note:* ADR-022 is about
**identity** deletion (its D1–D5 concern the Supabase auth row, not content), so the content-purge
duty lives in ADR-033 D4 — this ADR extends that, not ADR-022 directly.
**Relates to:** ADR-031 (storage as a `Plan` axis — the allowance this consumes), ADR-034 D3.1
(claims honesty — the shipped device-local copy must change), ADR-028/029 (device-local free tier —
unchanged), ADR-001 (unamended — no server-side key custody; this ADR spends no tokens at all).
**Builds on:** media slice 1 — topic image attachments, shipped in PR #318 (2026-07-15) and
device-verified 2026-07-16 (`mobile/.claude/skills/verify/SKILL.md` records the method).

---

## Context

Media slice 1 shipped attach-a-figure as **free and device-local**: the author attaches an image to
a topic, it renders in both readers, compiles into the EPUB/PDF, and travels in a `.book.zip`
bundle. Its storage model is deliberate — **refs in the schema, bytes on disk**: `GeneratedTopic.images[]`
holds `TopicImage` records whose `file` points at `media/<bookId>/<imageId>.<ext>`, and the bytes
are materialized only transiently (the reader's figure resolver, the compile payload). Nothing about
the image lives in `book.json`.

ADR-033 then accepted a paid, per-user **private hosted library**, scoping server-side content in D2
to: **(a)** authored books (`book.json`), **(b)** scoped queries and their generated content,
**(c)** public-domain downloads.

Those two decisions do not meet. **Media bytes are in none of D2's three classes**, precisely because
slice 1 keeps them out of `book.json`. Syncing a hosted user's library today would carry the *refs*
and not the *bytes* — the second device would render a topic whose figures point at files that do not
exist there. Not a missing feature: a silent, data-loss-shaped failure produced by two correct
decisions that were never reconciled. No ADR currently owns those bytes; this one does.

This is recorded before any hosted code exists, which is the cheapest place to decide it.

## Decision

**Sync author-attached media to the hosted tier as end-to-end-encrypted, per-book blobs — fetched
lazily, private to one user, and never shared.** The device-local free tier is unchanged.

### D1 — Hosted media is in scope; the free tier is untouched

Extend ADR-033 D2 with a fourth hosted content class: **(d) author-attached media bytes**,
book-scoped. Additive and opt-in, exactly as ADR-033 D1 frames hosting generally.

The free/anonymous tier keeps working as shipped: attach with no account, bytes on device, fully
offline, zero-knowledge. Hosted media is an unlock, never a migration users are pushed through.

### D2 — End-to-end encrypted under the existing per-book Data Key

Media bytes are encrypted **on the device** under the book's existing Data Key and uploaded as
opaque ciphertext. The server stores the ciphertext and its byte length, and **holds no key that
opens it**.

No new crypto. ADR-014 D10 already specifies the envelope, and media is already book-scoped, so the
book's DK covers its figures:

```
passphrase / recovery key ──KDF──▶ KEK
KEK  ──wraps──▶  Library Master Key (LMK — per-user)
LMK  ──wraps──▶  per-book Data Key (DK)
DK   ──encrypts──▶  book content  +  that book's media blobs   ← this ADR
```

**Why media can keep zero-knowledge when hosted text cannot.** ADR-033 D4 conceded that the hosted
tier is not zero-knowledge for a specific, load-bearing reason: *server-side RAG must hold plaintext
to index and embed it*. That reason **does not apply to images** — nothing indexes them. Vision/OCR
is a later slice (media slice 3, gated by ADR-034), and D6 below keeps it out of scope. Absent an
indexing need, there is no reason to hold a key we would only be trusted not to use.

So this ADR **narrows** D4 rather than extending it: hosted *text* is access-controlled and encrypted
but readable by us; hosted *media* is not readable by us at all. That asymmetry is a deliberate,
stated property of the tier, not an accident of implementation.

### D3 — Lazy fetch, then cache and render through slice 1's existing path

A device downloads and decrypts a book's blobs **when a topic that references them is opened**, then
caches them locally under slice 1's existing caps. Once cached, rendering uses the unchanged
slice-1 local-file path (the reader's figure resolver is indifferent to how the file arrived).

This matches ADR-033 D7's thin-client stance — bandwidth is proportional to what is actually read,
not to library size. It matters here: `MAX_MEDIA_PER_BOOK_BYTES` is 100 MB, so eager whole-library
replication could pull hundreds of megabytes unprompted.

**Offline on a device that has not cached a blob**: the topic's text renders and the figure shows an
explicit "needs connection" state. It must **never** render as a missing/broken image — for a user
whose own photo is involved, silent absence reads as data loss. The empty state is a requirement of
this decision, not a UI detail.

### D4 — Private-per-user only; sharing is fenced off until re-decided

Hosted media is **private to one user and never shared**. ADR-014 D11 (per-book DK wrapped to a
recipient) and ADR-027 (collaborative draft sharing) **must not carry figures** until a future ADR
addresses the question this ADR deliberately does not.

The reason is a direct consequence of D2. E2E means **we cannot inspect what we host**. That is
tolerable for private storage: nobody else can receive the bytes, so there is no distribution.
Sharing changes the posture materially — distributing imagery we are structurally unable to scan is
a different legal question from storing it. It would likely re-open the mandatory-DMCA-regime +
legal-review gate that ADR-033 D5 deliberately shed by keeping the infringement surface near zero.

This fence must be **explicit** because the default is otherwise "yes by accident": a shared book's DK
already decrypts that book's figures, so sharing would carry them for free unless something stops it.
Silence here is a decision, and the wrong one.

Recorded cost: when collaborative sharing lands, figures are a visible hole someone must reopen.
That is the intended outcome — reopened deliberately, with the question in front of them.

**This fence costs nothing today, because sharing already drops figures — silently.** ADR-027 D2
(hosted invite-based draft sharing) is **built and shipped**. It stores and serves `shared_draft.book_json`
(`backend/src/sharing/router.py`), and `book.json` carries figure *refs* whose bytes never leave the
author's device. Figures are therefore already excluded at two independent layers:

1. `mobile/app/book/shared/[id].tsx:105` renders `<TopicRenderer topic={topic} />` with **no
   `figures` prop** — the shared-draft reader never even attempts to show them; and
2. the bytes are not on the invitee's device regardless, and `resolveFigureDataUrls` skips a ref
   whose file is missing ("renderer omits that figure").

So D4 **codifies existing behaviour** rather than restricting anything. But the current behaviour is
silent, and that is a real defect this ADR should not launder into a decision: **an author shares a
draft for review and the reviewer never sees the diagram they are being asked to review** — no
placeholder, no notice, on the one surface whose entire purpose is feedback. Fixing the silence
(an explicit "figures aren't shared" state on the shared-draft reader) is independent of hosting,
needs no encryption, and should not wait for this ADR. Recorded as follow-up F1.

### D5 — Claims honesty: the shipped device-local copy must change (ADR-034 D3.1)

Two strings ship today and become **false for hosted users** the moment this lands:

- `mobile/src/components/FiguresPanel.tsx:141` — "Figures stay on your device. Nothing is sent to the AI."
- `mobile/src/help-content/topics.ts:315` — "Your figures stay on your device; nothing is sent to the AI."

ADR-034 D3.1 bans "nothing leaves your device" as written; these are the same class of claim. They
are accurate for the free tier and must stay for it. Hosted copy states the honest, and still strong,
version:

> *"Your figures are encrypted on your device before we store them, so they follow you across
> devices — we can't read them."*

The "nothing is sent to the AI" half remains **true** through this slice — media sync spends no
tokens and calls no model. It becomes false only at media slice 3 (vision), which is that ADR's
obligation to face, not this one's to pre-empt.

Updating this copy is part of shipping D1, not a follow-up (see the repo's Definition of Done —
Help is authored as data and gated by the coverage test).

### D6 — Gating: downstream of ADR-033's hosted library; storage-only, zero token spend

Media sync **cannot ship before ADR-033's hosted library** — syncing figures is meaningless while
`book.json` is still device-local. It ships with or after it.

But its gate is narrower than ADR-033 D8's. Hosted media needs **storage plans + billing only**: it
spends **zero tokens**, calls no LLM, and needs no managed keys. ADR-016 metering and the
`managed_account_spend_ceiling_micros` prerequisite (ADR-033 D3) bound *token* cost and are not
implicated. Ciphertext bytes count against the hosted plan's storage allowance (ADR-033 D3 /
ADR-031's `Plan` axis); ciphertext is ~plaintext-sized, so the existing accounting needs no new model.

### D7 — Deletion and orphan collection extend server-side

Server blobs are refcounted by the `book.json` refs that name them:

- Deleting a book purges its blobs (extends ADR-033 D4's purge obligation), mirroring
  the on-device `deleteBookMedia` cascade that slice 1 already wires into `bookStore.deleteBook`.
- Removing a figure orphans its blob, which is collected server-side — the mirror of slice 1's
  `pruneOrphanMedia`.

Deletion of ciphertext we cannot read is unusually clean: purging the blob and dropping the book's DK
both independently render it unrecoverable.

## Consequences

**What we gain.** Figures follow the user across devices — the gap that would otherwise make hosted
libraries silently lossy for any book with a figure. A **stronger** privacy claim than the hosted tier
otherwise carries, obtained for free rather than bought: "encrypted on your device; we can't read
them" holds for media even though it cannot hold for hosted text. No new crypto, no new billing
axis, no token spend.

**GPS never reaches the server, even in principle.** Slice 1 strips EXIF at attach time — verified
on a real device on 2026-07-16 (a GPS canary was gone from the stored bytes for JPEG, PNG and WebP;
APP1 / `eXIf`+`tEXt` / WebP `EXIF` chunks all absent). The bytes are stripped *before* they are
encrypted, so the ciphertext cannot contain location data we could later be compelled to produce.
That verification is what makes this claim safe to state; the re-encode invariant it depends on is
now locked by tests (PR #319).

**What we lose (honestly).** Server-side vision/OCR over hosted media is foreclosed without a
re-decision — the server cannot read the pixels. Note the limit precisely: **only the server-side
variant is blocked.** A device holding the DK can decrypt locally and send the image to the LLM under
BYOK/managed passthrough, exactly as text does today, so on-device vision (slice 3) remains open.

We also cannot scan hosted imagery for illegal or infringing content — by construction, permanently,
for as long as D2 holds. D4's private-only fence is what makes that acceptable, and is therefore
load-bearing rather than conservative.

**Real infra cost**: bytes at rest, bounded by the per-plan storage allowance.

**Migration:** additive. Existing device-local users are unaffected. A user opting into hosting
uploads their existing media as part of ADR-033's migration flow (its open question 3), subject to
the same encryption.

## Open questions

1. **Blob store** — object storage (S3-class) vs Postgres large objects; per-user isolation model.
2. **DK granularity** — per-book DK (as specified) vs per-blob DKs. Per-book is simpler and matches
   ADR-014 D10; per-blob would be the precondition for sharing a *single figure* if D4 is ever revisited.
3. **Device cache accounting** — do cached hosted blobs count against slice 1's device caps
   (`MAX_MEDIA_PER_BOOK_BYTES`), and what evicts them?
4. **Inherited dependency** — ADR-014 D10's passphrase/recovery flow is itself **unbuilt**. This ADR
   cannot ship before it, and D10's own recovery story (O4) applies: a forgotten passphrase means
   unrecoverable media, same as unrecoverable content.
5. **Passphrase rotation** — re-wrapping the LMK is cheap; confirm no blob re-encryption is implied
   (it should not be — rotation touches the KEK→LMK wrap, not the DK→blob layer).
6. **Upload timing** — attach-then-upload-on-reconnect vs upload-on-attach; what the UI shows for a
   figure attached offline on a hosted account and not yet uploaded.

## Follow-ups (independent of this ADR shipping)

- **F1 — Shared drafts silently drop figures (present-day defect, no hosting required).** Surfaced
  while writing D4. ADR-027 D2's shipped draft-sharing serves `book.json` whose figure refs the
  invitee cannot resolve, and `mobile/app/book/shared/[id].tsx:105` passes no `figures` prop at all,
  so the reviewer sees no figure and no explanation — on a surface that exists to collect feedback.
  Fix the **silence** (explicit "figures aren't shared" state); the fence in D4 is what keeps it a
  silence-fix rather than a sharing-feature. Needs no encryption, no hosting, no new ADR.

## Blast radius

- **ADR-033** — D2 gains content class (d); D4 gains a bounding sentence (the not-ZK concession does
  not reach media).
- **ADR-014** — D10 gains a consumer (media under the per-book DK); D11 gains the D4 fence.
- **ADR-027** — inherits the D4 fence (collaborative sharing excludes figures).
- **ADR-022** — *not* amended: it governs identity deletion, not content. The content-purge duty
  ADR-035 D7 extends lives in ADR-033 D4.
- **Shipped copy** — `FiguresPanel.tsx:141` and `help-content/topics.ts:315` (D5).
- **STATUS.md** — ADR-035 row added.

## Scope — what this ADR is *not*

- **Not** a change to the **free device-local tier** — slice 1 ships and stays as-is (D1).
- **Not** media **sharing** — private-per-user only, fenced until re-decided (D4).
- **Not** media slice 3 (**vision/OCR**) — and note E2E blocks only its *server-side* variant (D6).
- **Not** server-side key custody or any token spend — ADR-001 unamended (D6).
- **Not** shippable before ADR-033's hosted library, nor before ADR-014 D10's passphrase flow exists.
- **Not** the build design — blob store, upload queue, cache eviction and the migration path are
  future brainstorms.
