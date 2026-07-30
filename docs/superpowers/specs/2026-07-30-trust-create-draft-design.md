# Trust Create — Source-Cited Draft into a Version — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 Phase 02 "Create"** · A2 of the guided-authorship program (Capture ✅ → **Create** → Validate ✅ → Share ✅). Depends on Capture (PR #355, on main).
**Scope:** a new trust endpoint that generates a **bounded, source-cited draft** from a project's captured inputs into a new `artifact_version`, replacing the mobile `addVersion({text:""})` stub. Backend generation (mirrors `/derivatives`) + mobile "Generate a draft". **Inline (seconds), BYOK/managed like `/derivatives`, per-section source attribution.**

## Why this slice
Capture (sources) and Validate (approvals) exist, but nothing produces the draft in between — the owner "Add version" writes empty content, so the expert has nothing real to validate. This wires the **Create** phase: draft *from* the captured sources, attribute each section to the source(s) it drew from, store as a version — closing Capture → Create → Validate end-to-end. Bounded + inline now; the full 8–25k-word async cornerstone is a later scale-up.

## Grounding (verified)
- **LLM seam to mirror:** `backend/src/derivatives/generate.py` `generate_post` — `build_prompt → build_provider(provider_id, api_key, model) → LLMRequest(prompt, max_tokens, response_format="json") → generate_validated(provider, req, _validate, max_repairs=2)`; raises `LLMSchemaError`/`LLMError` subclasses.
- **Key handling to mirror:** `backend/src/derivatives/router.py` — `managed = body.api_key is None`; managed → `is_managed_eligible(principal, provider_id)` else generic 400, `get_managed_key`; else BYOK. `model = body.model or settings.anthropic_default_model`. `await asyncio.to_thread(...)`. Error cascade: `LLMSchemaError`→502, `LLMAuthError`→502 (key-free), `LLMRateLimitError`→429, `LLMError`/`Exception`→502.
- **Store:** `artifact_repo.create_version(conn, *, artifact_id, content, created_by_sub, generation_meta=None)` — `content` + `generation_meta` are jsonb; `version_no` auto-increments. Returns `ArtifactVersion`.
- **Inputs (Capture):** `project_repo.list_inputs(conn, *, project_id)` → `[ProjectInput{id, kind, title, content, source_ref}]`.
- **Project scope:** `Project` has `title, topic, audience, goal` (`project_repo`).
- **Access:** trust router `_account` + `_require_role(..., need_owner=True)`; `project_id_for_artifact(conn, artifact_id)` resolves the project (used by the existing `create_version` endpoint). `require_active_user` (owner is authed).

---

## Backend (`src/trust/`)

### `draft_prompt.py`
`build_draft_prompt(sources, artifact_format, topic, audience, goal) -> str`:
- Labels each source `[S1]..[Sn]` (mapped back to real input ids server-side), includes each source's kind/title/content.
- Instruction: *"You are drafting a {format}{ on {topic}}{ for {audience}}{ so the reader can {goal}}. Using ONLY the sources below, write a short draft of 3–6 sections. Attribute each section to the source label(s) it draws from. Invent nothing beyond the sources — if the sources don't cover something, omit it."*
- Ends: *"Respond with ONLY valid JSON matching: {\"sections\":[{\"heading\":\"…\",\"body\":\"…\",\"sources\":[\"S1\"]}]}. 3–6 sections."*

### `generate.py` (mirror `derivatives/generate.py`)
```python
_MAX_REPAIRS = 2
_MAX_TOKENS = 4096   # a bounded multi-section draft — larger than a post, far below a full cornerstone

class _DraftSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []        # model-facing labels S1..Sn

class _DraftOutput(BaseModel):
    sections: list[_DraftSection] = Field(min_length=1, max_length=6)

def generate_draft(*, sources, artifact_format, topic, audience, goal,
                   provider_id, api_key, model) -> _DraftOutput:
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")
    def _validate(text): return _DraftOutput.model_validate(parse_json_response(text))
    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
```

### `schemas.py`
```python
class DraftGenerateIn(BaseModel):
    api_key: str | None = Field(default=None, min_length=20, max_length=512)  # None ⇒ managed
    provider_id: str = "anthropic"
    model: str | None = None
    # validators mirror derivatives DerivativeRequest: known provider; api_key prefix (skip when None)
```
- The endpoint returns the existing `VersionOut` (the created version). No new response schema.

### `router.py` — `POST /artifacts/{artifact_id}/versions/generate -> VersionOut`
Owner-only draft generation. Steps:
1. `project_id = project_id_for_artifact(conn, artifact_id)`; None → 404.
2. `account = _account(...)`; `_require_role(..., need_owner=True)`.
3. Load the artifact (for `format`) + project (topic/audience/goal); `inputs = list_inputs(...)`.
4. **Require ≥1 input** — empty → `422 "add at least one source before generating a draft"` (enforces Capture→Create + gives the handhold its signpost).
5. Key handling **mirrors `/derivatives`** (`managed = body.api_key is None`; managed → `is_managed_eligible` else 400 + `get_managed_key`; else BYOK; `model = body.model or settings.anthropic_default_model`).
6. `out = await asyncio.to_thread(generate_draft, sources=inputs, artifact_format=artifact.format, topic=project.topic, audience=project.audience, goal=project.goal, provider_id=..., api_key=..., model=...)`.
7. Map model-facing `S1..Sn` back to real input ids; build:
   - `content = {"sections": [{"heading", "body", "source_ids": [<input uuid>...]}]}`
   - `generation_meta = {"model": model, "provider_id": provider_id, "kind": "draft", "source_input_ids": [<all cited input ids>]}`
8. `v = create_version(conn, artifact_id=..., content=content, created_by_sub=principal.sub, generation_meta=generation_meta)`; return `VersionOut`.
- Error cascade mirrors the derivatives router (`LLMSchemaError`/`LLMError`/`Exception`→502, `LLMAuthError`→502 key-free, `LLMRateLimitError`→429). The BYOK key never logged/persisted/returned (it's used in the thread call only, like `/derivatives`).

**Boundaries (backend):** inline (no job queue); `_MAX_TOKENS=4096` bounded; per-section attribution (a section lists which inputs it drew from) — NOT per-claim; unknown model-labels in the output are dropped (best-effort mapping, content is still stored); no metering/usage_event.

---

## Mobile
- `src/api/trustClient.ts`: `generateVersion(artifactId, body: {api_key: string; provider_id?: string; model?: string}, token) -> VersionCreatedView` (POST `/artifacts/{id}/versions/generate`, JWT).
- `src/hooks/useTrustProject.ts`: add a `generateVersion(artifactId)` mutation that reads the saved BYOK key (`loadApiKey("anthropic")`, like Posts), calls the client, refreshes; keep the token guard. (Leaves the old `addVersion` in place or replaces its use — see UI.)
- `app/trust/[projectId].tsx`: the owner **"Add a version"** action becomes **"Generate a draft"** — on press: load the key (no key → friendly "add an Anthropic key in Settings"), call `generateVersion(artifactId)`; disable/hint when the project has **no sources** ("Add a source first"). On success the new version appears in the artifact (the expert can then Validate it). Busy state during the call.

## Testing
**Backend** (endpoint tests, `test_trust_router.py`; patch `build_provider` with a fake provider returning a canned `{sections:[…]}` JSON — mirror `test_derivatives_post`; run against CI Postgres):
- owner generates with ≥1 source → 200, a new version exists in the artifact (`version_no` incremented), `generation_meta.kind == "draft"`.
- **no sources** → 422.
- reviewer → 403; stranger → 403.
- BYOK key never appears in the response/logs (assert like `/derivatives`).
- bad model output (always-invalid JSON) → 502; empty-sections output → repair→502.

**Mobile:** `generateVersion` posts with the loaded key + JWT (client test); the owner "Generate a draft" action calls `generateVersion` and is disabled with no sources; no-key path surfaces the friendly error (screen/hook tests, mock the client + `loadApiKey`).

**Help/DoD:** extend the existing project/version Help topic (or the `sources` topic) to explain that Generate a draft turns the captured sources into a first version the expert reviews, grounded in and attributed to those sources. If a new FEATURES key is added, add its topic (coverage gate).

## Out of scope (later slices)
- Full 8–25k-word **async** cornerstone (job queue + poll) — this is the bounded inline version.
- **Per-claim** citations (this is per-section attribution).
- Editing the generated draft / regenerate-with-feedback (the feedback→revision loop is a later slice).
- Managed-plan DB entitlement + metering (same deferral as `/derivatives`; BYOK is the proven path).
- Rendering the sectioned draft nicely in the reviewer UI (this slice stores it; the reviewer detail shows versions already — rich section rendering is a follow-up).
- Derivative-format generation from an approved version (that's Share / the Posts path, already built for LinkedIn/X).

## Open items (resolve in the plan, non-blocking)
1. Where to source `datetime`/`generated_at` — keep it out of `generation_meta` (avoid `Date.now()` non-determinism in tests) or let Postgres stamp `created_at` on the version (already does). Plan: rely on the version's own `created_at`; `generation_meta` holds model/provider/source_input_ids only.
2. Reviewer detail currently renders version summaries; showing the section bodies is deferred — confirm the version still appears (it does, via `list_versions`) so the loop is demoable.
3. Label→id mapping when the model returns an unknown/format-off `Sx` — drop unknowns, keep the section; never 500 on a bad citation.
