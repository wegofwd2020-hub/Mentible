# Mentible — Prioritized Feature Shortlist (vs. what's built)

**Generated:** 2026-08-16 09:22 EDT · **against** `main a89d564`
**Basis:** reconciles the competitive-analysis pack in this folder against the *actual*
codebase state, plus a repo-wide sweep of proposed ADRs / proposals / unbuilt specs.

Legend: ✅ built · 🟡 partial (infra or spine exists, gaps remain) · ⬜ not built.

---

## TL;DR reframe

The competitive pack's "current-built baseline" is **stale (v0.2.0 / 2026-07-20)** — it predates
the ADR-037 trust workspace and everything shipped since. Two consequences:

1. **"Collaboration & Review" (their Feature 3) is already the product spine**, not a Phase-3
   build: invite expert reviewer → redeem → scoped project · feedback · approve → **append-only
   approval record (`recorded_via`)** · refine loop · immutable artifact versions. ~70% shipped.
   Don't build it — **finish** it.
2. Their whole plan optimizes for *competing with Ghostwriting Squad*. Mentible's actual edge
   (ADR-037) is **traceable, expert-validated knowledge**. The ranking below prioritizes
   **finishing the validation loop + turning on revenue + making trust visible** over the
   marketplace/writer-network features the docs themselves later archived as the "incorrect"
   strategy.

---

## A. Prioritized shortlist (from the competitive pack)

| # | Feature | Built state | Effort | Why now |
|---|---|---|---|---|
| ~~P0-1~~ | **Managed billing / self-serve payment rail** — **DEFERRED** ([ADR-039](../adr/ADR-039-monetization-sequencing-services-vs-self-serve-billing.md), Accepted 2026-08-16) | 🟡 entitlements/metering/plans built; paywall dormant — rail not built (**intentionally deferred**) | — | **Services-led instead:** revenue via the built work-with-me funnel + manual invoicing; grant managed access via the admin entitlement API. Build the self-serve rail only once demand is proven + model/platform chosen. |
| **P0-2** | **Finish the review loop** (F3 Tier-2): inline comments on a draft section · before/after **version diff** · reviewer-vs-editor roles | ✅ spine built (trust) · 🟡 these teeth missing | **M** | Completes the validation moat — the thing that *is* the product. |
| **P0-3** | **Export the validated master → PDF / Word (Pro)** (F5 first slice) | 🟡 EPUB3/PDF compiler + KDP coverRaster exist; trust-draft not wired; publish = copy text/MD only; docx new | **M** | Completes "idea → shippable, traceable asset" + a clean Pro hook. |
| **P1-4** | **Quality gates beyond format** (F4 automated): a **citations/grounding report** ("every claim traces to a source") + readability score (+ optional plagiarism) | 🟡 grounded gen ("use ONLY sources") + content-trust provenance built; no *report/score* surfaced | **M** | Makes "trust is the product" **visible** — a differentiator no ghostwriting tool has. |
| **P1-5** | **Derivatives / the Share phase** (F6-adjacent, PR #338 proposal) | ⬜ proposal only | **L** (start image/text) | ADR-037 D8 ("Share = derivatives now"); reuses compiler + coverRaster. |
| **P2-6** | **Retailer distribution APIs** (F5 full): KDP/Apple/IngramSpark via Draft2Digital · ISBN · royalty dashboard | 🟡 compiler only (~20%); no retailer wiring | **L + external deps** | Real gap, but heavy + third-party. Sequence *after* P0-3 proves demand. |

**Rejected / deferred (off the ADR-037 strategy):** Writer network / ghostwriter marketplace
(*the docs themselves archived this as the "incorrect" strategy*), full freelancer services
marketplace (F6), audiobook, translation, white-label licensing, reader ratings/reviews as a
growth bet, full analytics data-moat.

---

## B. Other pending features found across the repo (2026-08-16 sweep)

Deduped against Section A. Grouped by source; **near-built quick wins** called out first.

### B0. Near-built / quick wins — fold into the P0–P1 wave

- **Whole-book draft render preview** — ✅ **web shipped** (renders diagrams/Markdown via
  `TopicRenderer inline`; the earlier "not implemented" note was a misread of the native-fallback
  branch). The **native (Android) WebView** preview was the spec's deferred follow-up and is now
  **implemented** (auto-height WebView so the draft flows inside the page ScrollView).
  `docs/superpowers/specs/2026-08-10-wholebook-draft-render-preview-design.md` · **Done.**
- **Feature-scoped entitlements ("BYOK graduation" — feature axis)** — most machinery already
  built (`backend/src/billing/{plans,entitlement_repo,access,eligibility}.py`, admin
  `PUT /entitlement`, used for tester full-access #432/#433). Only the **capability axis** (gate
  *features* like EPUB/PDF export, not just spend/provider) is missing.
  `docs/adr/ADR-031-operator-granted-managed-access.md` · Proposed · **Effort: S** ·
  *Pairs naturally with P0-1 (billing) and P0-3 (Pro-gated export).*
- **Whole-book draft depth/shape decision** — whole-book gen is architecturally shallow (one
  call, 3–6 sections) vs per-topic (≤20 sections/topic); **parked pending an owner decision**,
  not a bug. `docs/backlog/2026-08-12-whole-book-draft-depth.md` · **Decision, not build.**

### B1. Proposed ADRs (backlog)

- **Library-grounded references (device-local citations)** — topic → citations pulled from the
  user's personal/downloaded shelf. `ADR-029` · Proposed (design-only). *Feeds P1-4's grounding story.*
- **Content currency agent** — watches sources so editions stay current; author-side BYOK +
  scheduled form. `ADR-030` · Proposed.
- **Vision-assisted figure captions** — send an attached figure to a vision model for captions
  (`LLMRequest` image parts, `Capabilities.vision`). `ADR-036` · Proposed. *a11y prereq done (#324).*
- **Hosted media sync (E2E-encrypted figures)** — attached images follow the user across devices
  via envelope encryption. `ADR-035` · Proposed.
- **Per-user private hosted library (paid: server FTS + managed-key embeddings)** — hosted,
  searchable personal corpus. `ADR-033` · **Accepted but gated on the managed-billing launch** →
  unblocks after P0-1.
- **Everyone Library (user-published books) + content moderation** — public "publish to all"
  shelf + super-admin archive/flag/complaint queue. `ADR-021` · Proposed. (The narrower
  Open-Library publish/reader-download slice it gates **is built** — see §C.)
- **Reader engagement: downloads · ratings (1–5★) · feedback** on published books. `ADR-023` ·
  Proposed, gated on ADR-021.
- **Book QR codes & deep-link/share surface** — per-book QR, version-pinned, resolves to a
  public web book page. `ADR-024` · Proposed.
- **New-edition redistribution** — readers' existing copies detect/pull a new edition.
  `ADR-025` · Proposed.
- **Narrative + animated-character lesson mode** — optional story-driven, animated-character
  presentation layer. `ADR-010` · Proposed.
- **Mentible ⇄ Pramana compliance handoff** — packaged-consumable contract for Pramana to
  consume Mentible-authored content. `ADR-011` · Proposed (cross-product; no code here).

### B2. Plans / backlog (docs top-level)

- **Zero-knowledge library sync** — cross-device library sync as ciphertext the server can't
  read (passphrase/recovery-key envelope). `docs/SYNC_BUILD_PLAN.md` · "Scoping (not started),"
  deferred past v1.1 (ADR-014 O3).
- **Open Library discovery catalog** — a browsable published-books catalog beyond a reader's own
  shelf. `docs/EXPORT_STATUS_AND_OPEN_LIBRARY_PLAN.md` §B5 · explicitly deferred (rest of Phase B
  is built).

### C. Doc-vs-code discrepancies to fix (housekeeping, not features)

- **ADR-027 status is stale** — its line says D5–D8 (Open-Library publish, registration-gated
  reading) "remain unbuilt," but that slice shipped 2026-07-04 (`ca07dd6`,
  `backend/src/library/router.py`, `published_artifact`, alembic 0007). Update the ADR.
- **Theming proposal substantially done** — `docs/proposals/2026-07-27-theming-and-multi-theme-support.md`
  describes a large `colors.` → `useThemedStyles` refactor; code now shows **88 files on
  `useThemedStyles`** + the 4-theme switcher. Mark the proposal largely complete.
- **Open Shelves (ADR-028) reader path mostly shipped** though the ADR is still formally Proposed —
  close/annotate.

---

## Recommended sequence

1. **P0-2 (review-loop teeth) + P0-3 (validated-master export)** — the top build moves now that
   P0-1 (self-serve billing) is **deferred** (ADR-039: services-led). Both "finish the 80%-done".
   Revenue runs in parallel via the **funnel + manual invoicing** — no billing-rail engineering.
2. **P0-3 (validated-master PDF/Word export)** + fix the **whole-book draft render preview**
   defect (B0) — both make the authoring output trustworthy and shippable.
3. **P1-4 (grounding/citations report + readability)** — leans into the "trust is the product"
   moat; pulls in **ADR-029 library-grounded references** (B1).
4. **P1-5 (derivatives / Share phase, #338)**.
5. **P2-6 (retailer publishing APIs)** — only after P0-3 shows demand.

Backlog (§B1/B2) unblocks opportunistically — e.g. **ADR-033 hosted private library** and
**reader engagement (ADR-021/023)** become viable once P0-1 billing is live.

---

## D. Competitive read — YouBooks + convergence (added 2026-08-16)

Two more docs (`COMPETITIVE_PRODUCTS_ANALYSIS.md`, `FEATURE_ROADMAP.md`) name **YouBooks** — a
**live** AI book generator (multi-model, web research, EPUB/PDF/DOCX, pay-per-book $7–9) — as the
#1 threat, with a 6-month "beat YouBooks" sprint. Full analysis: [`YOUBOOKS_REFRAME.md`](YOUBOOKS_REFRAME.md).

- **Reframe:** YouBooks competes on *book generation*; ADR-037 competes on **expert-validated,
  traceable knowledge** for **SMEs**. Different product/buyer. YouBooks is a **market signal +
  messaging foil** ("validated, not just generated"), **not** a feature checklist to chase.
- **⚠ Don't reorder toward the rejected strategy** the docs drift to — generation-parity, a
  services *marketplace*, a Reedsy partnership. ADR-037 declined those; the roadmap's 5
  writer-network items are even marked N/A.
- **Convergence = the real value:** independent docs agree the top moves are **the same as this
  shortlist** — activate **managed billing** (P0-1), **publishing/export** (P0-3/P2, "KDP = the
  moat"), **make trust visible** (P1-4), **finish collaboration** (P0-2). Heed the *urgency* on
  those; ignore the pull elsewhere.
- **Roadmap "26 built" is stale/mis-framed** — it buries the trust review loop (the spine) as
  "Revision Request (Basic)", predates recent ships (themes / funnel / native whole-book render /
  nav), and overstates "RevenueCat built" (payment rail is the P0-1 gap). Phase 4–5 ARR figures
  are speculative scenarios, not commitments.
