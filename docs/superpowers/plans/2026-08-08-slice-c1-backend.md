# Slice C1 — per-topic backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend for per-topic authoring — new `topic_version` + `topic_approval` tables, a grounded per-topic generator (section per subtopic), generate/approve/withdraw endpoints, and per-topic status on the project detail.

**Architecture:** Topics-as-rows. Mirror the existing `artifact_version`/`approval` machinery as separate `topic_version`/`topic_approval` tables + repos (deliberate separation). The per-topic generator copies `generate_version`'s grounding + key-handling + error mapping. Per-topic drafts reuse the artifact-draft content shape `{sections:[{heading,body,source_ids}]}`.

**Tech Stack:** FastAPI + asyncpg + alembic + pydantic + `wegofwd_llm`; pytest (mocked LLM, real test Postgres).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-08-slice-c-per-topic-design.md`.
- **App-level authz via `require_project_access` / `_require_role`** — NO RLS, no tenant column; the new tables are project-scoped like the rest of the trust aggregate. Owner-only generate; approve/withdraw owner-or-reviewer (mirror the artifact approval rules exactly: reviewer → `recorded_via="expert_self"`; owner → `recorded_via="operator"`, `expert_name` required).
- **ADR-001:** the LLM api key never touches a log line / response / traceback. The per-topic generate endpoint mirrors `generate_version`'s key handling; keep an `assert key not in r.text` test.
- **Grounding:** "use ONLY the topic's sources / invent nothing"; label the topic's sources `[S1..Sn]` (scoped to the topic's `source_ids`, not the whole project).
- **Snapshot + orphan:** `topic_version` stores `topic_id` (the TOC unit id) + snapshot `title` + `source_ids`. A `topic_version` whose `topic_id` is not in the current `project.toc` is **orphaned** — kept, excluded from the book rollup.
- **Validated** = a `topic_version`'s latest `topic_approval` (by `seq`) has `action='approve'` (mirror `approval_repo.is_validated`).
- Migration `down_revision = "0014"` (current head); downgrade drops both tables.
- Pre-push: `backend/.venv/bin/ruff check backend/ pipeline/` + `ruff format --check backend/ pipeline/` from repo root. Test DB `mentible_test` (docker `mentible_local_pg`); harness auto-applies migrations.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `backend/alembic/versions/0015_topic_version.py` (new) — both tables
- `backend/src/trust/models.py` — `TopicVersion`, `TopicApproval` dataclasses
- `backend/src/trust/topic_repo.py` (new) — topic_version repo
- `backend/src/trust/topic_approval_repo.py` (new) — topic_approval repo
- `backend/src/trust/topic_prompt.py` (new) — per-topic generation prompt
- `backend/src/trust/generate_topic.py` (new) — the generator
- `backend/src/trust/router.py` — 3 endpoints + per-topic status in the project detail
- `backend/src/trust/schemas.py` — `TopicVersionOut`, `TopicApprovalOut`, topic status types
- Tests: `backend/tests/test_trust_topic.py` (new), `backend/tests/test_trust_router.py`

---

### Task 1: Migration 0015 + models + repos

**Files:**
- Create: `backend/alembic/versions/0015_topic_version.py`, `backend/src/trust/topic_repo.py`, `backend/src/trust/topic_approval_repo.py`
- Modify: `backend/src/trust/models.py`
- Test: `backend/tests/test_trust_topic.py` (new)

**Interfaces:**
- Produces: tables `topic_version` / `topic_approval`; `TopicVersion`/`TopicApproval` dataclasses; `topic_repo.create_topic_version`/`list_topic_versions`/`get_topic_version`; `topic_approval_repo.record_topic_approval`/`get_latest_topic_approval`/`is_topic_validated`.

- [ ] **Step 1: Write the failing repo test** (`backend/tests/test_trust_topic.py` — model on how `test_trust_*` acquire a DB conn/fixture and seed a project; reuse that fixture):
```python
async def test_topic_version_and_approval_roundtrip(conn, project_id):  # adapt fixture names to the repo's conftest
    from backend.src.trust import topic_repo, topic_approval_repo
    tv = await topic_repo.create_topic_version(
        conn, project_id=project_id, topic_id="t1", title="Reading music",
        source_ids=["s1"], content={"sections": [{"heading": "Staff", "body": "…", "source_ids": ["s1"]}]},
        created_by_sub="sub-1",
    )
    assert tv.version_no == 1
    assert not await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)
    await topic_approval_repo.record_topic_approval(
        conn, topic_version_id=tv.id, expert_name="Dr X", approved_at=_now(),
        recorded_by_sub="sub-1", expert_email=None, expert_role=None, note=None, recorded_via="operator",
    )
    assert await topic_approval_repo.is_topic_validated(conn, topic_version_id=tv.id)
    # a second version for the same topic increments version_no
    tv2 = await topic_repo.create_topic_version(conn, project_id=project_id, topic_id="t1", title="Reading music",
        source_ids=["s1"], content={"sections": []}, created_by_sub="sub-1")
    assert tv2.version_no == 2
```
(Use the repo's real conftest fixtures for a conn + a seeded project; `_now()` = a tz-aware datetime.)

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_topic.py -v` → FAIL (no tables/repos).

- [ ] **Step 3: Migration 0015.**
```python
"""topic_version + topic_approval — per-topic drafts & validation (Slice C1)"""
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE topic_version (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            topic_id text NOT NULL,
            title text NOT NULL,
            source_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
            content jsonb NOT NULL,
            version_no int NOT NULL,
            created_by_sub text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_topic_version_project_topic ON topic_version (project_id, topic_id, version_no);
        CREATE TABLE topic_approval (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            topic_version_id uuid NOT NULL REFERENCES topic_version(id) ON DELETE CASCADE,
            seq int NOT NULL,
            action text NOT NULL,
            expert_name text NOT NULL,
            expert_email text,
            expert_role text,
            approved_at timestamptz NOT NULL,
            recorded_by_sub text NOT NULL,
            note text,
            recorded_via text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_topic_approval_version_seq ON topic_approval (topic_version_id, seq);
        """
    )

def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS topic_approval; DROP TABLE IF EXISTS topic_version;")
```
(Confirm `gen_random_uuid()` is available — the other trust tables use it; match their default. If they use a different id default/pattern, mirror that instead.)

- [ ] **Step 4: Models (`models.py`).** Add frozen dataclasses mirroring `ArtifactVersion`/`Approval`:
```python
@dataclass(frozen=True)
class TopicVersion:
    id: str
    project_id: str
    topic_id: str
    title: str
    source_ids: object       # parsed jsonb list
    content: object          # parsed jsonb {sections:[...]}
    version_no: int
    created_by_sub: str
    created_at: datetime | None

@dataclass(frozen=True)
class TopicApproval:
    id: str
    topic_version_id: str
    seq: int
    action: str
    expert_name: str
    expert_email: str | None
    expert_role: str | None
    approved_at: datetime
    recorded_by_sub: str
    note: str | None
    recorded_via: str
    created_at: datetime | None
```

- [ ] **Step 5: Repos.** `topic_repo.py` — mirror `artifact_repo`'s version helpers (jsonb read via `json.loads`, jsonb write via `json.dumps(...)::jsonb`, parameterised SQL):
  - `create_topic_version(conn, *, project_id, topic_id, title, source_ids, content, created_by_sub)` — computes `version_no = COALESCE(MAX(version_no),0)+1` for `(project_id, topic_id)` and inserts; returns `TopicVersion`.
  - `list_topic_versions(conn, *, project_id)` → all `TopicVersion`s for the project (for the status rollup), ordered.
  - `get_topic_version(conn, *, topic_version_id)` → `TopicVersion | None`.
  - `project_id_for_topic_version(conn, *, topic_version_id)` → `str | None` (for the approval routes' auth, mirroring `project_id_for_version`).
  `topic_approval_repo.py` — mirror `approval_repo`:
  - `record_topic_approval(conn, *, topic_version_id, expert_name, approved_at, recorded_by_sub, expert_email, expert_role, note, recorded_via, action="approve")` — append with next `seq`.
  - `withdraw_topic_approval(conn, *, topic_version_id, recorded_by_sub, note)` — append `action="withdraw"` (mirror `withdraw_approval`, incl. its 409-if-not-approved contract — raise the same exception type the artifact repo uses, or return a sentinel the route maps to 409; match the existing pattern).
  - `get_latest_topic_approval(conn, *, topic_version_id)` → `TopicApproval | None`.
  - `is_topic_validated(conn, *, topic_version_id)` → latest action == 'approve'.

- [ ] **Step 6: Run tests + ruff.** `cd backend && python -m pytest tests/test_trust_topic.py -v`; from repo root `backend/.venv/bin/ruff check backend/ pipeline/ && backend/.venv/bin/ruff format --check backend/ pipeline/`.

- [ ] **Step 7: Commit.**
```bash
git add backend/alembic/versions/0015_topic_version.py backend/src/trust/models.py backend/src/trust/topic_repo.py backend/src/trust/topic_approval_repo.py backend/tests/test_trust_topic.py
git commit -m "feat(trust): topic_version + topic_approval tables + repos (Slice C1)"
```

---

### Task 2: Per-topic generator + generate endpoint

**Files:**
- Create: `backend/src/trust/topic_prompt.py`, `backend/src/trust/generate_topic.py`
- Modify: `backend/src/trust/router.py`, `backend/src/trust/schemas.py`
- Test: `backend/tests/test_trust_topic.py`, `backend/tests/test_trust_router.py`

**Interfaces:**
- Consumes: `topic_repo.create_topic_version` (T1); `project.toc`; the topic's `source_ids`.
- Produces: `generate_topic_draft(*, sources, topic_title, subtopics, audience, goal, provider_id, api_key, model) -> _TopicDraft` (`{sections:[{heading,body,source_ids}]}`); `POST /projects/{project_id}/topics/{topic_id}/generate` → `TopicVersionOut`.

- [ ] **Step 1: Write failing tests.** In `test_trust_topic.py` (prompt is pure):
```python
def test_topic_prompt_scopes_to_topic_sources_and_sections_per_subtopic():
    p = build_topic_prompt(_SOURCES, "Reading music", ["Staff & clef", "Note values"], "beginners", "read music")
    assert "Reading music" in p
    assert "Staff & clef" in p and "Note values" in p    # subtopics drive the sections
    assert "invent nothing" in p.lower()
    assert "S1" in p
```
Endpoint test in `test_trust_router.py` (mirror the suggest-toc test's mocked-provider setup + how it seeds a project with `toc` + inputs): seed a project whose `toc` has a topic `t1` with `source_ids` pointing at a real input; mock the provider to return `{"sections":[{"heading":"Staff","body":"…","source_ids":["S1"]}]}`; `POST /projects/{id}/topics/t1/generate`; assert 200 + a `topic_version` persisted with snapshot `title`/`source_ids` and `version_no==1`; unknown topic id → 404; a topic with no `source_ids` → 422; reviewer → 403; `assert key not in r.text` (ADR-001).

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_topic.py tests/test_trust_router.py -k topic -v`.

- [ ] **Step 3: Prompt (`topic_prompt.py`)** — mirror `toc_prompt.py`'s labelling + grounding, scoped to ONE topic:
```python
def build_topic_prompt(sources, topic_title, subtopics, audience, goal) -> str:
    labelled = "\n\n".join(
        f'[S{i + 1}] ({s.kind}{": " + s.title if s.title else ""})\n"""\n{s.content}\n"""'
        for i, s in enumerate(sources)
    )
    subs = "; ".join(subtopics) if subtopics else "(no subtopics given — use one section for the topic)"
    ctx = []
    if audience:
        ctx.append(f"for {audience}")
    if goal:
        ctx.append(f"so the reader can {goal}")
    ctx_line = (" " + " ".join(ctx)) if ctx else ""
    return (
        f'You are writing the section on "{topic_title}"{ctx_line}. Using ONLY the sources below, '
        f"write one section per subtopic — subtopics: {subs}. Each section's heading is the subtopic; "
        f"its body is grounded ONLY in the sources and cites the source label(s) it draws from. Invent "
        f"nothing beyond the sources — if a subtopic is not covered, omit its section.\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"sections": [{{"heading": "string", "body": "string", "sources": ["S1"]}}]}}'
    )
```

- [ ] **Step 4: Generator (`generate_topic.py`)** — mirror `toc_suggest.py`/`generate.py`:
```python
_MAX_TOKENS = 4096
class _TopicSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []
class _TopicDraft(BaseModel):
    sections: list[_TopicSection] = Field(min_length=1, max_length=20)

def generate_topic_draft(*, sources, topic_title, subtopics, audience, goal, provider_id, api_key, model) -> _TopicDraft:
    prompt = build_topic_prompt(sources, topic_title, subtopics, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")
    def _validate(text: str) -> _TopicDraft:
        return _TopicDraft.model_validate(parse_json_response(text))
    return generate_validated(provider, req, _validate, max_repairs=2).parsed
```

- [ ] **Step 5: Endpoint (`router.py`) + schema.** `schemas.py`: `TopicVersionOut{id, topic_id, title, content, version_no, created_at}`. In `router.py` add (owner-only, `dependencies=[Depends(enforce_rate_limit)]`):
  - Load project + `project.toc`; find the topic by `topic_id` in the TOC (404 if absent); read its `source_ids` + subtopics + title.
  - Resolve the topic's `source_ids` to the project's inputs; 422 if empty. Build the `sources` list (only the topic's inputs) and the `by_label = {f"S{i+1}": str(inp.id)}` scoped to them.
  - Key handling identical to `generate_version` (managed vs `body.api_key`); call `generate_topic_draft` via `asyncio.to_thread`; same LLM error mapping (LLMSchemaError→502, rate-limit→429).
  - Map the returned sections' `S`-labels → real input ids (like `generate_version`), snapshot `title` + the topic's `source_ids`, and `topic_repo.create_topic_version(...)`. Return `TopicVersionOut`.

- [ ] **Step 6: Run tests + ruff** — `cd backend && python -m pytest tests/test_trust_topic.py tests/test_trust_router.py -v`; ruff clean from repo root.

- [ ] **Step 7: Commit.**
```bash
git add backend/src/trust/topic_prompt.py backend/src/trust/generate_topic.py backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_topic.py backend/tests/test_trust_router.py
git commit -m "feat(trust): per-topic generate endpoint (section per subtopic, grounded) (Slice C1)"
```

---

### Task 3: Per-topic approval endpoints (record + withdraw)

**Files:**
- Modify: `backend/src/trust/router.py`, `backend/src/trust/schemas.py`
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Consumes: `topic_approval_repo` (T1), `topic_repo.project_id_for_topic_version` (T1).
- Produces: `POST /topic-versions/{id}/approvals` + `POST /topic-versions/{id}/approvals/withdraw` → `TopicApprovalOut`.

- [ ] **Step 1: Write failing tests** (`test_trust_router.py`): seed a project + a `topic_version` (via the generate endpoint or a repo helper); owner records an approval WITHOUT `expert_name` → 422; with `expert_name` → 200 + `recorded_via="operator"` and the topic reads as validated; a reviewer (membership) records → `recorded_via="expert_self"`; withdraw → topic no longer validated; withdraw when not approved → 409; a non-member → 403; unknown topic_version id → 404.

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_router.py -k topic_approval -v`.

- [ ] **Step 3: Implement.** `schemas.py`: `TopicApprovalOut{id, topic_version_id, expert_name, approved_at, recorded_via, action}`. In `router.py`, add the two routes **mirroring `record_version_approval` / `withdraw_version_approval` verbatim** but against topics: use `topic_repo.project_id_for_topic_version` for the 404 + auth (`_require_role(..., need_owner=False)`), the same reviewer→`expert_self` / owner→`operator`(+expert_name-required) branch, then `topic_approval_repo.record_topic_approval(...)` / `withdraw_topic_approval(...)`; reuse the existing `schemas.ApprovalIn` / `schemas.WithdrawIn` request bodies (they carry expert fields, no version binding). Map the withdraw-when-not-approved case to **409** exactly as the artifact route does.

- [ ] **Step 4: Run tests + ruff** — `cd backend && python -m pytest tests/test_trust_router.py -v`; ruff clean.

- [ ] **Step 5: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_router.py
git commit -m "feat(trust): per-topic approve/withdraw endpoints (Slice C1)"
```

---

### Task 4: Per-topic status + book_validated in the project detail

**Files:**
- Modify: `backend/src/trust/router.py`, `backend/src/trust/schemas.py`
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Consumes: `project.toc`, `topic_repo.list_topic_versions`, `topic_approval_repo.is_topic_validated`.
- Produces: `ProjectDetailOut.topic_status: list[{topic_id, status}]` (`not_generated|drafted|validated`) + `book_validated: bool` on the project detail response.

- [ ] **Step 1: Write the failing test** (`test_trust_router.py`): a project whose `toc` has topics `t1,t2`; generate + validate `t1`, generate (not validate) `t2`; `GET /projects/{id}` → `topic_status` = `t1:validated, t2:drafted`, `book_validated=false`. Validate `t2` → `book_validated=true`. Add an orphan: a `topic_version` for `tX` (not in `toc`) → excluded from `topic_status` and does not affect `book_validated`.

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_router.py -k topic_status -v`.

- [ ] **Step 3: Implement.** In `get_project`'s detail builder: compute the current topic ids from `project.toc` (`[u.id for subj in toc.subjects for u in subj.units]`, tolerating `toc is None` / missing `units`). For each current topic, find its latest `topic_version` (max `version_no` among `list_topic_versions` with that `topic_id`) → `not_generated` if none, else `validated` if `is_topic_validated(latest)` else `drafted`. `book_validated = bool(topic_ids) and all(status == "validated")`. Orphaned versions (topic_id not in the current set) are simply never looked up. Add `topic_status` + `book_validated` to `schemas.ProjectDetailOut` (or the project sub-object — match where `toc` lives) and populate them.

- [ ] **Step 4: Run tests + ruff** — `cd backend && python -m pytest tests/test_trust_router.py tests/test_trust_topic.py -v` (all pass); ruff clean.

- [ ] **Step 5: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_router.py
git commit -m "feat(trust): per-topic status + book_validated on project detail (Slice C1)"
```

---

## Final verification (after all tasks)

- [ ] `cd backend && python -m pytest tests/test_trust_topic.py tests/test_trust_router.py -v` — all pass; ADR-001 key-leak assertion green; `ruff check` + `ruff format --check` clean.
- [ ] Migration 0015 applies cleanly on the test DB (`alembic upgrade head` reaches 0015) and downgrades.
- [ ] PR body: **prod backend refresh + `alembic upgrade head` (migration 0015)** on ship. Mobile UI is **Slice C2** (separate) — C1 ships backend-only; no web redeploy needed for C1 alone (no client consumes the new endpoints yet).

## Self-Review

- **Spec coverage:** tables + repos (T1) · per-topic generate, section-per-subtopic, grounded, snapshot (T2) · separate topic_approval record/withdraw mirroring artifact rules (T3) · per-topic status + book_validated + orphan exclusion (T4). Slice D (assembly) + C2 (mobile UI) correctly excluded.
- **Type consistency:** `TopicVersion`/`TopicApproval` (T1) consumed by T2/T3/T4; `create_topic_version` signature identical across T1 (def) and T2/T4 (call); `is_topic_validated` (T1) used by T3/T4; content shape `{sections:[{heading,body,source_ids}]}` identical to artifact drafts (viewer reuse).
- **Placeholders:** none — migration DDL, prompt, generator, and endpoint logic are literal; the "adapt fixture names to the repo's conftest" notes point the implementer at the real test harness rather than inventing one.
- **Grounding + ADR-001** preserved on the new generate path; app-level authz, no RLS.
