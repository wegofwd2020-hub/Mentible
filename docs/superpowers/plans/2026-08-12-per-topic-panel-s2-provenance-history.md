# Per-topic panel S2 — provenance + inline history — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provenance line + inline version history to the per-topic draft viewer, mirroring the
whole-book panel: a `generation_meta` column on `topic_version` (populated on generate) + a new
per-topic version-list endpoint, surfaced in the mobile viewer.

**Architecture:** Backend migration `0016` + repo/router changes (mirror the whole-book
`artifact_version.generation_meta` pattern) + a new list endpoint; mobile client/hook/viewer changes
reusing the existing `describeProvenance` helper and whole-book history-block shape.

**Tech Stack:** FastAPI + asyncpg + alembic (backend); React Native + Expo TS (mobile); pytest / Jest.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-per-topic-panel-s2-provenance-history-design.md`.
- **Mirror the whole-book pattern exactly** — `backend/src/trust/artifact_repo.py` (generation_meta
  store/read) and `router.py:388-402` (meta assembly). Do NOT invent a new shape. `kind = "topic_draft"`.
- **No backfill** — old rows keep `generation_meta = NULL`; `describeProvenance(null)` handles it.
- New endpoint uses `require_project_access` (the trust access guard). `asyncpg` for DB.
- `useThemedStyles`; reuse `describeProvenance` (`mobile/src/lib/draftProvenance.ts`) + existing styles;
  **no color-literal asserts in component tests**.
- Backend `pytest` + `ruff check`/`ruff format` green; mobile `npx tsc --noEmit` + full `npx jest` green.
  Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

Tasks run sequentially (T2/T3 depend on T1's column). Backend tests need a real DB (CI provides one);
locally, run the unit-level tests + `ruff` and rely on CI for the DB-integration tests.

## File Structure & anchors

- `backend/alembic/versions/0016_topic_version_generation_meta.py` — NEW (head is `0015`; `0015` uses
  raw `op.execute(...)`).
- `backend/src/trust/topic_repo.py` — `_TV` (line 7), `TopicVersion` model, `create_topic_version`
  (line 24), `list_topic_versions` (line 49), read-mapper.
- `backend/src/trust/router.py` — `generate_topic_version` create call (~794), `get_topic_version`
  handler (~826), + a NEW list endpoint near the topic-version routes (~813).
- `backend/src/trust/schemas.py` — `TopicVersionDetailOut` (line 213) + a new `TopicVersionSummaryOut`.
- `backend/src/trust/topic_approval_repo.py` — `is_topic_validated` (line 113).
- Mirror: `backend/src/trust/artifact_repo.py` (`_V` line 13, `create_version` line 64) + `router.py:388-402`.
- `mobile/src/api/trustClient.ts` — `TopicVersionDetailView` (~line 56), topic client fns (~183).
- `mobile/src/hooks/useTrustProject.ts` — add `listTopicVersions`.
- `mobile/app/trust/topic-version/[id].tsx` — provenance line + history block.
- `mobile/src/lib/draftProvenance.ts` — `describeProvenance` (reuse, do not modify).

---

### Task 1: Migration + generation_meta storage (backend)

**Files:** Create `0016_…py`; modify `topic_repo.py`, `router.py`; test under `backend/tests/`.

- [ ] **Step 1: Write the failing test.** In `backend/tests/` (mirror the existing topic-version/repo
  tests): assert `create_topic_version(..., generation_meta={"kind":"topic_draft", ...})` round-trips
  (the returned/re-read `TopicVersion.generation_meta` equals the dict); and that
  `generate_topic_version` (with the LLM mocked, mirroring the existing topic-generate test) stores a
  `generation_meta` with `kind=="topic_draft"`, `provider_id`, `source_input_ids`, and `guidance` when
  given. Run — verify fail.

- [ ] **Step 2: Migration** `backend/alembic/versions/0016_topic_version_generation_meta.py`
  (`revision="0016"`, `down_revision="0015"`), raw SQL like 0015:
  `op.execute("ALTER TABLE topic_version ADD COLUMN generation_meta JSONB")`; downgrade
  `op.execute("ALTER TABLE topic_version DROP COLUMN generation_meta")`.

- [ ] **Step 3: `topic_repo.py`.**
  - `_TV`: append `, generation_meta`.
  - `TopicVersion` model + read-mapper: add `generation_meta` (`json.loads(r["generation_meta"]) if
    r["generation_meta"] is not None else None`), mirroring `artifact_repo` lines 31-32.
  - `create_topic_version`: add param `generation_meta=None`; add the column to the INSERT column list
    and values, passing `json.dumps(generation_meta) if generation_meta is not None else None`
    (mirror `artifact_repo.create_version` line 79). Keep the `version_no` subquery intact.

- [ ] **Step 4: Router `generate_topic_version`.** At the `create_topic_version(...)` call (~794), add:
  ```python
  generation_meta={
      "kind": "topic_draft",
      "model": model,
      "provider_id": body.provider_id,
      "source_input_ids": topic_source_ids,
      **({"guidance": body.guidance} if body.guidance else {}),
  },
  ```

- [ ] **Step 5: Run** — `cd backend && ruff check src/trust && ruff format --check src/trust && pytest tests -k "topic" -q` (DB-integration tests may be skipped locally; CI runs them). Verify the unit-level assertions + no import/lint errors.

- [ ] **Step 6: Commit.**
```bash
git add backend/alembic/versions/0016_topic_version_generation_meta.py backend/src/trust/topic_repo.py backend/src/trust/router.py backend/tests
git commit -m "feat(trust): store generation_meta on topic_version (migration 0016)"
```

---

### Task 2: Expose generation_meta + provenance line

**Files:** `schemas.py`, `router.py` (get handler); `trustClient.ts`; `topic-version/[id].tsx`; tests.

- [ ] **Step 1: Backend test** — extend the `get_topic_version` test to assert the response includes
  `generation_meta` (the stored dict, and `null` when unset). Run — fail.

- [ ] **Step 2: Backend.** `schemas.TopicVersionDetailOut`: add `generation_meta: dict | None = None`.
  `get_topic_version` handler (`router.py:826`): add `generation_meta=tv.generation_meta` to the
  `TopicVersionDetailOut(...)`.

- [ ] **Step 3: Mobile — client type.** `trustClient.ts` `TopicVersionDetailView`: add
  `generation_meta: Record<string, unknown> | null`.

- [ ] **Step 4: Mobile — provenance line + test.** In `topic-version/[id].tsx`, under the version
  title, render `<Text style={styles.provenance}>{describeProvenance(topicVersion.generation_meta)}</Text>`
  (import `describeProvenance`; add a muted `provenance` style mirroring `version/[versionId].tsx`).
  Test: a version with `generation_meta.source_input_ids` shows "source(s)"; a null-meta version shows
  the generic fallback (no crash). No color-literal asserts.

- [ ] **Step 5: Run** — backend `pytest -k topic` + `ruff`; `cd mobile && npx jest <topic viewer test> && npx tsc --noEmit`.

- [ ] **Step 6: Commit.**
```bash
git add backend/src/trust/schemas.py backend/src/trust/router.py backend/tests mobile/src/api/trustClient.ts "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__
git commit -m "feat(trust): expose topic-version generation_meta + provenance line in the viewer"
```

---

### Task 3: History endpoint + inline history block

**Files:** `router.py` (new endpoint), `schemas.py`; `trustClient.ts`, `useTrustProject.ts`,
`topic-version/[id].tsx`; tests.

- [ ] **Step 1: Backend test** — the new `GET /projects/{id}/topics/{topic_id}/versions` returns the
  topic's versions (only that topic_id) with `is_validated` per version, ordered, and enforces
  `require_project_access` (403 for a non-member). Run — fail.

- [ ] **Step 2: Backend.** `schemas.TopicVersionSummaryOut { id: str; version_no: int; created_at:
  datetime | None; is_validated: bool }`. New handler
  `@router.get("/projects/{project_id}/topics/{topic_id}/versions", response_model=list[schemas.TopicVersionSummaryOut])`
  with the same auth/access deps as the sibling topic routes: fetch
  `topic_repo.list_topic_versions(conn, project_id=project_id)`, filter `v.topic_id == topic_id`, and
  build each summary with `is_validated = await topic_approval_repo.is_topic_validated(conn,
  topic_version_id=v.id)`.

- [ ] **Step 3: Mobile — client + hook.** `trustClient.ts`: `TopicVersionSummaryView { id; version_no;
  created_at; is_validated }` + `getTopicVersions(projectId, topicId, token): Promise<TopicVersionSummaryView[]>`
  (`GET /projects/${projectId}/topics/${topicId}/versions`). `useTrustProject.ts`: add
  `listTopicVersions(topicId)` → `getTopicVersions(projectId, topicId, accessToken)`.

- [ ] **Step 4: Mobile — history block + test.** In `topic-version/[id].tsx`, fetch
  `listTopicVersions(topicVersion.topic_id)` on load (into state, defensive). When `>1`, render a
  "Versions" block (v# · localized date · ✓ when `is_validated` · *current* when `id === id`
  param) above Back; non-current rows `router.push('/trust/topic-version/'+v.id+'?projectId='+projectId)`.
  Mirror the whole-book history block in `version/[versionId].tsx`. Test: two versions → both rows +
  current marker + tap navigates; one/none → no block. No color-literal asserts.

- [ ] **Step 5: Run** — backend `pytest -k topic` + `ruff`; `cd mobile && npx jest <topic viewer test> && npx tsc --noEmit`.

- [ ] **Step 6: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__
git commit -m "feat(trust): per-topic version history endpoint + inline history in the viewer"
```

---

## Final verification (after all tasks)

- [ ] `cd backend && ruff check . && pytest -q` (CI runs the DB-integration tests) ; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] Migration applies cleanly (`alembic upgrade head` → `0016`); downgrade drops the column.
- [ ] Grep the diff: backend limited to trust module + migration; mobile to client/hook/viewer + tests.
- [ ] **Deploy:** backend refresh + `alembic upgrade head`, then web. **Web verify** (local recipe w/
  the `status:"signed_in"` + token patch, stub answering `/topic-versions/{id}` with `generation_meta`
  and `/topics/{tid}/versions` with a 2-version list): provenance line under the title; a Versions
  block listing both, current marked, tap navigates.
- [ ] PR body: per-topic S2 — provenance + inline history (migration 0016, no backfill); backend
  refresh + migration, then web. Arc: S1 done; S3 feedback next.

## Self-Review

- **Spec coverage:** migration+store (T1) · expose+provenance (T2) · history endpoint+UI (T3). Feedback/
  edit correctly deferred.
- **Type consistency:** `generation_meta` mirrors `artifact_version` (JSONB / `dict | None` /
  `Record<string,unknown>|null`); `TopicVersionSummaryOut` fields match the client `TopicVersionSummaryView`.
- **Constraints:** mirror whole-book pattern; no backfill; `require_project_access`; reuse
  `describeProvenance`; no color-literal asserts.
