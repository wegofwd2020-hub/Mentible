# Trust Capture — Project Sources (inputs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project owner add raw sources (paste a transcript / note / link) to a trust project over HTTP + a mobile **Sources** surface; everyone with project access can see them. This is ADR-037 Phase 01 "Capture".

**Architecture:** The `project_input` table + `project_repo.add_input`/`list_inputs` **already exist and are repo-tested** — this slice only adds schemas + two endpoints (owner-only POST, list in the project detail) mirroring `create_artifact`/`get_project`, then a mobile client/hook/UI mirroring the existing artifact/invite surfaces. No migration, no repo changes, no generation, no file upload.

**Tech Stack:** FastAPI + asyncpg (backend), Pydantic v2, React Native + Expo, Jest/RNTL.

## Global Constraints
- **No migration, no repo code, no generation.** Reuse `project_repo.add_input(conn, *, project_id, kind, title=None, content=None, source_ref=None)` and `list_inputs(conn, *, project_id)` exactly as-is.
- **Access:** POST is **owner-only** (`_require_role(conn, account, project_id, need_owner=True)`); the detail listing is visible to **owner + reviewer** (`need_owner=False`). Mirror `create_artifact` / `get_project` in `backend/src/trust/router.py`.
- **Kind is limited to `transcript|note|link`** at the schema boundary — `upload` is a valid repo kind but blocked here (no blob storage this slice).
- **Backend endpoint tests need a live Postgres** with the trust migrations applied (`test_trust_router.py` is `skipif(not DATABASE_URL)`). The executor must supply `DATABASE_URL` (the shared test-DB password was rotated — do NOT hardcode any secret in the plan/tests; provision or ask). Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py -v`.
- **Backend lint:** ruff at `~/.local/bin/ruff` (`export PATH="$HOME/.local/bin:$PATH"`), NOT `.venv/bin/ruff`.
- **Mobile:** `cd mobile && npm test -- <path>`; typecheck `npx tsc --noEmit` (baseline 0); **run `npx eslint <files>` before each mobile commit** (CI gate lints; anon components trip `react/display-name`, unused imports error).
- **Help DoD gate:** a new `FEATURES` key REQUIRES a matching Help topic in the same PR (`mobile/__tests__/help/coverage.test.ts`).

---

### Task 1: Backend — schemas + `POST /inputs` + inputs in project detail + endpoint tests

**Files:**
- Modify: `backend/src/trust/schemas.py` (add `ProjectInputIn`, `ProjectInputOut`; add `inputs` to `ProjectDetailOut`)
- Modify: `backend/src/trust/router.py` (add POST endpoint; add `inputs` to `get_project`)
- Test: `backend/tests/test_trust_router.py` (append the input tests)

**Interfaces:**
- Consumes: `project_repo.add_input`/`list_inputs`; `_account`, `_require_role`, `require_active_user`, `get_conn`, `ProjectAccessError` (already imported in `router.py`).
- Produces: `POST /api/v1/trust/projects/{project_id}/inputs -> ProjectInputOut`; `GET /api/v1/trust/projects/{project_id}` now returns `inputs: [ProjectInputOut]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_trust_router.py` (mirrors the existing `_as`/`TestClient` pattern; the invite→reviewer→`session/sync` redeem pattern is copied from `test_invite_then_reviewer_reads`):
```python
def test_owner_adds_input_and_it_appears_in_detail():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "Stormwater", "topic": "runoff"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/inputs",
            json={"kind": "transcript", "title": "Interview 1", "content": "We size pipes for the 10-year storm."},
        )
        assert r.status_code == 200
        assert r.json()["kind"] == "transcript"
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert len(detail["inputs"]) == 1
        assert detail["inputs"][0]["title"] == "Interview 1"


def test_input_bad_kind_and_empty_content_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        assert c.post(f"/api/v1/trust/projects/{pid}/inputs",
                      json={"kind": "upload", "content": "x"}).status_code == 422  # blocked kind
        assert c.post(f"/api/v1/trust/projects/{pid}/inputs",
                      json={"kind": "note", "content": ""}).status_code == 422    # empty content


def test_reviewer_cannot_add_input_but_can_view():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "owner note"})
        expert_email = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        # expert redeems membership via session/sync, then reads
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["my_role"] == "reviewer"
        assert len(detail["inputs"]) == 1                # reviewer CAN see sources
        # reviewer CANNOT add
        r = c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "nope"})
        assert r.status_code == 403


def test_stranger_cannot_add_input():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        assert c.post(f"/api/v1/trust/projects/{pid}/inputs",
                      json={"kind": "note", "content": "x"}).status_code == 403
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py -k "input" -v`
Expected: FAIL (404/422 mismatch — the `/inputs` route doesn't exist; `detail["inputs"]` KeyError).

- [ ] **Step 3: Add the schemas**

In `backend/src/trust/schemas.py` (near the other `*In`/`*Out` classes; `Literal` + `Field` + `datetime` are already imported there — confirm and add imports if not):
```python
InputKind = Literal["transcript", "note", "link"]

class ProjectInputIn(BaseModel):
    kind: InputKind
    title: str | None = Field(default=None, max_length=200)
    content: str = Field(min_length=1, max_length=200_000)
    source_ref: str | None = Field(default=None, max_length=500)

class ProjectInputOut(BaseModel):
    id: str
    kind: str
    title: str | None
    content: str
    source_ref: str | None
    created_at: datetime | None
```
Add `inputs: list[ProjectInputOut]` to `ProjectDetailOut` (after `my_role` is fine; it's a keyword field).

- [ ] **Step 4: Add the POST endpoint (mirror `create_artifact`)**

In `backend/src/trust/router.py`, add:
```python
@router.post("/projects/{project_id}/inputs", response_model=schemas.ProjectInputOut)
async def add_project_input(
    project_id: uuid.UUID,
    body: schemas.ProjectInputIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectInputOut:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    try:
        i = await project_repo.add_input(
            conn,
            project_id=project_id,
            kind=body.kind,
            title=body.title,
            content=body.content,
            source_ref=body.source_ref,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e
    return schemas.ProjectInputOut(
        id=str(i.id), kind=i.kind, title=i.title,
        content=i.content, source_ref=i.source_ref, created_at=i.created_at,
    )
```

- [ ] **Step 5: Add `inputs` to `get_project`**

In `get_project`, before building `ProjectDetailOut`, add:
```python
    inputs = [
        schemas.ProjectInputOut(
            id=str(i.id), kind=i.kind, title=i.title,
            content=i.content, source_ref=i.source_ref, created_at=i.created_at,
        )
        for i in await project_repo.list_inputs(conn, project_id=project_id)
    ]
```
and pass `inputs=inputs` into the `schemas.ProjectDetailOut(...)` return.

- [ ] **Step 6: Run tests + lint**

Run: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py -v`
Expected: all pass (the 4 new input tests + the existing router tests).
Then: `cd backend && export PATH="$HOME/.local/bin:$PATH" && ruff check src/trust/router.py src/trust/schemas.py tests/test_trust_router.py && ruff format --check src/trust/router.py src/trust/schemas.py`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_router.py
git commit -m "feat(trust): Capture — add/list project inputs endpoints (ADR-037 Phase 01)"
```

---

### Task 2: Mobile — `trustClient` + `useTrustProject` (addInput + inputs)

**Files:**
- Modify: `mobile/src/api/trustClient.ts`
- Modify: `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/api/trustClient.inputs.test.ts`

**Interfaces:**
- Consumes: existing `trustFetch`, `ProjectDetailView`, `createArtifact` (the mirror), `useTrustProject`'s existing `addArtifact` mutation.
- Produces: `ProjectInputView`; `addProjectInput(projectId, body, token): Promise<ProjectInputView>`; `ProjectDetailView.inputs: ProjectInputView[]`; `useTrustProject().inputs` + `useTrustProject().addInput(body)`.

**Notes:** READ `mobile/src/api/trustClient.ts` (`createArtifact` + `ProjectDetailView`) and `mobile/src/hooks/useTrustProject.ts` (`addArtifact`) first, and mirror them exactly for the new client fn + hook mutation.

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/api/trustClient.inputs.test.ts`:
```ts
import { addProjectInput } from "@/api/trustClient";

function mockFetchOnce(status: number, body: unknown) {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300, status,
    json: async () => body, text: async () => JSON.stringify(body),
    headers: { get: () => null },
  });
}
afterEach(() => jest.restoreAllMocks());

it("POSTs a project input with the JWT and returns the created input", async () => {
  const created = { id: "i1", kind: "note", title: "T", content: "c", source_ref: null, created_at: null };
  mockFetchOnce(200, created);
  const out = await addProjectInput("p1", { kind: "note", title: "T", content: "c" }, "tok");
  expect(out.id).toBe("i1");
  const [url, init] = (global as unknown as { fetch: jest.Mock }).fetch.mock.calls[0];
  expect(url).toMatch(/\/trust\/projects\/p1\/inputs$/);
  expect(init.method).toBe("POST");
  expect(init.headers.Authorization).toBe("Bearer tok");
  expect(JSON.parse(init.body)).toMatchObject({ kind: "note", content: "c" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/api/trustClient.inputs.test.ts`
Expected: FAIL — `addProjectInput` not exported.

- [ ] **Step 3: Add the client fn + type (mirror `createArtifact`)**

In `mobile/src/api/trustClient.ts`:
```ts
export interface ProjectInputView {
  id: string; kind: string; title: string | null;
  content: string; source_ref: string | null; created_at: string | null;
}

export async function addProjectInput(
  projectId: string,
  body: { kind: "transcript" | "note" | "link"; title?: string; content: string; source_ref?: string },
  token: string,
): Promise<ProjectInputView> {
  return (await trustFetch<ProjectInputView>(
    `/projects/${projectId}/inputs`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ProjectInputView;
}
```
Add `inputs: ProjectInputView[]` to the `ProjectDetailView` interface.

- [ ] **Step 4: Wire the hook (mirror `addArtifact`)**

In `mobile/src/hooks/useTrustProject.ts`: expose `inputs: project?.inputs ?? []` from the detail, and add an `addInput` mutation that calls `addProjectInput(projectId, body, accessToken)` then `refresh()` — modeled exactly on the existing `addArtifact` mutation (same token guard, same refresh-on-success). Return `addInput` + `inputs` from the hook.

- [ ] **Step 5: Run test + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/api/trustClient.inputs.test.ts && npx tsc --noEmit`
Then: `cd mobile && npx eslint src/api/trustClient.ts src/hooks/useTrustProject.ts __tests__/api/trustClient.inputs.test.ts`
Expected: PASS + 0 type errors + eslint clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/api/trustClient.inputs.test.ts
git commit -m "feat(trust): mobile client + hook for project inputs (ADR-037 Phase 01)"
```

---

### Task 3: Mobile — Sources section in the project workspace

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.sources.test.tsx`

**Interfaces:**
- Consumes: `useTrustProject().inputs` + `.addInput` (Task 2); `my_role` (already used for owner gating).
- Produces: a "Sources" section — owner add form (kind selector + title + paste box + Add), source list for all roles.

**Notes:** READ `mobile/app/trust/[projectId].tsx` first — mirror the existing **owner-only** action pattern (`my_role === "owner"` gating, the same input/button styling used by the Invite / Add-artifact / Add-version affordances) and the existing test file `mobile/__tests__/screens/TrustProjectDetail.owner.test.tsx` for the mock/harness pattern (mock `useTrustProject`, expo-router, `@/lib/alert`).

- [ ] **Step 1: Write the failing test**

`mobile/__tests__/screens/TrustProjectDetail.sources.test.tsx` — mock `useTrustProject` to return a project with `my_role` + `inputs` + an `addInput` jest.fn; render the route (`import TrustProjectDetail from "@/../app/trust/[projectId]"`), and assert:
- as **owner**: the add-source form is present (a "Add source" control by accessibility label); typing content + pressing Add calls `addInput` with the entered `{kind, content}`.
- as **reviewer**: the source **list** renders the mocked `inputs` items, but the add form/button is **absent**.
Follow the exact mock shape in `TrustProjectDetail.owner.test.tsx` (same `(useTrustProject as jest.Mock).mockReturnValue({...})`).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.sources.test.tsx`
Expected: FAIL — no Sources section.

- [ ] **Step 3: Add the Sources section**

In `mobile/app/trust/[projectId].tsx`, add a **"Sources"** section (place it near the top of the project body, before Artifacts — sources are the raw material):
- A `<Text>` section header "Sources" + one-line helper ("The expert's raw knowledge. Paste a transcript, note, or link.").
- **Owner-only** (gate on `my_role === "owner"`): a kind selector (three `Pressable`s: Transcript / Note / Link, default "note"), an optional title `TextInput`, a multiline content `TextInput`, and an **"Add source"** `Pressable` (accessibilityLabel="Add source"), disabled while content is empty. On press → `await addInput({ kind, title: title.trim() || undefined, content: content.trim() })` then clear the fields.
- **All roles**: the list of `inputs` — each row shows the kind (label), the title (or a `content` preview truncated to ~80 chars), created date. Empty state: "No sources yet." (+ the capture hint for owners).
- Use the file's existing theme tokens / `StyleSheet` idiom (this screen is not yet theme-migrated — keep it consistent with its current static `colors` usage; do NOT introduce `useThemedStyles` here).

- [ ] **Step 4: Run the new test + the existing detail tests + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.sources.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx && npx tsc --noEmit`
Then: `cd mobile && npx eslint "app/trust/[projectId].tsx" __tests__/screens/TrustProjectDetail.sources.test.tsx`
Expected: all pass + 0 type errors + eslint clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.sources.test.tsx
git commit -m "feat(trust): Sources section (Capture) in project workspace (ADR-037 Phase 01)"
```

---

### Task 4: Help topic + full-suite / DoD gate

**Files:**
- Modify: `mobile/src/help-content/features.ts`
- Modify: `mobile/src/help-content/topics.ts`

- [ ] **Step 1: Add the FEATURES key**

In `mobile/src/help-content/features.ts`, add to `FEATURES`:
```ts
  { key: "sources", label: "Sources (Capture)" },
```

- [ ] **Step 2: Run the coverage test to verify it FAILS**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts`
Expected: FAIL — `sources` uncovered.

- [ ] **Step 3: Add the Help topic**

In `mobile/src/help-content/topics.ts`, add to `HELP_TOPICS`:
```ts
  {
    id: "sources",
    title: "Sources — capture the expert's knowledge",
    featureKey: "sources",
    keywords: ["source", "sources", "capture", "transcript", "note", "link", "input", "material", "intake"],
    blocks: [
      {
        kind: "text",
        text: "Sources are the raw material a project is built from — an interview transcript, a note, or a link to something the expert wrote. Open a project and, as its owner, paste a source under Sources. Everyone invited to the project can see the sources behind the work. Adding sources is the first step; a later step turns them into a drafted, expert-reviewed asset.",
      },
    ],
  },
```

- [ ] **Step 4: Run coverage + full mobile suite + tsc + eslint**

Run: `cd mobile && npm test -- __tests__/help/coverage.test.ts && npm test && npx tsc --noEmit`
Then: `cd mobile && npx eslint src/help-content/features.ts src/help-content/topics.ts`
Expected: coverage PASS; full suite green; 0 type errors; eslint clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "feat(trust): Help topic for Sources (Capture) — ADR-037 Phase 01 DoD"
```

---

## Final verification (after all tasks)
- Backend: `cd backend && PYTHONPATH=$(git rev-parse --show-toplevel) DATABASE_URL=<dsn> .venv/bin/pytest tests/test_trust_router.py -v` (all green) + `ruff check src/trust tests/test_trust_router.py`.
- Mobile: `cd mobile && npm test && npx tsc --noEmit && npx eslint src/api/trustClient.ts src/hooks/useTrustProject.ts "app/trust/[projectId].tsx"`.

## Self-Review notes (author)
- **Spec coverage:** schemas + POST + detail-listing + endpoint tests = Task 1; mobile client/hook = Task 2; Sources UI = Task 3; Help DoD = Task 4. Owner-add / all-view access split is enforced in Task 1 (`need_owner=True` on POST, `need_owner=False` on GET) and reflected in Task 3's owner-gated form.
- **No-migration/no-repo confirmed:** the plan reuses `add_input`/`list_inputs` verbatim; only schemas/router/client/UI/tests/help change.
- **Type consistency:** `ProjectInputOut` (Task 1) ↔ `ProjectInputView` (Task 2) same fields; `addProjectInput` signature (Task 2) consumed by `addInput` (Task 2 hook) + Task 3 UI; `inputs` added to both `ProjectDetailOut` (Task 1) and `ProjectDetailView` (Task 2).
- **Risk flagged:** backend endpoint tests require a live Postgres + `DATABASE_URL` (shared pw rotated — executor provisions/supplies it; never hardcode a secret). Mobile tasks need no DB.
- **Deviation guard:** Task 3 explicitly does NOT theme-migrate `[projectId].tsx` (keeps its current static `colors`) — theming migration is a separate workstream (#340 follow-ups).
