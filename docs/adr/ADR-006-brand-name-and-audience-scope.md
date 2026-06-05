# ADR-006 — Rebrand to "Mentible"; audience stays self-learner (+ professionals)

**Status:** Accepted — 2026-05-29 *(name pending trademark/domain clearance)*
**Decision-maker:** Sivakumar Mambakkam
**Revises:** SCOPE.md **D5** and **D19** (public brand changes from "StudyBuddy Q"
to **"Mentible"**). **Reaffirms D6** (standalone, self-learner audience, **no
funnel to the school SKU**).

---

## Context

`docs/branding-and-naming-analysis.md` (PR #35) surfaced two issues: "StudyBuddy"
is a crowded name (≥5 active products) and the "Q" suffix collides with **Amazon
Q** (CLAUDE.md pitfall #6). A "what-if" discussion (2026-05-29) also weighed
re-expanding the audience to tutors/schools or serving OnDemand subscribers.

Two product calls were made:

1. **Audience stays self-learner-only.** D6 holds — standalone, **no funnel to
   the school SKU**, no merge with OnDemand. The audience description is widened
   only to make explicit that **adult professionals learning at a macro level**
   are in scope (they are adult self-learners; no compliance change). The
   school/curriculum-cascade use case remains OnDemand's, not ours.
2. **Rebrand off "StudyBuddy Q" to "Mentible."** This drops both the crowded
   "StudyBuddy" family and the Amazon-Q-adjacent "Q" suffix, and gives the
   provider-agnostic product (see ADR-005) a name not tied to "study"/"school".

---

## Decision

### D1 — New brand: "Mentible"

The public brand becomes **"Mentible"** (supersedes "StudyBuddy Q", SCOPE.md
D5/D19). The "Q = Query" rationale retires with the old name. **Tagline** is a
separate decision — lead candidate **"Author Yourself"** (double meaning: author
the material yourself / author yourself; see branding doc §4b), with *"Knowledge
in. Lessons out."* as the alternate. The tagline pairs with whichever name clears.

**Etymology (intended reading).** "Mentible" is a **coined word**, read as Latin
*mens / mentis* ("mind") + the *-ible* suffix ("capable of being") — the same
construction as *tangible*, *comprehensible*, *legible*. The intended sense is
*"of the mind / able to be grasped by the mind"*, which squares with the product
(turning knowledge into something a mind can hold) and the cover's "growing mind"
mark. This is the rationale for the name, **not a claim of a dictionary origin** —
the word is invented, which is precisely what gives it the high distinctiveness
(and trademark ownability) noted in the sweep below.

**Conditional on clearance.** "Mentible" is **not yet legally cleared.** Before it
is locked for store listings / assets, run the mandatory sweep (CLAUDE.md pitfall
#6): **USPTO TESS, Google Play, App Store**, plus **`.com`/`.ai` domain**
availability. A preliminary sweep was run 2026-05-29 (see "Trademark sweep" below):
Mentible remains the lead but carries a **"Mentable" conflict** that needs
**attorney review**; of the fallback shortlist only **SelfSyllabus** survives
(Knowmad and Curriculo are eliminated; Tutela was already excluded).

### D2 — Audience: self-learners + professionals (D6 reaffirmed)

Target audience is the **adult independent learner**, explicitly including
**professionals learning concepts at a macro level**. **Out of scope:** schools,
K-12, tutors-as-a-distinct-segment, and any OnDemand integration. D6 stands; the
OnDemand "what-if" was considered and **rejected** to avoid re-importing
multi-tenancy and FERPA/COPPA surface.

**Use-case widening — declined (2026-06-03).** Using Mentible as a general
**content-generation** engine for **marketing** (or other non-educational copy)
was raised and **declined**. It cuts against the product's opinion (scoped
educational artifacts — lesson/explanation/quiz → EPUB3/PDF), and there is no
external API/MCP surface for it by design. The reusable IP for any such future
need is the **scoped-query layer + multi-provider seam** (ADR-005), which would
be a *separate* product, not Mentible widened. **D6 reaffirmed.**

### D3 — Repo name unchanged

`StudyBuddy_SelfLearner` stays as the **internal** repo name (already
internal-only per D5). Only the **public brand** changes. A repo rename is
optional cleanup, not required by this decision.

---

## Trademark sweep — preliminary findings (2026-05-29)

A **preliminary** availability sweep (web, app stores, domains) was run on the
lead name and the fallback shortlist. **This is not legal clearance** — the
authoritative USPTO/EUIPO register searches could not be completed (those systems
block automated access) and a trademark attorney's knockout opinion is still
required before any name is locked.

| Name | Verdict | Distinctiveness | Availability | Key risk found |
|---|---|---|---|---|
| **Mentible** | 🟡 Amber | High (coined word) | `.com` registered/dormant (expired cert); `.ai` no active site | **"Mentable"** — a mental-health **app** (Cluj-Napoca; class-9 software) **and** a US provider **Mentable Wellness PLLC** (Charlotte, NC). One letter off, phonetically identical. Different primary industry (learning vs mental health) helps, but needs **attorney review**. |
| **SelfSyllabus** | 🟡 Amber | Low–medium (descriptive) | **Best — exact name unused; domain likely open** | Crowded "Syllabus" namespace (Simple Syllabus, Syllabus AI, etc.) — no direct hit, but a **weak/descriptive mark**. |
| **Curriculo** | 🔴 Red — eliminated | Low (real word) | `.ai`/`.me` taken | Means **"résumé/CV"** in ES/PT (we support `es`); active CV-AI products (Curriculo AI, Curriculo ATS, a Google Play résumé builder). |
| **Knowmad** | 🔴 Red — eliminated | Low (descriptive coinage) | `.com`/`.app`/`.online` taken | Saturated across software/edu/AI (Knowmad Mood, Knowmad Digital Marketing, a Knowmad learning app, Knowmad Inc). Descriptive ("knowledge nomad" = our user). |

**Outcome:** finalist set narrows to **Mentible** (distinctive but contested) vs
**SelfSyllabus** (available but descriptive). Knowmad and Curriculo are dropped.
The Mentible vs Mentable likelihood-of-confusion question is the gating item for
the attorney.

---

## Follow-up (required before the brand is "locked")

1. **Attorney knockout search** on the finalist — resolve the **Mentible vs
   Mentable** conflict (classes 9 / 41 / 42) via USPTO TESS + EUIPO (the Mentable
   app is EU-based) + a trademark attorney's opinion. Confirm `mentible.com` /
   `.ai` status at a registrar.
2. **Ratify into canonical docs** — once cleared, update CLAUDE.md and SCOPE.md
   (D5/D19) to read the final name, and sweep "StudyBuddy Q" references repo-wide.
3. **Two-app naming (ADR-004)** — decide whether the free reader shares the
   brand, takes a sub-brand, or stands alone.

---

## Consequences

**Positive:** escapes the crowded "StudyBuddy" SEO/trademark space and the Amazon
Q risk; a vendor-neutral name fits the provider-agnostic direction (ADR-005); the
audience decision is now explicit (and the OnDemand temptation is closed).

**Negative:** rebrand cost — store listings, assets, references, and eventually
the repo. The name is **not yet cleared**, so it is provisional until the sweep
passes. Loses the "Q = Query" story that tied the brand to the scoped-query IP
(the IP itself is unchanged).

---

## References

- `docs/branding-and-naming-analysis.md` — the analysis behind this (PR #35;
  updated to name Mentible as chosen).
- CLAUDE.md — pitfall #6 (trademark sweep; Amazon Q); "Q = Query" rationale (retires).
- ADR-005 — concurrent decision (multi-provider + hybrid keys); reinforces a
  vendor-neutral name.
- SCOPE.md §5 — **D5/D19** changed (brand); **D6** reaffirmed (audience/standalone).
