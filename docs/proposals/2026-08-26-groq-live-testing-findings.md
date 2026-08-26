# Groq Managed Default — Live-Testing Findings & Status

> **Status:** Findings + status log (as of 2026-08-26 EOD). **Continue tomorrow.**
> **Context:** the Groq free generation default (PR #486) shipped to prod; a real smoke
> test against a live Groq key then surfaced two things the mocked test suite could not.
> **Companions:** `2026-08-25-groq-default-testing-phase.md` ·
> `2026-08-25-groq-implementation-prerequisites.md` · `2026-08-25-production-hosting-options.md`.

---

## 0. TL;DR

- **The managed-Groq generation path works** — a real lesson generates end-to-end
  (managed key → Groq → Qwen 3.8-27b → schema-validated `LessonOutput`).
- **Two real bugs the green tests missed, both caught by live testing:**
  1. Registry default model **`llama-3.3-70b-versatile` is dead (HTTP 404)** — Groq removed
     Llama *chat* models. Fixed with an app-level override to **`qwen/qwen3.8-27b`**.
  2. Groq **free tier = 8000 tokens/minute (input+output) per org** — our 8000 output clamp
     leaves no room for the ~2000-token prompt → **HTTP 413**. Fixed by capping Groq output to
     **5000** (`groq_max_output_tokens`).
- **Free-tier managed Groq is viable for light single-lesson testing only.** A **whole book**
  (many topics) still throttles per-minute (~1 generation/min) → **the Dev tier is the real fix
  for volume.**
- **Shipped to `main`:** PR #486 (`dcb0204`, default + wiring) + PR #487 (`91bd9a0`, free-tier
  cap). **Prod is deployed at `dcb0204`** — it does **not** yet have the #487 cap fix.

---

## 1. What was tested

A real end-to-end smoke of `backend/src/generate/tasks.run_generation(managed=True,
provider_id="groq")` against a live Groq API key — driven with **fakeredis** (no Redis/Celery/auth),
run from repo root with `PYTHONPATH=.` and dummy `BYOK_MASTER_KEY`/`SYSTEM_OWNER_SECRET`. This
exercises the actual path: managed-key resolve → build the real lesson prompt → call Groq →
validate `LessonOutput`. Scratchpad scripts: `groq_smoke.py` (single lesson), `groq_book_smoke.py`
(multi-topic book), `groq_probe.py` (direct provider call).

## 2. Finding A — the registry's default Groq model is dead (404)

- `wegofwd-llm` registry `groq.default_model = "llama-3.3-70b-versatile"` → **HTTP 404**. Groq
  dropped Llama *chat* models; the live catalog for the key is `openai/gpt-oss-120b/20b`,
  `qwen/qwen3.6-27b`, `qwen/qwen3.8-27b` (plus Llama *guard* models, not for chat).
- **`openai/gpt-oss-*` fail strict `json_object` mode** (`json_validate_failed`) — reasoning models
  leak non-JSON. **`qwen/qwen3.8-27b` returns clean JSON** and produced a full valid lesson.
- **Why tests missed it:** every unit test mocks the provider, so the dead id never hits the wire.
- **Fix (PR #486, option-b app override):** `settings.groq_default_model` (default
  `qwen/qwen3.8-27b`), applied in `run_generation` when a groq request has no explicit model.
  Avoids a `wegofwd-llm` package release (registry is git-pinned `@v0.2.0`). **A proper registry fix
  is deferred to a package bump.**

## 3. Finding B — free-tier TPM makes the output clamp 413

- Groq **free tier `on_demand` = ~8000 tokens/minute (input + output), per org**, enforced two ways:
  - **Per request (413):** the provider clamps output to the registry ceiling **8000**, which
    *equals* the TPM. So `8000 output + ~2000-token lesson prompt = ~8047 > 8000` → **413 before
    generating**. (Measured: the lesson prompt is ~2047 tokens / 8188 chars.)
  - **Cumulative (429):** the whole 8000/min budget is shared, so after ~one generation the next
    call that minute is rate-limited.
- **Fix (PR #487):** `settings.groq_max_output_tokens` (default **5000**), applied for groq in
  `run_generation`: `2000 + 5000 = 7000 < 8000`. **Verified live** — a real lesson now generates on
  the free-tier key (was 413). Config-tunable; **raise or set 0 on a paid Dev tier**.
- **Residual (not fixed, inherent to the free tier):** a **whole book** = many topics in a short
  window → cumulative 429. Free-tier managed Groq ≈ **one short generation per minute**.

## 4. The two keys (an operational note)

The local `.env` briefly held two different Groq keys — `GROQ_KEY` (a **higher-TPM org**, which is
why the very first smoke succeeded) and `MENTIBLE_GROQ_KEY` (**free `on_demand`, TPM 8000**). Per
the user's instruction the higher-tier `GROQ_KEY` was deleted (and its backup removed), leaving the
free-tier key locally. `MANAGED_GROQ_API_KEY` in prod `.env.demo` is whatever was set there — its
**tier determines whether prod hits the 413/429 wall**. For real whole-book testing, prod should use
a **Dev-tier** key.

## 5. What is shipped vs deployed

| Change | PR | On `main` | On prod |
|---|---|---|---|
| Groq free generation default + managed-key wiring (`GROQ_KEY`/`MENTIBLE_GROQ_KEY` alias) | #486 | ✅ `dcb0204` | ✅ `dcb0204` |
| App-level model override → `qwen/qwen3.8-27b` (llama 404 fix) | #486 | ✅ | ✅ |
| Free-tier output cap `groq_max_output_tokens=5000` (413 fix) | #487 | ✅ `91bd9a0` | ❌ **not yet** |

- **Prod backend** = `dcb0204` (has the model override, **not** the cap fix). **Web both surfaces**
  + **APK vc58/0.2.46** are live at the client defaults (Groq generation default).
- ⚠ **If prod's managed key is free-tier, prod currently 413s** on generation until the #487 cap
  fix is deployed.

## 6. Next — continue tomorrow

**Decisions:**
1. **Groq tier for the managed key** — put a **Dev-tier** key in prod `.env.demo`
   `MANAGED_GROQ_API_KEY` (recommended; cents-level, lifts TPM so whole books work), or accept
   free-tier's ~1-generation/minute limit. Recover/replace the higher-tier key (the deleted
   `GROQ_KEY`) from the Groq console.
2. **Prod redeploy** — refresh prod backend to `91bd9a0` (picks up the #487 cap fix). Bundle it with
   the Dev-tier key change so it's one refresh. (Runbook: `Plans/PROD_BACKEND_REFRESH_TO_MAIN.md`;
   no new migration.)
3. **The real prod test** — sign in as a `MANAGED_PLAN_EMAILS` account and generate a lesson (and,
   on a Dev-tier key, a whole book) — the first authenticated live run.

**Deferred follow-ups (still open):**
- **429/rate-limit handling** in `run_generation` (friendly "busy, retry" + backoff) — the free-tier
  cumulative throttle makes this more relevant.
- **`wegofwd-llm` registry release** to fix `groq.default_model` (retire the app override).
- **Trust two-lane setting** (`2026-08-25-trust-model-setting-design.md`) — ready to build after its
  forks are decided.
- **Second free model** (qwen3.6-27b / gpt-oss) — the original "Llama second option" is moot (Groq
  dropped Llama chat).
- **Groq provider-label copy** (still says "get a key" — misleading for the keyless managed default).

---

*Prepared 2026-08-26. Verified against a live Groq key; scratchpad smoke scripts under the session
scratchpad. Backend suites green (534 passed) through PR #487.*
