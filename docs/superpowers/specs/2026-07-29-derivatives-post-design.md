# Derivatives — Short-Form Post Generation — Design Spec

**Status:** Approved (2026-07-29) · **ADR-037 D8 (d1 = the "Share" phase)** · first slice of the Short-Form Publishing Studio ([#338] proposal, on main).
**Scope:** one backend endpoint — `POST /api/v1/derivatives/post` — that turns **source text** into a **platform-scoped social post** (text only) via the existing `pipeline/` LLM seam. Backend + tests only; **no render infra, no UI, no persistence**. Text-only P1a; banner/carousel/audio and the mobile "Make a post" action are later slices.

## Why this slice
It's the exact workflow that motivated #338 (a source → a LinkedIn post), reuses the scoped-LLM IP + the ADR-005 managed/BYOK key handling, adds **zero new infra** (no Chromium render, no TTS), and is fully testable with a mocked provider. It proves the source-native moat cheaply and gives the trust loop its "Share" seam (an approved version's content → a post).

## Grounding — mirror `/generate` exactly (verified)
- **Key handling (ADR-005):** `managed = body.api_key is None`. BYOK key in the request body (never logged, never persisted — see below); managed reads `billing/vault.get_managed_key(provider_id)` after `billing/eligibility.is_managed_eligible(principal, provider_id)`. Redaction via `core/log_redaction.get_logger()` + the app's 422 scrubber.
- **Provider seam:** `build_provider(provider_id, api_key, model)` → `wegofwd_llm.conformance.generate_validated(provider, LLMRequest(prompt, max_tokens, response_format="json"), _validate, max_repairs=2)` (1 + 2 = 3 attempts, per CLAUDE.md).
- **Prompt idiom:** clone `backend/src/generate/quiz_prompt.py` (single `source_text` → "return ONLY valid JSON matching this schema").
- **Auth:** `optional_user` + `enforce_rate_limit` (like `/generate`) — anonymous BYOK works; only the managed path needs an identity + eligibility.
- **Model/tokens:** `settings.anthropic_default_model` (`claude-sonnet-4-6`); a post is short → `max_tokens = 2048`.
- **Tests:** patch `build_provider` with `tests/helpers.fake_provider(text=...)`, `fake_redis` + `client` fixtures; assert the BYOK key never appears in the response/logs.

## The KEY difference from `/generate`: this endpoint is INLINE
`/generate` is an async job (minutes-long lessons → `202` + poll). A social post is one small, fast LLM call — so this endpoint runs **inline** and returns the post in the response body. Consequences:
- **No Redis job, no `BackgroundTasks`, no `/jobs/{id}` poll.** Simpler + better UX.
- **The BYOK key is used entirely within the request handler** (passed to `build_provider`, used, dropped) and is **never written to Redis** — strictly *safer* than `/generate`'s envelope path. Still: never logged, never in the response.
- Managed path reads `get_managed_key` inline.

## Global Constraints
- New module `backend/src/derivatives/` (`router.py`, `schemas.py`, `prompt.py`, `generate.py`). Register in `backend/main.py`. Reuse `pipeline`/`wegofwd_llm`/`billing`/`core` — no new deps.
- The BYOK key never touches a log line, the response, or persistence (ADR-001). Mirror `/generate`'s redaction + the key-leak test.
- Output is **schema-validated** through `generate_validated` (retry ≤2), like lessons/quizzes.
- App-level: `optional_user` + `enforce_rate_limit`. Managed requires eligibility; ineligible keyless caller → 400 (mirror `/generate`).

---

## Request / response

```python
# backend/src/derivatives/schemas.py
Platform = Literal["linkedin", "x"]   # extensible; NEW axis (orthogonal to OutputFormat)

class DerivativeRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=20000)
    platform: Platform = "linkedin"
    tone: str | None = None                      # optional style hint
    api_key: str | None = Field(default=None, min_length=20, max_length=512)  # None ⇒ managed
    provider_id: str = "anthropic"
    model: str | None = None
    # validators mirror GenerateRequest: known provider; api_key prefix matches provider (skip when None)

class PostVariant(BaseModel):
    hook: str
    body: str
    hashtags: list[str]
    cta: str | None = None

class DerivativeResponse(BaseModel):
    platform: str
    variants: list[PostVariant]      # e.g. 3
    provenance: str = "ai-generated" # the #338 discipline — always present
```

## Endpoint (`backend/src/derivatives/router.py`)
`router = APIRouter(prefix="/api/v1/derivatives", tags=["derivatives"])`; registered in `main.py`.

```python
@router.post("/post", response_model=DerivativeResponse, dependencies=[Depends(enforce_rate_limit)])
async def make_post(
    body: DerivativeRequest,
    principal: Principal | None = Depends(optional_user),
) -> DerivativeResponse:
    # 1. key selection (mirror generate/router.py)
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(400, "managed generation unavailable")   # generic (no key echo)
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    model = body.model or settings.anthropic_default_model
    # 2. generate inline (offloaded to a thread; validated + repaired)
    result = await generate_post(
        source_text=body.source_text, platform=body.platform, tone=body.tone,
        provider_id=body.provider_id, api_key=api_key, model=model,
    )
    return result   # DerivativeResponse
```

## Generation (`backend/src/derivatives/generate.py`)
```python
def generate_post(*, source_text, platform, tone, provider_id, api_key, model) -> DerivativeResponse:
    prompt = build_derivative_prompt(source_text, platform, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=2048, response_format="json")
    def _validate(text): return _DerivativeOutput.model_validate(parse_json_response(text))
    out = generate_validated(provider, req, _validate, max_repairs=2)   # raises LLMSchemaError on exhaustion
    return DerivativeResponse(platform=platform, variants=out.variants, provenance="ai-generated")
```
Wrapped with `asyncio.to_thread(...)` at the router (the provider call is sync, like tasks.py). `_DerivativeOutput` is a Pydantic model = `{ variants: list[PostVariant] }` (3 variants). On `LLMSchemaError` → `HTTPException(502, "generated content failed validation")`. On provider/auth error → map like `/generate` (401/502), never echoing the key.

## Prompt (`backend/src/derivatives/prompt.py`)
`build_derivative_prompt(source_text, platform, tone=None) -> str` — clone the `quiz_prompt` shape:
- "Using ONLY the source below, write 3 distinct {platform} posts that promote it." Platform rules injected (LinkedIn: professional, ≤3000 chars, 3–5 hashtags, a clear CTA; X: ≤280 chars/post, 1–2 hashtags, punchy). Optional `tone`.
- Ends with: "Respond with ONLY valid JSON matching this schema: {variants:[{hook, body, hashtags:[..], cta}]}".
- No fabrication beyond the source; the post promotes the source, doesn't invent facts.

## Testing (`backend/tests/test_derivatives_post.py`)
Mirror `test_generate_e2e.py` — `client` + `fake_redis`, patch `backend.src.derivatives.generate.build_provider` with `fake_provider(text=_FAKE_DERIVATIVE_JSON)`:
- **BYOK happy path:** POST with `api_key` → 200, `variants` length 3, `provenance == "ai-generated"`, `platform == "linkedin"`.
- **Key never leaks:** `known_test_api_key not in json.dumps(response.json())` (and not logged).
- **Schema repair/failure:** a fake provider returning bad-then-good JSON validates (repair); always-bad → 502.
- **Managed ineligible:** no `api_key`, no/ineligible principal → 400 (generic, no key material).
- **Platform X:** `platform:"x"` → the X prompt path (assert the request reached generate with platform "x").
- **Validation:** empty `source_text` → 422; unknown `provider_id` → 422 (mirror GenerateRequest validators).

## Out of scope (later slices)
- Banner / image render (the Chromium rasterizer) — P1b.
- Carousel, animated (SVG→video), audio (TTS) — P2–P4.
- The mobile "Make a post" UI (a `derivativesClient` + a source-picker action) — its own slice.
- Direct-publish, reference inputs (FR-1b), brand kit, saving/library, metering rows.
- Fetching source from a trust-version-id (client passes `source_text`).

## Open items (resolve in the plan, non-blocking)
1. Variant count fixed at 3 (could be a request field later) — spec fixes 3.
2. Whether managed usage should record a `usage_event` (like `/generate`) — deferred (no metering this slice; note it).
3. `tone` free-text vs an enum — spec keeps it optional free-text passed into the prompt.
