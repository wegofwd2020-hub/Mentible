# ADR-021 — Everyone Library (user-published books) & content moderation

**Status:** Proposed — 2026-06-27

## Context

`roles_spec.txt` proposes two role capability sets that go beyond today's model:

- A **User/Author** can author a book privately, then **publish it to an "Everyone
  Library"** (a public, all-users shelf) *or* share a PDF by email link, and toggle
  its Publish/Not-Publish state.
- A **Super-admin** can see libraries, **archive / un-publish / flag** books, and run
  a complaint-review workflow on published content.

How this sits against today's model:

- **ADR-017** — the *default library* is **owner-curated**: a small set of books *we*
  publish, HMAC-signed by the system owner (ADR-018), seeded read-only on first run.
  It is **not** user-generated.
- **ADR-014** — user libraries are **local-first**; optional cloud sync is
  **zero-knowledge / e2e by default**. The backend is a blind store of private content.
- **ADR-020** — the super-admin is a **runtime operator** (env allowlist) acting on
  **accounts** (suspend/delete) and the *default* library (publish/unpublish), all
  audited. ADR-020 explicitly states that a *shared/community library* "is a new ADR."
- **ADR-004** — two products: a paid authoring app and a free reader; content ships as
  EPUB3/PDF artifacts. Email-PDF share is specced as SBQ-EXP-001.

The **"Everyone Library" is exactly the thing ADR-020 deferred** — a **user-generated
public library**, a different axis from both the owner-curated default library and
private user libraries. It introduces server-side hosting of user content, discovery,
**moderation**, and **content liability**.

This ADR records the **model and the role capabilities** so the design is settled. It
**does not build it yet** (D1).

## Decision (proposed)

### D1 — Design-only now; build deferred

We adopt the model below but **do not build the Everyone Library at MVP**. The product
keeps shipping local-first/private libraries + the email-PDF share (SBQ-EXP-001) + the
owner-curated default library (ADR-017). Building the public UGC library is a later,
separately-scoped effort — it needs hosting, discovery, moderation tooling, and a
content-liability/ToS posture (see Open decisions). This ADR is the design anchor those
follow-ups build against.

### D2 — Three library tiers, kept distinct

| Tier | Who publishes | Visibility | Curation |
|---|---|---|---|
| **Private library** | the author (local-first) | only the author | none — the author's own drafts/finished books |
| **Default library** (ADR-017) | the system owner (ADR-018) | everyone (bundled) | owner-curated, HMAC-signed |
| **Everyone Library** (NEW) | any user/author | everyone (public) | UGC — moderated, not pre-curated |

The Everyone Library is **not** the default library, and the two never merge: the
default library is editorial and owner-signed; the Everyone Library is open UGC under
moderation. The Everyone Library does **not** use the ADR-018 system-owner signing
capability.

### D3 — Book lifecycle state machine

A book moves through explicit states; every transition names its actor:

```
            author publishes                 author or admin unpublishes
   DRAFT  ─────────────────────►  PUBLISHED  ◄────────────────────────────►  UNPUBLISHED
 (private)                      (Everyone Lib)                                 (private again)
                                    │   ▲
                   admin flags      │   │   admin restores (after review)
                  (on complaint)    ▼   │
                                 FLAGGED ──── admin removes ────►  REMOVED
                             (temp-unavailable)                    (purged from public)
```

- **Draft** — private to the author (D2); authoring + per-chapter review happen here.
- **Published** — live in the Everyone Library; publicly readable.
- **Unpublished** — taken back to private by the **author** (Publish/Not-Publish toggle)
  or by an **admin** (moderation). Reversible.
- **Flagged (temp-unavailable)** — an **admin** action on a complaint; hidden pending the
  review workflow (D5). Reversible (restore) or terminal (remove).
- **Removed** — purged from the public Everyone Library (terminal for the public copy;
  the author's own private copy is governed by their data rights / GDPR, ADR-014 D8).

### D4 — Author capabilities (the User/Author role)

1. Create a content framework from a **defined JSON** structure (the existing book/TOC
   schema, ADR-003).
2. **Per-chapter review / edit / validate** of generated content (ADR-003 authoring).
3. The book is **private during authoring** (Draft).
4. On completion: **publish to the Everyone Library** *or* **email a PDF download link**
   (SBQ-EXP-001 / ADR-004 artifacts).
5. Toggle the book's **Publish / Not-Publish** state (Draft ↔ Published, Published →
   Unpublished).

### D5 — Super-admin book moderation + complaint workflow

Extends ADR-020's operator (accounts + default-library) with **book-level moderation**
over the Everyone Library, all **audited** like the existing `admin_audit` trail
(actor sub/email, action, target, timestamp):

- **Archive** a book *on the author's request* — for content the author can't self-remove
  or a support request (distinct from the author's own unpublish in D4.5).
- **Unpublish** a published book (moderation).
- **Flag as temp-unavailable** on a user complaint → enters the review workflow.

**Complaint review = AI-assisted triage, operator decides** (this reframes the spec's
"send to Anthropic for review", which is not a real service):

1. A user complaint on a published book → it is set **Flagged (temp-unavailable)**.
2. The platform programmatically asks **Claude** to evaluate the flagged content against
   the complaint and our content policy, returning a **recommendation + rationale**. This
   is *our* use of the model API — **AI-assisted moderation**, not "Anthropic adjudicating
   the complaint." Anthropic offers no third-party-UGC complaint-review service.
3. The **super-admin makes the final call**: **restore** (→ Published) or **remove**.

> Anthropic's **Usage Policy** governs the *generation* of content via the API.
> **Post-hoc moderation of what users publish on our platform is our responsibility**,
> not Anthropic's.

### D6 — Visibility reconciled with zero-knowledge (ADR-014)

The super-admin's "see libraries" is bounded by content custody:

- **Published** books are public by definition → the admin (like everyone) reads their
  **full content**.
- **Private** books → the admin sees **metadata only** (title, owner, dates, state) —
  **never private content**. If the user opted into e2e sync (ADR-014 D5), the backend
  literally cannot read it, and this ADR keeps that promise.

This **amends the loose "can see all personal library"** in `roles_spec.txt` to
*metadata-only for private*, preserving ADR-014's zero-knowledge default.

### D7 — Relationship to ADR-020 / ADR-017 / ADR-018

- **ADR-020 is extended, not replaced:** its audited operator surface gains the D5
  book-moderation actions. Same allowlist principal, same `admin_audit`.
- **ADR-017 / ADR-018 are untouched:** the default library stays owner-curated and
  HMAC-signed; the Everyone Library is a separate UGC tier that does not use the
  system-owner signing capability.

## Open decisions

1. **Hosting & storage** for public UGC — where published books live server-side, CDN,
   size/count caps. Reverses today's "no shared content store / local-first" posture for
   *published* content; a deliberate later choice.
2. **Discovery / curation** — search, ranking, featured shelves, and ranking abuse.
3. **Content liability / ToS / DMCA** — we'd be distributing third-party content; needs
   legal review *before* build.
4. **Author due process** — notification on flag/unpublish, appeal path, retention of
   removed content.
5. **Abuse & rate limits** on publishing (spam, mass policy-violating uploads).
6. **AI-triage policy spec** — the ruleset Claude evaluates against (what counts as
   "policy-violating"), thresholds, and the human-in-the-loop guarantee (D5 keeps the
   human as final decider).
7. **Build trigger** — ~~the criteria that move this from design-only (D1) to a build
   ADR.~~ **Resolved 2026-06-30 — see "Build trigger (D8)" below.**

### D8 — Build trigger (resolves Open decision 7) — 2026-06-30

The Everyone Library has a **large fixed cost that does not amortize with volume**:
a content-liability/ToS/DMCA posture (Open #3, a hard blocker), moderation tooling +
a human-in-the-loop operator (D5 / Open #6), server-side UGC hosting that *reverses*
the local-first / no-server-content-store posture (Open #1), and discovery/anti-abuse
(Open #2/#5). A naïve "trip it at N published books" threshold is therefore **rejected**
— it can fire on a vanity metric while the legal and moderation prerequisites are still
absent. The trigger is a **deliberate strategic gate with hard prerequisites**, not an
automatic count. _Decision-maker:_ Sivakumar Mambakkam.

Today's surfaces already cover the adjacent needs: **email-PDF share (SBQ-EXP-001)**
handles 1:1 / small-group distribution, and the **owner-curated default library
(ADR-017)** covers "books we vouch for." The Everyone Library only earns its cost when
**public discovery of third-party UGC** is itself a wanted product direction.

**Build is unlocked only when _all four_ hold:**

1. **Demand for public discovery** — a genuine, repeated pull for a *public shelf*
   (not merely sharing, which SBQ-EXP-001 already covers): multiple distinct authors
   asking for it, or a deliberate strategic bet to make UGC a growth channel — **and**
   enough published-quality supply that a public shelf is worth browsing.
2. **Legal cleared (hard gate, Open #3)** — ToS / DMCA / content-liability review
   *completed*. Build **cannot** start without it.
3. **Moderation ready** — the AI-triage policy ruleset (Open #6) drafted **and** a human
   operator with bandwidth to be the final decider (D5).
4. **Money-model fit** — decided whether the public library is free/paid and how its
   hosting + token-moderation cost sits within ADR-004 / ADR-005.

**Anti-trigger (stay design-only):** as long as email-PDF share + the owner-curated
default library satisfy the real distribution/discovery need, do **not** build — this
ADR remains the design anchor and nothing more. Revisit only on an explicit decision
to pursue public UGC, at which point this trigger's four conditions gate the build.

## Consequences

**Positive:** the role model is settled end-to-end (author → publish → moderate); the
"send to Anthropic" misframe is corrected to a real AI-assisted-moderation flow with a
human decider; the zero-knowledge promise is preserved (D6); the Everyone Library is
cleanly separated from the owner-curated default library; and ADR-020's audit trail
extends to the new actions.

**Negative / cost:** committing (later) to a public UGC library is a major surface —
hosting, moderation, discovery, and real content-liability exposure — and partially
reverses the local-first / no-server-content-store posture for *published* content.
D1 keeps all of that out of MVP.

## Scope — what this ADR is *not*

- **Not a build commitment** (D1): no hosting design, schema, or endpoints are specified.
- **Not a change** to the default library (ADR-017/018) or to *account* moderation
  (ADR-020).
- **Not a legal/ToS document** — Open decision 3 must be resolved before any build.

## Follow-up tickets

- *(when triggered by Open decision 7)* Everyone Library hosting + publish / unpublish /
  flag endpoints, extending ADR-020's `/api/v1/admin/*`.
- AI-triage moderation service: prompt + policy ruleset + operator review console.
- Book state-machine model (D3) + author Publish/Not-Publish UI.
- Legal / ToS / DMCA review for hosting third-party content.
