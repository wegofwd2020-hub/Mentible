# Per-topic panel S4 — manual topic edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a project owner manually edit a topic version's content into a new version, mirroring
the whole-book viewer's Edit path — a new POST endpoint + the mobile edit UI. No migration.

**Architecture:** `POST /projects/{id}/topics/{topic_id}/versions {content}` (owner) → the existing
`create_topic_version` (server-set `generation_meta`); mobile adds an edit mode mirroring
`version/[versionId].tsx`.

**Tech Stack:** FastAPI + asyncpg; React Native + Expo TS; pytest / Jest.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-per-topic-panel-s4-manual-edit-design.md`.
- **Mirror the whole-book pattern** — `create_version` endpoint (`router.py:236`, `need_owner=True`,
  content-only body) and the whole-book viewer's edit mode (`version/[versionId].tsx`:
  `draft`/`startEdit`/`updateSection`/`removeSection`/`save`, ~lines 105-260 + the edit JSX ~330-378).
- **No migration.** `create_topic_version` (S1) already takes `title/source_ids/content/generation_meta`.
- **Owner-only** endpoint (`need_owner=True`); server sets `generation_meta` (client cannot).
- Backend `ruff check` **AND** `ruff format --check` (CI runs both — do not skip format). `asyncpg`.
- `useThemedStyles`; reuse the whole-book edit styles + S1-S3 flows; **no color-literal asserts**.
- Backend `pytest`; mobile `npx tsc --noEmit` + full `npx jest`. Commit messages end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

Two tasks, sequential (T2 depends on T1's endpoint). Backend DB tests run in CI (real PG); a local
temp PG (`mentible_local_pg`, DATABASE_URL set, run pytest from repo root) is ideal for red→green.

## File Structure & anchors

- `backend/src/trust/router.py` — new POST near the S2 GET `/projects/{project_id}/topics/{topic_id}/versions`;
  mirror `create_version` (@236) + `generate_topic_version`'s `TopicVersionOut` response mapping (~826/794).
  `topic_repo.list_topic_versions` + `create_topic_version` exist.
- `backend/src/trust/schemas.py` — `TopicVersionContentIn { content: dict }` (do NOT reuse `VersionCreateIn`,
  which exposes `generation_meta`). `TopicVersionOut` (line 204) is the response.
- `mobile/src/api/trustClient.ts` — `createTopicVersion(projectId, topicId, content, token)`;
  `TopicVersionCreatedView` exists.
- `mobile/src/hooks/useTrustProject.ts` — `editTopic`.
- `mobile/app/trust/topic-version/[id].tsx` — edit mode (mirror the whole-book viewer). Has S1 `openRegen`,
  S2 `reload`/history, S3 feedback; add `editing`/`draft` state + the edit JSX; gate the read-only blocks
  on `!editing`.

---

### Task 1: Backend manual-edit endpoint

**Files:** `router.py`, `schemas.py`; test under `backend/tests/`.

- [ ] **Step 1: Failing test** (mirror `create_version` + topic tests): owner `POST
  /projects/{id}/topics/{topic_id}/versions` with `{content:{sections:[{heading,body,source_ids:["a","b"]}]}}`
  creates a new topic version (version_no increments, content stored, `source_ids` = derived union
  `["a","b"]`, `generation_meta.kind == "manual_edit"`); a **reviewer** → 403; unknown topic (no
  versions) → 404. Run — fail.

- [ ] **Step 2: Schema.** `schemas.TopicVersionContentIn(BaseModel): content: dict`.

- [ ] **Step 3: Endpoint.**
  ```python
  @router.post("/projects/{project_id}/topics/{topic_id}/versions", response_model=schemas.TopicVersionOut)
  async def create_topic_version_manual(project_id: uuid.UUID, topic_id: str,
      body: schemas.TopicVersionContentIn, principal=Depends(require_active_user),
      conn=Depends(get_conn)):
      account = await _account(conn, principal)
      await _require_role(conn, account, project_id, need_owner=True)
      existing = [v for v in await topic_repo.list_topic_versions(conn, project_id=project_id)
                  if v.topic_id == topic_id]
      if not existing:
          raise HTTPException(status.HTTP_404_NOT_FOUND, "topic not found")
      title = existing[-1].title  # list_topic_versions orders by topic_id, version_no → last = latest
      sections = body.content.get("sections", []) if isinstance(body.content, dict) else []
      source_ids = sorted({sid for s in sections for sid in (s.get("source_ids") or [])})
      v = await topic_repo.create_topic_version(conn, project_id=project_id, topic_id=topic_id,
          title=title, source_ids=source_ids, content=body.content, created_by_sub=principal.sub,
          generation_meta={"kind": "manual_edit", "source_input_ids": source_ids})
      return schemas.TopicVersionOut(id=str(v.id), topic_id=v.topic_id, title=v.title,
          content=v.content or {"sections": []}, version_no=v.version_no, created_at=v.created_at)
  ```
  (Confirm the exact `TopicVersionOut` field list against the schema + how `generate_topic_version`
  builds it, and match it.)

- [ ] **Step 4: Run** — from repo root, `ruff check backend/src/trust && ruff format --check backend/src/trust && python -m pytest -k topic -q` (DATABASE_URL set; CI runs the DB tests).

- [ ] **Step 5: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests
git commit -m "feat(trust): manual topic edit endpoint — create a topic version from content"
```

---

### Task 2: Mobile edit mode

**Files:** `trustClient.ts`, `useTrustProject.ts`, `topic-version/[id].tsx`; tests.

- [ ] **Step 1: Failing test** — owner sees "Edit text"; pressing it (unvalidated) enters edit mode
  with section editors seeded from `topicVersion.content.sections`; editing a section heading/body +
  "Save as new version" calls the hook `editTopic` with `{ sections: <edited> }` and `router.replace`s
  to the returned id; a **reviewer** does NOT see "Edit text". Follow the topic-viewer test seam. Run — fail.

- [ ] **Step 2: Client + hook.** `trustClient.ts`: `createTopicVersion(projectId, topicId, content:
  object, token): Promise<TopicVersionCreatedView>` (`POST /projects/${projectId}/topics/${topicId}/versions`,
  `{ content }`). `useTrustProject.ts`: `editTopic(topicId, content)` → `createTopicVersion(projectId,
  topicId, content, accessToken)` (guard `!accessToken`).

- [ ] **Step 3: Viewer edit mode** (mirror `version/[versionId].tsx`):
  - Add `editing`/`draft` state (`{ heading; body; source_ids }[]`), `startEdit`
    (confirm if `is_validated`; seed `draft` from `topicVersion.content?.sections ?? []` deep-copying
    `source_ids`; `setEditing(true)`), `updateSection`, `removeSection`, add-section, and `save`
    (`const v = await editTopic(topicVersion.topic_id, { sections: draft }); router.replace(...)`).
  - Owner-only **"Edit text"** `Button variant="ghost"` next to Revise.
  - When `editing`, render the section editors + "Add section" + "Save as new version" (mirror the
    whole-book edit JSX ~330-378) and HIDE the read-only reader render + revise/approve/history/feedback
    blocks (gate them on `!editing`, like the whole-book viewer). Reuse the whole-book edit styles.
  - No new color literals.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__
git commit -m "feat(trust): owner manual edit of a topic draft (section editors → new version)"
```

---

## Final verification (after all tasks)

- [ ] From repo root `ruff check backend && ruff format --check backend && python -m pytest -k topic -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] No migration (grep the diff: no `alembic/versions/*`). Backend limited to router+schemas+tests; mobile to client/hook/viewer+tests.
- [ ] **Deploy:** backend refresh (NO alembic), then web. **Web verify** (local recipe w/ the
  `status:"signed_in"`+token patch; stub accepting the POST + returning the edited version): owner
  "Edit text" → section editors → save navigates to a new version; reviewer sees no Edit.
- [ ] PR body: per-topic S4 — manual edit (new version from content, no migration); backend refresh +
  web. Completes the per-topic full-parity arc.

## Self-Review

- **Spec coverage:** endpoint (T1) · mobile edit mode (T2). No migration; provenance tagged
  server-side; whole-book-mirrored UI.
- **Type consistency:** `TopicVersionContentIn.content` dict; `TopicVersionOut` response matches
  `generate_topic_version`; client `createTopicVersion`→`TopicVersionCreatedView` (`.id` for nav).
- **Constraints:** owner-only; server-set generation_meta; ruff check+format; no color-literal asserts.
