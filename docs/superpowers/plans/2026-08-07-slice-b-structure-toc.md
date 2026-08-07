# Slice B — Structure (TOC) phase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Structure phase to Projects: build/edit a TOC (reusing Studio's `TopicTreeEditor`), Suggest an outline from the sources (inline, grounded, with per-topic source coverage), persist it on the project, then Next → Drafts. Generation stays unchanged (TOC→generation is Slice C).

**Architecture:** `toc jsonb` on `project` (migration 0014) + a source-grounded inline suggest generator (mirrors `generate_draft`) + `POST /suggest-toc` / `PUT /toc` endpoints; mobile adds a `structure` phase, a StructurePanel wrapping `TopicTreeEditor`, and read-only source chips.

**Tech Stack:** FastAPI · asyncpg · Alembic · Pydantic v2 · pytest · React Native + Expo · Jest + RNTL.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-slice-b-structure-toc-design.md`; arc: `…/2026-08-07-projects-toc-structure-arc-design.md`.
- Owner-only for suggest/save; reviewers see the Structure phase **read-only**. App-level authz, no RLS.
- Suggest is **source-grounded** — "Invent nothing beyond the sources" (reuse the `build_draft_prompt` discipline). Key handling mirrors `generate_version` (managed vs `body.api_key`).
- Generation is **UNCHANGED** in this slice (Drafts = the multi-format picker). Do NOT touch `generate_draft`/`build_draft_prompt` (that's Slice C).
- `TopicTreeEditor` stays reusable: add source chips via an **optional** `sourceLabel?: (id) => string` prop (Studio callers pass nothing → no chips). Don't couple it to trust.
- `ruff check backend/ pipeline/` + `ruff format --check backend/ pipeline/` MUST pass (run from repo ROOT). `npx tsc --noEmit` MUST pass (Jest doesn't typecheck). jest.mock consts `mock`-prefixed; screen import path `@/../app/trust/[projectId]`.
- Reuse verbatim: `TopicTreeEditor` (`{toc, onChange}` + new optional `sourceLabel`), `StructuredTOC/SubjectNode/TopicNode` (`@/types/book`), the `generate_version` key-handling + `S1..Sn`→input-id map (`router.py:376-384`).

**Local backend test recipe (DB migrated to 0013 — this slice adds 0014):**
```bash
cd backend
export DATABASE_URL="postgresql://postgres:devlocal@localhost:5439/mentible_test"
export BYOK_MASTER_KEY="0000000000000000000000000000000000000000000000000000000000000000"
export SYSTEM_OWNER_SECRET="1111111111111111111111111111111111111111111111111111111111111111"
export REDIS_URL="redis://localhost:6379/0" APP_ENV=test LOG_LEVEL=INFO
export PYTHONPATH=/home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
source .venv/bin/activate
# apply the new migration once written: alembic upgrade head
```
(pg up: `docker start mentible_local_pg`.)

---

### Task 1: Backend — `project.toc` column + persist endpoint

**Files:**
- Create: `backend/alembic/versions/0014_project_toc.py`
- Modify: `backend/src/trust/models.py`, `backend/src/trust/project_repo.py`, `backend/src/trust/schemas.py`, `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `Project.toc: dict | None`; `project_repo.update_project_toc(conn, *, project_id, toc)`; `PUT /api/v1/trust/projects/{project_id}/toc` (owner-only) → `ProjectOut`; `toc` on `ProjectOut` + in `GET /projects/{id}`.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_trust_router.py`:
```python
def test_put_and_get_project_toc():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        toc = {"subjects": [{"subject_label": "S", "units": [
            {"id": "t1", "title": "Topic 1", "subtopics": [], "prerequisites": [], "source_ids": []}]}]}
        assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200
        got = c.get(f"/api/v1/trust/projects/{pid}").json()["project"]["toc"]
        assert got["subjects"][0]["units"][0]["title"] == "Topic 1"
        # reviewer/non-owner blocked
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 403
```

- [ ] **Step 2: Run — verify fail** — `python -m pytest tests/test_trust_router.py::test_put_and_get_project_toc -v` → FAIL (no route / no toc field).

- [ ] **Step 3: Migration `0014`**
```python
"""project.toc — the Structure-phase outline (Slice B)"""
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute("ALTER TABLE project ADD COLUMN toc jsonb")

def downgrade() -> None:
    op.execute("ALTER TABLE project DROP COLUMN toc")
```
Apply: `alembic upgrade head` (env per recipe) → confirm `Running upgrade 0013 -> 0014`.

- [ ] **Step 4: Model + repo**
- `models.py` `Project` dataclass: add `toc: dict | None = None` (last field).
- `project_repo.py`: append `toc` to `_P` (`"…, updated_at, toc"`); in `_project`, map `toc=json.loads(r["toc"]) if r["toc"] is not None else None` (import `json` if not already). Add:
```python
async def update_project_toc(conn, *, project_id, toc) -> None:
    await conn.execute("UPDATE project SET toc = $2::jsonb WHERE id = $1", project_id, json.dumps(toc))
```

- [ ] **Step 5: Schema + endpoints**
- `schemas.py`: add `toc: dict | None = None` to `ProjectOut`; add `class TocSaveIn(BaseModel): toc: dict`.
- `router.py`: in `get_project`'s `ProjectOut(...)` include `toc=p.toc`. Add (owner-only), near the project routes:
```python
@router.put("/projects/{project_id}/toc", response_model=schemas.ProjectOut)
async def save_project_toc(
    project_id: uuid.UUID,
    body: schemas.TocSaveIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    if not isinstance(body.toc.get("subjects"), list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "toc.subjects must be a list")
    await project_repo.update_project_toc(conn, project_id=project_id, toc=body.toc)
    p = await project_repo.get_project(conn, project_id=project_id)
    return schemas.ProjectOut(id=str(p.id), title=p.title, topic=p.topic, audience=p.audience,
                              goal=p.goal, status=p.status, created_at=p.created_at, toc=p.toc)
```

- [ ] **Step 6: Run tests + ruff** — `python -m pytest tests/test_trust_router.py -v` (new + existing pass); `cd .. && backend/.venv/bin/ruff check backend/ pipeline/ && backend/.venv/bin/ruff format --check backend/ pipeline/`.

- [ ] **Step 7: Commit**
```bash
git add backend/alembic/versions/0014_project_toc.py backend/src/trust/models.py backend/src/trust/project_repo.py backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): project.toc column + PUT /projects/{id}/toc (Structure phase persistence)"
```

---

### Task 2: Backend — grounded Suggest-TOC generator + endpoint

**Files:**
- Create: `backend/src/trust/toc_suggest.py`, `backend/src/trust/toc_prompt.py`
- Modify: `backend/src/trust/schemas.py`, `backend/src/trust/router.py`
- Test: `backend/tests/test_trust_toc.py` (new), `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `suggest_toc(*, sources, topic, audience, goal, provider_id, api_key, model) -> _TocOutput`; `POST /api/v1/trust/projects/{project_id}/suggest-toc` (owner-only) → `TocSuggestOut { toc: dict }` (StructuredTOC-shaped, each topic has `source_ids`). Does NOT persist.

- [ ] **Step 1: Write failing tests** (`backend/tests/test_trust_toc.py` — prompt is pure, no DB; endpoint uses DB + mocked provider like `test_trust_draft.py`/`test_trust_router` do):
```python
from backend.src.trust.toc_prompt import build_toc_prompt

class _Src:
    def __init__(self, id, kind, title, content):
        self.id, self.kind, self.title, self.content = id, kind, title, content

_SOURCES = [_Src("11111111-1111-1111-1111-111111111111", "transcript", "Interview", "We size pipes for the 10-year storm.")]

def test_toc_prompt_grounded_and_labels_sources():
    p = build_toc_prompt(_SOURCES, "stormwater", "engineers", "size pipes")
    assert "10-year storm" in p          # source content present
    assert "S1" in p                     # labelled source
    assert "Invent nothing" in p         # grounding discipline
    assert "json" in p.lower()
```
Add an endpoint test to `test_trust_router.py` mirroring the draft/generate tests' mocked-provider setup (see `test_trust_draft.py` `test_generate_draft_returns_sections` / how `test_trust_router` seeds + monkeypatches the provider): seed a project + a source, POST `/suggest-toc`, assert 200 + `toc.subjects[*].units[*].source_ids` are real input ids; no sources → 422; reviewer → 403. Match the existing provider-mock helper (`backend/tests/helpers.py` `fake_provider`).

- [ ] **Step 2: Run — verify fail** — `python -m pytest tests/test_trust_toc.py -v` → FAIL (module missing).

- [ ] **Step 3: `toc_prompt.py`** (mirror `draft_prompt.py`'s labelling + grounding):
```python
"""Prompt for a source-grounded outline (TOC) of a trust project (Slice B).

Mirrors draft_prompt.py's "use ONLY the sources / invent nothing" discipline, but
proposes an OUTLINE (subjects -> topics) of what the sources cover, attributing
each topic to its source label(s). No content is written here — just structure.
"""
from __future__ import annotations

def build_toc_prompt(sources, topic, audience, goal) -> str:
    labelled = "\n\n".join(
        f'[S{i + 1}] ({s.kind}{": " + s.title if s.title else ""})\n"""\n{s.content}\n"""'
        for i, s in enumerate(sources)
    )
    ctx = []
    if topic:
        ctx.append(f"on {topic}")
    if audience:
        ctx.append(f"for {audience}")
    if goal:
        ctx.append(f"so the reader can {goal}")
    ctx_line = (" " + " ".join(ctx)) if ctx else ""
    return (
        f"You are outlining a long-form work{ctx_line}. Using ONLY the sources below, propose an "
        f"outline of what the sources actually cover: 1 to 6 subjects, each with 1 to 8 topics. "
        f"Attribute each topic to the source label(s) it draws from. Invent nothing beyond the "
        f"sources — if the sources do not cover something, omit it. If the sources are thin, propose "
        f"few topics.\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"subjects": [{{"subject_label": "string", "topics": [{{"title": "string", "sources": ["S1"]}}]}}]}}'
    )
```

- [ ] **Step 4: `toc_suggest.py`** (mirror `generate.py`):
```python
from __future__ import annotations
from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider
from backend.src.generate.anthropic_caller import parse_json_response
from .toc_prompt import build_toc_prompt

_MAX_REPAIRS = 2
_MAX_TOKENS = 2048

class _TocTopic(BaseModel):
    title: str
    sources: list[str] = []

class _TocSubject(BaseModel):
    subject_label: str
    topics: list[_TocTopic] = Field(min_length=1, max_length=8)

class _TocOutput(BaseModel):
    subjects: list[_TocSubject] = Field(min_length=1, max_length=6)

def suggest_toc(*, sources, topic, audience, goal, provider_id, api_key, model) -> _TocOutput:
    prompt = build_toc_prompt(sources, topic, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")
    def _validate(text: str) -> _TocOutput:
        return _TocOutput.model_validate(parse_json_response(text))
    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
```

- [ ] **Step 5: Schema + endpoint** — `schemas.py`: `class TocSuggestOut(BaseModel): toc: dict`. `router.py`: add `POST /projects/{project_id}/suggest-toc` (owner-only, `dependencies=[Depends(enforce_rate_limit)]`), copying `generate_version`'s key-handling block (managed vs `body.api_key`; reuse `DraftGenerateIn` for the body — it already has `api_key`/`provider_id`/`model`). Load sources (`project_repo.list_inputs`; 422 if empty), call `suggest_toc` via `asyncio.to_thread`, reuse `generate_version`'s LLM error mapping, then map each topic's `S`-labels → input ids and build the StructuredTOC:
```python
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    toc = {"subjects": [
        {"subject_label": subj.subject_label, "units": [
            {"id": str(uuid.uuid4()), "title": t.title, "subtopics": [], "prerequisites": [],
             "source_ids": [by_label[lbl] for lbl in t.sources if lbl in by_label]}
            for t in subj.topics]}
        for subj in out.subjects]}
    return schemas.TocSuggestOut(toc=toc)
```
(`uuid` already imported in router.)

- [ ] **Step 6: Run tests + ruff** — `python -m pytest tests/test_trust_toc.py tests/test_trust_router.py -v`; ruff clean from repo root.

- [ ] **Step 7: Commit**
```bash
git add backend/src/trust/toc_suggest.py backend/src/trust/toc_prompt.py backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_toc.py backend/tests/test_trust_router.py
git commit -m "feat(trust): grounded Suggest-TOC-from-sources endpoint"
```

---

### Task 3: Mobile — phase-flow + client + hook

**Files:**
- Modify: `mobile/src/lib/projectPhase.ts`, `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/lib/projectPhase.structure.test.ts` (new)

**Interfaces:**
- Produces: `PhaseKey` includes `"structure"`; `deriveProjectPhase` marks it done iff the project has TOC subjects. `trustClient.suggestToc(projectId, key, token)` (POST) + `saveToc(projectId, toc, token)` (PUT); `ProjectView.toc?`. Hook `suggestToc()`, `saveToc(toc)`.

- [ ] **Step 1: Write failing test** (`projectPhase.structure.test.ts`): a detail with `toc.subjects.length>0` → `structure` done; without → not done; assert `PHASE_ORDER` = `["capture","structure","create","validate","share"]` and `PHASE_LABELS.structure === "Structure"`.

- [ ] **Step 2: Run — fail** — `npx jest __tests__/lib/projectPhase.structure.test.ts`.

- [ ] **Step 3: projectPhase.ts**
- `PhaseKey` → add `"structure"`. `PHASE_ORDER = ["capture","structure","create","validate","share"]`. `PHASE_LABELS.structure = "Structure"`.
- In `deriveProjectPhase`, add to `done`: `structure: !!(detail.project?.toc?.subjects?.length)`. (Confirm the detail shape carries `project.toc` — see Step 4; `ProjectDetailView.project` is the `ProjectView`.)
- `currentKey`/`base` logic unchanged (order-driven).

- [ ] **Step 4: trustClient.ts** — add a `StructuredTocView` type (`{ subjects: { subject_label: string; units: { id: string; title: string; subtopics: unknown[]; prerequisites: string[]; source_ids?: string[] }[] }[] }`); add `toc?: StructuredTocView` to `ProjectView`. Add:
```ts
export async function suggestToc(projectId: string, body: { api_key: string; provider_id?: string }, token: string): Promise<StructuredTocView> {
  const r = (await trustFetch<{ toc: StructuredTocView }>(`/projects/${projectId}/suggest-toc`, token, { method: "POST", body: JSON.stringify(body) })) as { toc: StructuredTocView };
  return r.toc;
}
export async function saveToc(projectId: string, toc: StructuredTocView, token: string): Promise<void> {
  await trustFetch(`/projects/${projectId}/toc`, token, { method: "PUT", body: JSON.stringify({ toc }) });
}
```

- [ ] **Step 5: useTrustProject.ts** — add (mirroring `generateVersion`'s key load):
```ts
  const suggestToc = useCallback(async () => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to suggest an outline.");
    if (!accessToken) throw new Error("Not signed in");
    return suggestTocApi(projectId, { api_key: key, provider_id: "anthropic" }, accessToken);
  }, [accessToken, projectId]);
  const saveToc = useCallback(async (toc) => {
    if (!accessToken) throw new Error("Not signed in");
    await saveTocApi(projectId, toc, accessToken);
    await refresh();
  }, [accessToken, projectId, refresh]);
```
Import `suggestToc as suggestTocApi, saveToc as saveTocApi` from `@/api/trustClient`; add both to the returned object.

- [ ] **Step 6: Run test + tsc** — `npx jest __tests__/lib/projectPhase.structure.test.ts && npx tsc --noEmit`.

- [ ] **Step 7: Commit**
```bash
git add mobile/src/lib/projectPhase.ts mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/lib/projectPhase.structure.test.ts
git commit -m "feat(trust): structure phase + suggestToc/saveToc client + hook"
```

---

### Task 4: Mobile — TopicTreeEditor source chips

**Files:**
- Modify: `mobile/src/types/book.ts` (`source_ids?` on `TopicNode`), `mobile/src/components/TopicTreeEditor.tsx`
- Test: `mobile/__tests__/components/TopicTreeEditor.sourcechips.test.tsx` (new)

**Interfaces:**
- Produces: `TopicNode.source_ids?: string[]`; `TopicTreeEditor` optional prop `sourceLabel?: (id: string) => string` — when present, renders each unit's `source_ids` as read-only chips `sourceLabel(id)` (parallel to the existing read-only prerequisites chips). `source_ids` preserved through edits.

- [ ] **Step 1: Write failing test** — render `<TopicTreeEditor toc={tocWithSourceIds} onChange={()=>{}} sourceLabel={(id)=>id==="i1"?"S1":"S?"} />`; assert `getByText("S1")` renders for a unit whose `source_ids:["i1"]`. A second assertion: without `sourceLabel`, no chip renders (Studio path unaffected).

- [ ] **Step 2: Run — fail** — `npx jest __tests__/components/TopicTreeEditor.sourcechips.test.tsx`.

- [ ] **Step 3: types** — `book.ts` `TopicNode`: add `source_ids?: string[];`.

- [ ] **Step 4: TopicTreeEditor.tsx** — add `sourceLabel?: (id: string) => string` to `Props`. Where the unit renders its read-only prerequisites chips, add a parallel row: if `sourceLabel` and `unit.source_ids?.length`, render each id as a read-only chip showing `sourceLabel(id)` (reuse the prerequisites-chip style). Do NOT make them editable. The structural clone in `mutate` already deep-copies `source_ids`, so edits preserve them — verify no code path strips unknown keys (it spreads/clones the whole node).

- [ ] **Step 5: Run test + tsc** — `npx jest __tests__/components/TopicTreeEditor.sourcechips.test.tsx && npx tsc --noEmit`. Confirm the existing Studio book-editor tests (if any reference TopicTreeEditor) still pass.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/types/book.ts mobile/src/components/TopicTreeEditor.tsx mobile/__tests__/components/TopicTreeEditor.sourcechips.test.tsx
git commit -m "feat(trust): TopicTreeEditor read-only source-coverage chips"
```

---

### Task 5: Mobile — StructurePanel + phase render branch

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx` (new)

**Interfaces:**
- Consumes: `useTrustProject().suggestToc/saveToc/project.toc` (Task 3), `TopicTreeEditor` + `sourceLabel` (Task 4), `inputs`.
- Produces: a `structure` render branch rendering a StructurePanel (owner: editor + Suggest + Next; reviewer: read-only).

- [ ] **Step 1: Write failing test** (model on the existing `TrustProjectDetail.*` tests): owner project with sources + `my_role:"owner"`, `useTrustProject` mocked with `suggestToc`/`saveToc` jest.fns. Switch to the Structure tab; assert:
  - "Suggest from sources" control renders; pressing it calls `suggestToc` and the returned TOC's topic title renders in the editor.
  - editing (or the Suggest result) triggers `saveToc`.
  - a `Next` control advances to the Drafts tab.
  - reviewer (`my_role:"reviewer"`) sees the TOC read-only — no Suggest/Next/edit controls.

- [ ] **Step 2: Run — fail** — `npx jest __tests__/screens/TrustProjectDetail.structure.test.tsx`.

- [ ] **Step 3: StructurePanel + branch** in `app/trust/[projectId].tsx`:
- In `TrustProjectDetailInner`: pull `suggestToc, saveToc` from the hook; `const [tocDraft, setTocDraft] = useState(project?.project.toc ?? { subjects: [] })` (seed once from `project.toc`; keep local while editing). A `sourceLabel` = id→`S{n}` map from `inputs` (build a `Map`, mirror the viewer's `labelFor`).
- New module-scope `StructurePanel` component (props: `styles`, `isOwner`, `toc`, `onChangeToc`, `onSuggest`, `suggestBusy`, `onNext`, `sourceLabel`, `inputsEmpty`). Owner: `<TopicTreeEditor toc={toc} onChange={onChangeToc} sourceLabel={sourceLabel} />` + a **"Suggest from sources"** `Pressable` (accessibilityLabel `"Suggest outline from sources"`, disabled when `suggestBusy || inputsEmpty`, shows `…` when busy; "Add a source first" hint when empty) + a **`Next`** `Pressable` (accessibilityLabel `"Next to Drafts"`). Reviewer: render the editor read-only (no `onChange`/Suggest/Next) — simplest is a read-only variant or pass a no-op onChange + hide the buttons.
- Handlers in `Inner`:
```tsx
  const onSuggest = async () => {
    setSuggestBusy(true);
    try {
      const toc = await suggestToc();
      if (tocHasContent(tocDraft)) { /* confirm replace via Alert */ }
      setTocDraft(toc); await saveToc(toc);
    } catch (e) { Alert.alert("Couldn't suggest", e instanceof ApiError ? e.userMessage() : "Try again."); }
    finally { setSuggestBusy(false); }
  };
  const onChangeToc = (next) => { setTocDraft(next); void saveToc(next).catch(() => {}); };  // debounce if noisy
  const onNext = () => setSelected("create");
```
- Render branch: `active === "structure" ? <StructurePanel .../> : null` between the `capture` and `create` branches.

- [ ] **Step 4: Run test + full TrustProjectDetail suite + tsc** — `npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`. If a `journey`/phase test asserted the old 4-phase order, update it to include `structure` (note in report).

- [ ] **Step 5: Commit**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx
git commit -m "feat(trust): Structure phase panel — TopicTreeEditor + Suggest + Next"
```

---

## Final verification (after all tasks)

- [ ] Backend: `python -m pytest tests/test_trust_router.py tests/test_trust_toc.py -v` — all pass; no-key gate green; `ruff check` + `ruff format --check` clean.
- [ ] Mobile: `npx jest && npx tsc --noEmit` — full suite green, tsc clean.
- [ ] PR body: **prod backend refresh + `alembic upgrade head` on ship** (migration 0014 + endpoints). Web redeploy for the UI.

## Self-review

- **Spec coverage:** toc column + persist (T1), grounded suggest w/ source_ids (T2), phase + client + hook (T3), editor source chips (T4), StructurePanel + Next + reviewer-read-only (T5). Generation-feed correctly excluded (Slice C). Optional/skippable phase (Next always advances).
- **Type consistency:** `toc` shape (`subjects[].units[]` with `source_ids`) identical across the suggest endpoint (T2), client `StructuredTocView` (T3), `TopicNode.source_ids` (T4), and the panel (T5); `suggestToc()/saveToc(toc)` identical in hook (T3) and panel (T5).
- **Placeholders:** none — migration/repo/generator/prompt/endpoint code literal; the T5 panel step names exact controls + accessibility labels the test asserts (a couple of small helpers like `tocHasContent`/debounce are the implementer's to write, flagged inline).
