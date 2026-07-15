# ADR-033 — Per-user private hosted library: narrow hosting accepted, ADR-032's broad shape rejected

**Status:** Accepted — 2026-07-15
**Decision-maker:** Sivakumar Mambakkam
**Supersedes:** ADR-032 (server-hosted library + hosted RAG + storage tiers) — rejected in place.
**Amends:** ADR-014 D8 (data-minimization / device-local default — the hosted paid tier holds
readable content), ADR-022 (deletion extends to hosted content + its derived index).
**Re-parents:** ADR-029 and ADR-030 (their hosted mode now points here, not at ADR-032).
**Relates to:** ADR-001 (no server-side key custody — unamended; hosted RAG runs on **managed**
keys), ADR-005 (managed vault), ADR-016/013 (managed billing + metering — the launch gate),
ADR-020 (super-admin operates on metadata only — never touches hosted content), ADR-028 (Open
Shelves device-local downloads — the free-tier baseline), ADR-031 (the `Plan`/entitlement/storage
machinery this tier reuses).
**Companion:** `docs/superpowers/specs/2026-07-15-adr-033-per-user-private-hosted-library-design.md`.
**Plain-language explainers:** `docs/adr-033-user-facing-view.md` (the two-tier user view + diagrams) ·
`docs/adr-033-tiers-presentation.md` (free-vs-paid for a non-technical audience).

---

## Context

Authoring's library-grounded retrieval (ADR-029) was designed **device-local**: on-device lexical
search over the author's own downloaded + authored books, no network, no tokens, no server-side
content. ADR-032 (2026-07-12) then reshaped it into a **paid hosted tier** — a server-hosted
library plus hosted RAG on managed keys — and in doing so amended ADR-001, amended ADR-014,
reversed ADR-028's "core promise," and left ADR-029 internally contradictory (its header said
"dual-mode / hosted," its Scope still said "nothing leaves the device").

An intermediate design (2026-07-14) resolved the contradiction by **rejecting hosting outright**.
That was correct for the shape it rejected — ADR-032's **shared, global, deduplicated PD corpus**
(D13) with copyrighted-file hosting (D7) and unbounded free grounding (D15), whose own author
could no longer state what the paid tier sold (OQ-A4) and whose abuse guard the ADR admitted was
"broken."

The product owner's actual requirement is a **different design point**: hosting **is** wanted, but
the corpus is **private and per-user** — every book, query, and generated artifact specific to one
user, nothing visible to another — inside a **paid** subscription with an included **minimum**
storage + token allowance. This is neither ADR-029 (device-local, no sync) nor ADR-032-as-landed
(shared global corpus). It is the per-user *private* account that ADR-032's original D2 gestured at
before its D11 amendment retreated to the shared-PD cul-de-sac.

ADR-033 did not exist as a committed ADR when this decision was made — the branch held only design
docs. So this is a fresh decision recorded before any code exists, which is the cheapest place to
make it.

## Decision

**Reject ADR-032's hosted shape. Accept a narrow substitute: an opt-in, paid, per-user *private*
hosted library — the user's own authored books, scoped queries, and generated content, plus their
public-domain downloads — synced across devices, running server lexical search now and managed-key
semantic retrieval later.** The device-local design (ADR-028/029) remains the **free/anonymous,
zero-knowledge** baseline, unchanged.

This is one decision, not two: one ADR carries the whole hosting stance — considered hosting,
rejected the broad version, accepted the narrow version. ADR-032 is marked Rejected/superseded;
its body is retained as the archived record.

### D1 — Hybrid: device-local free baseline + opt-in per-user private hosted account (paid)

ADR-028/029 device-local stays the free/anonymous/zero-knowledge baseline. The hosted account is an
opt-in subscription unlock. Additive; existing users stay device-local until they opt in.

### D2 — Content scope: own content + PD only, per-user isolated

On the server: **(a)** authored books (`book.json`), **(b)** scoped queries and their generated
content (lessons / quizzes / explanations), **(c)** public-domain downloads (Gutenberg-class, no
rightsholder). Never on the server (stays device-local): copyrighted-but-free third-party
downloads, and user-named repo content (the server never fetches a user-named repo). No
shared/global corpus; no cross-user dedup; strict per-user isolation.

### D3 — Tier & storage: paid subscription with an included minimum; reuse existing machinery

Opt-in paid subscription includes a **minimum** storage allowance (GB) + **minimum** managed-token
allowance; higher plans add more. Storage is a `Plan` axis (ADR-031 machinery); tokens metered via
ADR-016. Bounded by the per-account storage cap and the `managed_account_spend_ceiling_micros`
ceiling. **Launch prerequisite:** that ceiling ships at `default=0` today; it MUST be set to a
nonzero default before the hosted tier ships. No new billing system.

### D4 — Privacy: honest not-zero-knowledge + hard data rights

Server-side RAG must hold plaintext to index/embed, so the hosted tier **cannot be zero-knowledge**
— stated plainly. Committed mitigations: content **encrypted at rest**, decrypted **transiently**
in the RAG worker then dropped; **use-limited** to the user's own retrieval (no cross-user use, no
ad-profiling, no third-party sharing); the **super-admin role (ADR-020) never touches hosted
content** (metadata only); **deletion purges** content **and** derived index within the documented
window (extends ADR-022; amends ADR-014 D8); export on request. Disclosure copy: *"Your hosted
library lives with us to power cross-device AI. The free tier stays on your device,
zero-knowledge."* The access-control requirement ("only the user accesses their knowledge") is met
in full against other users; the operator-at-index-time caveat is disclosed. The free device-local
tier remains zero-knowledge (ADR-014 default).

### D5 — Copyright: minimal surface; DMCA is hygiene, not a launch gate

Because the server holds only own-authored/generated + PD content, there is effectively no
third-party rightsholder to injure. PD ingestion **fetches from the vetted source, never accepts
client bytes** (anti-poisoning). A standard ToS **rights-representation + indemnification** clause
governs any user-supplied material. A registered DMCA agent + takedown is **advisable hygiene, not a
launch-gating blocker** — the near-zero infringement surface removes the mandatory-DMCA-regime +
legal-review gate that ADR-032's copyrighted-file and repo hosting forced.

### D6 — Compute: server lexical first, managed-key semantic later

**Phase 1** — server **lexical FTS** over the per-user corpus; no LLM, no keys, no token spend;
ships with hosting. **Phase 2** — **managed-key semantic embeddings**, metered, **gated on the
managed-billing launch** (ADR-016); a user's key is **never** held server-side (ADR-001 unamended).
On-device BYOK semantic (ADR-029 Phase 2) remains the free-tier path.

### D7 — Sync: server is source of truth; thin-client query/stream

Library + index live server-side; a device queries for search/references and streams content on
demand. Multi-device is trivial. No local replication, no conflict handling. Offline hosted-RAG
needs a connection — acceptable, because the free device-local tier works fully offline. Device
offline cache is a v2 refinement (open Q).

### D8 — Gating & abuse posture

Ships **with the managed-billing launch** (managed keys, metering, storage plans all live there —
built, off). **Paid**, which structurally blunts Sybil/abuse (no free hosting to farm). Per-plan
storage caps (D3) and the per-account spend ceiling (D3, once set nonzero) bound infra + token cost.
Managed embeddings comp only paid providers.

## Consequences

**What we keep:** the entire device-local thesis as the **free tier** (BYOK, no vendor token bill,
no server-side user content, no reading-interest profile, zero-knowledge); **ADR-001 unamended**;
**ADR-029 becomes consistent and buildable** (its Scope promises are scoped to the free tier).

**What we lose (honestly):** zero-knowledge for hosted users (opt-in, disclosed); a real
privacy/GDPR footprint for hosted content with deletion/export obligations; real infra cost (bytes +
server FTS now, vector store + managed embeddings later). Relative to ADR-032 we **shed** the
shared-corpus dedup problem, copyrighted-file hosting, the mandatory DMCA regime + legal-review
launch gate, and unbounded free grounding — while **keeping** cross-device sync and gaining a
nameable paid value proposition (private cross-device home for your own work).

**Migration:** additive and opt-in. Existing users stay device-local until they opt into a hosted
plan; a migration/upload flow (open Q) moves eligible content up. Anonymous / device-local remains
the zero-account baseline.

## Open questions

1. Embedding provider/model + on-server vector-store infra for Phase-2 hosted semantic (via
   `wegofwd-llm`); chunking; bounds.
2. Device offline cache (D7 v2) — which items cache, invalidation, partial-offline behavior.
3. Migration flow — moving an existing device-local library into a hosted account (eligibility per
   D2).
4. Storage-tier pricing — GB allowances per plan vs infra cost (ties to ADR-031 plan catalogue).
5. Server FTS engine (Postgres FTS vs a dedicated index) and per-user index isolation model.
6. The exact nonzero default for `managed_account_spend_ceiling_micros` (D3 launch prerequisite).

## Blast radius

This ADR is accompanied by: ADR-032 → Rejected/superseded (body retained); ADR-029 → hosted mode
re-parented here, Scope promises scoped to the free tier; ADR-030 → scheduled/background form
re-parented here; ADR-031 → dangling "once ADR-032 lands" reference reworded; the two 2026-07-14
intermediate design docs → superseding banner; STATUS → ADR-032 Rejected, ADR-033 Accepted.

## Scope — what this ADR is *not*

- **Not** a change to the **free tier** — ADR-028/029 device-local / zero-knowledge is unchanged.
- **Not** server-side **BYOK** key custody — hosted RAG runs on **managed** keys (D6, ADR-001).
- **Not** hosting of **copyrighted** third-party files or user-named-repo content — own + PD only (D2/D5).
- **Not** a device-sync/replication system — server is source of truth (D7).
- **Not** shippable before **managed billing**, and not before the spend ceiling is set nonzero (D3/D8).
- **Not** the legal opinion itself — D5 records the (much smaller) posture; counsel confirms the ToS.
- **Not** the build design — hosted extraction/FTS/vector-store/reference-panel/migration are future
  brainstorms.
