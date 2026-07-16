# ADR-033 Per-User Private Hosted Library — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the go-forward hosting decision by writing a new **Accepted** ADR-033 (per-user private hosted library) and re-parenting the ADR record onto it, so the ADRs are internally consistent and no longer describe the rejected broad ADR-032 shape.

**Architecture:** Docs-only change. One new ADR file + six surgical edits to existing docs. No code, no tests, no runtime surface. The "test cycle" for each task is a **verification grep** (shown with expected output) that confirms the edit landed and did not leave a contradiction. Frequent commits — one per task.

**Tech Stack:** Markdown. Verification via `grep`. Git.

## Global Constraints

- **Dates:** Today is **2026-07-15**. Every new status/amendment line uses this date verbatim.
- **ADR-032 body is retained** — it is marked Rejected, never deleted (archival trail).
- **ADR-029 stays *Proposed*** — this plan makes it consistent, it does NOT promote or build it.
- **ADR-001 stays unamended** — no server-side BYOK key custody; nothing in these edits may imply otherwise.
- **No new decisions** — the plan only transcribes decisions from the approved design doc `docs/superpowers/specs/2026-07-15-adr-033-per-user-private-hosted-library-design.md`. If a task seems to need a new decision, stop and ask.
- **Content class on the server, stated identically everywhere it appears:** authored books + scoped queries + generated content + public-domain downloads only. Copyrighted-but-free downloads and user-named-repo content stay device-local.
- **Privacy phrasing, stated identically:** honest **not-zero-knowledge**, opt-in, paid; free device-local tier stays zero-knowledge.
- **Commit trailer** on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Write the new ADR-033 (Accepted)

The substantive deliverable. Everything else re-points to this file, so it lands first.

**Files:**
- Create: `docs/adr/ADR-033-per-user-private-hosted-library.md`

**Interfaces:**
- Produces: the file path `docs/adr/ADR-033-per-user-private-hosted-library.md` and the decision IDs **D1–D8**, referenced verbatim by Tasks 2–6. Status string it establishes: `**Status:** Accepted — 2026-07-15`.

- [ ] **Step 1: Create the ADR file with this exact content**

````markdown
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
````

- [ ] **Step 2: Verify the file exists and asserts Accepted status + all eight decisions**

Run: `grep -c -E '^### D[1-8] ' docs/adr/ADR-033-per-user-private-hosted-library.md && grep -n 'Status:\*\* Accepted — 2026-07-15' docs/adr/ADR-033-per-user-private-hosted-library.md`
Expected: first line prints `8`; second line prints the status line.

- [ ] **Step 3: Commit**

```bash
git add docs/adr/ADR-033-per-user-private-hosted-library.md
git commit -m "docs(adr): add ADR-033 — per-user private hosted library (Accepted)

Narrow hosting decision: reject ADR-032's broad shared-corpus shape, accept an
opt-in paid per-user PRIVATE hosted library (own content + PD only), synced
cross-device. Honest not-ZK privacy; copyright surface collapses to hygiene;
spend ceiling must ship nonzero before launch.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Mark ADR-032 Rejected / superseded (body retained)

**Files:**
- Modify: `docs/adr/ADR-032-server-hosted-library-and-rag.md` (status line at line 3; banner after line 3)

**Interfaces:**
- Consumes: the ADR-033 path/status from Task 1.
- Produces: ADR-032's Rejected status, relied on by Task 6's verification.

- [ ] **Step 1: Replace the status line**

Find (line 3):
```
**Status:** Proposed — 2026-07-12 (the §5 open decisions of the pre-ADR brief are now
```
The full line 3–4 currently reads:
```
**Status:** Proposed — 2026-07-12 (the §5 open decisions of the pre-ADR brief are now
resolved; see D1–D10). Design-only; gated on the managed-billing launch.
```
Replace those two lines with:
```
**Status:** Rejected — 2026-07-15 (superseded by ADR-033). Originally Proposed 2026-07-12
(§5 resolved; see D1–D10). Design-only; never implemented.

> **This decision was rejected.** The document is retained as the record of the broad
> hosted shape that was considered and narrowed to a per-user *private* hosted tier — see
> **ADR-033**. Its reasoning has archival value; the body below is unchanged.
```

- [ ] **Step 2: Verify Rejected status is set and the body is intact**

Run: `grep -n 'Rejected — 2026-07-15 (superseded by ADR-033)' docs/adr/ADR-032-server-hosted-library-and-rag.md && grep -c '^### D' docs/adr/ADR-032-server-hosted-library-and-rag.md`
Expected: first line prints the status line; second line prints `10` (D1–D10 body untouched).

- [ ] **Step 3: Commit**

```bash
git add docs/adr/ADR-032-server-hosted-library-and-rag.md
git commit -m "docs(adr): mark ADR-032 Rejected, superseded by ADR-033 (body retained)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Re-parent ADR-029's hosted mode + scope its free-tier promises

The trickiest edit — ADR-029's self-contradiction is fixed by *scoping* the Scope block to the free
tier, not by deleting the hosted mode.

**Files:**
- Modify: `docs/adr/ADR-029-library-grounded-references.md` (header at line 3; Scope block ~line 116)

**Interfaces:**
- Consumes: ADR-033 path from Task 1.

- [ ] **Step 1: Replace the line-3 header amendment**

Find (line 3–5):
```
**Status:** Proposed — 2026-07-10 · **amended by ADR-032 (2026-07-12): dual-mode** — the
device-local design below is the **free tier**; a **hosted** mode (server FTS now,
managed-key embeddings Phase 2) is added for the paid tier.
```
Replace with:
```
**Status:** Proposed — 2026-07-10 · **amended by ADR-033 (2026-07-15):** the device-local
design below is the **free tier**; the hosted mode is the per-user **private** paid tier
(server FTS now, managed-key embeddings Phase 2) — see **ADR-033** (ADR-032's broad hosted
shape was rejected). This ADR stays *Proposed*; nothing here is promoted or built.
```

- [ ] **Step 2: Scope the Scope block's device-local promise to the free tier**

Find (the first Scope bullet, ~line 116–120):
```
- **Not** cloud retrieval — no server-side index, corpus, or query log; queries and
  interests never leave the device (Phase 2's provider calls are the sole, disclosed,
  opt-in exception).
```
Replace with:
```
- **Not** cloud retrieval **in the free (device-local) tier** — no server-side index,
  corpus, or query log; queries and interests never leave the device (Phase 2's BYOK
  provider calls are the sole, disclosed, opt-in exception). *The opt-in **paid** hosted
  tier (ADR-033) necessarily holds a server-side index over the user's own private corpus;
  its not-zero-knowledge posture and data rights are governed by ADR-033 D4.*
```

- [ ] **Step 3: Verify header points at 033, Scope no longer contradicts, and no live ADR-032 pointer remains in ADR-029**

Run: `grep -n 'amended by ADR-033' docs/adr/ADR-029-library-grounded-references.md && grep -n 'free (device-local) tier' docs/adr/ADR-029-library-grounded-references.md && ! grep -qi 'amended by ADR-032' docs/adr/ADR-029-library-grounded-references.md && echo "OK: no ADR-032 amendment pointer"`
Expected: the two greps print their matching lines; final line prints `OK: no ADR-032 amendment pointer`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/ADR-029-library-grounded-references.md
git commit -m "docs(adr): re-parent ADR-029 hosted mode onto ADR-033; scope free-tier promises

Header amendment now points at ADR-033 (private hosted tier), not the rejected
ADR-032. Scope block's 'nothing leaves the device' is explicitly scoped to the
free device-local tier, resolving ADR-029's self-contradiction without deleting
the hosted mode. Stays Proposed.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Re-point ADR-030 header + fix ADR-031 dangling reference

Two trivial one-line re-points, batched — a reviewer would accept/reject them together.

**Files:**
- Modify: `docs/adr/ADR-030-content-currency-agent.md` (header at line 3)
- Modify: `docs/adr/ADR-031-*.md` (line ~156)

**Interfaces:**
- Consumes: ADR-033 path from Task 1.

- [ ] **Step 1: Replace ADR-030's line-3 header amendment**

Find (line 3, begins):
```
**Status:** Proposed — 2026-07-10 · **amended by ADR-032 (2026-07-12):** the author-side
```
Change only the amendment clause `**amended by ADR-032 (2026-07-12):**` to:
```
**amended by ADR-033 (2026-07-15):**
```
and, at the point where the clause states the scheduled/background form goes to the hosted tier,
ensure it reads "the per-user private hosted tier (ADR-033)". If the existing sentence already
names "the hosted tier," change that noun phrase to "the per-user private hosted tier (ADR-033)".
Leave the author-side BYOK sentence (the free path) unchanged.

- [ ] **Step 2: Reword the ADR-031 dangling reference**

Find (line ~156):
```
   once ADR-032 lands). Each flag needs one enforcement site.
```
Replace with:
```
   once the hosted tier (ADR-033) lands). Each flag needs one enforcement site.
```

- [ ] **Step 3: Verify both re-points and confirm no live ADR-032 dependency remains in either file**

Run:
```
grep -n 'amended by ADR-033' docs/adr/ADR-030-content-currency-agent.md && \
grep -rn 'once the hosted tier (ADR-033) lands' docs/adr/ADR-031-*.md && \
! grep -qiE 'once ADR-032 lands|amended by ADR-032' docs/adr/ADR-030-content-currency-agent.md docs/adr/ADR-031-*.md && echo "OK: no dangling ADR-032 refs"
```
Expected: the two greps print matches; final line prints `OK: no dangling ADR-032 refs`.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/ADR-030-content-currency-agent.md docs/adr/ADR-031-*.md
git commit -m "docs(adr): re-point ADR-030 scheduled form + ADR-031 ref onto ADR-033

ADR-030's scheduled/background currency-watch now lives on the per-user private
hosted tier (ADR-033), not the rejected ADR-032. ADR-031's dangling 'once
ADR-032 lands' reworded to 'once the hosted tier (ADR-033) lands'. Substance
of both ADRs untouched.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Banner the two intermediate design docs + update STATUS

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-adr-032-reconciliation-device-local-retrieval-design.md` (top)
- Modify: `docs/superpowers/specs/2026-07-14-adr-029-vs-032-comparison.md` (top)
- Modify: `docs/STATUS.md`

**Interfaces:**
- Consumes: ADR-033 path/status from Task 1; ADR-032 Rejected status from Task 2.

- [ ] **Step 1: Add a superseding banner directly under the H1 of BOTH 2026-07-14 docs**

Insert this block immediately after the first `# ` heading line of each file:
```
> **Superseded by the 2026-07-15 design** (`2026-07-15-adr-033-per-user-private-hosted-library-design.md`).
> The decision narrowed from "reject hosting outright" to "reject ADR-032's broad shape,
> **accept a per-user *private* hosted tier** (ADR-033)." This document is retained as the
> record of the intermediate full-rejection reasoning; its body is unchanged.
```

- [ ] **Step 2: Update STATUS.md — ADR-032 Rejected, ADR-033 Accepted**

Open `docs/STATUS.md`. If it lists ADRs by number/status:
- Change the ADR-032 entry's status to `Rejected (superseded by ADR-033)`.
- Add an ADR-033 entry: `ADR-033 — per-user private hosted library — **Accepted** 2026-07-15 (hosted tier gated on managed billing; free device-local tier unchanged)`.
If STATUS has no ADR list, add a one-line note under its most relevant "decisions/ADR" section recording ADR-033 Accepted and ADR-032 Rejected. Do not restructure STATUS.

- [ ] **Step 3: Verify banners present and STATUS updated**

Run:
```
grep -l 'Superseded by the 2026-07-15 design' docs/superpowers/specs/2026-07-14-adr-032-reconciliation-device-local-retrieval-design.md docs/superpowers/specs/2026-07-14-adr-029-vs-032-comparison.md && \
grep -niE 'ADR-033' docs/STATUS.md && grep -niE 'ADR-032.*reject|reject.*ADR-032' docs/STATUS.md
```
Expected: both spec paths printed; at least one ADR-033 line in STATUS; at least one ADR-032-rejected line in STATUS.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-07-14-adr-032-reconciliation-device-local-retrieval-design.md docs/superpowers/specs/2026-07-14-adr-029-vs-032-comparison.md docs/STATUS.md
git commit -m "docs: supersede 2026-07-14 full-rejection docs; STATUS reflects ADR-033 Accepted / ADR-032 Rejected

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Final consistency verification + memory maintenance

No commit for the greps (read-only). The memory update is a separate, non-git deliverable.

**Files:**
- Read-only: `docs/adr/`, `docs/STATUS.md`
- Modify (memory, not git): `~/.claude/projects/-home-sivam-Documents-code-projects-AIStuff-STEM-studybuddy-Mentible/memory/project_grounded_authoring_adr029_032.md` and the current resume-pin file + `MEMORY.md` pointer.

- [ ] **Step 1: Contradiction sweep across all ADRs**

Run: `grep -riE "dual-mode|hosted (rag|tier|mode)" docs/adr/`
Expected: matches appear ONLY in ADR-033 (defining the tier), ADR-029 / ADR-030 (pointing to it), and ADR-032 (the rejected record). No other ADR describes a live hosted/dual-mode design.

- [ ] **Step 2: No ADR treats ADR-032 as live/pending**

Run: `grep -riE "adr-032" docs/adr/`
Expected: every hit is either ADR-032's own Rejected header/banner, or a "superseded/rejected ADR-032" reference in ADR-033. No "once ADR-032 lands", no "amended by ADR-032", no "will land".

- [ ] **Step 3: ADR-029 header/Scope agree**

Run: `grep -nE 'amended by ADR-033|free \(device-local\) tier' docs/adr/ADR-029-library-grounded-references.md`
Expected: both lines present — header points at ADR-033, Scope scopes the promise to the free tier.

- [ ] **Step 4: Update memory to reflect the accepted decision**

Edit `project_grounded_authoring_adr029_032.md`: replace the "hosted RAG rejected / PD-only shared corpus" framing with: *"ADR-033 (Accepted 2026-07-15): per-user **private** hosted tier accepted — own content + PD only, paid with included minimum, honest not-ZK. ADR-032's broad shared-corpus shape rejected. Device-local (ADR-029) stays the zero-knowledge free tier."* Update the current resume-pin file's next-step line and the matching `MEMORY.md` pointer hook to match. Keep each memory file one fact; update in place, do not duplicate.

- [ ] **Step 5: Final report**

Confirm to the user: all six edits committed (Tasks 1–5), the four verification greps pass (Steps 1–3), memory updated (Step 4). Note the two owner-decision followups: (a) set `managed_account_spend_ceiling_micros` nonzero before any hosted-tier build; (b) branch `docs/adr-033-reject-hosted-rag` name now mismatches the narrow-accept decision — rename or leave at PR time.

---

## Notes for the executor

- **This plan makes no code change and adds no tests** — it is a decision-record edit. The grep
  steps ARE the verification; treat a failing grep exactly as you would a failing test (stop, fix,
  re-run).
- **Never delete an ADR body.** Rejection is a status + banner, not a removal.
- **If any "Find" string does not match verbatim**, re-read the file around the cited line before
  editing — do not force a replacement against drifted text. Line numbers are approximate; the
  quoted strings are authoritative.
- **Do not promote ADR-029 or ADR-030** or add any new decision. If a step seems to require one,
  stop and ask the owner.
