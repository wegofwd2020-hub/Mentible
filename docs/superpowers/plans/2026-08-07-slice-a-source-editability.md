# Slice A — Source view / edit / delete — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project owner view the full content of a source and edit / delete it, guarded so a source cited by a generated draft can't be silently removed or have its grounded content changed.

**Architecture:** Backend gains `PATCH`/`DELETE /api/v1/trust/inputs/{input_id}` (owner-only) with a "cited by a version" guard (scans `artifact_version.content.sections[].source_ids`). Mobile makes each Sources row open a detail sheet with Edit/Delete (owner) or read-only (reviewer).

**Tech Stack:** FastAPI · asyncpg · Pydantic v2 · pytest · React Native + Expo · Jest + RNTL.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-slice-a-source-editability-design.md`; arc: `…/2026-08-07-projects-toc-structure-arc-design.md`.
- Owner-only (`_require_role(..., need_owner=True)`); reviewers get read-only UI. App-level authz, no RLS.
- **Cited-guard:** an input cited by ANY artifact version → **DELETE blocked (409)** and **content-edit blocked (409)**; editing **title / source_ref is allowed even when cited** (they don't change grounded text). "Cited" = the input id appears in some `artifact_version.content -> 'sections'` element's `source_ids` (the `artifact_version_source` join table is unpopulated — do NOT use it).
- No migration (`project_input` already has the columns; `content_hash`/`storage_path` are unused — leave them).
- Route keyed by `input_id` alone; resolve the project from the row (mirrors `/versions/{id}`).
- Mobile: `useThemedStyles` (selected theme, no forced `SmeThemeScope`); RN literals `as const`; `Alert` from `@/lib/alert`; jest.mock consts `mock`-prefixed; screen import path `@/../app/trust/[projectId]`. Run REAL `npx tsc --noEmit`.
- **Prod backend refresh on ship** (new routes) or PATCH/DELETE 404 on prod.

**Local backend test recipe (DB migrated to 0013):**
```bash
cd backend
export DATABASE_URL="postgresql://postgres:devlocal@localhost:5439/mentible_test"
export BYOK_MASTER_KEY="0000000000000000000000000000000000000000000000000000000000000000"
export SYSTEM_OWNER_SECRET="1111111111111111111111111111111111111111111111111111111111111111"
export REDIS_URL="redis://localhost:6379/0" APP_ENV=test LOG_LEVEL=INFO
export PYTHONPATH=/home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
source .venv/bin/activate
```
(If the pg container is stopped: `docker start mentible_local_pg`.)

---

### Task 1: Backend — input update/delete + cited-guard

**Files:**
- Modify: `backend/src/trust/project_repo.py` (`get_input`, `update_input`, `delete_input`, `input_cited`)
- Modify: `backend/src/trust/access.py` (`project_id_for_input`)
- Modify: `backend/src/trust/schemas.py` (`ProjectInputUpdateIn`)
- Modify: `backend/src/trust/router.py` (`PATCH`/`DELETE /inputs/{input_id}`)
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `PATCH /api/v1/trust/inputs/{input_id}` (body `{title?, content?, source_ref?}` → `ProjectInputOut`; 409 if content-edit on a cited input); `DELETE /api/v1/trust/inputs/{input_id}` (204; 409 if cited). `project_repo`: `get_input`, `update_input`, `delete_input`, `input_cited`. `access.project_id_for_input`.

- [ ] **Step 1: Write the failing tests**

Add to `backend/tests/test_trust_router.py` (mirrors the existing `_as` helper + TestClient pattern):

```python
def _seed_project_with_input(c, owner):
    _as(owner, f"{owner}@x.z")
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    iid = c.post(f"/api/v1/trust/projects/{pid}/inputs",
                 json={"kind": "note", "title": "T", "content": "body here"}).json()["id"]
    return pid, iid


def test_edit_and_delete_uncited_input():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        # edit title + content on an uncited input
        r = c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "T2", "content": "new body"})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "T2" and r.json()["content"] == "new body"
        # delete uncited → 204, gone
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 204
        inputs = c.get(f"/api/v1/trust/projects/{pid}").json()["inputs"]
        assert all(i["id"] != iid for i in inputs)


def test_cited_input_guards_content_edit_and_delete_but_allows_title():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        # create an artifact + a version whose content cites this input id
        art = c.post(f"/api/v1/trust/projects/{pid}/artifacts",
                     json={"role": "cornerstone", "format": "book"}).json()
        c.post(f"/api/v1/trust/artifacts/{art['id']}/versions",
               json={"content": {"sections": [{"heading": "H", "body": "B", "source_ids": [iid]}]}})
        # content edit blocked
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "x"}).status_code == 409
        # delete blocked
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 409
        # title edit allowed even when cited
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "renamed"}).status_code == 200
        # still present
        assert any(i["id"] == iid for i in c.get(f"/api/v1/trust/projects/{pid}").json()["inputs"])


def test_input_edit_delete_owner_only_and_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")   # non-member
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "z"}).status_code == 403
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 403
        _as(owner, f"{owner}@x.z")
        assert c.patch(f"/api/v1/trust/inputs/{uuid.uuid4()}", json={"title": "z"}).status_code == 404
```

- [ ] **Step 2: Run — verify they fail**

Run: `cd backend && python -m pytest tests/test_trust_router.py -k "input" -v`
Expected: FAIL (405/404 — no PATCH/DELETE routes).

- [ ] **Step 3: Repo methods (`project_repo.py`)**

Add (mirroring `add_input`/`list_inputs`, reusing `_I` + `_input`):

```python
async def get_input(conn, *, input_id) -> ProjectInput | None:
    r = await conn.fetchrow(f"SELECT {_I} FROM project_input WHERE id = $1", input_id)
    return _input(r) if r else None


async def update_input(conn, *, input_id, title, content, source_ref) -> ProjectInput:
    r = await conn.fetchrow(
        f"UPDATE project_input SET title=$2, content=$3, source_ref=$4 WHERE id=$1 RETURNING {_I}",
        input_id, title, content, source_ref,
    )
    return _input(r)


async def delete_input(conn, *, input_id) -> None:
    await conn.execute("DELETE FROM project_input WHERE id = $1", input_id)


async def input_cited(conn, *, project_id, input_id) -> bool:
    return bool(await conn.fetchval(
        """
        SELECT EXISTS (
          SELECT 1 FROM artifact_version v JOIN artifact a ON a.id = v.artifact_id
          WHERE a.project_id = $1 AND v.content IS NOT NULL
            AND v.content -> 'sections' @> jsonb_build_array(
                  jsonb_build_object('source_ids', jsonb_build_array($2::text)))
        )
        """,
        project_id, str(input_id),
    ))
```

Note: if the `@>` containment proves brittle at test time, replace `input_cited`'s query with a
Python scan — load the project's versions and check `str(input_id) in section["source_ids"]`.
Correctness over cleverness; keep the same signature.

- [ ] **Step 4: `project_id_for_input` (`access.py`)**

Mirror `project_id_for_artifact`:

```python
async def project_id_for_input(conn, *, input_id) -> uuid.UUID | None:
    return await conn.fetchval("SELECT project_id FROM project_input WHERE id = $1", input_id)
```

- [ ] **Step 5: Schema (`schemas.py`)**

After `ProjectInputOut`:

```python
class ProjectInputUpdateIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=200_000)
    source_ref: str | None = Field(default=None, max_length=500)
```

- [ ] **Step 6: Endpoints (`router.py`)**

Import `project_id_for_input` alongside the other `access` imports. Add after `add_project_input`:

```python
@router.patch("/inputs/{input_id}", response_model=schemas.ProjectInputOut)
async def edit_project_input(
    input_id: uuid.UUID,
    body: schemas.ProjectInputUpdateIn,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.ProjectInputOut:
    project_id = await project_id_for_input(conn, input_id=input_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    cur = await project_repo.get_input(conn, input_id=input_id)
    if cur is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    if body.content is not None and await project_repo.input_cited(conn, project_id=project_id, input_id=input_id):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This source is cited by a draft — edit the draft, or remove the citation first.")
    i = await project_repo.update_input(
        conn,
        input_id=input_id,
        title=body.title if body.title is not None else cur.title,
        content=body.content if body.content is not None else cur.content,
        source_ref=body.source_ref if body.source_ref is not None else cur.source_ref,
    )
    return schemas.ProjectInputOut(
        id=str(i.id), kind=i.kind, title=i.title, content=i.content,
        source_ref=i.source_ref, created_at=i.created_at,
    )


@router.delete("/inputs/{input_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_input(
    input_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> None:
    project_id = await project_id_for_input(conn, input_id=input_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=True)
    if await project_repo.input_cited(conn, project_id=project_id, input_id=input_id):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This source is cited by a draft — remove it from the draft first.")
    await project_repo.delete_input(conn, input_id=input_id)
```

Note: PATCH is a partial update — a `None` field means "leave unchanged" (fall back to `cur`), so the
title-only edit doesn't blank content/source_ref.

- [ ] **Step 7: Run — verify pass + full trust suite**

Run: `cd backend && python -m pytest tests/test_trust_router.py -v`
Expected: PASS (the 3 new + all existing). Confirm the no-key-in-logs gate still passes.

- [ ] **Step 8: Commit**

```bash
git add backend/src/trust/project_repo.py backend/src/trust/access.py backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): edit/delete project source inputs + cited-by-version guard"
```

---

### Task 2: Mobile — source detail / edit / delete UI

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (`updateInput`, `deleteInput`)
- Modify: `mobile/src/hooks/useTrustProject.ts` (`editInput`, `removeInput`)
- Modify: `mobile/app/trust/[projectId].tsx` (SourcesPanel row → detail/edit/delete)
- Test: `mobile/__tests__/screens/TrustProjectDetail.sources-edit.test.tsx` (new) + extend `trustClient` tests if present

**Interfaces:**
- Consumes: the Task-1 endpoints.
- Produces: `trustClient.updateInput(inputId, body: {title?; content?; source_ref?}, token)`, `deleteInput(inputId, token)`. `useTrustProject.editInput(inputId, body)`, `removeInput(inputId)`. Owner Sources rows open a detail with Edit/Delete; reviewers read-only.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustProjectDetail.sources-edit.test.tsx` (model on the existing `TrustProjectDetail.sources.test.tsx`). Seed `my_role:"owner"` with one input `{ id:"i1", kind:"note", title:"T", content:"full body", source_ref:null, created_at:null }`. Mock `useTrustProject` exposing `editInput`/`removeInput` jest.fns. Assert:

```ts
// row opens detail with FULL content (not the 80-char preview)
fireEvent.press(getByLabelText("Open source T"));
expect(getByText("full body")).toBeTruthy();
// edit
fireEvent.press(getByLabelText("Edit source"));
fireEvent.changeText(getByLabelText("Source content"), "edited body");
fireEvent.press(getByLabelText("Save source"));
await waitFor(() => expect(mockEditInput).toHaveBeenCalledWith("i1", expect.objectContaining({ content: "edited body" })));
// delete (confirm auto-fires via the Alert mock)
fireEvent.press(getByLabelText("Delete source"));
await waitFor(() => expect(mockRemoveInput).toHaveBeenCalledWith("i1"));
```

Add a second case: `my_role:"reviewer"` → opening the row shows content but **no** Edit/Delete controls (`queryByLabelText("Edit source")` is null).

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.sources-edit.test.tsx`
Expected: FAIL (no "Open source" affordance).

- [ ] **Step 3: Client (`trustClient.ts`)**

```ts
export async function updateInput(
  inputId: string, body: { title?: string; content?: string; source_ref?: string }, token: string,
): Promise<ProjectInputView> {
  return (await trustFetch<ProjectInputView>(`/inputs/${inputId}`, token, { method: "PATCH", body: JSON.stringify(body) })) as ProjectInputView;
}

export async function deleteInput(inputId: string, token: string): Promise<void> {
  await trustFetch<null>(`/inputs/${inputId}`, token, { method: "DELETE" });
}
```

- [ ] **Step 4: Hook (`useTrustProject.ts`)**

```ts
  const editInput = useCallback(async (inputId: string, body: { title?: string; content?: string; source_ref?: string }) => {
    if (!accessToken) throw new Error("Not signed in");
    const i = await updateInput(inputId, body, accessToken);
    await refresh(); return i;
  }, [accessToken, refresh]);

  const removeInput = useCallback(async (inputId: string) => {
    if (!accessToken) throw new Error("Not signed in");
    await deleteInput(inputId, accessToken);
    await refresh();
  }, [accessToken, refresh]);
```

Import `updateInput, deleteInput` from `@/api/trustClient`; add `editInput, removeInput` to the returned object.

- [ ] **Step 5: SourcesPanel detail / edit / delete UI (`[projectId].tsx`)**

Make each source row in `SourcesPanel` a `Pressable` (`accessibilityLabel={`Open source ${sourcePreview(input.title, input.content)}`}` — keep it stable/short) that opens a **detail** for that input (a `Modal` or an inline expanded card — match the file's existing modal idiom, e.g. how other sheets are done; a simple inline expand is fine). The detail shows `kind`, `title`, full `content`, `source_ref`. For an **owner**:
- **Edit** (`accessibilityLabel="Edit source"`) → an editable form: title `TextInput`, content `TextInput` multiline (`accessibilityLabel="Source content"`), source_ref `TextInput` → **Save** (`accessibilityLabel="Save source"`) → `editInput(id, { title, content, source_ref })`; on `ApiError` 409 show the guard message via `Alert` and keep the source.
- **Delete** (`accessibilityLabel="Delete source"`) → `Alert.alert` confirm → `removeInput(id)`; on 409 show the guard message.
For a **reviewer** (`!isOwner`): detail is read-only — no Edit/Delete.
Thread `isOwner`, `editInput`, `removeInput` into `SourcesPanel` props. Add styles (`as const`) as needed; reuse existing input/button styles where possible.

- [ ] **Step 6: Run — verify pass + full Sources/Detail suites + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`
Expected: PASS (new sources-edit + existing detail/sources/journey/etc.), tsc clean.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.sources-edit.test.tsx
git commit -m "feat(trust): Sources — view full, edit, delete (owner); read-only for reviewer"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_router.py -v` — all pass; no-key gate green.
- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green, tsc clean.
- [ ] PR body: **prod backend refresh on ship** (new PATCH/DELETE routes; no migration). Web redeploy for UI.

## Self-review

- **Spec coverage:** edit + delete endpoints + cited-guard (title-allowed / content+delete-blocked) + owner-only + 404 (T1); client + hook + detail/edit/delete UI + reviewer read-only + 409 handling (T2). Non-goals (TOC/Structure, kind-change) excluded.
- **Type consistency:** `updateInput(inputId, {title?,content?,source_ref?})` identical in client (T2) and hook + the `PATCH` body shape matches `ProjectInputUpdateIn` (T1); `input_cited(project_id, input_id)` used identically in both endpoints.
- **Placeholders:** none — repo/schema/endpoint code literal with the exact guard logic; the T2 UI step names the exact accessibility labels the tests assert.
