# Analysis — Sridhar's pricing/engine proposal (Cloudflare + credits-first)

**Date:** 2026-08-30
**Author:** Siva (analysis) · from Sridhar's proposal (`proposal_from Sridhar_20260830.docx`)
**Status:** Analysis + recommended plan — no decision committed yet.
**Relates to:** ADR-005 (multi-provider + hybrid keys + money), ADR-037 (SME
expert-validation, services-led), ADR-042 (no self-hosted inference).

---

## What Sridhar proposes

1. **Free-tier engine → Cloudflare Workers AI + Gemma 4 26B-A4B.** ~10,000 free
   "neurons"/day; Cloudflare states it won't train on customer prompts/outputs
   without explicit consent (good for unpublished manuscripts). Do **not**
   self-host initially.
2. **Model tiers by task** (see reference table below).
3. **Chase non-dilutive startup credits first** to subsidize the first 6–18 months,
   starting with Cloudflare for Startups + Anthropic for Startups (see reference
   table below). Sridhar to "work the angles" via targeted applications.

## Assessment (short)

Strong, pragmatic strategy. Endorse the **direction**: credits-first,
tiered-by-task, managed-not-self-hosted. Treat the **specific engine swap
(Groq → CF+Gemma) as a spike, not a settled decision** — it's a plausible
quality/privacy upgrade over the Groq-free default we ship today, but gated on
throughput + JSON-conformance testing first.

**Fits our architecture:** Cloudflare Workers AI has an OpenAI-compatible endpoint,
so it's a `wegofwd-llm` registry entry + a managed-vault key — the same shape as the
Groq work already shipped. The engine dropdown, engine/token chip, and
honor-selected-provider all carry over unchanged.

**Consistent with ADR-042:** CF Workers AI is *managed inference on someone else's
infra at ~$0*, not us running GPUs — so it does not contradict ADR-042 ("don't
self-host"); it finds a cheaper managed source while keeping the privacy story.

**Main cautions:**
- Measure CF's real throughput first — "10k neurons/day" is a different, likely
  tighter budget than tokens; we just hit the Groq 8k-TPM wall (callmds's dense
  topic), don't trade one wall for another blind.
- A/B the JSON-conformance quality — we validate every gen against a strict schema
  with a repair loop; we've seen models fail strict `json_object` (gpt-oss).
- Verify the exact model IDs are actually on CF Workers AI today (some names read
  as near-future).
- Integrate only CF + Anthropic to start; don't wire all seven credit programs.
- Name the credit-expiry exit (BYOK shifts cost to the user per ADR-005 + paid
  tiers cover managed spend), so 6–18-mo credits aren't a cliff.

---

## Recommended plan

Durations are dev-effort (engineering unless noted). **#1–#3 gate everything** —
do the tests first; they turn the proposal into a data-backed go/no-go before any
integration or default change. Groq-free stays the default until they pass.

| # | Task | Type | Owner | Duration | Depends on / Notes |
|---|------|------|-------|----------|--------------------|
| **P0 — Data before any swap** | | | | | |
| 1 | Confirm exact model IDs **actually on Cloudflare Workers AI today** (Gemma variant, Qwen3-30B-A3B) + its OpenAI-compat endpoint | Research | Eng | 0.5 day | Names in the proposal look near-future/speculative |
| 2 | **Benchmark CF free-tier throughput** — translate "10k neurons/day" into real per-topic gens/day on a representative prompt (incl. a callmds-sized dense input) | Test | Eng | 0.5 day | The Groq 8k-TPM lesson — know CF's ceiling before trusting it. Blocks the swap decision |
| 3 | **A/B JSON-conformance quality** — Gemma-26B & Qwen3-30B vs Groq-Qwen through our strict-JSON schema + repair loop on 5–10 real topics; score valid-JSON rate + draft quality | Test | Eng | 1 day | Gates the trust/validation path |
| **P1 — Integrate only if P0 clears** | | | | | |
| 4 | Add **Cloudflare Workers AI** to `wegofwd-llm` registry as `openai_compatible` (base URL, capabilities, token cap) | Integration | Eng | 0.5 day | Same shape as the Groq work |
| 5 | Wire **managed CF key** through vault + eligibility + metering (mirror `MANAGED_GROQ_API_KEY`) | Integration | Eng | 0.5 day | Reuse #495/#496 plumbing |
| 6 | **In-app A/B on a real book** — full book on CF-Gemma via the engine dropdown; verify quality, latency, no TPM/neuron wall | Test | Eng + Siva | 0.5 day | Dropdown + chip already support per-book provider switch |
| 7 | Flip free default Groq → CF-Gemma (`DEFAULT_GENERATION_PARAMS`), keep Groq as A/B fallback | Change | Eng | 0.25 day | Only after #6 passes; reversible |
| **P1 — Premium tier** | | | | | |
| 8 | Confirm **Anthropic (Claude Sonnet)** as the paid premium/validation engine | Config | Eng | 0.25 day | Already integrated; tier-mapping + copy |
| **P2 — Non-engineering (parallel, Sridhar-led)** | | | | | |
| 9 | Apply for **Cloudflare for Startups** ($10k, ~$2.5k Workers AI) + **Anthropic for Startups** first | Business | Sridhar | ongoing (weeks) | Start narrow; defer the other five until a need pulls them |
| 10 | Capture the **credits program list + amounts + status** in a durable doc | Docs | Eng/Siva | 0.25 day | Done here (below); keep status updated |
| **P2 — Decision record** | | | | | |
| 11 | Write **ADR-043** — tiered-model-by-task + credits-first engine/pricing strategy; reconcile ADR-005/037/042 | Docs | Eng | 0.5 day | Records the strategy |
| 12 | Define the **credit-expiry exit** (BYOK per ADR-005 + paid tier covers managed spend) | Decision | Siva + Sridhar | — | One paragraph in ADR-043 |

**Critical path:** #1 → #2 → #3 (~2 dev-days of testing) → if green, #4–#7
(~1.5 dev-days) → shipped, verified free-tier swap ≈ **3.5–4 dev-days**, plus
Sridhar's parallel credits outreach.

---

## Reference — captured from Sridhar's proposal (was only in the .docx images)

### Recommended model setup

| Mentible tier | Model | Purpose |
|---|---|---|
| Free | Gemma 4 26B-A4B | Outline, sample chapter, rewriting, title & concept generation |
| Free fallback / A-B test | Qwen3 30B-A3B | Alternative for creative writing and multilingual content |
| Paid standard | Gemma 4, GPT-OSS 20B or another economical model | Routine drafting and revisions |
| Paid premium actions | GPT-5.6 Terra or Claude Sonnet 5 | Final polish, complex synthesis, quality validation |

### Non-dilutive AI credit programs (apply first; subsidize the first 6–18 months)

| Program | Potential benefit | Mentible fit |
|---|---|---|
| Cloudflare for Startups | $10,000 in credits for self-funded startups, incl. up to $2,500 for Workers AI | **Best immediate fit** for the free tier |
| Anthropic for Startups | Claude API credits, priority limits, founder resources | Strong for premium authoring & validation |
| Together AI Accelerator | Up to $15,000 for startups that raised < $5M, plus engineering & GTM support | Excellent open-model alternative |
| AWS Activate | Up to $5,000 self-funded; up to $200,000 via eligible investors/accelerators | Good multi-model path through Bedrock |
| Microsoft for Startups | Credits unlocked progressively, potentially reaching $150,000 | Good if targeting Microsoft enterprise customers |
| Google for Startups | Up to $2,000 pre-funded; qualified AI-first funded startups can receive substantially more | Good for Gemini/Gemma and Vertex AI |
| NVIDIA Inception | Free, no equity; technical, ecosystem & GTM benefits | More useful later if self-hosting |

> ⚠ Model names above (e.g. "Gemma 4 26B-A4B", "GPT-5.6 Terra", "Claude Sonnet 5")
> are per the proposal and must be verified against what is actually available on
> the target platform before wiring (task #1). Qwen3-30B-A3B is real.
