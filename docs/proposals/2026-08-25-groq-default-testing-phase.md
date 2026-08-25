# Groq Managed-Default for the User-Testing Phase — Plan & Cost

> **Status:** Proposal / plan (not yet built). **Date:** 2026-08-25.
> **Ask:** Make **Groq** the default LLM for the user-testing phase, offer **Llama** as a
> second free option, keep **BYOK** for Claude / other LLMs. Estimate cost + steps.
> **Companion:** [`docs/research/llm-provider-landscape.md`](../research/llm-provider-landscape.md) ·
> [`docs/research/cost-model-byok-unit-economics.md`](../research/cost-model-byok-unit-economics.md) ·
> ADR-005 (multi-provider seam) · ADR-014 (per-provider credential set).

---

## 0. TL;DR

- **This is a flip-defaults + one small UI + config job — not a build.** The provider seam
  (ADR-005), the managed key-resolution flow, the Groq registration, and the free-tier
  token-cap handling **already exist**.
- **Decisions (confirmed):** testers get **zero-key managed Groq** by default · picker offers
  **two free Groq models** (Llama 3.3 70B = quality default, Llama 3.1 8B instant = faster
  second) · **BYOK unchanged** for Claude/OpenAI/etc.
- **Cost:** ~**0.5–1.5 dev-days** of code + a few hours of real-Groq verification. **No DB
  migration, no package release, no new architecture.** Token spend can be **$0** on the Groq
  free tier — **but one managed key = one shared quota bucket for all testers**, so the real
  ceiling is a **rate limit (HTTP 429), not a bill**. See **§6**.
- **One product call to confirm:** keep the **trust-artifact generator on Anthropic** (product
  spine, citation discipline) while book/lesson/TOC move to Groq — recommended.
- **Recommended framing: hybrid** — managed Groq default (zero friction) **+ BYOK opt-out**. A
  tester who brings their own Groq key self-isolates from the shared quota, which is the built-in
  pressure-valve for the rate-limit ceiling (§6). No code needed for this.

---

## 1. What already exists (the cost-savers)

Verified against the repo on 2026-08-25:

| Capability | Evidence | Why it matters |
|---|---|---|
| **Groq is a verified provider** | `wegofwd-llm/wegofwd_llm/registry.py` `"groq"` entry: `openai_compatible=True`, `base_url=https://api.groq.com/openai/v1`, `default_model="llama-3.3-70b-versatile"`, **`model_verified=True`** | No `wegofwd-llm` package release needed (unlike DeepSeek, which is `model_verified=False`). |
| **Free-tier 413 is already solved** | `openai_compatible.py:79-83` clamps `min(req.max_tokens, capabilities.max_output_tokens)`; Groq caps `max_output_tokens=8000` | Our whole-book/trust gens request `max_tokens=16384` — the clamp drops that to 8000 for Groq, so **no HTTP 413**, no new token-cap code. |
| **Managed key flow exists** | `generate/tasks.py` → `build_provider` + `get_managed_key` (from `billing/vault.py`) + a `managed` flag selecting OUR vault key by `provider_id` | Managed Groq = set one env key + grant testers. No new plumbing. |
| **Vault has a Groq slot** | `billing/vault.py` tuple includes `("groq", settings.managed_groq_api_key)`; registry `managed_env_key="GROQ_API_KEY"` | We only need to **populate** the key, not wire it. |
| **Zero-friction grant path** | `config.py` `managed_plan_emails` allowlist | Grant testers managed access with **no billing** — just an email allowlist. |
| **Groq already a BYOK provider** | `mobile/src/constants/providers.ts` `id:"groq"`, label "Groq (free)" | BYOK Groq works today; Claude/OpenAI BYOK untouched. |
| **Per-book provider/model already modeled** | `mobile/src/types/generationParams.ts` `provider: string`, `model: string | null` | Data layer supports a second model already; only the picker UI needs it. |

**Net:** the three things that usually dominate a "new provider" cost — a package release,
the token-limit fix, and the managed wiring — are all **already done**.

---

## 2. The confirmed decisions

| Question | Decision | Consequence |
|---|---|---|
| **Access model** | **Managed, zero-key.** We hold one Groq key; testers need no key. Granted via `managed_plan_emails`. | We carry token cost (Groq free tier = $0). Matches "default option for testing". |
| **"Second free option"** | **A second Llama *model* on Groq** — `llama-3.3-70b-versatile` (default) + `llama-3.1-8b-instant` (faster). Groq's default model *is already* Llama 3.3 70B. | One provider, two model picks — smallest change (vs. adding Cerebras/OpenRouter as a 2nd provider). |
| **Free-tier token cap** | **Lower max_tokens on the Groq path** — already automatic via the clamp (§1). | Draft-grade output (≤8000 out), fine for a testing phase; pipeline validate-and-retry-3× still applies. |

---

## 3. Steps to implement

| # | Step | Where | Size |
|---|---|---|---|
| 1 | **Provision Groq** — create a Groq account (free, no card); set `MANAGED_GROQ_API_KEY` on the prod backend; add tester emails to `managed_plan_emails`. | prod env / ops | tiny (someone creates the Groq key) |
| 2 | **Flip generation defaults → `groq` / `llama-3.3-70b-versatile`** | `ROLE_DEFAULTS` (authoring, toc) in `registry.py`; `generate/schemas.py` `provider_id` default; mobile `DEFAULT_PROVIDER_ID` + `DEFAULT_GENERATION_PARAMS.provider`; `buildGenerateRequest` fallback | small, mechanical (~6 constants) |
| 3 | **Second Llama model picker** — add a per-provider `models: [{id,label}]` list to the Groq entry, and a model sub-picker in `GenerationParamsEditor` (today it picks *provider* only and sets `model:null` → registry default). | `constants/providers.ts`, `GenerationParamsEditor.tsx`, `types/generationParams.ts` | **small-medium — the only real UI work** |
| 4 | **Help (Definition-of-Done gate)** — add a `FEATURES` key + a Help topic ("Free Groq default / choose your AI"). CI (`help/coverage.test.ts`) fails without it. | `help-content/features.ts`, `topics.ts` | small |
| 5 | **Tests** — default-change units, managed-Groq key resolution, clamp-through-Groq, model-picker. | `mobile/__tests__/`, `backend/tests/` | small |
| 6 | **429 handling (§6)** — surface a friendly "service busy, retry shortly" on Groq rate-limits + optional short backoff-retry. Today the pipeline retries on *malformed JSON*, not on 429 — a rate-limit is a different failure. Needed under the shared-key options (A/B). | `generate/tasks.py`, mobile error copy | small |
| 7 | **Verify (load-bearing)** — real Groq generation: a whole book, a per-topic lesson, and a diagram/KaTeX topic. Confirm valid JSON and that draft-grade quality is acceptable. | device/local, real Groq key | few hours |
| 8 | **Ship** — no migration; backend config redeploy + web deploy both surfaces + APK vc58. | deploy | small |

> **`wegofwd-llm` note:** Steps 2–3 touch `ROLE_DEFAULTS` and the Groq entry, which live in the
> **external `wegofwd-llm`** package. Editing there needs a package release + a pin bump in
> `backend/requirements.txt` — but **no `model_verified` flip** (Groq is already verified), so it's a
> version bump, not a re-verification cycle. The mobile-side constants are in-repo.

---

## 4. The one product decision to confirm

The **trust-artifact generator is the product spine** — "expert-validated, cited, traceable"
(ADR-037). Groq/Llama is flagged **"conformance not measured — draft-grade"**, and per our own
landscape note, **structured graphics + citation discipline** are exactly where open models
wobble. `trust/schemas.py` carries its own `provider_id="anthropic"` default, *separate* from
`ROLE_DEFAULTS`.

**Recommendation:** flip **book / lesson / TOC** to Groq (that *is* "user testing"), but **keep
trust-artifact generation on Anthropic-managed** so the flagship cited flow stays trustworthy.
It's a one-line difference either way:

- **Recommended:** leave `trust/schemas.py` on `anthropic`; flip only `ROLE_DEFAULTS` + generate defaults.
- **Alternative (ride Groq everywhere):** also flip the two `trust/schemas.py` defaults. Faster to
  "all Groq," but risks a weaker first impression on the cited spine.

Reversible either way — defaults flip back instantly.

---

## 5. Cost summary

| Dimension | Estimate |
|---|---|
| **Engineering** | ~**0.5–1.5 dev-days** of code (step 3 is the only non-trivial piece) + the step-6 verify pass. No migration, no package re-verification, no new architecture. |
| **Token $ (testing)** | Can be **$0** on the Groq free tier — **but** one managed key shares one quota bucket across all testers, and the practical ceiling is a **rate limit (429), not cost** (see §6). Paid Dev tier removes the ceiling for a few dollars. |
| **Data residency / privacy** | **Groq is US-based** → no China residency review (unlike DeepSeek). Managed = we hold one key; testers' prompts go to Groq's paid/managed endpoint, not a data-training free tier. Confirm Groq's data-retention terms for the managed path before onboarding real private sources. |
| **Quality risk** | Draft-grade open model. Acceptable and *expected* for a testing phase; the whole point is to gather feedback. Mitigated by keeping trust on Anthropic (§4) + the existing validate-and-retry-3×. |
| **Reversibility** | High — flip ~6 constants back. No data or schema changes. |

---

## 6. Shared-quota / rate limits — the real ceiling

**Managed "zero-key" means one Groq account = one API key = one quota bucket shared by *all*
testers at once.** Groq's free tier rate-limits **per account**, not per end-user. So the binding
constraint is **not a token budget you slowly spend down — it's concurrency**: two testers
generating at the same time compete for the same per-minute and per-day ceilings, and the
overflow is **HTTP 429 (rate-limited)**, not a bill.

### Why it bites *this* workload
Whole-book generation **fans out one request per topic** — a single 15-topic book = ~15 requests
and tens of thousands of tokens in a burst. On one shared free key:

- **TPM ≈ 12k** (already pinned in the registry comment; each call is clamped to 8000 out, but
  concurrent testers stack toward the per-minute ceiling).
- **Requests/day + tokens/day** caps (order-of-magnitude ~1k RPD / ~100k TPD on free
  `llama-3.3-70b-versatile` — **verify live on Groq's dashboard; these move**) → only a **handful
  of whole-book gens per day, total, across everyone**, before the shared key is throttled for the
  rest of the day.

**Read:** fine for a **small, coordinated, roughly-sequential** tester group; **not** fine for many
testers running whole-book gen concurrently.

### The three ways out

| Option | Quota model | $ | Effort delta |
|---|---|---|---|
| **A. Free, one managed key** | Shared bucket, all testers | $0 | none — but expect 429s under concurrency; **add a friendly "service busy, retry" message** on 429 |
| **B. Groq paid Dev tier, one managed key** *(recommended if testing is real)* | Much higher shared limits; pay-per-token | **small** (Groq ~$0.59/1M in — cheap) — needs a card + light spend metering | tiny (same vault key slot, paid account) |
| **C. BYOK-Groq per tester** | **Each tester's own free account = own quota** — distributes the limit, no shared ceiling | $0 | tester makes a free Groq key (signup friction) |

**Recommendation by scenario:**
- **Few testers, coordinated** → **A** (free) + a 429 retry message. $0, ships fastest.
- **Real / concurrent volume** → **B** (paid Dev tier). Removes the ceiling for a few dollars,
  keeps zero-key friction. Best all-round.
- **No card / privacy-minded** → **C** (BYOK-Groq). Quota scales with users; each tester signs up.

> This is the same managed-vs-BYOK trade the landscape note flags (§1.3/§4): **managed = zero
> friction but a shared ceiling; BYOK = friction but quota scales with users.** Option C is just
> the "BYOK-default" fork of the access decision, chosen for quota rather than privacy.

### Hybrid: BYOK as a quota pressure-valve (recommended framing)

The three options aren't exclusive — **mix them.** A tester who brings **their own Groq key**
authenticates against **their own Groq account**, so their usage is **fully separated** from the
shared managed bucket. This is already built (no code):

- **Mechanism:** the BYOK-vs-managed switch is decided by one thing — *is a key in the request
  body?* `buildGenerateRequest.ts:46` sends `api_key` only when a key is stored; `generate/schemas.py`
  routes `api_key is None → managed (our vault key)`, else `→ BYOK (their key, prefix-checked `gsk_`)`.
  Same provider (`groq`), **mixed mode per user**, no conflict (ADR-014 per-provider credential set).
- **Worked example (5 testers, 1 BYOK):** the BYOK tester's generations bill + rate-limit against
  **their** Groq account — **zero draw on the shared bucket**; the other 4 (keyless → managed) don't
  touch their quota, and vice-versa.
- **Why it matters:** BYOK is the **pressure-valve** for the shared-quota problem. On option A, the
  *heaviest* tester is the one most likely to 429 the group — move that one to BYOK and they're off
  the shared bucket entirely, freeing the whole managed quota for the light users. **De-risks option
  A without paying for the Dev tier.**
- **Caveats:** (1) they need their own free Groq account + key — the signup friction *is* the
  isolation; (2) BYOK ≠ unlimited — their key still has Groq's per-account free ceiling, so they
  can 429 *themselves*, just not the group; (3) the key is **device-local** (ADR-014) — entered per
  device, passed per request, never stored server-side; removing it reverts them to managed; (4) the
  same path lets a tester **BYOK Claude** to feel the premium model vs the free Groq default.

> **Framing:** run the testing phase as **hybrid — managed Groq default (zero friction) + BYOK
> opt-out** — rather than all-managed. Light/casual testers stay keyless; heavy or privacy-minded
> testers bring their own key and self-isolate.

### Implication for the plan
- Under **A/B**, add **429 handling**: a clear user-facing "busy, try again shortly" message and
  (optionally) a short backoff-retry in the generate task. Small, but do it before testers see raw
  errors. (Today the pipeline retries on *malformed JSON*, not on *rate-limit* — a 429 is a
  different failure and should be surfaced/backed-off, not counted as a content failure.)
- **B** needs the light spend-metering that ADR-005 D6 already anticipates for managed usage.

---

## 7. Open items before "go"

1. **Who creates the Groq account + key?** (free, no card) — needed for steps 1 and 6.
2. **Trust on Anthropic or Groq?** (§4) — recommend Anthropic.
3. **Which testers?** — the email list for `managed_plan_emails`.
4. **Groq data-retention terms** for the managed path — quick read before real private sources.
5. **Second model scope** — ship both Llama models now (step 3), or launch single-model Groq and
   add the 8B picker as a fast-follow? (Single model shaves step 3 to near-zero.)
6. **Quota tier (§6)** — free/one-key (A), paid Dev tier (B), or per-tester BYOK (C)? Gates whether
   testers hit 429s under concurrency. Recommend **B** if testing is real, **A** for a small
   coordinated group.

---

*Prepared from a code map of the provider seam (`wegofwd-llm` registry, `billing/vault.py`,
`generate/tasks.py`, `mobile/src/constants/providers.ts`, `GenerationParamsEditor.tsx`) on
2026-08-25. File:line references were current as of that read.*
