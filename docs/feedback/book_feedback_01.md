# Book feedback #01 — *Product Sense and AI*

> **Book:** *Product Sense and AI: A Practical Guide for Experienced Professionals in the AI Era*
> **Reviewer:** Sridhar Parthasarathy (J.P. Morgan — Product Portfolio Operations / Client Onboarding & Servicing)
> **Received:** 2026-06-10 (email originally sent Wed Jun 10 2026, 10:51 AM; forwarded to Siva 1:37 PM)
> **Source artifact:** `/home/sivam/Downloads/book_feedback_01.pdf` (7 pages, 2 attached images)
> **Recorded:** 2026-06-10
> **TOC the feedback refers to:** `artifacts/product-sense-and-ai-toc.json` (the 15-chapter / 7-part cut)

This document captures the feedback verbatim-in-substance and organises it for analysis.
It has two halves:

1. **The critique** — the reviewer's actual feedback on the book (general, targeting, flow, detailed).
2. **The supporting research** — a long set of extracts the reviewer pasted in to back his
   biggest single ask: *"Why AI Fails" is missing the Jagged Frontier concept.* Treat this half
   as a reading/source list to fold into the book, not as feedback line-items.

---

## 1. The critique

### 1.1 General (positive)
- Agrees with **both the premise and the thesis**; "much of content and actions are good."
- "It reads pretty well and I like the structure of each chapter."

### 1.2 Targeting — *"Who are you targeting?"* (the central question)
- **Product Managers, or 'professionals'?** The book is trying to serve both and the reviewer
  thinks that's the core tension.
- If you target **broader** ('professionals'): you'd have to **remove SDD, Requirements, and
  Product Sense** — but then "you will miss the hyper-personalised world that *Mentible* should
  be offering."
- **Recommendation:** narrow the subtitle to **"A Practical Guide for Experienced Product
  Managers."** Rationale:
  - The examples already lean PM (e.g. *FreightCo leaders failing to adopt an AI tool* is a
    **Product Sense** story).
  - **'Product Sense', 'Requirements', and 'SDD' are clearly PM concepts.**
  - A PM-specific scope is "a better target scope and would allow you to **double-down** rather
    than trying to do too much in one document."

> ⚠ **Decision needed (positioning):** PM-specific vs broad-professional. This trades against
> the *Mentible* "hyper-personalised for any professional" pitch. Not a wording tweak — it
> changes what content stays in.

### 1.3 Flow — *"Flow didn't really work for me"*
- The book **drifts from various problems → recommendations without calling them out in
  sections.** Pick one of two clean structures:
  - (a) **explicitly section** problem vs recommendation throughout, **or**
  - (b) **all problems + context up front, then all recommendations/actions at the end.**
- **Reframe the Context chain.** Currently: *Context Architect → Why AI Fails → Context
  Engineering.* Proposed: **Why AI Fails → How an experienced professional can optimise for
  that** (he flags "better language!!!") **which then contains both Context Architecture *and*
  Engineering.** (i.e. lead with the problem, then fold both context chapters under one
  "how to optimise" umbrella.)
- **Consider moving "The T-Shaped Professional" to the end of the book.**

### 1.4 Detailed line-items
- **"Practical guide" vs learning objectives.** The doc calls itself a *practical guide* — are
  **learning objectives** the right construct, or should it use a different one?
- **"Why AI Fails" only expands on 2 of the 4 root causes** it itself identifies. (Gap —
  finish the other two.)
- **"Why AI Fails" is missing the *Jagged Frontier* concept** — the reviewer's biggest content
  ask; "an important one to grasp." (See §2 — he attached a long extract set to source it.)
- **Chapters 8 and 9 are too thin for a PM audience** — they "do not really say much about
  those 4 root causes and 4 components." (Ch08 *Why Requirements Fail*, Ch09 *What Is
  Spec-Driven Development?* — the SDD pair.)

### 1.5 Critique → action checklist (for triage)

> **Status legend:** 🔵 Open · 🟡 Decided (not yet applied) · 🟢 Done · ⚪ Won't do / deferred.
> Fill the **Decision / Response** column as each item is worked. Keep the rationale terse; link
> a commit/PR/ADR where one exists.

| # | Item | Type | Chapter(s) | Effort (rough) | Status | Decision / Response |
|---|------|------|-----------|----------------|--------|---------------------|
| C1 | Decide PM-specific vs broad scope; likely re-subtitle to "…Experienced Product Managers" | Positioning | whole book | Decision + sweep | 🟡 Decided | **Option A — narrow to PMs.** Re-subtitle to "…Experienced Product Managers"; keep & deepen SDD/Requirements/Product Sense (2026-06-10, Siva). Sweep not yet applied. |
| C2 | Make problem/recommendation structure explicit (section it, or front-load problems) | Structure | whole book | Medium | 🔵 Open | _—_ |
| C3 | Reorder: *Why AI Fails → How to optimise (⊃ Context Architecture + Engineering)* | Structure | ch04–07 | Medium | 🔵 Open | _—_ |
| C4 | Consider moving *T-Shaped Professional* (ch03) to the end | Structure | ch03 | Low | 🔵 Open | _—_ |
| C5 | Revisit "learning objectives" as the construct for a *practical guide* | Pedagogy | whole book | Low–Med | 🔵 Open | _—_ |
| C6 | "Why AI Fails" — expand the missing 2 of 4 root causes | Content gap | ch05 | Medium | 🔵 Open | _—_ |
| C7 | "Why AI Fails" — add the **Jagged Frontier** concept (sources in §2) | Content gap | ch05 | Medium | 🔵 Open | _—_ |
| C8 | Thicken ch08 & ch09 for PMs (the 4 root causes + 4 components) | Content gap | ch08, ch09 | Medium–High | 🔵 Open | _—_ |

#### C1 — positioning options (pick one)

The reviewer's central tension: the book serves **both** PMs and generic "professionals," and
he thinks picking one would let it double-down. This is a positioning decision with a **Mentible
product dependency**, so it's broken out here.

- [x] **Option A — Narrow to Product Managers** *(reviewer's recommendation)* — ✅ **CHOSEN 2026-06-10 (Siva).**
  - **Subtitle:** "A Practical Guide for Experienced Product Managers."
  - **Keep & deepen:** Product Sense, Requirements, SDD (ch08–10) — they're already PM-native;
    resolves C8 (thin SDD chapters) by giving them a clear audience.
  - **Examples:** lean into PM framings (the FreightCo AI-adoption story is already a Product
    Sense case).
  - **Pro:** sharp, coherent, "double-down" depth; examples and concepts already align.
  - **Con:** smaller TAM; **conflicts with Mentible's "any experienced professional,
    hyper-personalised" pitch** — the book stops being a showcase for that breadth.

- [ ] **Option B — Stay broad (all experienced professionals)**
  - **Subtitle:** unchanged / generic-professional framing.
  - **Trade-off the reviewer named:** to be honestly broad you'd have to **cut or generalise
    SDD + Requirements + Product Sense** (they read as PM-specific) — which guts ~3 chapters and
    weakens the engineering spine.
  - **Pro:** matches Mentible's positioning; larger audience.
  - **Con:** reviewer's core complaint stands ("trying to do too much in one document");
    risks a diffuse, shallower book.

- [ ] **Option C — Broad spine + PM track (hybrid)**
  - Keep the broad framing but make SDD/Requirements/Product Sense an explicitly-labelled
    **"for product managers" track / Part**, so non-PM readers can skip it without the book
    feeling unfocused.
  - **Pro:** preserves Mentible breadth *and* the PM depth; addresses "call things out in
    sections" (overlaps C2).
  - **Con:** most structural work; risks satisfying neither audience fully; biggest re-cut.

> **Recommendation:** **Option A** if the book is meant to *sell the thesis* (sharpest, matches
> the reviewer, fixes C8 for free); **Option C** if the book must *also* demo Mentible's breadth.
> Option B only if Mentible positioning is non-negotiable and SDD content can be sacrificed.
> **Owner of this call:** Siva (product) + Sridhar (author). Resolve before re-cutting content,
> since C2/C3/C6/C7/C8 all inherit the chosen scope.

#### Decision log (chronological — newest first)
<!-- One line per decision as it's made. Format: `YYYY-MM-DD · Cn · <decision> — <who/rationale>` -->
- **2026-06-10 · C1 · Option A — narrow the book to Product Managers** (Siva). Subtitle →
  "A Practical Guide for Experienced Product Managers"; keep & deepen Product Sense /
  Requirements / SDD. Accepts the smaller TAM and the divergence from Mentible's broad
  "any professional" positioning. Downstream: C8 now has a clear audience; C2/C3/C6/C7 to be
  worked against the PM scope. Subtitle/content sweep not yet applied (status 🟡).

---

## 2. Supporting research the reviewer attached

> These are extracts the reviewer pasted to source the **Jagged Frontier** ask (C7) and the
> broader "AI fails confidently/plausibly; verification is the real constraint" theme. Useful raw
> material for ch05 (*Why AI Fails*) and possibly the verification/Product-Sense chapters.

### 2.1 The Jagged Frontier — *what it is*
- Origin: **Dell'Acqua et al. (2023) BCG study.** AI doesn't make people uniformly better/worse;
  it creates a **"jagged technological frontier"** — some tasks easy for AI, others
  deceptively-similar-but-hard.
- **Inside the frontier:** consultants saw **+12.2%** task completion, worked **25.1% faster**,
  **+40% quality.** **Outside the frontier:** **−19 percentage points** worse than those working
  without AI.
- **Key risk:** not AI failing dramatically — **AI failing *confidently and plausibly* in ways
  that are hard to detect.**

### 2.2 Current state — *still jagged, but shifting*
- General-purpose systems remain unreliable on basic facts/logic; may excel at hard tasks while
  failing simple ones.
- Immediate risk = **people over-estimating AI.** Reliability & trust are the adoption barriers;
  evaluations remain underutilised.
- **Perception gap:** quantitative users (structured tasks → "AI does well") vs qualitative
  users (hit failures more acutely) — a growing fault line.

### 2.3 Practical Quality Verification Approaches (5)
1. **Know which side of the frontier you're on** — structured/pattern-heavy = inside; nuanced
   judgement / novel context / domain expertise = likely outside.
2. **Human-in-the-loop by design** — HITL steps, confidence-based routing, output verification.
3. **Watch what experts *delegate*, not benchmarks** — real-world delegation reveals where trust
   is actually warranted; benchmark scores are a weak proxy.
4. **Treat trust as end-to-end** — reliability is model-level; *trust* is model→application→user.
   Different problems.
5. **Re-evaluate regularly** — "AI can't do X" decays; the frontier moves, so task classification
   should too.

### 2.4 Institutional Risk Management (2025–2026)
- Practices maturing but immature: threat modelling, capability evaluations, incident reporting.
  In 2025, **12 companies** published/updated Frontier AI Safety Frameworks.
- Rigorous approach has **four components:** risk **identification** (lit review + red-teaming),
  **analysis** (quantitative metrics + thresholds), **treatment** (mitigations), **governance**
  (clear org accountability).
- **2026 International AI Safety Report:** growing mismatch between AI capability speed and
  governance pace — fragmented/slow/opaque risk management no longer sufficient.

### 2.5 The Practical Upshot (personal habits)
- Be explicit with yourself: is the task **structural/pattern-driven vs judgement-heavy?**
- **Always verify** AI outputs in domains where you wouldn't accept a confident answer from a
  junior colleague unchecked.
- **Resist "AI as default"** when the cost of a confident wrong answer is high.

### 2.6 *Some Simple Economics of AGI* — arxiv 2602.20946v1 (MIT Sloan + UCLA)
- Thesis: the primary economic constraint in an AGI world is **not the cost of intelligence but
  the human capacity to *verify* it.**
- **Core concepts:**
  - **Measurability Gap (Δm):** distance between tasks AI can cost-effectively *execute* (m_A) and
    tasks humans can afford to *verify* (m_H). AI scales exponentially, human biology is fixed →
    the gap widens → structural growth bottleneck.
  - **Measurability-Biased Technical Change:** rents shift away from traditional skills toward
    **unmeasured domains** (creativity, taste, human connection) and **liability underwriting**
    (insuring/taking responsibility for machine output).
  - **"Trojan Horse" Externality:** privately rational to deploy *unverified* AI to scale → a
    **"Hollow Economy"** where nominal output looks high but real utility/safety collapse from
    accumulated "hidden debt."
- **Dynamic instabilities (two "curses"):**
  - **Missing Junior Loop:** automating entry-level roles destroys the apprenticeship pipeline →
    society stops producing the senior experts needed to verify AI later.
  - **Codifier's Curse:** senior experts who train/direct AI codify their tacit knowledge into
    data → accelerate their own replacement, hollow out their expertise.
- **Structural shifts:** **Zero-Labor-Share Economy** (labour share → ~0, wealth to owners of
  compute); **"AI Sandwich" Topology** (humans define **intent**, machines handle **execution**,
  humans provide final **underwriting/verification**).
- **Mitigations:** **Accelerated Mastery** (AI-driven synthetic practice to rebuild expertise
  faster); **Observability & Provenance** (cryptographic tools + interpretability → auditable
  signals); **Verification as a Public Good** (fund verification infra + ground-truth registries
  to prevent a race to the bottom).
- **Attached quadrant chart** (`image001.png`) — *Cost to Verify* (y) × *Cost to Automate* (x):
  | Quadrant | Name | Automate | Verify |
  |---|---|---|---|
  | Q1 | **Safe Industrial Zone** | easy | easy |
  | Q2 | **Runaway Risk Zone** / Economic Blind Spot | easy | hard |
  | Q3 | **Human Manual / Artisan Zone** | hard | easy |
  | Q4 | **Pure Tacit Zone** | hard | hard |
  - Plus a **Structural Blind Spot:** extreme high-latency tail where verify-cost ≫ budget →
    verification fundamentally infeasible regardless of budget.

### 2.7 *A Model of Artificial Jagged Intelligence (AJI)* — arxiv 2601.07573v1 (Joshua Gans, early 2026)
- Extends the AGI economics discussion by **formalising why AI performance stays "jagged" even
  as it scales.** Focuses on the **information problem**: users can't predict *when* AI will fail
  because competence is unevenly distributed across tasks.
- **Key contributions:**
  - **Inspection Paradox:** users are statistically **overexposed** to an AI's weaknesses — a
    uniform user is likelier to land in a *large* knowledge gap than a small one, so *experienced*
    average error ≫ *benchmark* average error.
  - **Scaling vs Jaggedness:** doubling an AI's knowledge **shrinks** gaps but does **not change
    the *shape*** of jaggedness — users still spend disproportionate time in the largest remaining
    gaps; "surprising" failures persist even in advanced models.
  - **Blind-Adoption Threshold:** a formal threshold (q ≥ 1/3λ) above which it's rational to adopt
    AI *blindly* (no task-level checking). If failure stakes are too high vs local reliability,
    rational users eschew the tool entirely even if it's "smart on average."
  - **Calibration as the solution:** a model signalling its own uncertainty is the critical
    complement to scale — a *calibrated* user who knows when to abstain extracts positive value
    from a model that's otherwise a net-negative "risky gamble."
- **"Bridge of Knowledge" analogy:** crossing a river on a bridge with occasional pylons
  (knowledge points); planks (interpolation) sag between pylons; short spans safe, long spans
  dangerous; an engineer sees "average span length" and calls it safe, but **the user spends 80%
  of their time on the longest, most dangerous planks** — so their experience differs
  fundamentally from the engineer's average.
- Shifted the question from *"When will AI be smart enough?"* → *"How can we make its reliability
  **visible** enough to be useful?"*

### 2.8 Mitigation — verification routes (the reviewer's three sub-questions)
**(1) Technical routes to verify AI output** (layer them, don't choose one):
- **Deterministic / rule-based** — cheapest; validate structure (JSON schema, word count,
  required fields, no prohibited strings). Surface-only; great for data extraction / form filling.
- **Traditional NLP metrics** (BLEU, ROUGE, BERTScore) — compare vs reference answers; fall short
  on nuanced/contextual responses; superseded for open-ended tasks, still useful where there's a
  clear "right answer."
- **LLM-as-a-Judge** — now dominant at scale; one model rates another's output against your
  criteria; handles pairwise comparison and direct scoring.
- **Human review** — gold standard but expensive/slow; in practice used as **calibration +
  spot-check**, not primary verification.

**(2) Can we use AI to check AI?** Yes, mainstream, with caveats:
- Core principle: **evaluation is fundamentally easier than generation.**
- LLM-as-a-Judge: **500×–5000× cheaper** than human review, **~80% agreement** with human
  preferences. Known failure modes:
  - **Position/verbosity bias** — prefer the first / longer answer regardless of quality.
  - **Self-enhancement bias** — judging same-family outputs inflates scores **5–7%.**
  - **Domain gaps** — SME agreement drops **10–15%** in specialised fields; misses subtle
    clinical/domain "red flags"; gravitates to surface prompt compliance; applies superficial
    personalisation rather than culturally-anchored, evidence-based customisation.
  - **Mitigations:** use a **different model family** as judge; require **chain-of-thought** from
    the judge (+10–15% reliability); use **structured rubrics** over open-ended scoring; combine
    automated eval at scale with targeted human review on flagged cases.

**(3) Agentic flows — verify steps or just the end?** You need **both**, weighted by risk/task
structure; checking only final output is a well-documented failure mode.
- Failures hide in the **execution trace** (tool calls that never happened, unvalidated
  intermediate outputs); a component-level failure cascades into an end-to-end one that *looks*
  fine (e.g. a polished research report built on stale/fabricated data from a silently-failed tool
  call).
- Many failures are **process failures** (bad plans, redundant tool use, infinite loops) → treat
  **trajectories as the primary unit of correctness, not just final outputs.**
- Emerging framework: **span-level** eval on high-risk intermediate steps (tool calls, retrieval,
  reasoning handoffs) + **trace-level** eval of the full flow for completion & coherence. For
  multi-agent systems the loop is iterative — each cycle needs its own verification because errors
  propagate and compound between agents.
- **Heuristic:** the more **irreversible** the action an agent takes (send email, modify DB, make
  a booking), the more you want verification **before** that action. Read-only / pure-reasoning
  steps → end-to-end verification is usually sufficient. Intermediate verification adds latency +
  token cost, so calibrate to the **stakes of each step.**

---

## 3. Notes for analysis
- The reviewer is **pro-thesis** — this is a "tighten and finish," not a "rethink." The two
  load-bearing asks are **C1 (scope/positioning)** and **C7 (Jagged Frontier in ch05)**, with the
  ch05 "2-of-4 root causes" gap (C6) and thin SDD chapters (C8) close behind.
- **C1 — RESOLVED 2026-06-10 → Option A (narrow to PMs).** Subtitle → "A Practical Guide for
  Experienced Product Managers"; keep & deepen SDD/Requirements/Product Sense. Accepted trade-off:
  smaller TAM + divergence from Mentible's "any professional" pitch. All remaining items
  (C2/C3/C6/C7/C8) are now scoped to the PM audience.
- Most of §2 is sourcing for **one chapter (ch05, *Why AI Fails*)** plus the verification theme —
  it could overwhelm the chapter. Decide how much of the AGI-economics / AJI material belongs in a
  *practical guide* vs a sidebar/appendix.
- Open question to route back to the reviewer/author: is "learning objectives" staying, or moving
  to a different pedagogical construct (C5)?
