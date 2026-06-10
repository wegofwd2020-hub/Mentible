# Analysis — book feedback #01 (*Product Sense and AI*)

> Companion to [`book_feedback_01.md`](./book_feedback_01.md) (the raw feedback + C1–C8 triage)
> and the two mindmaps ([as-is](./product-sense-ai-mindmap.png) ·
> [proposed](./product-sense-ai-mindmap-proposed.png)).
> Grounded against the actual v2 artifact (`artifacts/product-sense-and-ai-v2.book.json`), not
> just the TOC. Recorded 2026-06-10.

---

## 0. Headline

The reviewer is right about the **shape** of the book and partly **out of date** about its
**content**. The structural critique (ordering, scope, T-Shaped placement) is sound and the
proposed mindmap is close to right. But two of the three "content gap" items (C6, C8) **do not
fully match the v2 artifact on disk** — which means the first action isn't editing, it's
**reconciling which draft was reviewed.**

---

## 1. What grounding revealed (the non-obvious part)

I measured every chapter and read the disputed ones. Three findings change how to act:

### 1a. No chapter is "thin" by length — they're suspiciously uniform
Every chapter is **~1,400–1,770 words** (ch08 = 1,519; ch09 = 1,473 — both dead average).
So C8's "very thin" is **not** about length. It's about **depth-for-role**: under the C1 PM
scope, SDD/Requirements becomes the *core* of the book, yet it gets the same flat allotment as
every other chapter. The uniformity itself is a smell — a generated book where importance isn't
reflected in depth. **"Thin" = under-developed-for-its-new-importance, not short.**

### 1b. C6 doesn't match v2 — ch05 already expands all five failure modes
Ch05 ("Why AI Fails") explicitly says *"Here are the five named modes"* and covers all of them
(hallucination + missing information / constraints / business context / organizational memory),
**with a summary table**. The reviewer said it *"only expands on 2 of the 4 root causes."* That
maps to v2 only if you read it as a **depth-imbalance**: hallucination gets a full, vivid
paragraph; the other four are compressed to **one sentence each** + a table row. So:
- The **count is off** (book says 5 modes; reviewer registered 4) → the framing isn't landing.
- The **substance is fair** → the four "missing-X" gaps are named, not *developed* (no worked
  example each, unlike hallucination).
- **Or** the reviewer read an **earlier draft** where only 2 were expanded. Worth confirming.

### 1c. C7 is fully confirmed — Jagged Frontier is genuinely absent
`"jagged"` = **0** occurrences in ch05; `"frontier"` appears once and only as *"Frontier
models"* (i.e. cutting-edge models, not the concept). The Dell'Acqua/BCG Jagged Frontier idea
is **not in the book**. C7 stands unambiguously.

### 1d. C8 is half-confirmed — ch08 has its framework, ch09 doesn't
- **ch08** ("Why Requirements Fail") *does* develop its four causes (ambiguity / interpretation
  gaps / tribal knowledge / misaligned expectations each recur 3–4×). It's more developed than
  the reviewer implies.
- **ch09** ("What is SDD") has **zero** mentions of "component" — the *"4 components"* the
  reviewer expects is **absent**. ch09 is prose-narrative with no structuring framework.

> **⚠ Draft-reconciliation flag.** C6 (5 modes present, not 2-of-4) and C8 (ch08's 4 causes
> present) don't match the v2 file. Either the reviewer read a **pre-v2 draft**, or these are
> *depth/balance* critiques worded as *absence*. **Confirm which artifact Sridhar reviewed before
> spending effort** — otherwise you may "fix" things that are already fixed.

---

## 2. What the two mindmaps expose (structural)

Putting current and proposed side by side surfaces two smells beyond the reviewer's list:

### 2a. Ordering defect: solution before problem (validates C3 strongly)
Current reading order hits the **role** ("Context Architect", ch04) and even the **identity**
("T-Shaped", ch03) *before* the **problem** ("Why AI Fails", ch05) that motivates them. You meet
the cure before the disease. The reviewer's C3 instinct — *Why AI Fails → then how to optimise* —
fixes a genuine pedagogical inversion, not just a preference. **Strong agree.**

### 2b. Duplicate concept: "Context Architect" appears twice
- ch04 "From Expert to **Context Architect**" (Part II)
- ch11 "Product Managers as **Context Architects**" (Part V)

C3's merge folds ch04 into the new "how to optimise" chapter — good — but that chapter and ch11
now **overlap**. They can coexist only if sharply differentiated: the new Part 2 chapter =
*context as an engineering technique for AI reliability*; ch11 = *context architecture as the
PM's evolving role/identity*. If you can't articulate that line in a sentence, **merge them.**

### 2c. The unifying defect: "named, not developed"
ch05's four gaps and ch09's missing framework are the same failure — a chapter **lists** a
structure rather than **developing** each element with an example. It bites hardest in exactly
the chapters that become **core under C1 (PM scope)**. This is the single most useful frame for
the content pass: *find every "named list" in a now-core chapter and give each item a worked,
PM-flavoured example.*

---

## 3. Item-by-item verdict

| # | Item | Verdict | Why (grounded) | Impact | Effort |
|---|------|---------|----------------|--------|--------|
| **C1** | Narrow to PMs | ✅ **Agree (decided) — but it's a *reversal* of the original design, not a clarification** | **As-designed audience (from the artifact, not inferred): "experienced professionals (45–65)" — broad, generic-professional = Option B.** That exact string is stamped into the `enhancementInstructions` of **all 15 chapters**; `level=professional`; metadata/subtitle both say "experienced professionals". Yet the *material* drifted PM-ward (glossary makes the PM the central role; L3 owned by "PMs"; PRD/SDD/Requirements/Product Sense are PM craft) — which is the incoherence the reviewer caught. Audience = **two axes**: career-stage (*experienced/45–65* — keep) × role (*generic → PM* — the change). So Option A re-points the role axis the original design never narrowed. Ripples into ch01–04 framing **and the 15 `Audience:` directives**, not just the subtitle. | High | Med–High (re-point 15 `Audience:` directives + reframe ch01–04; contradicts the baked-in instruction) |
| **C2** | Problem/recommendation sectioning | ✅ **Agree — option (a)** | Tag-in-place preserves the strong thematic problem→solution pairing. **Reject option (b)** (front-load all problems) — it would split SDD's "why requirements fail" from "what is SDD" across the book. | Med | Low–Med |
| **C3** | Reorder *Why AI Fails → optimise* | ✅ **Strong agree** | Fixes the solution-before-problem defect (§2a) + dissolves the ch04 duplication. | High | Med |
| **C4** | Move T-Shaped to end | ✅ **Agree, with a caveat** | Problem→method→identity reads better for a *practical* guide. Caveat: front-loading an aspirational chapter is a valid *motivational* choice — this is a deliberate genre call, not a bug-fix. | Med | Low |
| **C5** | "Learning objectives" construct | 🟡 **Agree, minor** | A formal academic frame clashes with the "executive-friendly, conversational" voice. Prefer lightweight "What you'll be able to do" / keep the existing "Key Takeaways". | Low | Low |
| **C6** | *Why AI Fails*: expand missing causes | 🟠 **Refine** | v2 already has all 5 modes + table; the real issue is **depth imbalance** (1 rich, 4 one-liners) and a **count that doesn't land** (5 vs "4"). Action: give each gap a worked example; make the count consistent. **Verify draft first.** | Med | Med |
| **C7** | Add Jagged Frontier | ✅ **Agree (confirmed absent)** | Genuinely missing. But **scope risk**: the §2 research pack (Simple Economics of AGI, AJI, verification routes) is huge — folding it all into ch05 overloads it. Recommend **core concept in-chapter; deep economics as a sidebar/appendix.** | Med | Med |
| **C8** | Thicken ch08/ch09 | 🟠 **Refine** | Not length-thin (both ~1,500 w). ch08's 4 causes are present; **ch09 lacks any framework** (the "4 components" = 0). Action: give ch09 a structuring model and deepen both *because they're now core*, not because they're short. **Verify draft first.** | High | High |

Legend: ✅ agree · 🟡 agree-minor · 🟠 agree-but-reframed.

---

## 4. Recommended sequence (three waves)

The items have dependencies — don't work them in C-number order.

**Wave 0 — Reconcile (½ day, blocking).**
Confirm which draft Sridhar reviewed. Resolve the C6/C8 mismatches. Output: a corrected,
de-duplicated gap list. *Without this you risk fixing already-fixed content.*

**Wave 1 — Ratify the TOC re-cut (C1 + C3 + C4).**
The [proposed mindmap](./product-sense-ai-mindmap-proposed.png) is the candidate. Settle: the
Part-2 chapter boundaries, the ch04/ch11 differentiation (§2b), and the PM reframing scope for
ch01–04. Lock the new 6-part/13-chapter TOC before touching prose.

**Wave 2 — Content-depth pass (C6 + C7 + C8), scoped to the new TOC.**
Apply the "named-not-developed" frame (§2c): worked PM examples for ch05's gaps, Jagged Frontier
(core in-chapter, economics in a sidebar), a framework + depth for the SDD pair. Do this *after*
Wave 1 so you don't deepen a chapter that's about to move or merge.

**Wave 3 — Treatment pass (C2 + C5).**
Tag Problem/Recommendation in place; swap formal "learning objectives" for voice-aligned framing.
Cheap, do last.

---

## 5. Open decisions to resolve before Wave 1

1. **Draft provenance** — which artifact did the reviewer read? (gates Wave 0)
2. **ch04 vs ch11** — differentiate (technique vs role) or merge? (§2b)
3. **C7 scope** — how much of the AGI-economics/AJI pack lands in ch05 vs an appendix? (scope-creep risk)
4. **C4 genre call** — practical (problem→method→identity, T-Shaped last) vs motivational
   (identity first)? My rec: practical, given the subtitle is literally "A Practical Guide."
5. **PM-reframe depth** — does C1 only re-skin examples in ch01–04, or rewrite them? (effort driver)

---

## 6. One-line take

*Accept the structure (C1/C3/C4 → the proposed mindmap), reframe the content gaps (C6/C8 are
depth/consistency issues, not absences — and may target a stale draft), confirm C7 is the one
clean net-new addition, and reconcile the draft before writing a word.*
