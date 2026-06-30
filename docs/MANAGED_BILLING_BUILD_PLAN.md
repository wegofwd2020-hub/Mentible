# Managed Billing — Build Plan

> **Status:** Scoping (not started). Backlog item (ADR-005 **D6**: usage metering
> Phase 2 + plan caps + managed-key vault). Also closes **ADR-020 follow-up #6**
> (the managed-vault half).
> **Owner decisions pending:** see [Open decisions](#open-decisions) — several are
> blocking (payment platform, vendor ToS, allowance/overage policy) and must be
> settled **before Phase 1**.
> **Authoritative model:** ADR-005 **D2–D5** + its Phasing/Open-questions; ADR-001
> (key discipline — extended, not replaced); ADR-014 (accounts + the `managed_vault`
> credential source). Where this doc and an ADR differ, the ADR wins.

This is the product's **revenue lever** and its **largest remaining surface**. It is
also the one backlog item that introduces a *new commercial relationship with the LLM
vendors* (we pay for tokens) and a *new external dependency* (a payment processor). It
should not start before the blocking decisions below are made.

---

## 1. Goal & non-goals

**Goal.** Let a user **subscribe and just generate** — no BYOK key required — with the
token cost carried by us under a metered, per-plan allowance. "Subscribe and it just
works" (ADR-005 D2, managed is the default consumer experience).

**Non-goals (explicit).**
- **Not replacing BYOK.** BYOK stays a first-class, optional path with ADR-001
  discipline intact (per-request passthrough, Redis TTL, shred). Managed is a *second*
  regime alongside it (ADR-005 D3). A BYOK key is **never** silently promoted to managed
  (ADR-014 D3).
- **Not metering BYOK token spend.** We don't pay for BYOK tokens, so we don't meter
  them for billing (the device-local usage ledger from Phase 1 stays as-is). Request
  rate limiting already covers BYOK abuse.
- **Not a usage-based/pay-per-token consumer product.** The consumer model is a
  **subscription with an allowance**, not a metered bill (metering is internal, for cap
  enforcement + margin control).
- **Not multi-currency / tax-engine / invoicing-suite scope** at first launch — lean on
  the payment processor's built-ins.
- **Not a shared billing _service_ or cross-product wallet** (decided 2026-06-30,
  ADR-019). Each wegofwd product bills independently; what's shared is the **mechanism**,
  later, as a **`wegofwd-billing` library** — not a runtime service and not one
  subscription spanning products. See the next note.

> **Designed for extraction → `wegofwd-billing` (ADR-019, 2026-06-30).** Managed billing
> splits into a **mechanism** layer that is identical across Mentible / Pramana /
> kathai-chithiram (vault access, token→cost metering, payment-webhook → generic
> entitlement, the cap engine) and a **policy** layer that drifts per product (plans,
> allowances, grants, the entitlement/usage DB rows, UX). Per ADR-019's build-first /
> extract-on-the-second-consumer rule, we **build the mechanism in-repo here behind a
> clean seam** — `meter(usage)→cost`, `verify_webhook(payload)→entitlement`,
> `enforce(policy, usage)→decision`, and vault access — so it can be lifted into a shared
> `wegofwd-billing` package **when a second consumer (likely Pramana) actually wires to
> it**. We do **not** package it speculatively now. Policy stays in app code throughout.

> **Managed changes the content-privacy story (must be disclosed).** Under **BYOK** the
> user's content is theirs end-to-end (ADR-014 zero-knowledge stance). Under **managed**,
> generation content **transits our provider account** and the provider may retain
> inputs/outputs **~30 days for abuse detection** (per OpenAI/Anthropic/Groq terms;
> Gemini's *free* tier additionally trains on + human-reviews data — hence managed Gemini
> is **paid-only**, O4). This is inherent to managed, not a defect — but it's a real
> difference from BYOK and **managed users must be told** (managed-plan terms / privacy
> copy). It does not change the no-key-in-logs discipline or that we never sell content.

---

## 2. Current state — what this builds on (already shipped)

| Capability | Status | Where |
|---|---|---|
| Provider seam (`build_provider(provider_id, api_key, model)`) | ✅ | `wegofwd-llm`, used in `generate/tasks.py` |
| BYOK multi-provider passthrough (per-job Redis envelope → decrypt → use → **shred**) | ✅ | `generate/tasks.py`, `core/byok_envelope.py` |
| Accounts + IdP (Supabase JWKS verify; `Account`, per-provider credential set) | ✅ | `auth/`, `accounts/` (ADR-014) |
| **`managed_vault` as a defined credential source** (metadata only, no key yet) | ◑ defined, unused | `accounts/models.py` `CREDENTIAL_SOURCES` |
| Rate limiting (per-identity, fail-open, per-min + per-day) | ✅ | `core/rate_limit.py` (ADR-014 D9) |
| Usage capture Phase 1 (worker returns a `usage` dict; **client-side** device-local ledger; nothing persisted server-side) | ✅ | `generate/schemas.py` (`usage`), `generate/tasks.py` (SBQ-USAGE-001) |

So the seam, the BYOK regime, identity, abuse throttling, and per-call token capture
all exist. **Managed billing adds: a company-key vault, a managed generation fork,
server-side usage accounting, a plan/entitlement model with cap enforcement, and a
payment integration.** These map to ADR-005 phases 3–5.

---

## 3. Architecture overview

Five components; the fork from today's BYOK-only flow is small and well-localized.

```
                          ┌─────────────────────────────────────────┐
  POST /generate ──────►  │  key-source decision (per request)       │
   (authed, no api_key)   │  managed? = authed ∧ plan active ∧        │
                          │            provider managed-eligible ∧    │
                          │            within cap                     │
                          └───────┬───────────────────────┬──────────┘
                          managed │                  BYOK  │ (unchanged: Redis envelope)
                                  ▼                        ▼
                       ┌────────────────────┐    ┌────────────────────┐
                       │ Managed-key vault  │    │ byok envelope      │
                       │ (OUR company keys, │    │ (per-job, shred)   │
                       │  small fixed set)  │    └────────────────────┘
                       └─────────┬──────────┘             │
                                 └──────────┬─────────────┘
                                            ▼
                              build_provider(...) → generate (UNCHANGED)
                                            │
                                  ┌─────────▼──────────┐
                       managed →  │ usage metering P2  │  → period rollup → cap check
                                  │ (server-side cost) │
                                  └────────────────────┘
```

**Key insight that shrinks the "vault":** managed keys are **OUR small fixed set** (one
key per provider, a handful total), **not per-user secrets**. So the "at-rest vault" is
secure storage + rotation of ~N company keys — far lighter than a per-user key store.
The hard part of managed billing is **metering, plans, and payments**, not the vault.

---

## 4. Component 1 — Managed-key vault (ADR-005 phase 3 / ADR-020 #6)

**What it stores:** our provider keys (Anthropic first; others as enabled). A small,
fixed set — not per-user.

**Mechanism options (decision O3):**
- **(A) Secret store / env at deploy** — keys injected as env/secret files, loaded via
  `pydantic-settings` like every other secret today; rotation = redeploy with new value.
  Simplest; fits the single-VPS deploy; matches how `byok_master_key` /
  `system_owner_secret` already work. **Recommended for launch.**
- **(B) KMS-wrapped in DB** — reuse the `byok_envelope` envelope pattern (a master key
  wraps the stored provider keys); rotation without redeploy. More moving parts;
  warranted only once there are many keys or automated rotation is needed.
- **(C) Managed secrets manager** (Vault / AWS/GCP Secret Manager / Doppler) — overkill
  for a handful of keys on one box; revisit at scale.

**Discipline (non-negotiable, ADR-001/ADR-005 D3):** the company key never reaches a
log line, DB row, or traceback — same redaction filter that guards BYOK keys. The worker
fetches it, uses it for the call, and drops the reference (mirror the BYOK `del api_key`).

**Worker fork:** in `generate/tasks.py`, where today it always reads/decrypts the BYOK
envelope (~L180–194), branch on the key-source decision: managed → vault key; BYOK →
existing envelope path. Everything downstream (`build_provider` → generate → validate)
is **identical** — only the key source differs, and the provenance/`PolicyBlock` flips
(`byok=False`, `key_stored=False` still true — we never store the user's key because
there isn't one).

---

## 5. Component 2 — Managed generation path (the fork)

The request shape changes: a managed user calls `/generate` **without** an `api_key`.

- **Eligibility (computed per request):** `authed ∧ account.plan active ∧ provider ∈
  managed-eligible set ∧ usage within cap`. If any fails, the response is explicit:
  401 (not authed), 402/forbidden-with-reason (no active plan), 409/cap (over allowance
  — see overage policy O2), or fall back to "provide a BYOK key".
- **Credential-set coupling:** the chosen provider's entry in the account credential set
  is `source = managed_vault` (ADR-014 D2/D3). This is how the picker knows a provider is
  "use our key" vs BYOK on this device. Setting it is an explicit opt-in, never automatic.
- **Anonymous demo unaffected:** no account ⇒ no managed path ⇒ BYOK or demo as today.

---

## 6. Component 3 — Usage metering Phase 2 (server-side)

Phase 1 already returns exact `{provider, model, input_tokens, output_tokens, attempts}`
per job. Phase 2 **persists** it for **managed** generations (BYOK stays client-ledger).

- **`usage_event`** — append-only: `account_id, ts, provider, model, input_tokens,
  output_tokens, est_cost_micros, job_id`. Written by the worker after a managed call.
- **`usage_period`** — rolled-up counter for the current billing window per account
  (sum tokens + est_cost), the cheap read the cap check hits on the hot path.
- **Cost basis (decision O6):** a **price table** (per provider/model, input/output rate)
  converts tokens → `est_cost_micros`. Versioned + dated (vendor prices change). Owner of
  the table is the same person who pins models (carry from the multi-provider work).
- **Pre-flight vs post-hoc:** exact tokens are only known *after* the call. So: a
  **pre-flight estimate** (prompt size + page target → predicted tokens) gates the hard
  cap and optionally **reserves** budget; the **post-hoc actual** reconciles the reserve.
  Soft cap = warn; hard cap = block before dispatch.

---

## 7. Component 4 — Plans, entitlements & cap enforcement

- **`plan`** (config or table): id, display, **allowance** (token- or unit-based — O5),
  managed-eligible providers, price, **behavior-at-cap** (O2).
- **`entitlement`** per account: `plan_id, status (active|past_due|canceled), period_start,
  period_end` — the source of truth for "is this account managed-active right now".
  Driven by **RevenueCat webhooks** (§8, O1), **never** trusted from the client.
- **Cap enforcement** sits in the eligibility check (§5), reading `usage_period` vs the
  plan allowance. **D18's ~100-unit fair-use cap is reinterpreted here as the cost-control
  lever** (ADR-005 D5), not a storage limit.
- **Per-account spend ceiling / anomaly guard (O7):** a hard `est_cost` ceiling per window
  independent of the nominal allowance, as a backstop against a runaway loop draining our
  spend even within "unit" limits.

---

## 8. Component 5 — Billing & payments (RevenueCat; O1 decided)

**The hard external dependency.** Mentible ships as a **web app**
(`mambakkam.net/app/mentible`) and a **sideloaded Android APK** (GitHub Release, *not* the
Play Store today). **O1 is decided → RevenueCat** as the single billing/entitlement layer.

- **Why RevenueCat over Stripe-direct:** one subscriber record + one shared **entitlement**
  across web, Play, and App Store, queryable from any platform — so listing on Play/iOS
  later doesn't mean re-plumbing billing. RC **Web Billing uses Stripe** under the hood and
  **never stores card data** (PCI stays with Stripe), so the launch path is effectively
  "Stripe, wrapped" with a future-proof multi-platform layer.
- **Integration shape:** products defined in Stripe (Web Billing) now — and in Play Console
  / App Store Connect when those land — all wired to **one RevenueCat entitlement**. The
  app uses RC's hosted Web Purchase Link / paywall to check out; **RevenueCat webhooks →
  our `entitlement`** (active / past_due / canceled) drive eligibility (§5/§7). Entitlement
  is always server-verified via RC, **never** trusted from the client.
- **No store-billing forcing function today:** while we're web + sideloaded APK, no Play/
  App Store billing applies at all; and post–*Epic v. Google*, even a US Play listing now
  permits external billing (~9–20% fee). RevenueCat is chosen for the unified layer, not
  because policy forces it.
- **Overage (O2):** at the cap, one of — block until renewal / degrade (e.g. offer BYOK) /
  paid overage (metered top-up) / soft-cap-then-block. Pick per plan.

---

## 9. Phasing

> **Phase 0 is blocking and mostly non-code** — settle the [Open decisions](#open-decisions)
> first. Everything after is gated on the managed providers' **vendor ToS** allowing us to
> serve their tokens to third parties under our account (O4).

| Phase | Deliverable | Notes |
|---|---|---|
| **0 — Decisions** | ~~Payment platform (O1)~~ ✅ RevenueCat · ~~vendor ToS (O4)~~ ✅ all four cleared · still open: allowance/overage (O2/O5), vault mechanism (O3), spend ceiling (O7), free tier (O9). | **Blocking O1/O4 settled 2026-06-30** — the rest are non-blocking design choices that can land alongside their phase. |
| **1 — Vault + managed fork (internal)** | ✅ **BUILT** (2026-06-30). Company-key storage (option A, `MANAGED_ANTHROPIC_API_KEY`), the worker key-source branch, and an **internal staff allowlist** (`MANAGED_PLAN_EMAILS/SUBS`, no payments yet). | `backend/src/billing/{vault,eligibility}.py` (mechanism vs policy seam) + the `/generate` fork (keyless ⇒ managed for an eligible caller; BYOK unchanged; managed key never in Redis/logs — extends the mandatory no-key gate). Anthropic only. |
| **2 — Usage metering P2** | ✅ **BUILT** (2026-06-30). `usage_event` (migration 0005) + period rollup (SUM aggregate), price table (`billing/pricing.py`), and a **fixed cost cap** enforced pre-flight (`billing/caps.py` + the `/generate` 429). | `billing/usage_repo.py` (store) + worker best-effort recording (managed only; degrades gracefully with no DB). Period total is read as an aggregate (materialised rollup deferred); the **pre-flight estimate/reserve** is deferred — the cap gates on accumulated **actuals** (refuse once over). |
| **3 — Plans + caps** | ✅ **BUILT** (2026-06-30). `plan` registry (`billing/plans.py`) + `entitlement` (migration 0006, `billing/entitlement_repo.py`) + a unified access policy (`billing/access.py`: plan entitlement OR the Phase-1 staff override) wired into `/generate` (400 ineligible / **429** over the plan allowance). | Entitlement **set by admin** — `PUT/GET /api/v1/admin/users/{sub}/entitlement` (audited). Supersedes the Phase-2 fixed cap (now the staff-path cap). Behavior-at-cap = block (O2 degrade/overage later). No payments — Phase 4 wires RevenueCat → entitlement. |
| **4 — Billing** | ◑ **Backend BUILT** (2026-06-30) — RevenueCat webhook → entitlement. `billing/revenuecat.py` (event→intent mapping) + `POST /api/v1/billing/revenuecat/webhook` (`billing/router.py`): auth-checked (shared secret), maps RC product→plan, syncs `entitlement` (grant active / expiration→canceled / billing-issue→past_due). **Replaces the manual admin grant for real subscribers.** | **Owner setup pending (no real money yet):** create the RC project + products, set `REVENUECAT_WEBHOOK_AUTH` + `REVENUECAT_PRODUCT_PLAN_MAP`, point the RC dashboard webhook at the endpoint with the same Authorization secret, and have the client call `Purchases.logIn(idp_sub)` so `app_user_id` = our account. Overage (O2) still = block. **Sandbox-verify before enabling.** |
| **5 — Client UX** | ◑ **Status + meter BUILT** (2026-06-30). Backend `GET /api/v1/billing/managed-status` (entitlement + server-side period usage + allowance) + mobile `ManagedPlanCard` on the Usage screen: plan, status badge, **server-sourced usage meter** vs allowance, and past-due / canceled / over-cap messaging. | **Deferred (needs the RC SDK + your products):** the **plan picker / purchase flow** (RevenueCat checkout) and the "managed vs BYOK per provider" toggle in the key UI. The card is read-only until then. |
| **6 — Launch hardening** | Anomaly/spend-ceiling alarms, key rotation runbook, margin dashboard, multi-provider enablement. | |

Sequencing rationale: vault + fork first (smallest, unblocks dogfooding), metering before
caps (can't cap what you don't measure), caps before billing (prove enforcement on a free
internal plan), billing last (highest external risk). Mirrors ADR-005's own phase order.

---

## 10. Risks & mitigations

- **Margin inversion** — token cost exceeds subscription if uncapped. *Mitigation:* hard
  caps + per-account spend ceiling + margin-aware allowance sizing (O2/O5/O7); meter from
  day one of the managed path.
- **Vendor ToS** — reselling/proxying tokens under our account may breach provider terms.
  *Mitigation:* **O4 is a hard gate** — clear each provider's ToS before enabling it managed;
  launch with only the cleared set (likely Anthropic first).
- **Platform billing policy** — shipping managed via the Play Store would force Play Billing
  + its cut. *Mitigation:* O1 decided up front; web-Stripe while distribution is web + sideload.
- **Abuse on our dime** — managed key = our money; a compromised account or runaway client
  drains spend. *Mitigation:* existing rate limits + new spend ceiling + anomaly alarms;
  entitlement always server-verified, never client-trusted.
- **Company-key exposure** — a leaked managed key is *our* liability across all users.
  *Mitigation:* same no-log discipline as BYOK; rotation runbook; least-privilege storage.
- **Cost-estimate drift** — pre-flight estimate wrong → cap leaks or false blocks.
  *Mitigation:* reconcile post-hoc; tune the estimate from real `usage` data; conservative
  hard ceiling as backstop.

---

## 11. Test plan

- **Vault:** key never appears in logs/tracebacks (extend the mandatory no-key-in-logs
  gate to the managed path); worker uses vault key when managed, envelope when BYOK.
- **Fork/eligibility:** matrix over (authed?, plan active?, provider eligible?, within
  cap?) → correct path or correct explicit error; anonymous/demo unaffected; BYOK path
  byte-for-byte unchanged.
- **Metering:** `usage_event` written only for managed; `usage_period` rollup correct
  across repair attempts; price-table cost math; pre-flight vs post-hoc reconcile.
- **Caps:** soft-cap warns, hard-cap blocks before dispatch; spend ceiling trips
  independent of unit allowance; behavior-at-cap per policy.
- **Billing:** webhook → entitlement transitions (active/past_due/canceled) drive
  eligibility; client can never self-grant; Stripe sandbox e2e.
- **No live vendor/Stripe in CI** — mock the provider SDK and the payment webhooks (same
  rule as today).

---

## Open decisions

1. **O1 — Payment platform & distribution policy. ✅ DECIDED 2026-06-30 → RevenueCat.**
   Use RevenueCat as the single billing/entitlement layer: **RevenueCat Web Billing
   (Stripe under the hood) now**, with Play / App Store products wired to the **same
   shared entitlement** later — one subscriber record, queryable from any platform,
   RC never stores card data. Chosen over Stripe-direct to avoid re-plumbing billing if
   the app later lists on Play/iOS. _(Context: while we're web + sideloaded APK, no store
   billing applies at all; and post–Epic v. Google even a US Play listing now permits
   external billing — so this is about a unified future-proof layer, not a policy forcing
   function.)_ See §8.
2. **O2 — Behavior at cap.** Block / degrade / offer-BYOK / paid overage — per plan.
3. **O3 — Vault mechanism.** Env/secret-store (A, recommended) vs KMS-envelope-in-DB (B)
   vs managed secrets manager (C).
4. **O4 — Vendor ToS (hard gate). ✅ DECIDED 2026-06-30 → all four cleared for managed,
   as a value-add app on commercial accounts.** Research (2026-06-30, non-legal — confirm
   against the live signed terms before launch) found the same line in every provider's
   terms: **prohibited** = reselling/transferring *raw API access or keys* (being a
   "conduit"); **permitted** = building a value-add application that serves end users on
   your own commercial account. Mentible managed is squarely the permitted pattern.
   - **Anthropic** ✅ value-add product on a **commercial** API account (never a
     Claude Pro/Max *subscription* credential; not raw pass-through). Formal partner/
     reseller agreement only relevant at ~6-figure annual spend.
   - **OpenAI** ✅ "make Customer Applications available to End Users" is explicit;
     business/API inputs not trained on by default; ~30-day abuse retention.
   - **Groq** ✅ same "integrate into customer applications / available to End Users";
     prohibited only is reselling API access or transferring keys.
   - **Gemini** ⚠️ **paid quota only** — the free tier **trains on + human-reviews**
     submitted data, which breaks our content-privacy posture. Use paid, or skip Gemini
     for managed.
   - **Standing rules (all providers):** commercial/paid accounts only; never expose raw
     API pass-through or transfer keys; **managed content transits our provider account
     and may be retained ~30 days for abuse** — a real privacy difference from BYOK/
     zero-knowledge that managed users must be told (see the new managed-privacy note in
     §1). Re-verify before any subscription-credential or reseller pattern.
5. **O5 — Allowance basis.** Token-based vs request/"unit"-based (D18 ~100-unit) allowance
   — units are simpler UX, tokens track cost more precisely.
6. **O6 — Cost basis & price-table ownership.** Source/refresh of per-provider/model rates;
   who owns updates.
7. **O7 — Per-account spend ceiling / anomaly thresholds.** The runaway-spend backstop.
8. **O8 — Managed-eligible providers at launch.** Likely Anthropic only first; expand as
   ToS (O4) clears.
9. **O9 — Free tier?** Whether anonymous/free accounts get any managed allowance (lead-gen)
   or managed is strictly paid (BYOK/demo remain the free paths).
