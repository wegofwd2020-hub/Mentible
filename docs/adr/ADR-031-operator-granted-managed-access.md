# ADR-031 — Operator-granted managed access: comp/trial allowances, feature entitlements, and the BYOK graduation

**Status:** Proposed — 2026-07-12
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-005 (managed-key vault + hybrid keys — this **activates** the managed
path via operator grants and **amends D6** to add a *feature* axis alongside the spend
axis), ADR-016/013 (managed billing + metering — built, off; this reuses the
`Plan`/`Entitlement`/metering machinery), ADR-020 (super-admin operator role — the
grant/extend/terminate surface + `admin_audit`), ADR-018 (system-owner holds the managed
vault keys), ADR-001 (managed key never exposed; server-side custody), ADR-014 (account
owns the entitlement; managed↔BYOK never *silently* promoted — here an expired grant
falls back to BYOK **explicitly**), ADR-004 (EPUB/PDF artifact — the first
feature-gated capability), ADR-006 (product-owner-set policy).
**Code today:** `backend/src/billing/{plans,entitlement_repo,access,eligibility,usage_repo,pricing,vault}.py`,
`backend/src/admin/router.py` (`PUT /api/v1/admin/users/{sub}/entitlement`).

---

## Context

The product owner wants to let a user **taste Mentible's AI functionality on the owner's
dime** — a comped, capped, expiring allowance — and then have the user **graduate to
BYOK** (or, later, a paid plan) for full independence. The caps should be **per-user** and
governed **at the owner's discretion**: bounded by cost, by time, and by *which
functionality* is unlocked (e.g. generation but not EPUB/PDF export), and
started/extended/terminated manually **or** automatically.

Most of this is **already built but switched off** (ADR-005 D6 / ADR-016 Phases 1–6):

- **`Plan`** — a code-defined catalogue; each plan declares a **cost allowance**
  (`allowance_micros` per period; 0 = unlimited), the **managed providers** it covers, and
  a **window** (`window_days`).
- **`Entitlement`** — one row per account: `plan_id`, `status` (`active`/`past_due`/
  `canceled`), and the period (`period_start`..`period_end`).
- **`access.resolve_access` + `over_cap`** — gate a managed request against the plan
  allowance **and** a hard per-account spend ceiling (ADR-005 O7), with an ops **anomaly
  alarm** at a warn fraction.
- **`admin PUT …/entitlement`** — a **super-admin**, **audited** grant/replace, with an
  optional `period_days` override (ADR-020).
- **`eligibility`** — a non-entitled caller **falls back to BYOK**.

**The gap:** entitlements gate **spend** and **providers**, but **not functionality**.
There is no way today to grant "generation yes, EPUB/PDF export no." Everything else the
owner asked for already exists. This ADR records the decision to **activate the
operator-grant path** and **adds the one missing axis** (feature entitlements), and pins
the money/abuse/key posture so the activation is deliberate.

---

## Decision (proposed)

### D1 — The operator grant is the activation path; no payment processor required

The owner comps access by **granting an entitlement directly** via the super-admin
`PUT /api/v1/admin/users/{sub}/entitlement` (grant / extend / set `status=canceled`),
every action written to `admin_audit` (ADR-020). Self-serve payments (ADR-016 Phase 4)
are a *later, separate* source of the **same** entitlement object — nothing here presumes
them. This is exactly the path `plans.py` already anticipates ("until then an operator
grants an entitlement directly").

### D2 — Auto-termination is **lazy**, not a scheduled sweep

A grant ends when its **period expires** or its **cost cap is exhausted**; both are
enforced **at the next request** (`resolve_access` rejects an out-of-period entitlement;
`over_cap` rejects over-allowance spend). There is **no Celery-beat / cron** reaping
grants (backend rule #5 — no scheduled tasks at MVP). "Automatic termination" therefore
means *the next managed call is refused*, which is sufficient and keeps the backend
request-driven.

### D3 — Caps are **multi-axis by cost, time, and provider — not raw token count**

An entitlement bounds: **cost** (`allowance_micros`, the primary lever), **time**
(`period_days`/window), and **provider scope** (`managed_providers`). A **raw token-count
cap is explicitly not added** — cost is the lever that actually protects the owner (a
token is worth different money per model, and cost is what the bill is denominated in).
The hard **per-account spend ceiling** (ADR-005 O7) backstops *every* grant, comped or
paid, against a runaway client.

### D4 — **NEW: feature entitlements** — grants gate *functionality*, not only spend

`Plan` gains a **feature axis** — a set of capability flags (e.g. `export_epub`,
`export_pdf`; extensible to other gated capabilities) — and the entitlement check gates
the **capability's endpoint**, refusing a caller whose active plan does not include the
flag. The first gated capability is **EPUB/PDF export** (ADR-004 artifact). This is the
**only net-new build** in this ADR; spend/time/provider gating already exists.

### D5 — Per-user caps come from **named plans**, not free-form per-grant numbers

Different comp levels are expressed as **named plans** in `plans.py` (e.g.
`managed_trial`, `managed_basic`, …), each a small, reviewable policy object (cost +
window + providers + features). The operator **grants a plan** (with an optional
`period_days` override), **not** arbitrary per-grant cost numbers. Rationale: caps stay
**auditable policy in code**, not free-form operator input — fewer foot-guns, and every
grant maps to a named, diffable allowance. *(Alternative considered: a per-grant
`allowance_micros` override for fine control — deferred to an open question; revisit if
operators need it.)*

### D6 — **BYOK is the graduation and the fallback**

Beyond the comp, **full independence is BYOK**. When a grant expires/cancels/exhausts, the
managed path is refused and the user continues by supplying their **own** key (the BYOK
request travels only in the `/generate` body, ADR-001). Consistent with **ADR-014 D3** —
managed and BYOK are never *silently* swapped; here the transition is an **explicit**
"your allowance ended, add your key" fallback, not a promotion.

### D7 — Key custody and provider hygiene are unchanged

Managed keys are **ours**, held in the server-side vault (ADR-018), **never exposed** to
the user — the user receives *functionality*, never a key (ADR-001). Comps use **paid
providers only**; **free-tier Gemini is never comped** (it trains on data — `plans.py`
already flags this).

### D8 — Abuse posture: discretionary now, gated if ever self-serve

Comped grants invite multi-account (Sybil) farming. Current mitigations suffice **because
grants are owner-discretionary** (not self-serve): per-install device tracking + the
per-account spend ceiling cap the blast radius. If comp grants ever become **self-serve**,
an explicit anti-Sybil gate (device/identity limits, rate) is a **prerequisite** — and is
out of scope here.

### D9 — Super-admin **observability + state control** of the comped "free keys"

The owner must be able to **see how the free keys are being used** and **change the state
of a provision**, both through the audited super-admin surface (ADR-020,
`require_super_admin`, read-only metadata — never user *content*).

**View (usage).** Two granularities:
- **Per-user free-key usage** — for a given account, its entitlement **joined to consumed
  spend against the allowance**: plan, period, `cost_micros` used, remaining, % of
  allowance, and a **near-cap flag**. The building block exists (`usage_repo.period_usage`);
  what exists today is only **fleet-aggregate** spend (`GET /billing/usage-summary`) and the
  **bare** entitlement (`GET …/entitlement`, no consumption). Joining entitlement × usage
  per user is **net-new** (small) — this is the observability gap.
- **Fleet of active comps** — a list of accounts holding a comp entitlement with each one's
  consumption and expiry, so a runaway or an expiring trial is visible at a glance.

**Change state.** Already available and audited — this ADR **records** it as the state
lever, no new mechanism:
- `PUT /api/v1/admin/users/{sub}/entitlement` — **grant / extend** (new `period_days`) /
  **terminate** (`status=canceled`). A **soft pause** uses `status=past_due` (already in
  `ENTITLEMENT_STATUSES`); **resume** re-grants `active`. `resolve_access` only honors an
  `active`, in-period entitlement, so a non-`active` status **immediately** stops managed
  access (lazy, at next request — D2).
- Account-level `suspend` / `reactivate` / `delete` remain the coarser levers.

Every view is metadata-only and gated; every state change is written to `admin_audit`
(actor, action, target, timestamp) — the audit trail already carries `entitlement.set:…`.

---

## Open questions

1. **Feature-flag vocabulary + enforcement points.** Confirm the initial set
   (`export_epub`, `export_pdf`) and whether other capabilities are gated (managed
   *provider choice*, higher `max_tokens`, image/diagram generation, Open-Shelves/RAG
   once ADR-032 lands). Each flag needs one enforcement site.
2. **Per-user custom caps (D5).** Named plans now; add a per-grant `allowance_micros`
   override only if operator demand shows it. Decide the trial-plan catalogue.
3. **Owner UI.** Admin API/CLI is enough to start; decide whether to build a console
   screen for grant/extend/terminate (the ADR-020 user-management console exists; an
   entitlement-grant screen may not).
4. **User-facing lifecycle signals.** The anomaly alarm is ops-side; a user-facing "your
   trial is ending / allowance nearly used" prompt (and the graduation-to-BYOK nudge) is
   separate UX to design.
5. **Unification with Phase-4 payments.** Comp and paid entitlements are the same object;
   confirm the self-serve billing webhook will write the same `entitlement` row so the
   access path stays single-sourced.

---

## Scope — what this ADR is *not*

- **Not** self-serve payments / billing integration (ADR-016 Phase 4).
- **Not** a change to key custody or BYOK mechanics (ADR-001/014) — managed keys stay
  server-side and unexposed.
- **Not** a raw-token cap (D3) — cost is the lever.
- **Not** a scheduled/background reaper (D2) — enforcement is lazy, request-driven.
- **Not** an anti-abuse system for self-serve comps (D8) — that is a prerequisite for a
  future self-serve flow, not built here.

---

## Consequences

**Positive:** activates a **comp/trial/growth lever** ("taste on the owner's dime, capped
and expiring, then BYOK or subscribe") on machinery that is ~85% built; the comp and the
future paid plan are the **same entitlement object**, so the access path stays
single-sourced; the owner keeps discretionary, audited control; cost exposure is bounded
by allowance + spend ceiling + anomaly alarm.

**Negative / cost:** the **feature axis** is new surface across `plans.py`, the entitlement
check, and each gated endpoint; comping spends **real owner tokens**, so plan tuning and
the spend ceiling matter; a self-serve future needs an anti-Sybil gate before it can open.

**Migration:** additive. Existing `Plan`/`Entitlement`/access flow is unchanged except for
the new (optional, defaulted-empty) feature set; plans without features behave exactly as
today. Anonymous/BYOK remains the zero-entitlement baseline.

---

## Staged plan (post-acceptance)

1. **Feature axis** on `Plan` (`features: frozenset[str]`, default empty) + an entitlement
   helper (`has_feature(access, flag)`), tests (D4).
2. **Gate EPUB/PDF export** on the feature entitlement; ungranted/BYOK-only → refused with
   a clear "not included in your plan" message (D4; Open question 1).
3. **Comp/trial plan(s)** in `plans.py` (cost + window + providers + features) (D5).
4. *(optional)* **Owner console** screen for grant/extend/terminate over the existing
   admin API (Open question 3).
5. **Activation**: flip eligibility from the staff allowlist to real granted entitlements;
   confirm both `/generate` and export consult `access` (D1).
6. **Super-admin usage view**: per-user entitlement × consumed-spend endpoint + active-comps
   fleet list; state control reuses the existing audited `PUT …/entitlement` (D9).

## Follow-up tickets

- **SBQ-GRANT-001** — `Plan.features` + `has_feature` entitlement check (staged plan 1).
- **SBQ-GRANT-002** — feature-gate EPUB/PDF export (staged plan 2; Open question 1).
- **SBQ-GRANT-003** — comp/trial plan catalogue in `plans.py` (staged plan 3).
- **SBQ-GRANT-004** — owner grant/extend/terminate console (staged plan 4; Open question 3).
- **SBQ-GRANT-005** — user-facing allowance/expiry + BYOK-graduation prompts (Open question 4).
- **SBQ-GRANT-006** — super-admin per-user free-key usage view (entitlement × consumed spend
  vs allowance, near-cap flag) + active-comps fleet list (D9). State control (grant/extend/
  pause/terminate) reuses the existing audited `PUT …/entitlement`.
- *(carried)* per-grant allowance override (Open question 2); Phase-4 payment unification (Open question 5).
