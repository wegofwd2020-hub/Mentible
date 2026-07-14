# Design — Reconcile ADR-029 / ADR-032: device-local retrieval is the answer

**Date:** 2026-07-14
**Author:** Sivakumar Mambakkam (with Claude)
**Status:** Approved design — ready for implementation plan
**Deliverable:** a new **ADR-033** plus surgical edits to ADR-032, ADR-029, ADR-030, ADR-031.
**Explicitly out of scope:** designing or building the device-local retrieval feature itself.
That is a separate future brainstorm. This work only makes the ADR record consistent and
records the go-forward decision.

---

## Problem

ADR-029 (library-grounded references) was designed **device-local**: on-device lexical
retrieval over the author's own downloaded + authored books, no network, no tokens, no
server-side content. ADR-032 (2026-07-12) then reshaped it into a **paid hosted tier** —
server-hosted library plus hosted RAG on **managed** keys — and in doing so:

- **amended ADR-001** (no server-side key custody): the hosted tier's RAG runs on managed keys;
- **amended ADR-014** (data-minimization / device-local default): the hosted tier holds readable content;
- **reversed ADR-028's "core promise"** (its own words) of device-local downloads; and
- **left ADR-029 internally contradictory**: its header now says "dual-mode / hosted," while its
  untouched **Scope** block still promises *"no server-side index, corpus, or query log; queries
  and interests never leave the device."*

You cannot implement a decision that contradicts itself, and you cannot build ADR-029 while
ADR-032 is actively rewriting its premise. The contradiction is not cosmetic — it is the visible
symptom of an unmade product decision.

## Decision

**Reject the hosted tier. Retrieval stays device-local, lexical, free, BYOK-only.**

Four reasons, in order of weight:

1. **The moat.** BYOK, no vendor token bill, and zero server-side user content are the product's
   actual differentiator against the upload-your-documents-to-our-cloud default. The hosted tier
   trades that away for cross-device convenience.
2. **ADR-032's own OQ-A4.** After its D11 (personal uploads stay device-local) and D15 (the PD
   corpus is free), ADR-032 could no longer state what the paid tier would sell. A tier whose
   author cannot name its value proposition should not be built.
3. **Un-priced risk.** D15 put the vendor's managed-key token spend in front of **free** users,
   while the one backstop three ADRs lean on — `managed_account_spend_ceiling_micros` — ships at
   `default=0` (no ceiling). The abuse argument was, by the ADR's own admission, broken.
4. **Decision hygiene.** A self-amending stack of *Proposed* ADRs that rewrites *Accepted*
   decisions (ADR-001, ADR-014, ADR-028) before any code exists is where architecture rots.
   Killing the branch that caused it is the cheap fix, done on paper, exactly when it is cheapest.

## What we lose (stated honestly)

- **Cross-device library + RAG sync as a paid feature.** A user's downloaded shelf and any future
  retrieval index remain per-device (ADR-028 D3 / ADR-029 D3). A second device rebuilds its own.
  This is a real capability we are choosing not to sell.
- Nothing else. No shipped code is affected — ADR-032 was never implemented (zero hits for
  `rag` / `embedding` / `vector` / `pgvector` / `fts5` across the codebase on 2026-07-14).

## What we keep

- The entire device-local thesis: BYOK, no vendor token bill, no server-side user content,
  no reading-interest profile. ADR-001, ADR-014, and ADR-028 revert to un-amended force.
- **ADR-029 becomes buildable as written** — its Scope and header agree again.

---

## Deliverable — one new ADR + four surgical edits

### 1. NEW: `docs/adr/ADR-033-device-local-retrieval-hosted-rag-rejected.md`

**Status:** Accepted — 2026-07-14. Sections:

- **Context** — the ADR-032 reshaping and the ADR-029 contradiction it created (as above).
- **Decision** — reject the hosted tier; the four reasons above.
- **Consequences** — what we lose / keep (above), and: ADR-029 is now consistent and buildable;
  ADR-030's scheduled watch reverts to its original managed-billing gating (not deleted).
- **Blast radius** — the exact edit list below, so the record is self-describing.
- **Relates to:** ADR-029, ADR-030, ADR-031, ADR-032, ADR-001, ADR-014, ADR-028.

### 2. EDIT `ADR-032` — mark Rejected

It was only ever *Proposed*, so it is **rejected in place**, not "superseded." Change the status
line to `**Status:** Rejected — 2026-07-14 (see ADR-033)` and add a one-line banner at the top of
the body: *this decision was rejected; the document is retained as the record of what was
considered and why it was not adopted.* **Leave the body intact** — the reasoning has archival value.

### 3. EDIT `ADR-029` — drop the dual-mode amendment

Remove the three-line `amended by ADR-032 (2026-07-12): dual-mode …` clause from the Status header,
restoring `**Status:** Proposed — 2026-07-10`. Add one line: `Reconciled by ADR-033 (2026-07-14):
device-local only; the hosted mode was rejected.` The Scope block ("no server-side index …") then
stands correct and unedited. No other change — ADR-029 stays *Proposed*, ready for a future build
brainstorm.

### 4. EDIT `ADR-030` — drop the dual-mode amendment

Remove the `amended by ADR-032 …` clause. Its scheduled/background currency-watch reverts to its
**original** gating (managed billing, ADR-016/013) — it is *relocated back*, not removed. Add the
same one-line `Reconciled by ADR-033` pointer.

### 5. EDIT `ADR-031` — fix one dangling forward-reference

ADR-031 is otherwise independent (it comps BYOK-managed access; it does not depend on hosted RAG).
But line ~156 reads *"… once ADR-032 lands"*. Reword to drop the dead reference (ADR-032 is not
landing) without changing ADR-031's own decision.

---

## Verification (docs-only change — no test suite)

After the edits, grep-confirm:

1. No ADR still describes retrieval as `dual-mode` or points to a live hosted tier:
   `grep -rniE "dual-mode|hosted (rag|tier|mode)" docs/adr/` returns only ADR-032 (as the rejected
   record) and ADR-033 (describing what was rejected).
2. ADR-029's header and Scope no longer contradict: the header says device-local, the Scope says
   "no server-side index," and nothing between them says otherwise.
3. No remaining ADR treats ADR-032 as a live/pending decision:
   `grep -rniE "adr-032|032 (lands|will|hosted)" docs/adr/` shows only Rejected-status references
   and ADR-033's analysis.
4. `PORTFOLIO`/status docs, if they list ADR-032 as Proposed, are updated to Rejected (check the
   project-critique companion note separately; out of scope for this repo's PR).

## Non-goals (guard against scope creep)

- **Not** designing the device-local retrieval build (extraction, FTS engine, reference panel).
- **Not** touching ADR-031's substance beyond the one dangling reference.
- **Not** deleting ADR-032's body — rejection preserves the trail; deletion destroys it.
- **Not** re-litigating ADR-028/029's device-local design — this ADR re-affirms it, nothing more.
