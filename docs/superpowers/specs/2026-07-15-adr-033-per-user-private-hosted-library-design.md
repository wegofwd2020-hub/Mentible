# Design — ADR-033 reshaped: per-user private hosted library (narrow hosting tier)

**Date:** 2026-07-15
**Author:** Sivakumar Mambakkam (with Claude)
**Status:** Approved design — ready for implementation plan
**Deliverable:** write a new **ADR-033** (Accepted) plus surgical edits to ADR-032, ADR-029,
ADR-030, ADR-031, two intermediate design docs, and STATUS.
**Explicitly out of scope:** designing or building the hosted retrieval feature itself
(extraction, FTS engine, vector store, reference panel, migration/upload flow). Those are
separate future brainstorms gated on the managed-billing launch. This work only records the
go-forward product decision and makes the ADR record consistent.
**Supersedes:** `2026-07-14-adr-032-reconciliation-device-local-retrieval-design.md` and its
companion `2026-07-14-adr-029-vs-032-comparison.md` — the decision has narrowed from
"reject hosting outright" to "reject the broad hosted shape, accept a narrow per-user private
hosted tier." Those docs are retained as the record of the intermediate full-rejection
reasoning.

---

## Problem

Two forces collided in the ADR record:

1. **ADR-029 (library-grounded references)** was designed **device-local**: on-device lexical
   retrieval over the author's own downloaded + authored books — no network, no tokens, no
   server-side content. Its Scope block promises *"no server-side index, corpus, or query log;
   queries and interests never leave the device."*
2. **ADR-032 (2026-07-12)** reshaped it into a **paid hosted tier** — a server-hosted library
   plus hosted RAG on managed keys — and in doing so amended ADR-001, amended ADR-014, reversed
   ADR-028's "core promise," and left ADR-029 internally contradictory (header said
   "dual-mode / hosted," Scope still said "nothing leaves the device").

An intermediate design (2026-07-14) resolved the contradiction by **rejecting hosting outright**
and keeping retrieval device-local. That was correct *for the ADR-032 shape it was rejecting* —
a **shared, global, deduplicated PD corpus** (ADR-032 D13) with copyrighted-file hosting (D7)
and unbounded free grounding (D15) — whose own author could no longer state what the paid tier
sold (OQ-A4) and whose abuse guard the ADR admitted was "broken."

**But the product owner's actual requirement is a different design point** than the one ADR-032
landed on:

- Hosting per user **is** wanted — the library, queries, and generated content should follow the
  account across devices.
- The corpus is **private and per-user**, not shared/global. Every book, query, and generated
  artifact is specific to one user; nothing one user stores is ever visible to another.
- A **minimum free storage + token allowance** inside a **paid** subscription.
- Privacy: only the user accesses their knowledge.

This is neither ADR-029 (device-local, no sync) nor ADR-032-as-landed (shared global corpus).
It is a **third point**: the per-user *private* hosted account that ADR-032's original D2
gestured at **before** its D11 amendment retreated to the shared-PD-corpus cul-de-sac.

Crucially, ADR-033 does not exist as a committed ADR yet — the branch holds only the two design
docs. So this is a **fresh write of a pending draft**, not a reversal of an accepted decision.
The cheapest place to make an architecture decision is on paper before code exists; that is
exactly where we are.

---

## Decision

**Reject ADR-032's hosted shape. Accept a narrow substitute: an opt-in, paid, per-user *private*
hosted library — the user's own authored books, scoped queries, and generated content, plus their
public-domain downloads — synced across devices, running server lexical search now and
managed-key semantic retrieval later.**

The device-local design (ADR-028/029) remains the **free/anonymous** baseline, unchanged and
zero-knowledge. The hosted tier is an **opt-in unlock tied to subscription** — the reversal of the
device-local promise is per-user and paid, never wholesale.

### Why this is one decision, not two

This is Approach A of the brainstorm: one ADR carries the whole hosting stance — *we considered
hosting, rejected the broad version, accepted the narrow version.* ADR-032 is marked **Rejected,
superseded by ADR-033**; its body is retained as the archived record of the broad shape. We do
**not** amend ADR-032 in place (that would compound the self-amending-stack rot the 2026-07-14
reconciliation called out), and we do **not** split the pivot across two ADRs (reject in 033,
accept in 034) — "reject broad / accept narrow" is genuinely one decision about one topic.

### The narrow tier's decisions (become D1–D8 in the ADR)

**D1 — Hybrid: device-local free baseline + opt-in per-user private hosted account (paid).**
ADR-028/029 device-local stays the free/anonymous/zero-knowledge baseline. The hosted account is
an opt-in subscription unlock. Additive; existing users stay device-local until they opt in.

**D2 — Content scope: own content + PD only, per-user isolated.**
On the server: **(a)** authored books (`book.json`), **(b)** scoped queries and their generated
content (lessons / quizzes / explanations), **(c)** public-domain downloads (Gutenberg-class, no
rightsholder). Never on the server (stays device-local): copyrighted-but-free third-party
downloads, and user-named repo content (the server never fetches a user-named repo — highest
legal exposure). No shared/global corpus; no cross-user dedup; strict per-user isolation.

**D3 — Tier & storage: paid subscription with an included minimum; reuse existing machinery.**
Opt-in paid subscription includes a **minimum** storage allowance (GB) + **minimum** managed-token
allowance; higher plans add more. Storage is a `Plan` axis (ADR-031 machinery); tokens metered via
ADR-016. Bounded by the per-account storage cap and the `managed_account_spend_ceiling_micros`
ceiling. **Launch prerequisite:** that ceiling ships at `default=0` today; it MUST be set to a
nonzero default before the hosted tier ships — the un-priced-spend gap was a leg of the original
rejection and must be closed, not inherited. No new billing system.

**D4 — Privacy: honest not-zero-knowledge + hard data rights.**
Server-side RAG must hold plaintext to index/embed, so the hosted tier **cannot be
zero-knowledge** — stated plainly, never hidden. Committed mitigations:
- Content **encrypted at rest**; decrypted **transiently** in the RAG worker to index/embed, then
  dropped — never persisted in plaintext.
- **Use-limited** to serving the user's **own** retrieval: no cross-user use, no ad-profiling, no
  third-party sharing.
- The **super-admin operator role (ADR-020) never touches hosted content** — it acts on account
  *metadata* only; hosted content is outside its reach.
- **Deletion purges** content **and** derived index within the documented window (extends ADR-022;
  amends ADR-014 D8). Export on request.
- Disclosure copy: *"Your hosted library lives with us to power cross-device AI. The free tier
  stays on your device, zero-knowledge."*

The access-control requirement ("only the user accesses their knowledge") is met in full against
**other users**; the operator-at-index-time caveat is **disclosed**, because it is inherent to
hosted RAG and cannot be engineered away while keeping server-side semantic search. The free
device-local tier remains zero-knowledge (ADR-014 default).

**D5 — Copyright: minimal surface; DMCA is hygiene, not a launch gate.**
Because the server holds **only own-authored/generated + PD** content, there is effectively no
third-party rightsholder to injure:
- Own-authored/generated content has no third-party rights.
- PD content has no rightsholder.
- PD ingestion **fetches from the vetted source, never accepts client bytes** (anti-corpus-poisoning,
  carried from ADR-032 D14).
- A standard ToS **rights-representation + indemnification** clause governs any user-supplied
  material.
- A registered DMCA agent + takedown process is **advisable hygiene, not a launch-gating blocker** —
  the near-zero infringement surface removes the mandatory-DMCA-regime + legal-review gate that
  ADR-032's copyrighted-file and repo hosting (D7) forced.

This is the largest single win over ADR-032: the highest-risk, launch-gating legal exposure
disappears by construction.

**D6 — Compute: server lexical first, managed-key semantic later.**
- **Phase 1** — server **lexical FTS** over the per-user corpus. No LLM, no keys, no token spend.
  Ships with hosting; delivers "search my library across devices" immediately.
- **Phase 2** — **managed-key semantic embeddings**, metered, **gated on the managed-billing
  launch** (ADR-016). A user's key is **never** held server-side (ADR-001 holds unamended). On-device
  BYOK semantic (ADR-029 Phase 2) remains the free-tier path.

**D7 — Sync: server is source of truth; thin-client query/stream.**
The library + index live server-side; a device queries the server for search/references and streams
content on demand. Multi-device is trivial (every device sees the same state). No local replication,
no conflict handling. Hosted-RAG offline needs a connection — acceptable, because the free
device-local tier works fully offline. Device-side caching for partial offline is a v2 refinement
(open Q).

**D8 — Gating & abuse posture.**
The hosted tier ships **with the managed-billing launch** (managed keys, metering, storage plans all
live there — built, off). It is **paid**, which structurally blunts Sybil/abuse (no free hosting to
farm). Per-plan storage caps (D3) and the per-account spend ceiling (D3, once set nonzero) bound
infra + token cost. Managed embeddings comp only paid providers (no free-tier Gemini — trains on
data).

---

## What we keep

- The entire device-local thesis as the **free tier**: BYOK, no vendor token bill, no server-side
  user content, no reading-interest profile, zero-knowledge. ADR-028/029's device-local design is
  re-affirmed, not replaced.
- **ADR-001 stays unamended** — no server-side BYOK key custody; hosted RAG runs on managed keys.
- **ADR-029 becomes consistent and buildable** — its Scope promises are scoped to the free tier;
  the hosted mode is re-parented onto ADR-033.

## What we lose (stated honestly)

- **Zero-knowledge for hosted users.** By construction, opt-in and disclosed. Only affects users who
  choose the paid tier; the free tier is untouched.
- **A genuine privacy/GDPR footprint** for hosted content (readable at index time) with
  deletion/export obligations.
- **Real infra cost** — stored bytes + server FTS now, vector store + managed embeddings later.
- Relative to a pure device-local world: we take on hosting we would not otherwise run. Relative to
  ADR-032: we **shed** the shared-corpus dedup problem, copyrighted-file hosting, the mandatory DMCA
  regime + legal-review launch gate, and the unbounded-free-grounding cost — while **keeping** the
  one capability hosting buys (cross-device sync) and gaining a **nameable** paid value proposition
  (private cross-device home for your own work), which ADR-032's OQ-A4 could not state.

---

## Blast radius — one new ADR + six surgical edits

### 1. NEW `docs/adr/ADR-033-per-user-private-hosted-library.md`
**Status:** Accepted — 2026-07-15. Sections: Context (the ADR-032 reshaping + the ADR-029
contradiction it created, and why the owner's requirement is a third design point) → Decision
(reject broad ADR-032 shape / accept narrow per-user-private tier; D1–D8 above) → What we
keep / lose → Blast radius (this list, so the ADR is self-describing) → Relates-to: ADR-029,
ADR-030, ADR-031, ADR-032, ADR-001, ADR-014, ADR-016, ADR-020, ADR-022, ADR-028.

### 2. EDIT `ADR-032` — mark Rejected, superseded
It was only ever *Proposed*, so it is rejected in place. Status line →
`**Status:** Rejected — 2026-07-15 (superseded by ADR-033)`. Add a one-line top-of-body banner:
*this decision was rejected; the document is retained as the record of the broad hosted shape that
was considered and narrowed to the per-user private tier (ADR-033).* **Leave the body intact** —
the reasoning has archival value.

### 3. EDIT `ADR-029` — re-parent hosted mode onto ADR-033; scope the free-tier promises
Change the line-3 header amendment from *"amended by ADR-032 (2026-07-12): dual-mode …"* to:
*"amended by ADR-033 (2026-07-15): device-local is the **free tier**; the hosted mode is the
per-user **private** paid tier (ADR-033)."* Annotate the **Scope** block: its "no server-side
index, corpus, or query log; queries and interests never leave the device" promises are **scoped to
the device-local free tier**; the hosted paid tier necessarily holds a server-side index — see
ADR-033 D4 (privacy). This resolves ADR-029's self-contradiction by *scoping* the promise, not by
deleting the hosted half. ADR-029 stays *Proposed*, buildable, ready for a future device-local
build brainstorm.

### 4. EDIT `ADR-030` (content-currency-agent) — re-point to ADR-033
Change the line-3 header amendment from *"amended by ADR-032 (2026-07-12):"* to:
*"amended by ADR-033 (2026-07-15): the scheduled/background form lives on the per-user private
hosted tier."* Its managed-billing gating (D4) is unchanged and now consistent (the hosted tier is
billing-gated). The scheduled form is *relocated onto the accepted hosted tier*, not removed.

### 5. EDIT `ADR-031` — fix the dangling forward-reference
Line ~156 reads *"… once ADR-032 lands"*. ADR-032 is not landing; the hosted tier does, as ADR-033.
Reword to *"… once the hosted tier (ADR-033) lands"* (or drop the temporal clause). ADR-031's own
decision is untouched — it already supplies the `Plan` / storage / metering machinery D3 reuses.

### 6. EDIT the two 2026-07-14 intermediate design docs
`2026-07-14-adr-032-reconciliation-device-local-retrieval-design.md` and
`2026-07-14-adr-029-vs-032-comparison.md`: add a one-line top banner on each — *superseded by the
2026-07-15 design; the decision narrowed from "reject hosting" to "accept a per-user private hosted
tier." Retained as the record of the intermediate full-rejection reasoning.* Bodies intact.

### 7. EDIT `docs/STATUS.md` (+ any ADR index / PORTFOLIO)
ADR-032 → Rejected (superseded by ADR-033). Add ADR-033 → Accepted (per-user private hosted
library; hosted tier gated on managed billing).

### Out-of-repo followups (flagged, done after the doc lands)
- **Memory maintenance** — `project_grounded_authoring_adr029_032.md` and the current resume pin say
  "hosted RAG rejected / PD-only shared corpus." Flip both to "per-user private hosted tier accepted
  (ADR-033); device-local stays the free tier."
- **Branch name** — `docs/adr-033-reject-hosted-rag` now mismatches the narrow-*accept* decision.
  Cosmetic; rename or leave at PR time (owner's call).

---

## Verification (docs-only change — no test suite)

After the edits, grep-confirm:

1. `grep -riE "dual-mode|hosted (rag|tier|mode)" docs/adr/` → hits only ADR-033 (defining it),
   ADR-029 / ADR-030 (pointing to it), and ADR-032 (the rejected record).
2. ADR-029's header and Scope no longer contradict: the Scope block is explicitly scoped to the
   device-local free tier; the header points the hosted mode at ADR-033.
3. No remaining ADR treats ADR-032 as a live/pending decision:
   `grep -riE "adr-032" docs/adr/` shows only Rejected-status references and ADR-033's analysis.
4. `grep -rn "once ADR-032 lands" docs/adr/` → no hits (ADR-031 reworded).
5. STATUS shows ADR-032 Rejected + ADR-033 Accepted.

## Non-goals (guard against scope creep)

- **Not** designing the hosted retrieval build (extraction, server FTS engine, vector store,
  reference panel, migration/upload flow) — separate future brainstorms, gated on managed billing.
- **Not** building or turning on anything — ADR-032 was never implemented (zero hits for
  `rag` / `embedding` / `vector` / `pgvector` / `fts5` across the codebase on 2026-07-14); this is
  a paper decision.
- **Not** touching ADR-031's substance beyond the one dangling reference.
- **Not** deleting ADR-032's body — rejection preserves the trail; deletion destroys it.
- **Not** re-litigating ADR-028/029's device-local design — this re-affirms it as the free tier.
- **Not** the legal opinion itself — D5 records the (much smaller) posture; counsel confirms the ToS
  rights-rep/indemnification clause and whether even a hygiene DMCA agent is wanted at launch.
