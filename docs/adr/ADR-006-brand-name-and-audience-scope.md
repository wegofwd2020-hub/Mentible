# ADR-006 — Brand name & audience scope (keep "StudyBuddy Q" + self-learner-only, or revisit?)

**Status:** Proposed — **STUB, decision not yet made**
**Date:** 2026-05-29
**Would revise (only if the decision changes the status quo):** SCOPE.md **D5**
and **D19** (public brand = "StudyBuddy Q"), and **D6** (standalone, self-learner
audience, no funnel to the school SKU).
**Touches:** CLAUDE.md pitfall #6 (trademark check — USPTO TESS, Google Play, App
Store; **Amazon Q** collision; "never collapse to bare 'Q' in marketing"). ADR-004
(two-product split — naming must now cover *two* apps, authoring + reader).

---

## Context

`docs/branding-and-naming-analysis.md` (merged 2026-05-29, PR #35) raises two
real questions, but does so from a product definition that **differs from this
repo's locked decisions**. The doc was subsequently revised to align with the
locked scope; this ADR captures the underlying decisions it surfaced so they get
made deliberately rather than implied by a draft.

Two genuine findings in that doc are worth acting on:

1. **"StudyBuddy" is crowded.** At least five active products use the name
   (a Schoology grades app, a study-partner matcher, an AI school platform, a
   K-12 LMS, a campus tutoring app). SEO, app-store discoverability, and
   trademark would all be uphill. This **independently corroborates CLAUDE.md
   pitfall #6**, which already mandates a trademark sweep before alpha.
2. **The "input → output" tagline shape is strong** ("Knowledge in. Lessons
   out.") and is brand-direction-agnostic — usable regardless of the name.

But the doc also pushed in directions that **contradict locked decisions**:

- It framed the product as serving **three audiences (schools, self-learners,
  tutors)** with schools front-and-center. This repo is locked to
  **self-learners only** (D6; CLAUDE.md "Not a course platform… No school
  anything"). The school/curriculum-cascade flow it described is the
  **OnDemand** product, not Q.
- It recommended **dropping "StudyBuddy"** for new names (Curriculo / Mentible /
  Tutela). The public brand is **locked to "StudyBuddy Q"** (D5/D19).
- It read **"Q" as quiz/questions**. The locked meaning is **Q = Query** — the
  six-dimension scoped-query model that is the engineering IP.
- It did **not** address the specific **Amazon Q** trademark risk that CLAUDE.md
  pitfall #6 calls out.

This ADR exists to force the actual decisions rather than let a merged draft
imply them.

---

## The questions

1. **Brand name.** Keep the locked **"StudyBuddy Q"**, or revisit it given the
   "StudyBuddy" crowding *and* the Amazon Q collision risk on the "Q" suffix?
2. **Audience scope.** Stay **self-learner-only** (D6), or re-expand to tutors
   and/or schools — which would reverse the core scoping decision and re-import
   the OnDemand concerns (multi-tenancy, FERPA/COPPA) Q was built to avoid?

The two are linked: a broader audience would argue for a broader, non-"Study"
name; staying self-learner-only argues for keeping the focused locked brand.

---

## Options (to be evaluated)

1. **Status quo — keep "StudyBuddy Q", self-learner-only.** Lowest churn;
   preserves D5/D6/D19 and the "purpose-built for self-learners" positioning.
   Still requires the pitfall-#6 trademark sweep (StudyBuddy crowding + Amazon Q)
   before alpha; may need a marketing rule to never render the brand as bare "Q".

2. **Keep "StudyBuddy Q" branding, but clear/qualify the "Q".** Same audience and
   wordmark, but resolve the Amazon Q risk explicitly (e.g. always "StudyBuddy Q",
   never standalone "Q"; defensive usage guidelines). Decision is mostly legal +
   style-guide, not product.

3. **Rebrand.** Adopt a new name (the doc's candidates, or others) because the
   "StudyBuddy" family is too crowded to win discoverability/trademark. Reverses
   D5/D19; requires repo/store/asset rework; only worth it if the crowding is
   judged fatal.

4. **Re-expand audience (separate decision, can combine with any of the above).**
   Add tutors and/or schools. Reverses D6 and re-imports OnDemand compliance and
   multi-tenancy concerns — large blast radius; likely its own ADR if pursued.

---

## Decision

**TBD.** No decision has been made. This stub captures the questions and the
locked decisions at stake; fill in the chosen options, rationale, and
consequences before any rename, store listing, or audience-scope change.

---

## Open questions

- **Trademark clearance for "StudyBuddy Q"** — run the pitfall-#6 sweep (USPTO
  TESS, Google Play, App Store) for "StudyBuddy Q" specifically, plus an
  Amazon Q conflict assessment, *before* committing either way.
- **Bare-"Q" policy** — is "StudyBuddy Q" always rendered in full? Codify it.
- **Two-app naming (ADR-004)** — does the free reader share the brand, get a
  sub-brand, or stand alone? The branding doc predates the split and doesn't
  cover the reader.
- **If rebranding** — does the repo name (`StudyBuddy_SelfLearner`, already
  internal-only) change too, and what is the migration cost across stores/assets?
- **Disposition of candidate names** — Tutela in particular is an existing
  trademark (network analytics); any shortlist needs real domain/TESS checks.

---

## References

- `docs/branding-and-naming-analysis.md` — the analysis this ADR adjudicates
  (PR #35; revised to align with locked scope).
- CLAUDE.md — pitfall #6 (trademark sweep, Amazon Q, never bare "Q"); brand
  rationale "Q = Query".
- SCOPE.md §5 — **D5** (repo + brand), **D6** (standalone self-learner audience),
  **D19** (brand "StudyBuddy Q").
- ADR-004 — two-product split; naming now spans authoring + reader.
