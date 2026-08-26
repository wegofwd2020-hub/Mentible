# Trust Model Setting — Per-User Choice of Trust Generation Provider (Design)

> **Status:** Design note (not yet built). **Date:** 2026-08-25.
> **Idea:** Let the user choose which model drafts **trust-artifact** content. Free edition
> defaults to **Groq (Llama 3.3)**; an experienced user can choose **Claude via their own API
> key (BYOK)**.
> **Depends on:** the Groq managed-default work
> ([`2026-08-25-groq-default-testing-phase.md`](./2026-08-25-groq-default-testing-phase.md) +
> [`…-groq-implementation-prerequisites.md`](./2026-08-25-groq-implementation-prerequisites.md)).
> **Context:** trust workspace = ADR-037; per-provider credentials = ADR-014; money = ADR-005.

---

## 0. TL;DR

- A **per-project "How trust content is drafted"** setting with **two lanes**:
  - **Standard** — managed **Groq / Llama 3.3**, free, zero-key (draft-grade; expert reviews before
    it counts).
  - **Expert** — **BYOK** (Claude or other), user's own key, highest fidelity to cited sources.
- **Clean tiering rule (also the cost control):** **managed = Groq only (we pay ~$0); Claude =
  BYOK only (they pay).** The free edition never bills us for Anthropic; the "experienced user
  wants Claude" case is exactly the person who brings a key.
- **Every artifact is stamped with the model that drafted it** (`generation_meta` → `TrustBadge`),
  visible to reviewers — the disclosure the Groq plan flagged, built into the feature.
- **Seam is ready:** trust generation already takes `provider_id` + optional BYOK `api_key`;
  `generation_meta` and `TrustBadge` already exist. The work is a setting + UI + stamping.

---

## 1. The two-lane rule

| Lane | Model | Key | Who pays | For whom |
|---|---|---|---|---|
| **Standard** (default, free) | Groq / **Llama 3.3 70B** (managed) | none (our managed key) | **us** (~$0, Groq free tier) | Everyone; the free edition |
| **Expert** (opt-in) | **Claude** (or any BYOK provider) | user's own (`sk-ant-…`) | **the user** (their vendor) | Experienced users who want top citation fidelity |

- **Managed Claude is deliberately NOT offered on the free edition** — it would bill *us* for
  Anthropic on the product's most token-heavy path. Claude is reachable only via BYOK. This bounds
  our cost and keeps the tiers coherent.
- **Room to grow:** a future **paid** tier could add a third lane (managed Claude, we carry the
  cost) without disturbing this rule.

---

## 2. UX design

**Setting: "How trust content is drafted"** — lives **per trust project**, seeded from a **global
default** (mirrors books: global default + per-project override). Free edition's global default =
Standard.

```
  How trust content is drafted                    (Project · Settings)
 ┌──────────────────────────────────────────────────────────────┐
 │ ● Standard                                          FREE       │
 │   Community model · Llama 3.3 (Groq)                           │
 │   Fast and free. Draft-grade — you review & approve           │
 │   before anything counts as validated.                        │
 ├──────────────────────────────────────────────────────────────┤
 │ ○ Expert  (your own API key)                                  │
 │   Highest fidelity to your cited sources · e.g. Claude        │
 │   Uses your key — you pay your provider directly.             │
 │   Best citation accuracy for the validated spine.             │
 │        ┌───────────────────────────────┐                      │
 │        │  + Add your Anthropic key  →  │  (if no key yet)     │
 │        └───────────────────────────────┘                      │
 └──────────────────────────────────────────────────────────────┘

  On every artifact + in the reviewer view:
   ┌─────────────────────────────────────────┐
   │  Drafted with · Llama 3.3 (Groq)         │   ← from generation_meta
   └─────────────────────────────────────────┘
```

### Principles (the load-bearing part)

The hard part isn't the picker — it's communicating a **trust gradient** honestly without being
condescending, since a free user picking a draft-grade model *for the trust spine* is the integrity
risk we identified. Five moves handle it:

1. **Framed by outcome, not vendor** — "fidelity to your cited sources," because that's what trust
   *means*. Most users don't know models.
2. **Progressive disclosure** — free users see "Standard (community model)"; the AI-savvy user sees
   the model name + BYOK path. One label, detail on expand.
3. **Honest about draft-grade** — "draft-grade — you review before it counts" is *true* (an expert
   approves every artifact), so it reassures rather than scares.
4. **Model stamped on the artifact** — `generation_meta.{provider,model}` → `TrustBadge` renders
   "Drafted with X," visible to reviewers. Transparency instead of a quality wall.
5. **BYOK-guided** — choosing Expert with no key inlines the existing Settings key flow; no dead-end.

---

## 3. What's already there vs. to build

**Already there:**
- Per-request `provider_id` + optional BYOK `api_key` in trust generation (`trust/schemas.py`).
- `generation_meta: object | None` slot on every trust version (`trust/models.py:76`) — where the
  drafting model gets stamped.
- `TrustBadge.tsx` (renders `recorded_via` today) — extend to also show the drafting model.
- BYOK Settings + per-provider credential set (ADR-014); book-style global-default + per-book
  override pattern to copy.

**To build:**
- **Per-project trust setting** — store the chosen lane/provider (project settings field or a
  project-level default; small addition, possibly one migration).
- **Global default** seeded by edition (free → Standard/Groq).
- **The tiered picker UI** (the mock above) + BYOK-guided key entry.
- **Populate `generation_meta.{provider,model}`** on every trust generate.
- **Extend `TrustBadge`** to render "Drafted with …".
- **Wire the lane → generation request** (Standard → managed Groq; Expert → BYOK key + provider).
- **Help topic** (DoD gate) + tests.

---

## 4. Open decisions (yours to make)

| # | Decision | Recommendation |
|---|---|---|
| **F1. Setting scope** | Per-project only, or **global default + per-project override**? | **Global default + per-project override** (matches books; a user sets it once, overrides per project). |
| **F2. Labeling** | Outcome-first with model detail on expand, or model names up front? | **Outcome-first + progressive disclosure** (serves both the novice and the AI-savvy user). |
| **F3. Two-lane rule** | Confirm managed = Groq only, Claude = BYOK only (no managed Claude on free). | **Confirm.** Add a paid managed-Claude lane later, not now. |
| **F4. Free-edition default** | Standard/Groq? | **Yes.** |
| **F5. Disclosure** | Show "Drafted with <model>" on artifacts + to reviewers? | **Yes** — it's the trust-transparency win and satisfies the Groq plan's disclosure item. |

---

## 5. Prerequisites — activities you must complete before I start

### A. Dependency (must land first)
- [ ] **A1. The Groq managed-default must be implemented first** — this feature *layers on it*.
      Complete the checklist in
      [`…-groq-implementation-prerequisites.md`](./2026-08-25-groq-implementation-prerequisites.md):
      create the Groq key, decide its D1–D4, send the tester list, set the two prod env vars.
      *(In particular this feature assumes **trust Standard = managed Groq**, so the Groq D1
      "trust on Anthropic vs Groq" decision becomes "trust default = Groq Standard lane, Claude via
      BYOK" — this design supersedes that single toggle with the two-lane setting.)*

### B. Decisions I need (the §4 forks)
- [ ] **B1. F1 — setting scope** (rec: global default + per-project override).
- [ ] **B2. F2 — labeling philosophy** (rec: outcome-first + progressive disclosure).
- [ ] **B3. F3 — confirm the two-lane rule** (managed Groq / BYOK Claude; no managed Claude on free).
- [ ] **B4. F4 — confirm free-edition default = Standard/Groq.**
- [ ] **B5. F5 — confirm artifact model disclosure** ("Drafted with <model>").

### C. Copy / brand
- [ ] **C1. Approve or adjust the honest labels** — the "community model · draft-grade · you review
      before it counts" and "highest fidelity to your cited sources" wording (brand voice; this copy
      is the whole trust-gradient UX).

### D. Product / posture
- [ ] **D1. Confirm BYOK-for-trust is acceptable** — an Expert user pays their own vendor for trust
      generation (same BYOK posture as elsewhere; no new cost to us). Expected: yes.
- [ ] **D2. Confirm the disclosure posture** — surfacing which model drafted each artifact to
      reviewers is desired (transparency), no legal/brand objection. Expected: yes.

### Minimal unblock
Land **A1** (Groq managed default), then answer **B1–B5** + **C1**. That fully unblocks
implementation; everything else has a recommended default.

---

## 6. What I do once the above is set

Add the per-project trust-model setting (global default + override), the tiered picker UI with
BYOK-guided key entry, stamp `generation_meta.{provider,model}` on generate, extend `TrustBadge`
to disclose it, wire each lane to its generation path (Standard → managed Groq, Expert → BYOK),
add the Help topic + tests, verify a real generation on each lane, then ship (backend + web + APK).
Small backend addition (possibly one migration for the project setting); no new generation plumbing.

---

*Prepared 2026-08-25. Grounded in `trust/models.py` (`generation_meta`), `trust/schemas.py`
(`provider_id`/`api_key`), `TrustBadge.tsx`. Companion to the Groq default + prerequisites docs.*
