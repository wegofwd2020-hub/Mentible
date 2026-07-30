# Derivatives — Short-Form Post Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/v1/derivatives/post` — turn `source_text` + a platform into 3 schema-validated social-post variants via the existing pipeline LLM seam, inline (no job), managed/BYOK, provenance-tagged.

**Architecture:** A new `backend/src/derivatives/` module (`schemas`, `prompt`, `generate`, `router`) that mirrors `/generate`'s key-handling + `build_provider`/`generate_validated` + prompt idiom, but runs **inline** (the BYOK key never leaves the request handler; no Redis job/poll). Registered in `backend/main.py`.

**Tech Stack:** FastAPI, Pydantic v2, `wegofwd_llm` (`build_provider`/`generate_validated`/`LLMRequest`), pytest + `httpx.AsyncClient` + mocked provider.

**Spec:** `docs/superpowers/specs/2026-07-29-derivatives-post-design.md`.

## Global Constraints

- New files only under `backend/src/derivatives/` + one line in `backend/main.py` + `backend/tests/test_derivatives_post.py`.
- **The BYOK key never touches a log line, the response, or persistence** (ADR-001). Mirror `/generate`'s redaction; add a key-leak test.
- Output validated via `generate_validated(..., max_repairs=2)`; `LLMSchemaError` → HTTP 502.
- Auth: `optional_user` + `enforce_rate_limit` (anonymous BYOK works; managed needs `is_managed_eligible`).
- **Import the shared seam EXACTLY as `backend/src/generate/tasks.py` + `backend/src/generate/router.py` do** — read those files for the precise import paths of `build_provider`, `generate_validated`, `LLMRequest`, `parse_json_response`, `LLMSchemaError`, `is_managed_eligible`, `get_managed_key`, `optional_user`, `enforce_rate_limit`, `Principal`, `settings`, `get_logger`. Do NOT guess module paths — copy them.
- Tests: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_derivatives_post.py -v` (no DB needed — inline, no persistence; `client`+`fake_redis` fixtures from conftest). ruff on PATH (`~/.local/bin/ruff`).

---

### Task 1: `schemas.py` + `prompt.py` + `_DerivativeOutput`

**Files:**
- Create: `backend/src/derivatives/__init__.py` (empty), `backend/src/derivatives/schemas.py`, `backend/src/derivatives/prompt.py`
- Test: `backend/tests/test_derivatives_prompt.py`

**Interfaces:**
- Produces: `Platform`, `DerivativeRequest`, `PostVariant`, `DerivativeResponse`, `_DerivativeOutput`; `build_derivative_prompt(source_text, platform, tone=None) -> str`. Consumed by Tasks 2/3.

- [ ] **Step 1: Read** `backend/src/generate/schemas.py` (the `GenerateRequest` validator idiom for `api_key` prefix + known-provider) and `backend/src/generate/quiz_prompt.py` (the prompt shape).

- [ ] **Step 2: Write the failing test**

```python
# backend/tests/test_derivatives_prompt.py
from backend.src.derivatives.prompt import build_derivative_prompt
from backend.src.derivatives.schemas import DerivativeRequest, DerivativeResponse, PostVariant, _DerivativeOutput
import pytest
from pydantic import ValidationError

def test_prompt_scopes_to_platform_and_source():
    p = build_derivative_prompt("Stormwater basics.", "linkedin")
    assert "Stormwater basics." in p
    assert "linkedin" in p.lower()
    assert "json" in p.lower()  # the "respond with ONLY valid JSON" tail
    x = build_derivative_prompt("Stormwater basics.", "x")
    assert "280" in x  # the X char-limit rule appears

def test_request_validation():
    DerivativeRequest(source_text="hi", platform="linkedin")           # ok, managed (no key)
    DerivativeRequest(source_text="hi", api_key="sk-ant-" + "x" * 20)  # ok, BYOK
    with pytest.raises(ValidationError):
        DerivativeRequest(source_text="")                              # min_length
    with pytest.raises(ValidationError):
        DerivativeRequest(source_text="hi", provider_id="bogus")       # unknown provider

def test_output_model():
    out = _DerivativeOutput.model_validate({"variants": [{"hook": "h", "body": "b", "hashtags": ["#a"], "cta": None}]})
    assert out.variants[0].hook == "h"
```

- [ ] **Step 3: Run to verify failure** — `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_derivatives_prompt.py -v` → FAIL (module missing).

- [ ] **Step 4: Write `schemas.py`** (mirror `GenerateRequest` validators — read them; use the same known-provider registry check + api_key prefix validator, skipped when `api_key is None`)

```python
# backend/src/derivatives/schemas.py
from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, field_validator
# import the provider-registry check the SAME way generate/schemas.py does (for _known_provider)

Platform = Literal["linkedin", "x"]

class DerivativeRequest(BaseModel):
    source_text: str = Field(min_length=1, max_length=20000)
    platform: Platform = "linkedin"
    tone: str | None = None
    api_key: str | None = Field(default=None, min_length=20, max_length=512)
    provider_id: str = "anthropic"
    model: str | None = None
    # @field_validator("provider_id") -> known-provider check (mirror generate/schemas.py _known_provider)
    # @field_validator("api_key") -> prefix matches provider, SKIP when None (mirror _api_key_matches_provider)

class PostVariant(BaseModel):
    hook: str
    body: str
    hashtags: list[str]
    cta: str | None = None

class DerivativeResponse(BaseModel):
    platform: str
    variants: list[PostVariant]
    provenance: str = "ai-generated"

class _DerivativeOutput(BaseModel):
    variants: list[PostVariant]
```

- [ ] **Step 5: Write `prompt.py`** (clone `quiz_prompt.py` shape)

```python
# backend/src/derivatives/prompt.py
from __future__ import annotations

_PLATFORM_RULES = {
    "linkedin": "Professional but human. Each post <= 3000 characters. 3-5 relevant hashtags. End with a clear call to action.",
    "x": "Punchy. Each post (the body) <= 280 characters. 1-2 hashtags. No fluff.",
}

def build_derivative_prompt(source_text: str, platform: str, tone: str | None = None) -> str:
    rules = _PLATFORM_RULES.get(platform, _PLATFORM_RULES["linkedin"])
    tone_line = f"\nTone: {tone}." if tone else ""
    return (
        f"You are a social-media editor. Using ONLY the source material below, write 3 distinct "
        f"{platform} posts that PROMOTE it. Do not invent facts beyond the source; the posts market "
        f"the source, they do not add claims.{tone_line}\n\n"
        f"Platform rules: {rules}\n\n"
        f"SOURCE:\n\"\"\"\n{source_text}\n\"\"\"\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"variants": [{{"hook": "string", "body": "string", "hashtags": ["#tag"], "cta": "string or null"}}]}}\n'
        f"Return exactly 3 variants."
    )
```

- [ ] **Step 6: Run to verify pass** — same command → PASS.

- [ ] **Step 7: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/derivatives tests/test_derivatives_prompt.py && ruff format --check src/derivatives tests/test_derivatives_prompt.py
git add backend/src/derivatives/__init__.py backend/src/derivatives/schemas.py backend/src/derivatives/prompt.py backend/tests/test_derivatives_prompt.py
git commit -m "feat(derivatives): schemas + platform-scoped post prompt (ADR-037 D8)"
```

---

### Task 2: `generate.py` — inline validated generation

**Files:**
- Create: `backend/src/derivatives/generate.py`
- Test: `backend/tests/test_derivatives_generate.py`

**Interfaces:**
- Consumes: `schemas`/`prompt` (Task 1); the pipeline seam (`build_provider`/`generate_validated`/`LLMRequest`/`parse_json_response`/`LLMSchemaError` — imported as in `generate/tasks.py`).
- Produces: `generate_post(*, source_text, platform, tone, provider_id, api_key, model) -> DerivativeResponse`; raises `LLMSchemaError` on validation exhaustion (the router maps it to 502).

- [ ] **Step 1: Read** `backend/src/generate/tasks.py` for the exact imports + the `generate_validated(provider, LLMRequest(...), _validate, max_repairs=...)` call shape + how `parse_json_response` is used.

- [ ] **Step 2: Write the failing test** (patch `build_provider`)

```python
# backend/tests/test_derivatives_generate.py
import json
from unittest.mock import patch
import pytest
from backend.tests.helpers import fake_provider
from backend.src.derivatives.generate import generate_post

_GOOD = json.dumps({"variants": [
    {"hook": "h1", "body": "b1", "hashtags": ["#a"], "cta": "Read more"},
    {"hook": "h2", "body": "b2", "hashtags": ["#b"], "cta": None},
    {"hook": "h3", "body": "b3", "hashtags": [], "cta": None},
]})

def test_generate_post_returns_variants():
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(text=_GOOD)):
        out = generate_post(source_text="Stormwater.", platform="linkedin", tone=None,
                            provider_id="anthropic", api_key="sk-ant-xxxxxxxxxxxxxxxxxxxx", model="claude-sonnet-4-6")
    assert out.platform == "linkedin"
    assert len(out.variants) == 3 and out.variants[0].hook == "h1"
    assert out.provenance == "ai-generated"

def test_generate_post_repairs_then_succeeds():
    with patch("backend.src.derivatives.generate.build_provider",
               return_value=fake_provider(responses=["not json", _GOOD])):
        out = generate_post(source_text="s", platform="x", tone=None,
                            provider_id="anthropic", api_key="sk-ant-xxxxxxxxxxxxxxxxxxxx", model="claude-sonnet-4-6")
    assert len(out.variants) == 3

def test_generate_post_raises_on_bad_output():
    from wegofwd_llm import LLMSchemaError  # import path per tasks.py
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(text="never json")):
        with pytest.raises(LLMSchemaError):
            generate_post(source_text="s", platform="linkedin", tone=None,
                          provider_id="anthropic", api_key="sk-ant-xxxxxxxxxxxxxxxxxxxx", model="claude-sonnet-4-6")
```
(Adjust `fake_provider`'s kwargs + the `LLMSchemaError` import path to match `tests/helpers.py` / `generate/tasks.py` exactly — read them.)

- [ ] **Step 3: Run to verify failure** — `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_derivatives_generate.py -v` → FAIL.

- [ ] **Step 4: Write `generate.py`** (mirror `tasks.py`'s validate+generate)

```python
# backend/src/derivatives/generate.py
from __future__ import annotations
# import build_provider, generate_validated, LLMRequest, parse_json_response EXACTLY as generate/tasks.py does
from .prompt import build_derivative_prompt
from .schemas import DerivativeResponse, _DerivativeOutput

_MAX_REPAIRS = 2
_MAX_TOKENS = 2048

def generate_post(*, source_text: str, platform: str, tone: str | None,
                  provider_id: str, api_key: str, model: str) -> DerivativeResponse:
    prompt = build_derivative_prompt(source_text, platform, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _DerivativeOutput:
        return _DerivativeOutput.model_validate(parse_json_response(text))

    out = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
    return DerivativeResponse(platform=platform, variants=out.variants, provenance="ai-generated")
```

- [ ] **Step 5: Run to verify pass** — same command → PASS.

- [ ] **Step 6: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/derivatives/generate.py tests/test_derivatives_generate.py && ruff format --check src/derivatives/generate.py tests/test_derivatives_generate.py
git add backend/src/derivatives/generate.py backend/tests/test_derivatives_generate.py
git commit -m "feat(derivatives): inline validated post generation (ADR-037 D8)"
```

---

### Task 3: `router.py` — the endpoint + key selection + registration

**Files:**
- Create: `backend/src/derivatives/router.py`
- Modify: `backend/main.py` (register)
- Test: `backend/tests/test_derivatives_post.py`

**Interfaces:**
- Consumes: `generate_post` (Task 2); `optional_user`/`enforce_rate_limit`/`Principal`/`is_managed_eligible`/`get_managed_key`/`settings` (imported as in `generate/router.py`).
- Produces: `POST /api/v1/derivatives/post` → `DerivativeResponse`.

- [ ] **Step 1: Read** `backend/src/generate/router.py` for the exact imports (`optional_user`, `enforce_rate_limit`, `is_managed_eligible`, `get_managed_key`, `settings`, `Principal`), the `managed = body.api_key is None` selection, and the generic-400 for ineligible keyless callers. Read `backend/main.py` L112 area for the `include_router` idiom.

- [ ] **Step 2: Write the failing endpoint test** (mirror `test_generate_e2e.py`, but INLINE — no poll)

```python
# backend/tests/test_derivatives_post.py
import json
from unittest.mock import patch
import pytest
from backend.tests.helpers import fake_provider

_GOOD = json.dumps({"variants": [
    {"hook": f"h{i}", "body": f"b{i}", "hashtags": ["#x"], "cta": None} for i in range(3)]})

pytestmark = pytest.mark.asyncio

async def test_byok_post_ok_and_key_never_leaks(client, known_test_api_key):
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(text=_GOOD)):
        r = await client.post("/api/v1/derivatives/post",
                              json={"source_text": "Stormwater.", "platform": "linkedin", "api_key": known_test_api_key})
    assert r.status_code == 200
    body = r.json()
    assert len(body["variants"]) == 3 and body["provenance"] == "ai-generated" and body["platform"] == "linkedin"
    assert known_test_api_key not in json.dumps(body)   # key never in the response

async def test_managed_ineligible_400(client):
    # no api_key + anonymous → not managed-eligible → generic 400, no key material
    r = await client.post("/api/v1/derivatives/post", json={"source_text": "s"})
    assert r.status_code == 400

async def test_platform_x_reaches_generation(client, known_test_api_key):
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(text=_GOOD)) as bp:
        r = await client.post("/api/v1/derivatives/post",
                              json={"source_text": "s", "platform": "x", "api_key": known_test_api_key})
    assert r.status_code == 200 and r.json()["platform"] == "x"

async def test_bad_output_502(client, known_test_api_key):
    with patch("backend.src.derivatives.generate.build_provider", return_value=fake_provider(text="never json")):
        r = await client.post("/api/v1/derivatives/post",
                              json={"source_text": "s", "api_key": known_test_api_key})
    assert r.status_code == 502

async def test_empty_source_422(client, known_test_api_key):
    r = await client.post("/api/v1/derivatives/post", json={"source_text": "", "api_key": known_test_api_key})
    assert r.status_code == 422
```
(If `is_managed_eligible(None, "anthropic")` is actually True in the test env, adjust `test_managed_ineligible_400` per how `/generate`'s own tests assert the managed-ineligible path — read them.)

- [ ] **Step 3: Run to verify failure** — `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_derivatives_post.py -v` → FAIL (404).

- [ ] **Step 4: Write `router.py`**

```python
# backend/src/derivatives/router.py
from __future__ import annotations
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status
# import optional_user, enforce_rate_limit, Principal, is_managed_eligible, get_managed_key, settings,
#   get_logger, LLMSchemaError EXACTLY as generate/router.py + tasks.py do
from .generate import generate_post
from .schemas import DerivativeRequest, DerivativeResponse

router = APIRouter(prefix="/api/v1/derivatives", tags=["derivatives"])
log = get_logger(__name__)

@router.post("/post", response_model=DerivativeResponse, dependencies=[Depends(enforce_rate_limit)])
async def make_post(
    body: DerivativeRequest,
    principal: "Principal | None" = Depends(optional_user),
) -> DerivativeResponse:
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "managed generation unavailable")
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    model = body.model or settings.anthropic_default_model
    try:
        return await asyncio.to_thread(
            generate_post,
            source_text=body.source_text, platform=body.platform, tone=body.tone,
            provider_id=body.provider_id, api_key=api_key, model=model,
        )
    except LLMSchemaError:
        log.warning("derivative_validation_failed", platform=body.platform)  # NO key/body
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "generated content failed validation")
```
(Match the managed-eligibility signature + any DB/account resolution `/generate` does for the managed path — read `generate/router.py`; if it needs `db_pool`/account, mirror only what's necessary, keeping the generic-400 for ineligible. Never log/return the key.)

- [ ] **Step 5: Register in `backend/main.py`** — add next to the other routers:

```python
from backend.src.derivatives import router as derivatives_router  # match the sibling import style
...
app.include_router(derivatives_router.router)
```

- [ ] **Step 6: Run to verify pass** — same command → PASS (BYOK ok + key-leak, managed-400, platform x, bad-output 502, empty-source 422).

- [ ] **Step 7: Lint + commit**

```bash
cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/derivatives tests/test_derivatives_post.py main.py && ruff format --check src/derivatives tests/test_derivatives_post.py main.py
git add backend/src/derivatives/router.py backend/main.py backend/tests/test_derivatives_post.py
git commit -m "feat(derivatives): POST /api/v1/derivatives/post endpoint + registration (ADR-037 D8)"
```

---

## Final verification

- [ ] Whole derivatives suite: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_derivatives_*.py -v` — all pass.
- [ ] **Key-leak gate:** the BYOK key appears in no response and no log line (the `known_test_api_key not in json.dumps(body)` assertion + manual grep of the endpoint for any `log.*(body)`/`api_key` logging).
- [ ] Lint: `cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/derivatives tests/test_derivatives_*.py`.
- [ ] `main.py` adds exactly one `include_router`; no other router touched. Endpoint is inline (no Redis job / no `/jobs` poll added).
