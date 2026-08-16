# YouBooks — reframe (signal, not the battle)

**Added:** 2026-08-16 · reconciling `COMPETITIVE_PRODUCTS_ANALYSIS.md` + `FEATURE_ROADMAP.md`
against [ADR-037](../adr/ADR-037-reposition-to-expert-validation-studio.md).

## What YouBooks is
A **live** AI book-generation platform (2024–): multi-model LLM, web research + source
upload, EPUB/PDF/DOCX/Markdown export, **pay-per-book** ($7–$9.40, lifetime deals ~$35–$59).
`COMPETITIVE_PRODUCTS_ANALYSIS.md` rates it 🔴 the #1 threat and proposes a 6-month
"beat YouBooks" sprint (managed billing this week; KDP integration in 8 weeks = "the moat";
market structured authoring + Trust Manifest; collaboration by Month 4; Reedsy by Month 5).

## The reframe
**YouBooks is a direct competitor only if Mentible fights as a *book generator*. Under ADR-037
it isn't.**

- YouBooks ships **unvalidated AI books**. Mentible produces **expert-validated, traceable
  knowledge** — projects → grounded draft → **invited expert reviewer** → approve → **append-only
  approval record (`recorded_via`)**. Different product, different buyer (**SMEs**, not indie
  authors churning volume).
- The competitive doc's own line — *"YouBooks generates books. Mentible publishes them"* —
  undersells it. The real moat is: **"YouBooks generates AI books; Mentible produces knowledge
  an expert stood behind."**
- **YouBooks is a SIGNAL, not the battle:** it proves the AI-authoring market is real and
  fundable. Use it as market proof + a messaging foil ("validated, not just generated"), not as
  a feature checklist to chase.

## The caution
Both competitive packs keep pulling toward the strategy **ADR-037 deliberately declined** —
indie-author volume, a services **marketplace**, a Reedsy partnership, racing on generation
features. **Don't let YouBooks urgency drag the roadmap back to the rejected ghostwriting
strategy.** (The roadmap's own 5 writer-network items are marked **N/A** — stay consistent with
that.)

## The convergence (this is the useful part)
Across *all* the strategy docs — the earlier pack, this competitive doc, and the roadmap — the
top moves are the **same**, and they match [`PRIORITIZED_SHORTLIST.md`](PRIORITIZED_SHORTLIST.md):

| Docs' "urgent" | Shortlist |
|---|---|
| Activate managed billing ("this week") | **P0-1** |
| Publishing / export (KDP = "the moat") | **P0-3 / P2** |
| Market the Trust Manifest / provenance | **P1-4** (make trust visible) |
| Finish collaboration | **P0-2** (review-loop teeth) |

Independent docs converging on the same three moves **reinforces** the plan. Heed the *urgency*
on those exact moves; ignore the pull toward generation-parity and a marketplace.

## Reality-check on the roadmap's "26 built"
A decent Aug-2026 baseline, but **stale + mis-framed**: it buries the ADR-037 **trust/validation
review loop** (the product spine) as "Revision Request (Basic)" + "Collaborative Draft Sharing
(partial)", predates the recent ships (4 themes, work-with-me funnel, native whole-book render,
nav changes), and overstates "Managed Billing & RevenueCat built" (vault/metering exist; the
**payment rail is not wired** — that's the P0-1 gap). Its Phase 4–5 financials ($1–5M ARR via
marketplace/coaching) are speculative and partly off-ADR-037 — treat as scenarios, not commitments.
