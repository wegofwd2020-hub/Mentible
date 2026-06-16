# SBQ-USAGE-001 — BYOK token-usage status page

> **Marker / discovery ticket** (not yet scheduled). Captures *how* we can show a
> customer their token usage in a BYOK product, and the one fact that makes it
> cheap: **the provider already hands us the token counts on every call.**
> Relates to **ADR-001** (key discipline — usage rows are metadata, never the key),
> **ADR-005** (metering pulled to MVP for the managed plan; BYOK users benefit from
> the same ledger), **ADR-014** (accounts + per-provider credential set — usage
> hangs off the stable user id and aggregates across providers).

---

## Context

This is **BYOK**: the user pays the provider directly and we never see their
provider billing. That *sounds* like we can't show usage — but we make every
generation call **on their behalf** (ADR-001 passthrough), and the provider's
response carries the usage. So we can show *observed* usage without ever touching
the key or the provider's billing system.

**The enabling fact (already true today):** every `build_provider(...).generate(req)`
returns an `LLMResponse` with:

- `input_tokens`, `output_tokens` — exact counts from the provider response
- `tokens_estimated` — `True` when a provider didn't return usage and the seam
  fell back to an estimate (some OpenAI-compatible providers)
- plus `provenance()` → `{provider, model, model_verified, …}`

The backend **currently discards all of this** (`tasks.run_generation` reads the
text and drops the response object). Capturing it is the whole feature.

## Approach (the "how")

**1. Capture — at the call site, key-free.**
In the generate worker, after each provider call, emit a usage record:
```
{ user_id, ts, provider, model, input_tokens, output_tokens, tokens_estimated,
  book_id?, topic_id?, job_id }
```
Contains **no key and no content** — safe to persist/sync (ADR-001 holds; this is
metadata, not the secret). One row per provider call (including repair retries, so
the count reflects *real* spend, not just the final accepted lesson).

**2. Persist — a per-user usage ledger.**
Append-only rows keyed by the stable user id (the JWKS principal, ADR-014).
- **MVP / local-first:** device-local ledger (AsyncStorage/SQLite), same posture
  as the rest of MVP state — works before server accounts land.
- **v1.1+ / server:** a `usage_events` table once accounts exist; cross-device,
  zero-knowledge sync per ADR-014 custody rules.

**3. Aggregate.** Roll up by `provider × model × day` and by `book`. Cheap on the
append-only rows.

**4. Estimate cost — clearly labelled.** Multiply tokens by a maintained
per-model price table (input/output rates) → estimated spend.
> ⚠️ **BYOK honesty:** this is *our estimate of what we sent* (observed tokens ×
> public list rates), **NOT** the provider's billed amount. It can't see caching
> discounts, batch rates, free-tier credits, or the provider's actual invoice.
> The UI must say so and point the user to their provider console for the real bill.

**5. UI — a Usage / Status surface** (its own page, or a Settings section):
- Headline: total input/output tokens + **estimated** spend, over a selectable window.
- Breakdown by **provider + model** (a BYOK user may hold several keys — aggregate
  across the per-provider credential set, ADR-014).
- Breakdown over time (per day) and **per book**.
- Surface `tokens_estimated = True` rows as "approximate".
- Plain-language disclaimer that this is observed usage, not the provider invoice.

## BYOK-specific caveats (capture these so they aren't re-discovered)

- **We observe, we don't bill.** Never present the estimate as authoritative spend.
- **`tokens_estimated`** providers → mark rows approximate; don't silently average them in.
- **Multi-provider / multi-key:** the page spans the whole credential set, not "a key".
- **Repairs count:** the conformance repair loop makes extra calls — include them, or
  the user's real token spend is under-reported.
- **Privacy:** usage rows are non-sensitive metadata; the *key* discipline (ADR-001)
  is unaffected, but the rows are still user data → ADR-014 custody/sync rules apply.

## Phasing

- **Phase 1 (small):** capture in the worker + local ledger + a basic Usage page
  (tokens by model, this device). No accounts required.
- **Phase 2:** server-side `usage_events` once accounts land (ADR-014); maintained
  price table → estimated cost; cross-device aggregation.
- **Managed tie-in (ADR-005):** the *same* ledger is the metering source for the
  managed plan's allowance — one mechanism serves BYOK transparency and managed
  metering.

## Open questions

- **Price-table maintenance** — rates drift; who owns updating it, and how stale is
  acceptable before the estimate is misleading?
- **Ledger home at MVP** — device-only vs backend; gated on ADR-014 accounts landing.
- **Reconciliation** — most providers don't expose per-key real-time usage APIs;
  assume **estimate-only** and don't promise reconciliation with the provider invoice.
- **Granularity** — per-call rows vs daily roll-ups at write time (volume vs fidelity).

## Why now is a marker, not a build

Multi-provider generation is validated (Anthropic/Gemini/Groq/OpenRouter; see PR #132).
The usage data is *already on the wire* — this ticket exists so that when accounts
(ADR-014) and the managed plan (ADR-005) land, the capture point and the BYOK caveats
are already decided rather than improvised.
