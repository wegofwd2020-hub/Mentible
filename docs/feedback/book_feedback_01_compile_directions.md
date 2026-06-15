# Could compile-time directions have prevented feedback #01?

> Follow-on to [`book_feedback_01_analysis.md`](./book_feedback_01_analysis.md). Maps each
> challenge (C1–C8) to what the authoring pipeline actually takes as input — the scope params,
> the per-chapter `enhancementInstructions`, and the TOC structure — and asks: how much of this
> feedback was a *generation-direction* gap rather than a model gap? Recorded 2026-06-10.

---

## TL;DR

**5 of 8 challenges were fully preventable with richer compile-time directions; 3 more were
partially preventable.** Every item is at least partially addressable — nothing here needs
something the pipeline fundamentally can't express. The 3 structural ones (C2/C3/C4) carry an
irreducible *"decide first, then encode"*: a direction can carry an editorial decision but can't
make it.

> The deeper signal: the directions weren't *absent*, they were **under-specified and uniform**
> — one generic audience line ×15, flat depth, a chapter skeleton, **empty `prerequisites`**.
> The feedback is, almost line-for-line, a list of **scope dimensions left blank or set broad.**
> This is a *generation-direction schema* problem, not a model problem — quality was left on the
> table at the scoping layer, which is exactly the product's IP.

---

## Which challenges, and why

| # | Challenge | Addressable? | The direction that would have prevented it |
|---|-----------|--------------|--------------------------------------------|
| **C1** | Audience (PM vs broad) | ✅ **Fully** | The pipeline *had* an audience field — set generic (`"experienced professionals (45–65)"`, repeated 15×). A **precise role persona** would have anchored every example PM-ward. The drift *is* an under-specified audience dimension. |
| **C5** | "Learning objectives" construct | ✅ **Fully** | A **pedagogical-frame directive**. The `enhancementInstructions` already dictate Concept→Visual→Example→Key Takeaways — just the wrong opener. |
| **C6** | *Why AI Fails*: 4 gaps as one-liners | ✅ **Fully** | An **"expand each enumerated item with a worked example"** policy + per-chapter depth. The "named-not-developed" pattern is exactly what this prevents. |
| **C7** | Missing Jagged Frontier | ✅ **Fully** | A per-chapter **`requiredConcepts` / `keySources`** list ("must engage Jagged Frontier — Dell'Acqua 2023"). *Caveat: the author must know to require it.* |
| **C8** | SDD chapters thin / no framework | ✅ **Fully** | **Non-uniform depth weighting** (break the `pages/15` flat split) + a **required framework** ("structure ch09 around its N components"). |
| **C2** | Problem/recommendation flow | 🟡 **Partial** | A per-chapter **`chapterRole: problem\|recommendation\|context`** tag gives the scaffold — but *section-in-place vs front-load-all-problems* is a decision the author must make first. |
| **C3** | Reorder (problem before solution) | 🟡 **Partial** | Directable via a **sequencing principle** or by populating **`prerequisites`** (exists but empty) so "Context Architect requires Why AI Fails" forces order. The *merges* (fold ch04/06/07) are editorial. |
| **C4** | Move T-Shaped to end | 🟡 **Partial** | A **placement/ordering directive** ("aspirational chapters last") — but it's a genre call (practical vs motivational). |

**Tally:** Fully → C1, C5, C6, C7, C8 (5). Partial → C2, C3, C4 (3).

---

## The data that would close the gap

Two layers — **additions to existing structures**, not greenfield. Today's inputs:
`generationParams` = `{level, depth, pages, language, format}`; each TOC unit =
`{title, subtopics, prerequisites, enhancementInstructions}`.

### Book-level (extend `generationParams`)
| Field | Shape | Fixes |
|---|---|---|
| `audiencePersona` | `{ role, careerStage, domain?, priorKnowledge, caresAbout }` — replaces the vague age band | **C1** |
| `narrativeArc` | e.g. *"problem → method → application; introduce a problem before its solution; aspirational chapters last"* | **C2, C3, C4** (ordering) |
| `pedagogicalFrame` | e.g. *"practical guide; no formal learning objectives; open with a scenario; end with Key Takeaways + an action"* | **C5** |
| `depthBudget` | non-uniform weighting (e.g. SDD part ×1.5) instead of `pages/15` | **C6, C8** |

### Per-chapter (extend each TOC unit)
| Field | Shape | Fixes |
|---|---|---|
| `chapterRole` | `problem \| recommendation \| context` | **C2** |
| `requiredConcepts` / `keySources` | `[ { concept, source? } ]` — named concepts + citations the chapter must engage | **C7** |
| `framework` | `{ name, components: [...] }` — a named structure the chapter must build around | **C6, C8** |
| `enumeratePolicy` | `"develop-each"` — every listed item gets an example + consequence, not a one-liner | **C6** |
| `targetWords` / `depthWeight` | per-chapter override of the flat budget | **C8** |
| `prerequisites` | **already in the schema** — just populate it to drive ordering | **C3, C4** |

### The useful split
- **Author-supplied domain intent** (high-value scope IP the product should *force out of the
  author*): `audiencePersona`, `requiredConcepts`/`keySources`, `framework`, relative importance
  (`depthBudget`/`depthWeight`), `prerequisites`. *The pipeline can't invent "include the Jagged
  Frontier" — that's domain knowledge the author must supply.*
- **Reusable pipeline policy** (ships as smart defaults): `enumeratePolicy: develop-each`,
  problem-before-solution ordering, `pedagogicalFrame`, `chapterRole` scaffolding.

---

## What directions still can't do
- **Make the decisions** — narrow to PMs? front-load or tag (C2)? merge ch04/ch11? A direction
  *encodes* a choice; it doesn't *choose*.
- **Replace verification** — C6's internal inconsistency ("5 modes" vs the reviewer's "4") and
  factual correctness still need a review pass. A directive reduces but doesn't remove it.

---

## One-line take
*~5/8 was a richer-prompt problem, ~3/8 a decide-then-encode problem, and 0/8 needed something
the pipeline fundamentally can't express — strong evidence that this book's quality was lost at
the generation-direction schema, not the model.*
