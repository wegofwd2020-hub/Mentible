# LLM Provider & Open-Model Landscape — for Content Generation

> **Status:** Reference / research note (info-only for now). Candidate to become a
> **living "provider qualifier"** inside Mentible, refreshed on an ongoing basis.
> **Last updated:** 2026-08-23 · **Next refresh:** when a leaderboard below moves,
> or quarterly.
> **Scope:** which LLMs (esp. open-source / free) can drive Mentible's content
> generation, and where to find current, trustworthy provider comparisons.

⚠️ **Model version numbers churn fast** (monthly). Treat the specific versions and
scores below as a **snapshot from the cited sources (mid-2026)** — for the current
truth, always check the **live leaderboards in §2**, not this file.

---

## 0. TL;DR for Mentible

- **Yes — capable open-weight models exist and several are free to *call*** (hosted
  free tiers) or free to *run* (self-host). The open field has largely caught up:
  open-weights models now hold **223 of 356** tracked model slots on Artificial
  Analysis, and the best open model (Kimi K3) sits at Intelligence Index **60** vs
  the #1 proprietary (Claude Opus 5) at **63**. [[AA]]
- **For Mentible specifically, "quality" ≠ raw benchmark score.** Our generation is
  **structured** (JSON books/lessons/trust artifacts) with **diagrams** (SVG /
  Mermaid) and **math** (KaTeX), plus long-form coherence and strict
  instruction-following. That rewards: strong **structured-output adherence**, long
  context, and reliable JSON — not just chat Elo.
- **Practical stance:** keep the **multi-provider seam** (ADR-005) — Anthropic as the
  managed default (best structured/long-form quality in our own tests), with
  **BYOK** to OpenAI / Google / **Groq (free, open models)** for power users and
  cost-sensitive runs. Open models are a strong **BYOK / self-host** option and a
  future **managed cost lever**, with the caveats in §4.
- **Biggest caveat: "free" usually means "your prompts train the model."** Fine for
  demos; **not** for users' private sources/manuscripts. See §1.3 + §4.

---

## 1. Q1 — Open-source / free LLMs for content generation

There are two very different meanings of "free," and Mentible cares about both:

### 1.1 Open-*weight* model families (free to self-host / fine-tune)

As of the mid-2026 sources, the leading open families for generation work: [[BFA]] [[Vellum]] [[TechJacks]]

| Family | Notable 2026 versions | License | Notes for content gen |
|---|---|---|---|
| **Qwen** (Alibaba) | Qwen 3.6 / 3.7, Qwen-VL | Apache-2.0 (most) | Top open all-rounder; strong reasoning + multilingual; good JSON |
| **DeepSeek** | V4 Pro, V3.2 | MIT | Leads several open reasoning/math/coding benchmarks |
| **GLM** (Zhipu/Tsinghua) | GLM-5 / 5.1 / 5.2 | MIT (5.2) | Top **open** Arena Elo; GLM-5.1 ≈ Claude Opus on coding |
| **Llama** (Meta) | Llama 3.3, 4 Scout | Meta community license (attribution; <700M MAU) | Most widely deployed; huge tooling/hosting support |
| **Mistral** (EU) | Mistral Large 3 | Apache-2.0 | Cleanest **permissive** license story; strong multilingual |
| **Gemma** (Google) | Gemma open family | Gemma license | Best for **laptop / on-device / edge** |
| **Kimi** (Moonshot) | K2.7 Code, K3 | Modified MIT | Highest-ranked **open** on AA Intelligence Index (K3 = 60) |
| **Phi** (Microsoft) | Phi-4 | MIT | Small, efficient; good cost/perf for narrow tasks |
| **OLMo** (AI2) | — | Apache-2.0 + open data | The most *truly* open (weights **and** training data) |

**License read for a commercial app (Mentible ships paid):** MIT / Apache-2.0 models
(**DeepSeek V4, Qwen, Mistral, GLM-5.2, Phi-4, OLMo**) are the cleanest — weights are
yours, commercial use unrestricted. Llama is fine below 700M MAU but needs
attribution; Gemma/Kimi have their own terms — **read the exact license before
shipping any model into the managed path.** [[BFA]]

### 1.2 Free-to-*call* hosted tiers (no GPU needed)

You can use many of the above through **permanent free API tiers** — the fastest way
to trial open models in Mentible's BYOK seam: [[OR]] [[Flywheel]]

| Provider | Free offering | Fit for Mentible |
|---|---|---|
| **Groq** | Llama 3.3 70B etc., ~320 tok/s, OpenAI-compatible; no card | Already a BYOK option in-app; great for fast/cheap runs |
| **Cerebras** | ~1M tokens/day on Llama 3.3 70B; no card | Volume/batch generation without speed penalty |
| **Google AI Studio** | Gemini free tier; no card | Already supported (BYOK Gemini) |
| **OpenRouter** | Routes to many free open models via one key | Easiest way to A/B many models behind one seam |
| **Mistral** | ~1B tokens/mo (Experiment tier) — **must opt into training** | Generous, but privacy caveat (§1.3) |
| **GitHub Models** | GPT-4o / Claude 3.5 / Llama / Phi via Azure, GitHub-tied | Handy for eval, not production content |

> Mentible's Settings already exposes **BYOK for Anthropic / OpenAI / Groq** (and the
> provider seam per ADR-005). Adding OpenRouter/Cerebras/Gemini keys is a
> config-level extension, not new architecture.

### 1.3 The privacy trap (this is the important one)

> **"No-credit-card free" tiers are usually funded by your prompts** — i.e. **your
> data trains the model.** [[OR]] [[Flywheel]]

Mentible's content is **users' own sources, notes, and manuscripts** (the whole
"drafted from your sources, cited, expert-signed" pitch). Routing that through a
data-training free tier would leak private customer content. **Rule of thumb:** free
tiers are OK for the **public demo** and internal eval; **never** for a paying user's
private generation. For the managed path, use **paid, no-training** endpoints (or a
self-hosted open model) and say so in the privacy posture.

---

## 2. Q2 — Where to find current provider/version comparisons

Yes — several **live, independent** leaderboards exist. Use these (not a static blog)
for the current picture; each measures something different:

| Report | What it measures | Best for | Link |
|---|---|---|---|
| **Artificial Analysis** — *Intelligence Index* | Aggregate of ~10 standardized benchmarks (coding, math, reasoning) **+ price + speed** | Objective capability **and** cost/latency trade-offs; open-vs-proprietary | [[AA]] |
| **LMArena** (Chatbot Arena) | Human blind-preference **Elo** from head-to-head votes | "Which do humans prefer" for conversational/writing quality — hard to game | [[LMArena]] |
| **Vellum Open LLM Leaderboard** | Open-weight models only, side-by-side | Comparing just the **open** field | [[Vellum]] |
| **llm-stats / Open LLM Leaderboard** | Open-model rankings + raw stats | Quick open-model rank + context/price | [[LLMStats]] |
| **DataLearner / Swfte / ClickRank** | Aggregated monthly rankings (LLM + image + coding) | Fast monthly pulse | [[DataLearner]] |

**How to read them together (for Mentible):**
- **Capability + cost** → Artificial Analysis (it prices every model, so it directly
  informs the managed-token cost lever, D18/ADR-005).
- **Writing/coherence quality** → LMArena Elo (closest proxy to "reads well," which
  matters for books/lessons).
- **"Is the best *open* model good enough yet?"** → Vellum / llm-stats open boards.
- **⚠️ None of them test our exact job** (structured JSON + SVG/Mermaid diagrams +
  KaTeX + long-form book coherence). Leaderboards are a *filter*, not a verdict — our
  own multi-provider generation test is the real gate (see §3).

Snapshot from the sources (mid-2026, will drift): **Claude Opus 5** #1 overall (AA
Index 63); best **open** = **Kimi K3** (60); **GLM-5** tops the **open Arena Elo**
(~1454), just ahead of **Qwen 3.5**; **DeepSeek V3.2** wins open reasoning/coding.
[[AA]] [[LMArena]] [[TechJacks]]

---

## 3. "Which serves which purpose" — mapped to Mentible's generation

Mentible doesn't do one kind of generation. Rough fit by task (blend of the sources
above + our own findings):

| Mentible task | What it stresses | Good fits (today) | Notes |
|---|---|---|---|
| **Whole-book / long-form drafting** | Long-context coherence, structured JSON, instruction-following | Claude (managed default), Qwen 3.x, DeepSeek V4 | Structured-output adherence matters more than chat Elo |
| **Per-topic lessons / quizzes** | Reliable JSON schema, moderate length | Most frontier + strong open (Qwen, GLM, Llama 3.3) | Cheap open models viable here |
| **Diagrams (SVG / Mermaid)** | Precise, valid markup generation | Claude strong; **⚠ Gemini-flash looped on SVG** in our test | Validate output; some models degrade on structured graphics |
| **Math (KaTeX)** | Correct LaTeX, no drift | DeepSeek (math-leading), Claude | Schema-validate + retry (pipeline already does 3× retry) |
| **Trust-generator artifacts** | Grounding, citation discipline, JSON shape | Claude (current) | 16384 max_tokens; double-encoded `sections` gotcha (see memory) |
| **Fast / cheap / high-volume** | Throughput, $0–low cost | **Groq** (Llama 3.3, ~320 tok/s), Cerebras | BYOK; watch privacy on free tiers |
| **Demo / offline / edge** | Small, local | Gemma, Phi-4 | On-device story if ever needed |

> Our own note (memory `project_multiprovider_generation_test`): **Anthropic best;
> Gemini-flash loops on SVG.** That's exactly why leaderboards don't replace an
> in-app eval — structured graphics are a known differentiator.

---

## 4. Mentible-specific caveats before adopting any model

1. **Structured-output adherence is the real quality axis**, not chat Elo. Test each
   candidate against our JSON schema + diagram/KaTeX validators (the pipeline's
   validate-and-retry-3× already exists) before trusting it.
2. **Privacy:** never route paying users' private sources through a data-training free
   tier (§1.3). Managed path = paid, no-training, or self-hosted open weights.
3. **Licensing:** if an open model enters the **managed** path (we serve it), confirm
   its license permits commercial hosting (MIT/Apache clean; Llama/Gemma/Kimi have
   conditions).
4. **Seam already supports this:** ADR-005 provider-agnostic seam + BYOK per provider.
   Adding an open model = a provider adapter + a key, not a rebuild.
5. **Cost lever:** open models on Groq/Cerebras/self-host can dramatically cut managed
   token spend (D18) — but only after they pass #1 for the target task.

---

## 5. Turning this into a living "qualifier" (future)

If this becomes an in-app/ongoing qualifier:
- Store a small **provider registry** row per model: `{provider, model, license,
  hosted_free?, trains_on_data?, ctx, price_in/out, fit_tags[], last_checked}`.
- Refresh `fit_tags` + prices from **Artificial Analysis** (has price/speed) on a
  cadence; link out to the live boards rather than freezing scores.
- Gate "managed-eligible" on: license OK + no-training endpoint + passes our
  structured-output eval.
- Surface to users as "recommended model per task" rather than raw benchmarks.

---

## 6. Adding DeepSeek V4 — effort, account binding (Q3–Q5)

*(Grounded in a code map of the provider seam, 2026-08-23.)*

### Headline: DeepSeek is **already a registered provider** (just not exposed/verified/default)
It's a full entry in the shared **`wegofwd-llm`** registry (`registry.py` `PROVIDER_REGISTRY`),
`openai_compatible=True`, base_url `https://api.deepseek.com/v1`, key env `DEEPSEEK_API_KEY`.
It runs through the shared `OpenAICompatibleProvider` — **no new adapter code**. It's held
back only because its `default_model`/`base_url` are marked **UNVERIFIED** and it isn't in
the mobile picker or the managed vault. (DeepSeek's API is OpenAI-format — `deepseek-v4-pro`
/ `deepseek-v4-flash`, 5M free tokens to start. [[NxCode]])

### Q3 — Effort to add DeepSeek V4 + make it the default
The **plumbing is hours, not weeks**; the real cost is verification, not code:

| Piece | What | Where | Size |
|---|---|---|---|
| **A. Verify the registry entry** | Set real `default_model` (`deepseek-v4-pro`), confirm base_url, flip `model_verified=True`, set capabilities | **External `wegofwd-llm` package** (edit via `pip install -e ../wegofwd-llm`, then release + bump the pin in `backend/requirements.txt`) | small code, but needs a **package release** |
| **B. Expose in BYOK** | Append one object to `PROVIDERS` + a `providerGuides.ts` "get a key" entry | `mobile/src/constants/providers.ts`, `providerGuides.ts` | ~1 file each — lights up Settings tabs, picker, key store, help |
| **C. Make it default** (optional) | Change ~6 default constants | `ROLE_DEFAULTS` (registry), `provider_id="anthropic"` in `trust/schemas.py` (×2) + GenerateBookIn, `backend/config.py`, mobile `DEFAULT_PROVIDER_ID` + `DEFAULT_GENERATION_PARAMS.provider` + `buildGenerateRequest` fallback | small, mechanical |
| **D. Managed (optional)** | Add `managed_deepseek_api_key` + one line in the vault candidate tuple | `backend/config.py`, `backend/src/billing/vault.py` | 2 files + **legal/ToS + we hold a DeepSeek account** |
| **E. Account/DB** | — | none | **no migration** (rows-not-columns) |

> **The load-bearing work is a real eval, not the edits.** Leaderboards ≠ our job:
> before trusting DeepSeek for whole-book / trust-artifact / diagram generation, run our
> structured-output + SVG/Mermaid + KaTeX conformance test (the same reason `model_verified`
> exists). That verification — plus a `wegofwd-llm` package release to flip the flag — is the
> bulk of the effort. **BYOK-only, not default ≈ a day** (verify + expose). **Default + managed
> ≈ more**, gated on the eval + ToS + cost tracking.

### Q4 — Is a user account tied to a specific LLM?
**No.** Provider is chosen **per-book / per-request**, never locked to the account.
- The account's `ProviderCredential` is a **registry-keyed set (rows, not columns)** — each row
  holds only `{provider_id, source, status}`, **no key material and no "chosen provider" field**
  (ADR-014 D2). Adding a provider needs **no DB migration**.
- Generation defaults (`{provider, model}`) live **device-local** (AsyncStorage
  `sbq_default_gen_params`), with a **per-book override** (`Book.generationParams`).
- Different users **and** different books can use different providers freely. ADR-016
  ("one provider per piece of content") is a **product/voice** pin — a book is pinned to one
  provider *at a time* for consistency, and provenance is stamped per unit — **not a technical
  lock**; the user can change it. Managed eligibility (`is_pro`) gates *whether* you may use the
  managed path, and is **provider-agnostic**.

### Q5 — Do we need an account on DeepSeek's end?
**Yes — someone needs a DeepSeek platform account + API key.** Which "someone" depends on path:
- **BYOK:** the **user** makes their own DeepSeek account + key (5M free tokens, no card) and
  pastes it in Settings. Mentible stores nothing server-side; the key is device-local + passed
  through per request. This is the low-effort, low-liability path.
- **Managed (we serve it):** **we** hold a DeepSeek business account + key in the vault
  (`managed_deepseek_api_key`), carry the token cost (cheap — ~$0.22–0.66 / 1M input [[NxCode]]),
  and track spend against the plan allowance.
- ⚠️ **Compliance flag for the managed path:** DeepSeek is a **China-based** provider — data
  residency / privacy review is required before routing paying users' **private sources** through
  it on the managed path (ADR-005 O4 / our "your sources stay yours" posture). For **BYOK**, the
  user opts in themselves, so the bar is lower.

## 7. Open questions / decision checklist (before swapping the default LLM)

The registry/config edits (§6) are easy; these are the decisions that determine whether
adopting a new default LLM (e.g. DeepSeek V4) is actually safe. **The three that gate a
"yes" are marked ⭐.**

### 🔴 Quality / fitness (the real gate)
1. **⭐ Does it pass *our* eval?** Not chat-Elo — our **structured JSON**, **SVG/Mermaid
   diagrams**, **KaTeX**, and **long-form book coherence**. Define the pass bar + the sample
   set. (This is exactly why `model_verified=false` today.)
2. **Default everywhere, or default per role?** The seam already has `ROLE_DEFAULTS`
   — DeepSeek could be default for cheap **fast-draft / TOC** while Anthropic stays for
   **whole-book / trust artifacts**. Single default vs mixed routing is a product call.
3. **Capability parity:** does it reliably do **JSON mode + tool-use** at our
   **16 384 max_tokens** and context needs? (Registry lists 64k ctx for DeepSeek.)

### 🟠 Ops / economics / trust
4. **⭐ Managed cost & margin:** DeepSeek is ~10× cheaper than Anthropic — does that change
   the plan allowance / fair-use caps (D18)? What's break-even?
5. **⭐ Data privacy / residency:** DeepSeek is **China-based** — does their API
   **train on / retain inputs**, and can we contractually disable that for the **managed**
   path? Directly hits the "your sources stay yours" posture (ADR-005 O4).
6. **Reliability:** rate limits, uptime, region latency, and **peak-hour pricing** windows —
   acceptable for a paid product?

### 🟡 Implementation / lifecycle
7. **Failure fallback:** today the pipeline does 3× retry then fails — do we want
   **cross-provider fallback** (e.g. DeepSeek → Anthropic) on malformed JSON / outage? (Biggest
   reliability upgrade regardless of which model wins.)
8. **Version pinning + re-verify:** DeepSeek versions churn (`v4-flash-0731`, `v4-pro-0813`)
   — process to pin a model + re-run the eval on each bump (ties to `model_verified` +
   integration/contract version).
9. **Migration of existing content:** changing the default doesn't touch existing device-local
   defaults or already-pinned books — is that intended? How does a mid-book provider change
   interact with ADR-016 voice consistency?
10. **Disclosure:** do we surface *which model* generated content (provenance / `recorded_via`),
    especially for trust artifacts?

## Sources

- [[BFA]] Build Fast with AI — *Best Open-Source LLMs 2026 (Qwen, GLM, DeepSeek, Llama)*: https://www.buildfastwithai.com/blogs/collection/open-source-llms
- [[Vellum]] Vellum — *Open Source LLM Leaderboard 2026*: https://www.vellum.ai/open-llm-leaderboard
- [[LLMStats]] llm-stats — *Open LLM Leaderboard*: https://llm-stats.com/leaderboards/open-llm-leaderboard
- [[TechJacks]] Tech Jacks — *Top 10 Open-Weight LLMs 2026 (Arena Elo)*: https://techjacksolutions.com/ai-tools/rankings/top-open-weight-llms/
- [[AA]] Artificial Analysis — *LLM Leaderboard (Intelligence Index, price, speed)*: https://artificialanalysis.ai/leaderboards/models
- [[LMArena]] LMArena / Chatbot Arena: https://lmarena.ai/
- [[DataLearner]] DataLearner — *AI Model Leaderboard*: https://www.datalearner.com/en/leaderboards
- [[OR]] OpenRouter — *Free LLM APIs in 2026 compared*: https://openrouter.ai/blog/tutorials/free-llm-apis-compared/
- [[Flywheel]] We The Flywheel — *Best Free LLM API Tiers 2026 (Groq, Cerebras, GitHub Models)*: https://wetheflywheel.com/en/ai-model-access/free-llm-api-tiers-2026/
- HuggingFace — *Open-weight models to run locally in 2026*: https://huggingface.co/blog/daya-shankar/open-source-llm-models-to-run-locally
- [[NxCode]] NxCode — *DeepSeek V4 API Guide: Pricing, Setup & Code (2026)*: https://www.nxcode.io/resources/news/deepseek-v4-api-guide-pricing-setup-2026

*(Reference note prepared from web sources dated to mid-2026; verify current versions/scores at the live leaderboards above.)*
