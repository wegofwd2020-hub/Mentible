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

The public brand becomes **"Mentible"** (working tagline: *"Knowledge in. Lessons
out."*). This supersedes "StudyBuddy Q" (SCOPE.md D5/D19). The "Q = Query"
rationale retires with the old name.

**Conditional on clearance.** "Mentible" is **not yet legally cleared.** Before it
is locked for store listings / assets, run the mandatory sweep (CLAUDE.md pitfall
#6): **USPTO TESS, Google Play, App Store**, plus **`.com`/`.ai` domain**
availability. If it fails, fall back to the ADR-006 shortlist (Knowmad, Curriculo,
SelfSyllabus; **not** Tutela — existing trademark) and re-clear.

### D2 — Audience: self-learners + professionals (D6 reaffirmed)

Target audience is the **adult independent learner**, explicitly including
**professionals learning concepts at a macro level**. **Out of scope:** schools,
K-12, tutors-as-a-distinct-segment, and any OnDemand integration. D6 stands; the
OnDemand "what-if" was considered and **rejected** to avoid re-importing
multi-tenancy and FERPA/COPPA surface.

### D3 — Repo name unchanged

`StudyBuddy_SelfLearner` stays as the **internal** repo name (already
internal-only per D5). Only the **public brand** changes. A repo rename is
optional cleanup, not required by this decision.

---

## Follow-up (required before the brand is "locked")

1. **Trademark + domain sweep** for "Mentible" (TESS / Play / App Store / domains).
2. **Ratify into canonical docs** — once cleared, update CLAUDE.md and SCOPE.md
   (D5/D19) to read "Mentible," and sweep "StudyBuddy Q" references across the repo.
3. **Two-app naming (ADR-004)** — decide whether the free reader shares the
   "Mentible" brand, takes a sub-brand, or stands alone.

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
