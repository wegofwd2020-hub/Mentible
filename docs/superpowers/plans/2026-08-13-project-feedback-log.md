# Project-wide feedback log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only project-wide "Revision notes" timeline aggregating every feedback note across a project's drafts (artifact + topic feedback), shown as a section in the workspace Feedback phase.

**Architecture:** A `UNION ALL` query over `feedback` + `topic_feedback`, joined to their draft and scoped to the project, exposed at `GET /projects/{id}/feedback` (owner or reviewer). Mobile fetches it and renders a "Revision notes" section in `FeedbackPanel`. Read-only; no new table/migration.

**Tech Stack:** FastAPI + asyncpg (backend); React Native (Expo) (mobile); pytest; Jest + RNTL.

## Global Constraints

- Owner **or** reviewer access (`_require_role(..., need_owner=False)`); read-only. The mobile section is non-critical — a fetch failure hides/empties it, never errors the panel.
- No color-literal asserts; theme via `useThemedStyles`/tokens. Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed:** `feedback` = `{id, version_id, author_kind, author_name, body, recorded_by_sub, created_at, seq}`; `topic_feedback` = `{id, topic_version_id, author_kind, author_name, body, ...}`. `artifact_version` has `version_no` + `artifact_id`; `artifact` has `format`/`title`. `topic_version` has `title` + `version_no` + `project_id`. Pattern for a project-scoped owner-or-reviewer GET: `list_topic_version_history` (`router.py`, uses `_require_role(conn, account, project_id, need_owner=False)`).

---

### Task 1: Backend — `list_project_feedback` + `GET /projects/{id}/feedback`

**Files:**
- Modify: `backend/src/trust/feedback_repo.py` (add `list_project_feedback`), `backend/src/trust/schemas.py` (`ProjectFeedbackItemOut`), `backend/src/trust/router.py` (the endpoint)
- Test: `backend/tests/test_trust_project_feedback.py` (new)

**Interfaces:**
- Produces: `GET /projects/{project_id}/feedback -> list[ProjectFeedbackItemOut]` where `ProjectFeedbackItemOut = { source: str; draft_label: str; format: str | None; version_no: int; author_kind: str; author_name: str | None; body: str; created_at: datetime | None }`.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_trust_project_feedback.py` (mirror `test_trust_router.py` fixtures: TestClient + the `_as`/auth helper). Create a project, an artifact + a version, a topic + a topic-version; add feedback to the artifact version (`POST /versions/{id}/feedback`) and to the topic version (`POST /topic-versions/{id}/feedback`); then `GET /api/v1/trust/projects/{id}/feedback` and assert: both notes returned; each has the right `source`, `draft_label` (artifact title/format · the topic title), `version_no`, `author_kind`, `body`; newest-first order; a reviewer (invited/redeemed) can read it; a non-member → 403; an empty project → `[]`. (Reuse whatever helpers the existing feedback tests use to create versions + post feedback.)

- [ ] **Step 2: Run it — FAIL** (no endpoint).

- [ ] **Step 3: Add `list_project_feedback`** to `feedback_repo.py` — a single `UNION ALL` returning rows shaped for `ProjectFeedbackItemOut`:
```python
async def list_project_feedback(conn, *, project_id) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT 'artifact' AS source, COALESCE(a.title, a.format) AS draft_label,
               a.format AS format, v.version_no AS version_no,
               f.author_kind, f.author_name, f.body, f.created_at
          FROM feedback f
          JOIN artifact_version v ON f.version_id = v.id
          JOIN artifact a ON v.artifact_id = a.id
         WHERE a.project_id = $1
        UNION ALL
        SELECT 'topic' AS source, tv.title AS draft_label,
               NULL AS format, tv.version_no AS version_no,
               tf.author_kind, tf.author_name, tf.body, tf.created_at
          FROM topic_feedback tf
          JOIN topic_version tv ON tf.topic_version_id = tv.id
         WHERE tv.project_id = $1
        ORDER BY created_at DESC, draft_label
        """,
        project_id,
    )
    return [dict(r) for r in rows]
```
(Return dicts, or map to a small dataclass — match the repo's style; the router shapes `ProjectFeedbackItemOut`.)

- [ ] **Step 4: Add `ProjectFeedbackItemOut`** to `schemas.py` (fields above).

- [ ] **Step 5: Add the endpoint** in `router.py` (mirror `list_topic_version_history`):
```python
@router.get("/projects/{project_id}/feedback", response_model=list[schemas.ProjectFeedbackItemOut])
async def list_project_feedback(project_id: uuid.UUID, principal: Principal = Depends(require_active_user), conn: asyncpg.Connection = Depends(get_conn)) -> list[schemas.ProjectFeedbackItemOut]:
    account = await _account(conn, principal)
    await _require_role(conn, account, project_id, need_owner=False)  # owner OR reviewer
    rows = await feedback_repo.list_project_feedback(conn, project_id=project_id)
    return [schemas.ProjectFeedbackItemOut(**r) for r in rows]
```
(Adjust `**r` if the repo returns dataclasses; ensure the field names line up with `ProjectFeedbackItemOut`.)

- [ ] **Step 6: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_trust_project_feedback.py tests/test_trust_router.py -q`. Commit:
```bash
git add backend/src/trust/feedback_repo.py backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_project_feedback.py
git commit -m "feat(trust): GET /projects/{id}/feedback — project-wide feedback rollup (owner or reviewer)"
```

---

### Task 2: Mobile — Revision-notes section in the Feedback phase

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (`listProjectFeedback` + `ProjectFeedbackItem` type), `mobile/app/trust/[projectId].tsx` (the `FeedbackPanel` section)
- Test: the FeedbackPanel/TrustProjectDetail feedback test

**Interfaces:**
- Consumes: `listProjectFeedback(projectId, token): Promise<ProjectFeedbackItem[]>` (`{ source; draft_label; format: string | null; version_no; author_kind; author_name: string | null; body; created_at: string | null }`).

- [ ] **Step 1: Client + type** in `trustClient.ts`:
```ts
export interface ProjectFeedbackItem { source: string; draft_label: string; format: string | null; version_no: number; author_kind: string; author_name: string | null; body: string; created_at: string | null }
export async function listProjectFeedback(projectId: string, token: string): Promise<ProjectFeedbackItem[]> {
  return (await trustFetch<ProjectFeedbackItem[]>(`/projects/${projectId}/feedback`, token)) as ProjectFeedbackItem[];
}
```

- [ ] **Step 2: Fetch it.** In `[projectId].tsx`, fetch the feedback log when the Feedback phase is shown (a small `useState` + `useEffect`/focus, or thread through `useTrustProject`). **Fail-open:** on error, an empty list (don't error the panel). Only fetch when signed-in + on the Feedback phase.

- [ ] **Step 3: Write the failing screen test** — extend the FeedbackPanel/feedback test: mock `listProjectFeedback` → 2 items (one artifact, one topic); switch to the Feedback phase; assert a "Revision notes" section renders both rows (draft label, version, author, note body), newest-first; mock → `[]` → the empty state "No revision notes yet."; a rejected fetch → no crash (section empty/absent). No color-literal asserts.

- [ ] **Step 4: Add the section to `FeedbackPanel`.** Below (or above) the existing review/version content, render a **"Revision notes"** section (a section header + a subtle divider so it's visually distinct): a list of rows, each = `draft_label · v{version_no}` (small/kicker), the `body` (the note), and a meta line `author_name || author_kind` `·` formatted `created_at`. Newest-first (the API already orders). Empty → "No revision notes yet." Use theme tokens; `numberOfLines` where sensible. Thread the fetched items into `FeedbackPanel` via a prop.

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Keep existing FeedbackPanel tests green.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/api/trustClient.ts mobile/app/trust/[projectId].tsx mobile/__tests__
git commit -m "feat(trust): project-wide Revision-notes log in the Feedback phase"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_trust_project_feedback.py tests/test_trust_router.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] Access: owner AND reviewer can read the log; a non-member → 403. The mobile section fails open (fetch error → empty, panel not broken).
- [ ] **Deploy:** backend refresh + web deploy. No migration.

## Out of scope

- Editing/deleting from the log; a notifications/unread model; deep-link from a row (optional nice-to-have, not required); the unified-4-tab layout.
