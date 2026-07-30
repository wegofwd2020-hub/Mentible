# Trust Create — Source-Cited Draft into a Version — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A trust endpoint that generates a bounded, source-cited draft (3–6 attributed sections) from a project's captured inputs into a new `artifact_version`, plus a mobile "Generate a draft" owner action replacing the empty-version stub.

**Architecture:** Mirror the `/derivatives` inline-generation seam (`build_provider → generate_validated`, BYOK/managed key split) inside the trust router. The draft is drawn from `project_repo.list_inputs` (Capture), attributed per section to those inputs, and stored via `artifact_repo.create_version` (`content` = sections, `generation_meta` = provenance). Inline (seconds), not the async job queue.

**Tech Stack:** FastAPI + asyncpg, Pydantic v2, `wegofwd_llm` seam, React Native + Expo, Jest/RNTL.

## Global Constraints
- **The BYOK key never touches a log line, the response, or persistence** (ADR-001) — used only inside the `asyncio.to_thread(generate_draft, ...)` call, exactly like `/derivatives`. Mirror its redaction + key-leak test.
- **Owner-only** generation (`_require_role(..., need_owner=True)`); **≥1 source required** (empty inputs → 422). No repo/migration changes (reuse `list_inputs`, `create_version`, `project_id_for_artifact`).
- **Bounded inline** — `_MAX_TOKENS=4096`, 3–6 sections; no job queue, no metering, per-**section** attribution (not per-claim).
- **Key handling mirrors `/derivatives`** — `managed = api_key is None`; managed → `is_managed_eligible` else generic 400 + `get_managed_key`; else BYOK; `model = body.model or settings.anthropic_default_model`. Error cascade: `LLMSchemaError`/`LLMError`/`Exception`→502, `LLMAuthError`→502 (key-free), `LLMRateLimitError`→429.
- **Backend endpoint tests (Task 2) run in CI** (`skipif(not DATABASE_URL)`; local test-DB pw rotated, PG containerized). Tasks 1/3/4/5 need no DB. For Task 2, write the tests + `pytest --collect-only` + let CI run them.
- **Backend:** ruff at `~/.local/bin/ruff` (`export PATH="$HOME/.local/bin:$PATH"`); CI runs `ruff format --check backend/` over the WHOLE dir → `ruff format` every changed backend file (incl. tests) before commit.
- **Mobile:** `npm test`; `npx tsc --noEmit` (baseline 0); **`npx eslint <files>` before each commit** (CI lints).
- **Help DoD gate:** a new FEATURES key needs a matching topic (`__tests__/help/coverage.test.ts`).

---

### Task 1: Backend generation core — prompt + schemas + `generate_draft` (no DB)

**Files:**
- Create: `backend/src/trust/draft_prompt.py`, `backend/src/trust/generate.py`
- Modify: `backend/src/trust/schemas.py` (add `DraftGenerateIn`)
- Test: `backend/tests/test_trust_draft.py`

**Interfaces:**
- Consumes: `wegofwd_llm` (`generate_validated`, `LLMRequest`, `build_provider`), `backend.src.generate.anthropic_caller.parse_json_response`, `PROVIDER_REGISTRY`, `project_repo.ProjectInput` (only its fields, passed in).
- Produces: `build_draft_prompt(sources, artifact_format, topic, audience, goal) -> str`; `generate_draft(*, sources, artifact_format, topic, audience, goal, provider_id, api_key, model) -> _DraftOutput`; `DraftGenerateIn` (`api_key?`, `provider_id`, `model?`); `_DraftOutput{sections:[_DraftSection{heading, body, sources}]}`.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_trust_draft.py` (mirror `tests/test_derivatives_prompt.py` + `test_derivatives_generate.py`; use `tests.helpers.fake_provider`):
```python
import json
import pytest
from backend.src.trust.draft_prompt import build_draft_prompt
from backend.src.trust.generate import generate_draft, _DraftOutput
from backend.src.trust.schemas import DraftGenerateIn
from backend.tests.helpers import fake_provider

class _Src:
    def __init__(self, id, kind, title, content):
        self.id, self.kind, self.title, self.content = id, kind, title, content

_SOURCES = [_Src("11111111-1111-1111-1111-111111111111", "transcript", "Interview", "We size pipes for the 10-year storm.")]

_GOOD = json.dumps({"sections": [
    {"heading": "Design storm", "body": "Pipes are sized for the 10-year storm.", "sources": ["S1"]},
    {"heading": "Why", "body": "It balances cost and risk.", "sources": ["S1"]},
    {"heading": "Takeaway", "body": "Right-size, don't over-build.", "sources": []},
]})

def test_prompt_includes_sources_format_and_json():
    p = build_draft_prompt(_SOURCES, "guide", "stormwater", "engineers", "size pipes")
    assert "10-year storm" in p       # source content present
    assert "guide" in p               # format
    assert "S1" in p                  # labelled source
    assert "json" in p.lower()

def test_generate_draft_returns_sections(monkeypatch):
    monkeypatch.setattr("backend.src.trust.generate.build_provider", lambda *a, **k: fake_provider(text=_GOOD))
    out = generate_draft(sources=_SOURCES, artifact_format="guide", topic="t", audience="a", goal="g",
                         provider_id="anthropic", api_key="sk-ant-" + "x"*20, model="m")
    assert isinstance(out, _DraftOutput)
    assert 1 <= len(out.sections) <= 6
    assert out.sections[0].heading == "Design storm"

def test_request_validation():
    DraftGenerateIn(provider_id="anthropic")  # ok, managed (no key)
    DraftGenerateIn(api_key="sk-ant-" + "x"*20)  # ok, BYOK
    with pytest.raises(Exception):
        DraftGenerateIn(provider_id="bogus")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_trust_draft.py -v`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `draft_prompt.py`**

```python
"""Prompt for a source-cited draft of a trust artifact (ADR-037 Phase 02 Create).

Mirrors derivatives/prompt.py's "use ONLY the sources" discipline, but drafts a
{format} from the expert's captured inputs and attributes each section to the
source label(s) it draws from. Invents nothing beyond the sources.
"""
from __future__ import annotations

def build_draft_prompt(sources, artifact_format, topic, audience, goal) -> str:
    labelled = "\n\n".join(
        f'[S{i+1}] ({s.kind}{": " + s.title if s.title else ""})\n"""\n{s.content}\n"""'
        for i, s in enumerate(sources)
    )
    ctx = []
    if topic: ctx.append(f"on {topic}")
    if audience: ctx.append(f"for {audience}")
    if goal: ctx.append(f"so the reader can {goal}")
    ctx_line = (" " + " ".join(ctx)) if ctx else ""
    return (
        f"You are drafting a {artifact_format}{ctx_line}. Using ONLY the sources below, write a short "
        f"draft of 3 to 6 sections. Attribute each section to the source label(s) it draws from. "
        f"Invent nothing beyond the sources — if the sources do not cover something, omit it.\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"sections": [{{"heading": "string", "body": "string", "sources": ["S1"]}}]}}\n'
        f"Return 3 to 6 sections."
    )
```

- [ ] **Step 4: Write `schemas.py` additions + `generate.py`**

In `backend/src/trust/schemas.py` add (mirror `derivatives/schemas.py` `DerivativeRequest` validators — `Literal`/`Field`/`field_validator`/`model_validator`/`PROVIDER_REGISTRY` imports; add any missing):
```python
class DraftGenerateIn(BaseModel):
    api_key: str | None = Field(default=None, min_length=20, max_length=512)  # None ⇒ managed
    provider_id: str = "anthropic"
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider_id {v!r}")
        return v

    @model_validator(mode="after")
    def _api_key_matches_provider(self) -> "DraftGenerateIn":
        if self.api_key is None:
            return self
        prefix = PROVIDER_REGISTRY[self.provider_id].key_prefix
        if prefix and not self.api_key.startswith(prefix):
            raise ValueError(f"{self.provider_id} api_key must start with {prefix}")
        return self
```
`backend/src/trust/generate.py` (mirror `derivatives/generate.py`):
```python
from __future__ import annotations
from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider
from backend.src.generate.anthropic_caller import parse_json_response
from .draft_prompt import build_draft_prompt

_MAX_REPAIRS = 2
_MAX_TOKENS = 4096

class _DraftSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []

class _DraftOutput(BaseModel):
    sections: list[_DraftSection] = Field(min_length=1, max_length=6)

def generate_draft(*, sources, artifact_format, topic, audience, goal,
                   provider_id, api_key, model) -> _DraftOutput:
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")
    def _validate(text: str) -> _DraftOutput:
        return _DraftOutput.model_validate(parse_json_response(text))
    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
```

- [ ] **Step 5: Run tests + lint**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_trust_draft.py -v`
Expected: PASS (3 tests). Then `export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/draft_prompt.py src/trust/generate.py src/trust/schemas.py tests/test_trust_draft.py && ruff format --check src/trust tests/test_trust_draft.py` → clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/trust/draft_prompt.py backend/src/trust/generate.py backend/src/trust/schemas.py backend/tests/test_trust_draft.py
git commit -m "feat(trust): source-cited draft generation core (ADR-037 Phase 02)"
```

---

### Task 2: Backend router — `POST /versions/generate` + endpoint tests

**Files:**
- Modify: `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_router.py` (append)

**Interfaces:**
- Consumes: Task 1's `generate_draft` + `DraftGenerateIn`; `project_repo.list_inputs`; `artifact_repo.create_version`; the artifact's format (see note); `access.project_id_for_artifact`; `_account`/`_require_role`; billing `is_managed_eligible`/`get_managed_key`; `wegofwd_llm.errors`.
- Produces: `POST /api/v1/trust/artifacts/{artifact_id}/versions/generate -> VersionOut`.

**Notes:** READ `backend/src/derivatives/router.py` for the exact key-handling + error-cascade block and mirror it. To get the artifact's `format`: READ `backend/src/trust/artifact_repo.py` — if a `get_artifact` accessor exists use it, else fetch the format with `await conn.fetchval("SELECT format FROM artifact WHERE id=$1", artifact_id)`.

- [ ] **Step 1: Write the failing tests (append to `test_trust_router.py`)**

Mirror `test_derivatives_post` for the fake provider (patch `backend.src.trust.generate.build_provider`) + the existing owner/reviewer harness:
```python
from unittest.mock import patch
from backend.tests.helpers import fake_provider
import json as _json

_DRAFT_JSON = _json.dumps({"sections": [
    {"heading": "A", "body": "b", "sources": ["S1"]},
    {"heading": "C", "body": "d", "sources": []},
    {"heading": "E", "body": "f", "sources": ["S1"]},
]})

def _artifact_with_source(c):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                 json={"role": "cornerstone", "format": "guide"}).json()
    c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"})
    return pid, art["id"]

def test_owner_generates_draft_version():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"; _as(owner, f"{owner}@x.z")
        pid, aid = _artifact_with_source(c)
        with patch("backend.src.trust.generate.build_provider", return_value=fake_provider(text=_DRAFT_JSON)):
            r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate",
                       json={"api_key": "sk-ant-" + "x"*20})
        assert r.status_code == 200
        assert r.json()["version_no"] == 1
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["artifacts"][0]["versions"][0]["is_validated"] is False  # a real version exists

def test_generate_requires_a_source_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"; _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        aid = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "guide"}).json()["id"]
        r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": "sk-ant-" + "x"*20})
        assert r.status_code == 422  # no sources

def test_generate_key_never_leaks_and_reviewer_forbidden():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"; _as(owner, f"{owner}@x.z")
        pid, aid = _artifact_with_source(c)
        key = "sk-ant-" + "y"*20
        with patch("backend.src.trust.generate.build_provider", return_value=fake_provider(text=_DRAFT_JSON)):
            r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": key})
        assert key not in _json.dumps(r.json())
        # reviewer cannot generate
        expert = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert})
        _as(f"e-{uuid.uuid4()}", expert); c.post("/api/v1/trust/session/sync")
        rr = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": key})
        assert rr.status_code == 403

def test_generate_bad_model_output_502():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"; _as(owner, f"{owner}@x.z")
        pid, aid = _artifact_with_source(c)
        with patch("backend.src.trust.generate.build_provider", return_value=fake_provider(text="not json")):
            r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": "sk-ant-" + "z"*20})
        assert r.status_code == 502
```

- [ ] **Step 2: Verify collection (no local DB — tests skip)**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_trust_router.py --collect-only -q`
Expected: collects the new tests without error (they skip at run without a DB — CI runs them).

- [ ] **Step 3: Add the endpoint**

In `backend/src/trust/router.py`, add the imports Task 1 + the seam needs (mirror the derivatives router: `asyncio`, `wegofwd_llm.errors`, `is_managed_eligible`, `get_managed_key`, `settings`) and the endpoint:
```python
@router.post("/artifacts/{artifact_id}/versions/generate", response_model=schemas.VersionOut)
async def generate_version(
    artifact_id: uuid.UUID,
    body: schemas.DraftGenerateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.VersionOut:
    project_id = await project_id_for_artifact(conn, artifact_id=artifact_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "artifact not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)

    fmt = await conn.fetchval("SELECT format FROM artifact WHERE id=$1", artifact_id)  # or artifact_repo.get_artifact
    p = await project_repo.get_project(conn, project_id=project_id)
    sources = await project_repo.list_inputs(conn, project_id=project_id)
    if not sources:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "add at least one source before generating a draft")

    # key handling mirrors /derivatives
    managed = body.api_key is None
    if managed:
        if not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "an api_key is required for this request")
        api_key = get_managed_key(body.provider_id)
    else:
        api_key = body.api_key
    model = body.model or settings.anthropic_default_model

    try:
        out = await asyncio.to_thread(
            generate_draft,
            sources=sources, artifact_format=fmt, topic=p.topic, audience=p.audience, goal=p.goal,
            provider_id=body.provider_id, api_key=api_key, model=model,
        )
    except LLMSchemaError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "generated draft failed validation") from None
    except LLMAuthError:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            "The API key was rejected by the provider. Check it in Settings.") from None
    except LLMRateLimitError:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "The provider is rate-limiting requests. Try again shortly.") from None
    except (LLMError, Exception):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "draft generation failed") from None

    # map model labels S1..Sn -> real input ids (drop unknowns; never 500 on a bad label)
    by_label = {f"S{i+1}": str(s.id) for i, s in enumerate(sources)}
    sections = [
        {"heading": sec.heading, "body": sec.body,
         "source_ids": [by_label[l] for l in sec.sources if l in by_label]}
        for sec in out.sections
    ]
    cited = sorted({sid for s in sections for sid in s["source_ids"]})
    v = await artifact_repo.create_version(
        conn, artifact_id=artifact_id,
        content={"sections": sections},
        created_by_sub=principal.sub,
        generation_meta={"kind": "draft", "model": model, "provider_id": body.provider_id, "source_input_ids": cited},
    )
    return schemas.VersionOut(id=str(v.id), artifact_id=str(v.artifact_id), version_no=v.version_no, created_at=v.created_at)
```
Note: `except (LLMError, Exception)` — order matters; put the specific `LLMError`-family excepts before the bare fallback (as written). The bare `Exception` is defense-in-depth so no raw error escapes with key material (mirror derivatives).

- [ ] **Step 4: Lint + commit (endpoint tests run in CI)**

Run: `cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py tests/test_trust_router.py && ruff format --check src/trust tests/test_trust_router.py` → clean (run `ruff format` on any file it flags).
Also: `PYTHONPATH=$(git rev-parse --show-toplevel) .venv/bin/python -c "import backend.src.trust.router"` → imports clean.
```bash
git add backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): POST /versions/generate — inline source-cited draft (ADR-037 Phase 02)"
```

---

### Task 3: Mobile — `trustClient.generateVersion` + `useTrustProject` mutation

**Files:**
- Modify: `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/api/trustClient.generate.test.ts`

**Interfaces:**
- Produces: `generateVersion(artifactId, body: {api_key: string; provider_id?: string; model?: string}, token) -> VersionCreatedView`; `useTrustProject().generateVersion(artifactId)` (reads the saved BYOK key, calls the client, refreshes).

**Notes:** READ `mobile/src/api/trustClient.ts` (`createVersion` + `VersionCreatedView`) and `mobile/src/hooks/useTrustProject.ts` (`addVersion` mutation) + `mobile/src/secure/keyStore.ts` (`loadApiKey`) — mirror `createVersion` for the client fn and `useMakePost`/`addVersion` for the key-read + mutation.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/api/trustClient.generate.test.ts` — mock `fetch`, assert `generateVersion` POSTs to `/artifacts/{id}/versions/generate` with `Authorization: Bearer <token>` and a body containing `api_key`, returns the created version (mirror `trustClient.inputs.test.ts`'s mockFetch shape).

- [ ] **Step 2: Run → FAIL** (`generateVersion` not exported).

Run: `cd mobile && npm test -- __tests__/api/trustClient.generate.test.ts`

- [ ] **Step 3: Implement**

- `trustClient.ts`: `generateVersion(artifactId, body, token)` → `trustFetch<VersionCreatedView>(`/artifacts/${artifactId}/versions/generate`, token, {method:"POST", body: JSON.stringify(body)})` (mirror `createVersion`).
- `useTrustProject.ts`: `generateVersion(artifactId)` mutation — `const key = await loadApiKey("anthropic"); if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft."); if (!accessToken) throw ...; await generateVersionClient(artifactId, { api_key: key, provider_id: "anthropic" }, accessToken); await refresh();` (mirror the existing `addVersion` mutation's guard/refresh + `useMakePost`'s key read).

- [ ] **Step 4: Run + tsc + eslint → pass/clean**

Run: `cd mobile && npm test -- __tests__/api/trustClient.generate.test.ts && npx tsc --noEmit && npx eslint src/api/trustClient.ts src/hooks/useTrustProject.ts __tests__/api/trustClient.generate.test.ts`

- [ ] **Step 5: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/api/trustClient.generate.test.ts
git commit -m "feat(trust): mobile generateVersion client + hook (ADR-037 Phase 02)"
```

---

### Task 4: Mobile — "Generate a draft" owner action

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.generate.test.tsx`

**Notes:** READ the current owner "Add a version" affordance in `[projectId].tsx` (it calls `addVersion({text:""})`). Replace its handler + label with **"Generate a draft"** → `generateVersion(artifactId)` (from Task 3). Keep the file's existing static `colors`/StyleSheet idiom. Reuse the `@/lib/alert` shim for the no-key/no-source error, mirroring the owner-action patterns + `TrustProjectDetail.owner.test.tsx` harness.

- [ ] **Step 1: Write the failing test**

`TrustProjectDetail.generate.test.tsx` — mock `useTrustProject` to return an owner project with an artifact + a `generateVersion` jest.fn (+ `inputs` non-empty). Assert: the owner sees a **"Generate a draft"** control (by accessibility label); pressing it calls `generateVersion(artifactId)`. Also: when `inputs` is empty, the control is disabled or shows the "add a source first" hint (pick one, assert it). Mirror `TrustProjectDetail.owner.test.tsx`'s mock shape.

- [ ] **Step 2: Run → FAIL.**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.generate.test.tsx`

- [ ] **Step 3: Implement**

Replace the owner add-version affordance with a "Generate a draft" `Pressable` (accessibilityLabel="Generate a draft"): owner-only (`my_role === "owner"`), disabled when `inputs.length === 0` (with a hint "Add a source first") or while busy; onPress → `try { await generateVersion(artifactId) } catch (e) { Alert.alert("Couldn't generate", <message>) }`. Show a busy state during the call.

- [ ] **Step 4: Run new + existing detail tests + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.generate.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/screens/TrustProjectDetail.sources.test.tsx && npx tsc --noEmit && npx eslint "app/trust/[projectId].tsx" __tests__/screens/TrustProjectDetail.generate.test.tsx`
Expected: all pass, 0 type errors, eslint clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.generate.test.tsx
git commit -m "feat(trust): owner 'Generate a draft' action (ADR-037 Phase 02)"
```

---

### Task 5: Help + full-suite / DoD gate

**Files:**
- Modify: `mobile/src/help-content/topics.ts` (extend the `sources` topic) — and `features.ts` ONLY if adding a new key.

**Notes:** Prefer extending the existing `sources` (Capture) Help topic with a paragraph on Generate a draft (turns captured sources into a first version the expert reviews, grounded in + attributed to those sources) — this avoids a new FEATURES key + coverage entry. If you instead add a `draft` FEATURES key, you MUST add its topic (coverage gate).

- [ ] **Step 1: Extend the `sources` Help topic** with a Generate-a-draft paragraph (house style: no "generate with AI/chatbot"; "turns your sources into a first draft the expert reviews").

- [ ] **Step 2: Run coverage + full suite + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts && npm test && npx tsc --noEmit && npx eslint src/help-content/topics.ts`
Expected: coverage PASS (no new uncovered feature); full suite green; tsc 0; eslint clean.

- [ ] **Step 3: Commit**

```bash
git add mobile/src/help-content/topics.ts
git commit -m "feat(trust): Help — Generate a draft (ADR-037 Phase 02 DoD)"
```

---

## Final verification (after all tasks)
- Backend: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL= .venv/bin/pytest tests/test_trust_draft.py -v` (green, no DB) + `pytest tests/test_trust_router.py --collect-only -q` (collects) + `ruff check src/trust tests` + `ruff format --check backend/`. The endpoint tests run in CI.
- Mobile: `cd mobile && npm test && npx tsc --noEmit && npx eslint src/api/trustClient.ts src/hooks/useTrustProject.ts "app/trust/[projectId].tsx"`.

## Self-Review notes (author)
- **Spec coverage:** prompt+generate+schemas = Task 1 (pure, no DB); router endpoint + owner/≥1-source/key-leak/502 tests = Task 2 (CI-run); mobile client+hook = Task 3; owner "Generate a draft" = Task 4; Help DoD = Task 5.
- **Key safety:** the BYOK key flows body → `to_thread(generate_draft)` → dropped; error cascade never echoes it (mirrors `/derivatives`); Task 2 asserts key-not-in-response.
- **Type consistency:** `_DraftOutput`/`_DraftSection` (Task 1) consumed by the router mapping (Task 2); `DraftGenerateIn` (Task 1) is the endpoint body (Task 2); `generateVersion` signature (Task 3) consumed by Task 4; endpoint returns the existing `VersionOut`.
- **No-DB split:** Task 1 tests run locally (fake provider, pure). Task 2 endpoint tests skip locally, run in CI — same pattern as the Capture slice (#355, verified green in CI).
- **Risk flagged:** artifact `format` fetch — plan gives the inline `fetchval` fallback if `artifact_repo.get_artifact` is absent. `except (LLMError, Exception)` ordering noted so the specific LLM excepts catch first.
- **Boundaries:** inline only (no job queue), per-section attribution, no metering, `[projectId].tsx` not theme-migrated.
