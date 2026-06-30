# ADR-005 — Multi-provider LLM support + hybrid key handling

**Status:** Accepted — 2026-05-29
**Decision-maker:** Sivakumar Mambakkam
**Revises:** SCOPE.md **D1** (BYOK is no longer the *only* model — see hybrid
decision below) and **D9** (per-request passthrough is now one of two key paths).
Reframes the product from "a purpose-built **Anthropic** client" to "a
**provider-agnostic** learning-content generator."
**Amends:** ADR-001 (BYOK security model → now **hybrid**: managed-key vault +
BYOK passthrough). ADR-004 **D6** (subscription now includes a **metered token
allowance**, because managed generations are billed to us). Pulls **accounts/auth
and usage metering** forward to MVP (was v1.1+).

---

## Context

`docs/llm-providers.md` (PR #35) proposed a multi-provider LLM abstraction
(Anthropic + the OpenAI-compatible four: OpenAI, DeepSeek, Qwen, Gemma). ADR-005
began as a stub to force a deliberate decision, because the proposal reversed
locked decisions (D1/D9, Anthropic-only) and conflicted with ADR-001's key model.

Two product calls were made (2026-05-29) that resolve it:

1. **Reach other LLMs** — the product should not be tied to a single vendor.
2. **Key handling = hybrid** — managed keys (we hold them) as the **default**,
   with **optional BYOK** as a power-user path.

The driver is **consumer friction**: pasting an API key is a hard barrier for a
non-technical adult learner. A "subscribe and it just works" flow converts far
better, while keeping BYOK available for users who want to bypass usage caps and
pay their vendor directly.

> Note: the `llm/` package `docs/llm-providers.md` describes **still does not
> exist** — the live code is Anthropic-only `pipeline/providers/`. This ADR
> authorises building the layer; it is not yet built.

---

## Decision

### D1 — Provider abstraction

Adopt an `LLMProvider` seam fronting multiple vendors. Anthropic keeps its own
SDK; the OpenAI-compatible providers (OpenAI, DeepSeek, Qwen, Gemma) share one
client. Application code talks to a single interface; provider is selectable at
runtime. This is the shape `docs/llm-providers.md` describes — to be built in
`pipeline/` (or a new `llm/` package), Anthropic-only today.

### D2 — Hybrid key handling (managed default + optional BYOK)

| Path | Who holds the key | Who pays tokens | Usage caps |
|---|---|---|---|
| **Managed (default)** | **We do** — server-side vault | **We do** (covered by subscription token allowance) | Yes — metered, capped per plan |
| **BYOK (optional)** | User (per-request passthrough, per provider) | User (billed by vendor) | No app-imposed token cap |

- **Managed** is the default consumer experience. Provider keys are **our**
  secrets, held in a secrets manager, rotated, never logged. This is the
  **at-rest vault** model — distinct from ADR-001's transient-key model.
- **BYOK** remains available per provider and **retains ADR-001's discipline**:
  key in the request body, Redis with TTL, used + shredded, never persisted,
  never logged.

### D3 — ADR-001 becomes hybrid, not replaced

ADR-001's per-request passthrough is **preserved for the BYOK path**. The managed
path adds a **second, separate** key-handling regime (vault + rotation). Both
share the non-negotiable rule: **no key — ours or the user's — ever reaches a log
line, DB row, or traceback.**

### D4 — Money model (amends ADR-004 D6)

ADR-004 D6 said the subscription "covers the app + upkeep only… never covers
Anthropic token cost." That holds **only for BYOK users**. For **managed** users,
the subscription **includes a metered token allowance** and we carry the vendor
cost. Pricing must therefore be margin-aware, with per-plan token caps.

### D5 — Accounts, metering, and abuse control move to MVP

Managed billing cannot be anonymous. **Accounts/auth (was v1.1+) and per-user
usage metering + rate limits + hard caps move to MVP.** D18's "~100-lesson
fair-use cap" is reinterpreted as a **cost-control lever**, not just storage.

---

## Phasing

1. **`LLMProvider` seam** — refactor `pipeline/providers/` to the interface;
   Anthropic first (parity with today), then the OpenAI-compatible client. **✅ Built**
   (the shared `wegofwd-llm` package; ADR-012).
2. **BYOK multi-provider** — extend the existing passthrough path to N providers
   (per-provider key in body; ADR-001 discipline per provider). **✅ Built.**
3. **Managed-key vault** — secrets manager, rotation, per-job use; the new at-rest
   regime. Gated behind accounts. **⏳ Not built.**
4. **Accounts + metering** — auth, per-user usage records, rate limits, plan caps.
   **◑ Partial:** accounts (ADR-014) + rate limits (D9) + usage capture Phase 1 are
   **built**; server-side usage records + plan caps are **not**.
5. **Billing** — subscription token allowance + overage policy. **⏳ Not built.**

> **Phases 3–5 are scoped in [`docs/MANAGED_BILLING_BUILD_PLAN.md`](../MANAGED_BILLING_BUILD_PLAN.md)**
> (vault + managed generation fork + server-side metering + plans/entitlements/caps +
> Stripe billing; 7 phases). Two blocking decisions gate any build: the payment platform
> vs Play-Store policy, and per-provider vendor ToS for serving tokens to third parties.

---

## Open questions

- **Provider defaults & model pinning** — per-provider default model and a policy
  to keep them current (the doc's `deepseek-v4-pro` etc. are unverified). Anthropic
  default stays `claude-sonnet-4-6` (not `claude-opus-4-8` as the doc states).
- **Schema-validation robustness** — non-Anthropic models vary in JSON
  instruction-following; does the 3× retry budget hold, or are per-provider prompt
  tweaks needed?
- **Allowance sizing & overage** — token allowance per plan, and what happens at
  the cap (block / degrade / offer BYOK / paid overage).
- **Abuse vectors** — managed keys mean our spend; need rate limits, anomaly
  detection, and possibly per-account spend ceilings.
- **Vendor ToS** — reselling/proxying provider tokens under our account may carry
  vendor-specific terms; verify per provider before launch.

---

## Consequences

**Positive:** removes the BYOK friction wall for the default user; vendor-agnostic
(failover, cost, capability, regional access); BYOK preserved for power users and
ADR-001 stays intact for that path; subscription becomes a clean "it just works".

**Negative:** large new surface — provider abstraction, an at-rest key vault,
accounts/auth + metering + rate limiting at MVP (earlier than planned), and a
margin-aware billing model. We now carry token cost and a commercial relationship
with vendors (reverses CLAUDE.md's "no commercial relationship for token usage").
Two key regimes to secure instead of one.

---

## References

- `docs/llm-providers.md` — the multi-provider design (PR #35); layer not yet built.
- ADR-001 (BYOK security) — **amended to hybrid**; passthrough retained for BYOK.
- ADR-004 **D6** (money model) — **amended**; managed plans include a token allowance.
- ADR-006 — concurrent rebrand (StudyBuddy Q → Mentible); independent of this.
- SCOPE.md §5 — **D1/D9** reframed; **D18** reinterpreted as a cost lever.
