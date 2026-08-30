# P0 spike findings — Cloudflare Workers AI as the free-tier engine

**Date:** 2026-08-30
**Scope:** Tasks #1–#3 of `2026-08-30-pricing-engine-cloudflare-analysis.md` — verify
CF model availability, free-tier throughput, and JSON-conformance fit.
**Method:** Desk research against Cloudflare's official docs (no CF account needed).
The **live** benchmark + JSON A/B (throughput per real gen, valid-JSON rate,
latency) still need a **CF Workers AI API token + account ID** — see "Blocked" below.

---

## #1 — Model availability + endpoint ✅ (fits our architecture)

- **Gemma 4 26B A4B is real and on Workers AI** — model ID **`@cf/google/gemma-4-26b-a4b-it`**
  (MoE, 26B total / 4B active), **256,000-token context window**, launched
  2026-04-04. Native structured tool use.
- **OpenAI-compatible endpoint:** `/v1/chat/completions` — so it drops straight into
  our `wegofwd-llm` `openai_compatible` provider (base URL
  `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1`, model
  `@cf/google/gemma-4-26b-a4b-it`). No new provider code.
- **Qwen3** (dense + MoE) is on Workers AI; the exact `@cf/qwen/...` id for the
  30B-A3B variant to be confirmed in the live step. Qwen3-30B-A3B is a real model.

**Verdict:** architecturally clean — a registry entry + a managed key, same shape as
the Groq work already shipped.

## #2 — Free-tier throughput ⚠️ (tight daily cap; credit removes it)

- **Free allowance = 10,000 neurons/day** — a **hard daily cap** (unlike Groq's
  per-minute TPM).
- Gemma-class rates: **~31 neurons / 1k input tokens**, **~51 neurons / 1k output**.
- A realistic trust **topic** gen (~4k input sources+prompt + ~3k output) ≈
  **~280 neurons ⇒ ~35 topic generations per day** on the pure free tier.

| | Groq free (today's default) | CF Workers AI free |
|---|---|---|
| Limit shape | 8,000 tokens/**min** (+ ~1,000 req/day) | 10,000 **neurons/day** (hard daily) |
| Per-gen throttle | ~1 topic/min (annoyed callmds) | none — burst freely until the daily cap |
| Daily volume | higher (TPM-bound, ~a book over time) | **lower — ~35 topic gens/day** |
| Model | Qwen-8B (draft-grade) | Gemma-26B (bigger/better) + privacy (no-train) |

- **The $2,500 Workers AI credit** (Cloudflare for Startups) removes the daily cap
  for the runway: at CF's paid neuron rate it buys on the order of ~hundreds of
  thousands of topic gens. **So the strategy hinges on landing that credit
  (task #9)** — without it, CF-free alone is tighter on daily *volume* than Groq,
  but nicer per-gen (no per-minute wall, better model, privacy).

**Verdict:** viable, but the pure-free 10k/day is a **testing/low-volume** budget.
The credit is the load-bearing piece for real usage.

## #3 — JSON-conformance fit ⚠️ (Gemma is NOT a JSON-mode model)

- CF **does** support OpenAI-style `response_format` (`json_object` + `json_schema`).
- **BUT only 9 models support JSON mode** — **Llama 3.1 / 3.3, Hermes 2 Pro Mistral,
  DeepSeek Coder / R1 distill.** **Gemma 4 26B and Qwen3-30B are NOT on that list.**
- Our generation path sends `response_format="json"`. On Gemma-4 that is likely
  **ignored** (not enforced), so we'd depend on prompt-only JSON ("respond ONLY with
  valid JSON…") + our conformance repair loop. That's the same risk class that bit
  us with gpt-oss's strict `json_object` — higher malformed-output rate ⇒ more
  repairs ⇒ more failures.
- CF also warns JSON mode can still fail (`JSON Mode couldn't be met`) and does not
  stream.

**Refinement to the proposal:** for the free tier, seriously consider a
**JSON-mode-supported CF model — `Llama 3.3 70B` or a `DeepSeek-R1 distill`** —
instead of Gemma-4, so our strict-JSON path is *enforced*, not best-effort. The live
A/B must compare **Gemma-4 (prompt-only JSON) vs a JSON-mode model** on valid-JSON
rate through our schema + repair loop before committing the default.

---

## Go / no-go read (desk research)

- **Architecture:** ✅ CF is a drop-in `openai_compatible` provider.
- **Model exists:** ✅ Gemma 4 26B A4B (`@cf/google/gemma-4-26b-a4b-it`), 256k ctx.
- **Free throughput:** ⚠️ ~35 topic gens/day free; the $2,500 credit is what makes it
  real → **credit-first (task #9) is a prerequisite, not a nice-to-have.**
- **JSON fit:** ⚠️ Gemma is not a JSON-mode model → **the free-tier pick may need to
  be a JSON-mode CF model (Llama 3.3 / DeepSeek), not Gemma-4.** Live A/B decides.

**Recommendation:** proceed to the live A/B, but widen it to include a JSON-mode CF
model. Keep **Groq-free as the shipped default until the A/B clears** — the CF swap
is a plausible upgrade (bigger model + privacy + credit runway), not yet a decision.

## Blocked — needs to run the live step (#2 real / #3 A/B)

To run the actual benchmark + JSON A/B I need, in the repo's local env (never
logged/committed):
- a **Cloudflare API token** with Workers AI access, and the **account ID**.

With those I'll: register CF in the seam locally, run 5–10 real trust topic prompts
through **Gemma-4** and a **JSON-mode model (Llama 3.3 / DeepSeek-R1)**, and report
valid-JSON rate, repair counts, latency, and neurons burned per gen.
