# ADR-037 — Reposition Mentible to an expert-validation studio (SME-primary)

**Status:** Proposed (2026-07-27). Strategic direction chosen; implementation
specifics deferred to per-sub-project specs (see §Decomposition). This ADR lands the
**decision and its reconciliations only — no code.**
**Decision-maker:** Sivakumar Mambakkam
**Trigger:** a Lovable-authored product & UX direction (`mentible-direction.md`) that
reframes Mentible as an **AI-accelerated studio for subject-matter experts (SMEs)**
whose product is **expert-validated, traceable knowledge** — captured from an expert,
AI-drafted, expert-approved, and published as one cornerstone asset plus tailored
derivatives.

**Builds on / Reuses:**
- **#338** (Short-Form Publishing Studio, merged) — its output matrix + source-native
  moat **is** this pivot's "Share" phase (derivatives). Sub-project (d1) = #338.
- **Content Trust Manifest (SBQ-TRUST-001/002)** — the existing signing discipline
  underpins the "approved asset" publish step.
- **ADR-029 / ADR-033** (grounded authoring) — "generate only from provided sources,
  cite each" is exactly the source-native / library-grounded model already decided.
- **ADR-014** (flat IdP identity via JWKS) — multi-user *identity* already exists; the
  future expert-login path (deferred, D4) needs only *authorization*, not new identity.
- **#340** (multi-theme support, proposed) — the direction's **"Navy Trust"** palette
  becomes a layer-3 theme candidate there, not a product decision here (D7).

**Amends:**
- **D6** (standalone self-learner product) → **SME-primary, learner-secondary** (D2).
- **D1 / D17 / ADR-005 money model** (managed-subscription + BYOK as the revenue) →
  **services-led revenue now; self-serve subscription deferred to waitlist** (D3).
- **CLAUDE.md positioning** (headline "purpose-built Anthropic client for self-learners",
  "Claude Code for learners") → **expert-validation studio** headline; the learner
  framing is demoted, not deleted (D2).
- **Backend rule #4 / pitfall #5** ("single-tenant by user, no RLS, no multi-tenancy")
  → **preserved for now** with an explicit *share-ready seam*; the multi-actor break is
  **deferred**, not taken (D4). This is the opposite posture to a rebuild.

**Explicitly rejects (from the source direction):**
- Its **tech stack** (§11: TanStack Start · Vite · Cloudflare Worker · Tailwind v4 ·
  Gemini via Lovable AI Gateway · Lovable Cloud). We **reposition the existing stack**
  (RN+Expo · FastAPI · Node EPUB/PDF compiler · Anthropic/multi-provider per ADR-005),
  not rebuild (D1).
- Its **authz model** (§10: `user_roles` + `has_role()` + blanket RLS). We keep the
  **single-tenant** model and the **ADR-020 config-derived super-admin** (never a DB
  role); per-project access is added only if/when expert-login lands (D4).

**Implemented by:** follow-up sub-project specs (this ADR lands the decision only).

---

## Context

Mentible today (canonical per CLAUDE.md + ADRs, verified live in production): a
purpose-built, provider-agnostic client for **adult self-learners** — BYOK/managed
keys (ADR-005), Books-only authoring (ADR-009), a Node EPUB/PDF compiler, a Content
Trust Manifest, a super-admin console (ADR-020), shipped as an RN+Expo app + web app +
Android APK. Its identity model is **flat and single-tenant** (ADR-014, backend rule
#4): every account is a sealed island; no data is shared between two end-users; there
is no RLS and no multi-tenancy (the OnDemand `current_school_id` dance was explicitly
fled — pitfall #5).

The Lovable direction reframes the product around a different centre of gravity:
**trust is the product.** An expert brings raw knowledge; AI drafts; the *named expert*
reviews and approves at checkpoints; nothing is labelled "expert validated" until that
approval is recorded; every claim is traceable to a source. Revenue is **services**
(Discovery / Sprint / Pilot design-partner engagements), with the self-serve app on a
waitlist. The direction's own stack, backend, and authz differ from Mentible's on
nearly every axis.

The strategic question — *is this a pivot, a sibling product, or a cherry-pick?* — was
resolved to **pivot**. The forks below reconcile that pivot with the shipped reality so
we reposition rather than rebuild.

---

## Decision

### D1 — Reposition the existing stack; do not rebuild
Mentible stays **RN+Expo (mobile/web) · FastAPI · the Node EPUB/PDF compiler ·
Anthropic/multi-provider (ADR-005)**. The SME/trust workflow and the "Navy Trust" look
are layered **onto** this stack. The Lovable direction's stack (§11) and Gemini/Lovable
Gateway AI choice are **reference only** — the hard-won compiler, backend, and
provider-seam investments are retained. *Rationale:* the direction's value (workflow,
positioning, trust) is stack-independent; a rebuild would discard proven, live
infrastructure for no product gain.

### D2 — SME primary, learner secondary
The headline product and go-to-market become the **expert-knowledge-validation
studio**. The authoring engine (scoped-generation IP, compiler, reader) is unchanged
and **continues to support the self-learner mode** underneath, with lighter
positioning. This **amends D6** (standalone self-learner) — learner is demoted, not
removed.

### D3 — Services-led revenue; self-serve subscription deferred
Active revenue is the **services ladder**: Paid Discovery ($250) → Founding Expert
Sprint ($1,500, 30-day knowledge-to-asset) → Team Knowledge Pilot ($2,500–$5,000).
The self-serve app subscription (managed/BYOK, ADR-005) moves to **waitlist / free-tier**
(2 projects, ~20 generations/month) until it "feels right." This **amends D1/D17 and
the ADR-005 money model** — the managed-subscription motion is paused, not deleted;
services fund and validate the SME pivot first.

### D4 — Trust/validation is the product spine; expert-approval starts operator-recorded (single-tenant preserved), expert-login deferred
The **four-phase workflow — Capture → Create → Validate → Share** — is the product
spine, with **approval records, revision history, and source→claim traceability** as
first-class UI (not decoration).

On the load-bearing actor question: the **expert does not log in at MVP.** The studio
**operator records the expert's approval as data** — a signed approval record +
revision history, leaning on the **Content Trust Manifest** discipline. This **keeps
backend rule #4 intact** (single-tenant, no RLS, no multi-tenancy).

**But the model is designed share-ready**, so future expert-login is additive, not a
rewrite:
- every project-scoped resource carries an **explicit `owner_id`** from day one (not the
  implicit "every row is mine");
- **all project access routes through one guard function**, never inline ownership
  checks scattered per query.

When the services motion proves experts need to log in, expert-login = *add one
membership table (`project_id → user_id → role`) + extend the one guard* — a bounded
change, not a 200-endpoint retrofit. Taking the multi-actor break now was **explicitly
deferred** as the highest-cost/highest-risk piece; the seam makes deferral low-regret.
This **amends backend rule #4** only to the extent of requiring the share-ready seam;
it does **not** adopt the direction's `user_roles`/RLS model.

### D5 — Keep Anthropic/multi-provider; reject Gemini/Lovable-gateway
AI generation stays on the **ADR-005 provider seam** (Anthropic default, multi-provider,
BYOK/managed). The direction's Gemini-via-Lovable-Gateway is not adopted. The
"use only provided sources, cite each" prompt discipline **is** adopted — it matches
ADR-029/033 grounded authoring already.

### D6 — Keep the ADR-020 super-admin model; reject `user_roles`/RLS copy
The direction's §10 (`user_roles` table + `has_role()` + blanket RLS) is **not**
adopted. Operator/admin privilege stays the **config-derived super-admin** (ADR-020,
never a DB role or token claim). Per-project *reviewer* access is a **D4-deferred**
concern, introduced only with expert-login.

### D7 — "Navy Trust" is a theme, not a strategy
The direction's visual system — **deep navy · gold · cream**, **Fraunces** (serif) +
**Inter** (body), semantic-token-only, "no default AI aesthetics" — is recorded as a
**layer-3 theme candidate in #340** (alongside Gilded Noir / Forest & Moss). It does
not change app framework or layout here. The trust visuals (approval badges,
source-traced meters, revision counts) are **product UI** (D4), separate from the
palette.

### D8 — "Share" phase = derivatives now, direct-publish deferred
The **Share** phase splits:
- **(d1) derivatives generation** — cornerstone asset → learning module · podcast ·
  YouTube · reels · LinkedIn carousel · X thread. This **is #338** (Short-Form
  Publishing Studio) — near-term, already specced.
- **(d2) direct-publish integrations** — posting to LinkedIn/X/YouTube on the user's
  behalf. **Deferred** (highest cost/risk): it reverses #338's download-only stance
  (FR-8) and introduces a **new per-platform OAuth token-custody surface** (distinct
  from LLM-key custody, ADR-014). It is a **placeholder even in the source direction**.
  When built, it is **gated on an expert-approved artifact + an explicit human action**
  — never auto-publish (guiding principle #2: "expert stays in control").

---

## Decomposition (this is a program, not one spec)

The pivot is too large for a single spec. It decomposes into sub-projects, each of
which gets its own brainstorm → spec → plan → implementation cycle:

| # | Sub-project | Depends on | Status |
|---|---|---|---|
| **a** | **Rebrand / positioning** (SME-first messaging, four-phase narrative) + Navy Trust theme | #340 (theme mechanism) | not started |
| **b** | **Trust/validation data model** — projects · inputs · artifacts · artifact_versions · feedback · approval records · usage_events; source→claim traceability; the share-ready `owner_id` + single access-guard seam (D4) | — | not started |
| **c** | **Multi-actor auth (expert-login)** — membership + per-project access | (b) seam | **deferred** (D4) |
| **d1** | **Derivatives generation** = #338 Short-Form Publishing Studio | #338 (merged) | specced |
| **d2** | **Direct-publish integrations** — per-platform OAuth + token custody | (d1) | **deferred** (D8) |
| **e** | **Services ops** — Discovery/Sprint/Pilot intake, order-form scope, usage/quota | — | not started |

**Recommended next brainstorm:** sub-project **(b)** — the trust/validation data model,
because it plants the share-ready seam (D4) that every later piece depends on, and it is
where "trust is the product" becomes concrete.

---

## Consequences

**Positive:**
- Reuses the entire shipped stack (compiler, backend, provider seam, trust manifest) —
  the pivot is repositioning + new workflow, not a teardown.
- The single-tenant invariant (and its safety/simplicity) is preserved at MVP; the one
  genuinely hard reversal (multi-actor) is deferred behind a cheap seam.
- "One source, many formats" and "trust/traceability" converge with work already in
  flight (#338, Content Trust Manifest, grounded authoring) rather than competing.

**Negative / risks:**
- **Positioning whiplash** — the shipped product, store listings, landing page, and
  CLAUDE.md all speak "self-learner"; repositioning to SME touches all of them (sub-project a).
- **Services motion is an operational commitment** (Discovery/Sprint delivery) distinct
  from shipping software — new muscle.
- **The deferred multi-actor break (D4/c) is real debt** — cheap only if the share-ready
  seam is actually built into sub-project (b). If (b) skips the seam, expert-login later
  becomes the 200-endpoint retrofit we're trying to avoid. **The seam is non-negotiable in (b).**
- **CLAUDE.md is now materially out of step** — this ADR and its sub-projects take
  precedence, but CLAUDE.md's self-learner framing and backend rule #4 need an update
  pass once sub-projects land.

## Open questions
1. **Brand/name** — does "Mentible" carry the SME/trust repositioning, or does the trust
   studio warrant a distinct name? (Trademark work per pitfall #6 still pending.)
2. **Learner mode's fate** — kept as a supported secondary mode indefinitely, or
   sunset once SME traction is proven? (D2 keeps it for now.)
3. **Approval record format** — reuse the Content Trust Manifest signing envelope
   directly, or a new approval-record schema that the manifest signs? (Sub-project b.)
4. **When does expert-login (c) unlock?** — a concrete trigger (e.g. first Team Pilot
   with >1 reviewer) rather than "later."

## Non-goals
- Rebuilding on the Lovable stack (D1).
- Adopting `user_roles`/blanket RLS (D6).
- Switching AI provider to Gemini (D5).
- Auto-publishing without expert approval + explicit action (D8).
- Building expert-login now (D4 — deferred, seam only).
