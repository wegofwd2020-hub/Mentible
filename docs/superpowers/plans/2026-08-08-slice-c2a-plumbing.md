# Slice C2a — per-topic plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The plumbing that lets the mobile app drive the shipped Slice C1 per-topic endpoints — a backend `GET /topic-versions/{id}` (content + validated) plus the client calls, types, and hook methods. No visible UI (that's C2b/C2c).

**Architecture:** Backend read endpoint mirrors `GET /versions/{id}` (`get_version`) but over `topic_version`/`topic_approval`. Mobile client + hook mirror the artifact equivalents (`getVersion`/`generateVersion`/`approveVersion`/`withdrawApproval`). No migration.

**Tech Stack:** FastAPI + asyncpg (pytest, real test Postgres); React Native + Expo TS (Jest/RNTL, mocked `trustFetch`).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-08-slice-c2-per-topic-ui-design.md`. C1 backend is live (`topic_version`/`topic_approval`, generate/approve/withdraw, `topic_status`+`book_validated` on the project detail).
- **Auth:** `GET /topic-versions/{id}` is owner-OR-member (mirror `get_version`: resolve project via `topic_repo.project_id_for_topic_version` → `require_project_access`; non-member 403; unknown id 404). No RLS/tenant column.
- **ADR-001:** the api key flows only into `generateTopic`'s request body (mirror `generateVersion`); never logged, never in a response, never in a test fixture that gets asserted into output.
- **Reuse existing shapes:** `content = {sections:[{heading,body,source_ids}]}`; `is_validated`/`recorded_via` from `topic_approval_repo.is_topic_validated` + `get_latest_topic_approval`.
- No visible UI in C2a; no color-literal test assertions. `npx tsc --noEmit` strict clean; backend `ruff check` + `ruff format --check` clean (from repo root).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `backend/src/trust/router.py` — `GET /topic-versions/{id}` (C2a/T1)
- `backend/src/trust/schemas.py` — `TopicVersionDetailOut` (C2a/T1)
- `mobile/src/api/trustClient.ts` — types + `generateTopic`/`getTopicVersion`/`recordTopicApproval`/`withdrawTopicApproval` (C2a/T2)
- `mobile/src/hooks/useTrustProject.ts` — `generateTopic`/`approveTopic`/`withdrawTopic` + surface `topic_status`/`book_validated` (C2a/T2)
- Tests: `backend/tests/test_trust_router.py`; `mobile/__tests__/api/trustClient.topic.test.ts` (or the repo's client-test location) + a hook test if one exists.

---

### Task 1: Backend — `GET /topic-versions/{id}`

**Files:**
- Modify: `backend/src/trust/router.py`, `backend/src/trust/schemas.py`
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Consumes: `topic_repo.get_topic_version` + `project_id_for_topic_version` (C1); `topic_approval_repo.is_topic_validated` + `get_latest_topic_approval` (C1).
- Produces: `GET /topic-versions/{topic_version_id}` → `TopicVersionDetailOut{id, topic_id, title, content, version_no, created_at, is_validated, recorded_via}`.

- [ ] **Step 1: Write the failing test** (`test_trust_router.py`, mirror the existing topic-generate + get_version tests): seed a project + a `topic_version` (via the generate endpoint); `GET /topic-versions/{id}` as the owner → 200 + `content.sections` present + `is_validated=false`, `recorded_via=null`; approve it → `GET` shows `is_validated=true`, `recorded_via="operator"`; a reviewer/member → 200; a non-member → 403; unknown id → 404.

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_router.py -k topic_version_detail -v` → FAIL (no route).

- [ ] **Step 3: Schema (`schemas.py`).** Add (mirror `VersionDetailOut`, + `topic_id`, no artifact_id):
```python
class TopicVersionDetailOut(BaseModel):
    id: str
    topic_id: str
    title: str
    content: dict
    version_no: int
    created_at: datetime | None
    is_validated: bool
    recorded_via: str | None
```

- [ ] **Step 4: Endpoint (`router.py`).** Mirror `get_version`'s auth, using the topic repos:
```python
@router.get("/topic-versions/{topic_version_id}", response_model=schemas.TopicVersionDetailOut)
async def get_topic_version(
    topic_version_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    conn: asyncpg.Connection = Depends(get_conn),
) -> schemas.TopicVersionDetailOut:
    project_id = await topic_repo.project_id_for_topic_version(conn, topic_version_id=topic_version_id)
    if project_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "topic version not found")
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=False)  # owner or member may read
    tv = await topic_repo.get_topic_version(conn, topic_version_id=topic_version_id)
    latest = await topic_approval_repo.get_latest_topic_approval(conn, topic_version_id=topic_version_id)
    return schemas.TopicVersionDetailOut(
        id=str(tv.id), topic_id=tv.topic_id, title=tv.title,
        content=tv.content or {"sections": []}, version_no=tv.version_no, created_at=tv.created_at,
        is_validated=(latest.action == "approve") if latest else False,
        recorded_via=latest.recorded_via if latest else None,
    )
```
(Confirm `_require_role`/`_account`/`require_active_user` names against `get_version`; if `get_version` uses a different member-read helper, mirror THAT. If `is_topic_validated` is preferred over inspecting `latest.action`, use it — but you need `latest.recorded_via` anyway, so one `get_latest_topic_approval` call is enough.)

- [ ] **Step 5: Run tests + ruff** — `cd backend && python -m pytest tests/test_trust_router.py -v`; from repo root `backend/.venv/bin/ruff check backend/ pipeline/ && ruff format --check backend/ pipeline/`.

- [ ] **Step 6: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_router.py
git commit -m "feat(trust): GET /topic-versions/{id} (content + validated) (Slice C2a)"
```

---

### Task 2: Mobile — client calls + types + hook wiring

**Files:**
- Modify: `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/api/trustClient.topic.test.ts` (new; match the repo's client-test style/location) + extend a hook test if present

**Interfaces:**
- Consumes: the C1 endpoints + Task 1's `GET /topic-versions/{id}`.
- Produces: `ProjectDetailView.topic_status?`/`book_validated?`; `TopicVersionDetailView`; `generateTopic`/`getTopicVersion`/`recordTopicApproval`/`withdrawTopicApproval` client fns; hook `generateTopic`/`approveTopic`/`withdrawTopic`.

- [ ] **Step 1: Write the failing test** (`trustClient.topic.test.ts`, mirror any existing `trustClient` test that mocks `trustFetch`): assert
  - `generateTopic("p1","t1",{api_key:"k",provider_id:"anthropic"},"tok")` calls `trustFetch` with path `/projects/p1/topics/t1/generate`, method POST, and the body containing the key;
  - `getTopicVersion("tv1","tok")` → GET `/topic-versions/tv1`;
  - `recordTopicApproval("tv1",{approved_at,expert_name},"tok")` → POST `/topic-versions/tv1/approvals`;
  - `withdrawTopicApproval("tv1",{},"tok")` → POST `/topic-versions/tv1/approvals/withdraw`.
  (Mock `trustFetch` and assert the path/method/body — mirror the existing client test exactly; if none exists, assert via a mocked global fetch the same way the client is unit-tested elsewhere.)

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/api/trustClient.topic.test.ts`.

- [ ] **Step 3: Types + calls (`trustClient.ts`).**
- Extend `ProjectDetailView`: add `topic_status?: { topic_id: string; status: "not_generated" | "drafted" | "validated" }[]` and `book_validated?: boolean`.
- Add `TopicVersionCreatedView { id: string; topic_id: string; version_no: number; created_at: string | null }` and `TopicVersionDetailView { id: string; topic_id: string; title: string; content: { sections: DraftSection[] }; version_no: number; created_at: string | null; is_validated: boolean; recorded_via: string | null }`.
- Add the calls (mirror the artifact equivalents' style — `trustFetch<...>(path, token, {method, body})`):
```ts
export async function generateTopic(projectId: string, topicId: string, body: { api_key: string; provider_id?: string; model?: string }, token: string): Promise<TopicVersionCreatedView> {
  return (await trustFetch<TopicVersionCreatedView>(`/projects/${projectId}/topics/${topicId}/generate`, token, { method: "POST", body: JSON.stringify(body) })) as TopicVersionCreatedView;
}
export async function getTopicVersion(id: string, token: string): Promise<TopicVersionDetailView> {
  return (await trustFetch<TopicVersionDetailView>(`/topic-versions/${id}`, token, { method: "GET" })) as TopicVersionDetailView;
}
export async function recordTopicApproval(id: string, body: { approved_at: string; note?: string; expert_name?: string }, token: string): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(`/topic-versions/${id}/approvals`, token, { method: "POST", body: JSON.stringify(body) })) as ApprovalView;
}
export async function withdrawTopicApproval(id: string, body: { note?: string }, token: string): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(`/topic-versions/${id}/approvals/withdraw`, token, { method: "POST", body: JSON.stringify(body) })) as ApprovalView;
}
```

- [ ] **Step 4: Hook (`useTrustProject.ts`).** Add (mirror `generateVersion`/`approve`/`unapprove` — key load, POST, `refresh()`):
```ts
  const generateTopic = useCallback(async (topicId: string) => {
    const key = await loadApiKey("anthropic");
    if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate.");
    if (!accessToken) throw new Error("Not signed in");
    const v = await generateTopicApi(projectId, topicId, { api_key: key, provider_id: "anthropic" }, accessToken);
    await refresh(); return v;
  }, [accessToken, projectId, refresh]);
  const approveTopic = useCallback(async (id: string, opts?: { note?: string; expertName?: string }) => {
    if (!accessToken) throw new Error("Not signed in");
    const ap = await recordTopicApproval(id, { approved_at: new Date().toISOString(), note: opts?.note, expert_name: opts?.expertName }, accessToken);
    await refresh(); return ap;
  }, [accessToken, refresh]);
  const withdrawTopic = useCallback(async (id: string) => {
    if (!accessToken) throw new Error("Not signed in");
    await withdrawTopicApproval(id, {}, accessToken);
    await refresh();
  }, [accessToken, refresh]);
```
Import `generateTopic as generateTopicApi, recordTopicApproval, withdrawTopicApproval` from `@/api/trustClient`; add `generateTopic`/`approveTopic`/`withdrawTopic` to the returned object. (`getTopicVersion` is called directly by the viewer later, like `getVersion` — no hook method needed. `topic_status`/`book_validated` are already on `project` via the extended type.)

- [ ] **Step 5: Run test + tsc** — `cd mobile && npx jest __tests__/api/trustClient.topic.test.ts && npx tsc --noEmit`. Run any existing `useTrustProject`/`trustClient` suite to catch regressions.

- [ ] **Step 6: Commit.**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/api/trustClient.topic.test.ts
git commit -m "feat(trust): per-topic client calls + hook wiring (Slice C2a)"
```

---

## Final verification (after both tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_router.py -v` (topic-version-detail + existing pass); ADR-001 key-leak gate green; ruff clean.
- [ ] Mobile: `cd mobile && npx jest __tests__/api __tests__/hooks 2>/dev/null; npx tsc --noEmit` — green + clean.
- [ ] PR body: backend adds `GET /topic-versions/{id}` (no migration) → **prod backend refresh**. Mobile client/hook are plumbing (no visible UI); ships with C2b's redeploy. No APK rebuild needed for C2a.

## Self-Review

- **Spec coverage:** backend read endpoint (T1) · client types/calls + hook (T2). No UI (C2b/C2c deferred). Slice D out.
- **Type consistency:** `TopicVersionDetailOut` (T1) mirrors `TopicVersionDetailView` (T2); `topic_status`/`book_validated` added to `ProjectDetailView` match C1's response; `generateTopic`/`recordTopicApproval`/`withdrawTopicApproval` paths match the live C1 routes.
- **Placeholders:** none — endpoint + schema + client code literal; the "mirror `get_version`/existing client test" notes point at real code, not invented harnesses.
- **ADR-001** preserved on `generateTopic`; auth mirrors `get_version` (owner-or-member read).
