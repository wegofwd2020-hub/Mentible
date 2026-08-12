# Per-topic panel S2 — provenance + inline history — Design

**Status:** Approved (brainstorming, 2026-08-12). Second sub-slice of the per-topic full-parity arc
(after S1 Revise, #414). Adds a **provenance line** and **inline version history** to the per-topic
draft viewer, mirroring the whole-book panel. **Backend migration + refresh, then web.**

## Problem

The per-topic viewer shows a draft + Approve/Withdraw + (S1) Revise, but — unlike the whole-book panel
— it has **no provenance line** ("Generated from N sources…") and **no inline version history**
(switching versions means leaving the screen). Two backend gaps block this:
1. `topic_version` has **no `generation_meta` column** (columns: `id, project_id, topic_id, title,
   source_ids, content, version_no, created_by_sub, created_at`), so there is nothing to describe.
2. `list_topic_versions` exists in the repo but is **not exposed** per-topic to the client.

## Goal

Bring provenance + history to the per-topic viewer, matching the whole-book panel. Reuse the existing
`describeProvenance` helper and the whole-book history-block shape.

## Locked decisions

1. **Add `generation_meta` to `topic_version`** (migration) and populate it on generate, mirroring the
   whole-book `artifact_version` pattern exactly. Meta shape: `{ "kind": "topic_draft", "model": <model>,
   "provider_id": <provider_id>, "source_input_ids": <topic's cited source ids>, [ "guidance": <g> ] }`
   (matches `router.py:395` for whole-book, `kind` = `"topic_draft"`).
2. **No backfill.** Old topic versions keep `generation_meta = NULL`; `describeProvenance(null)` already
   returns the generic "Generated draft" (mobile/src/lib/draftProvenance.ts) — no crash, no migration
   of existing rows.
3. **Inline history via a new list endpoint** `GET /projects/{id}/topics/{topic_id}/versions` →
   `[{ id, version_no, created_at, is_validated }]`, no migration (data exists).

## Architecture

### Backend (mirror the whole-book `generation_meta` + `artifact_repo` pattern)

- **Migration** `backend/alembic/versions/0016_topic_version_generation_meta.py` (head is `0015`):
  `op.add_column("topic_version", sa.Column("generation_meta", postgresql.JSONB, nullable=True))`;
  `downgrade` drops it. Mirror `0015`'s structure/imports.
- **`topic_repo.py`**: add `generation_meta` to `_TV`; to the `TopicVersion` model; and to
  `create_topic_version(conn, *, …, created_by_sub, generation_meta=None)` — INSERT the column and pass
  `json.dumps(generation_meta) if generation_meta is not None else None` (mirror `artifact_repo.create_version`).
  Parse it on read (`json.loads(r["generation_meta"]) if not None`).
- **Router `generate_topic_version`** (`router.py` ~794): assemble and pass `generation_meta` to
  `create_topic_version`:
  ```python
  generation_meta={
      "kind": "topic_draft",
      "model": model,
      "provider_id": body.provider_id,
      "source_input_ids": topic_source_ids,
      **({"guidance": body.guidance} if body.guidance else {}),
  }
  ```
  (`topic_source_ids`, `model`, `body` are already in scope there.)
- **`TopicVersionDetailOut`** (`schemas.py:213`): add `generation_meta: dict | None = None`. The
  `get_topic_version` handler (`router.py:826`) maps `generation_meta=tv.generation_meta`.
- **History endpoint** `GET /projects/{project_id}/topics/{topic_id}/versions`
  (`response_model=list[schemas.TopicVersionSummaryOut]`, `require_project_access`): fetch
  `list_topic_versions(conn, project_id=…)`, filter to `topic_id`, and for each compute `is_validated`
  via `topic_approval_repo.is_topic_validated(conn, topic_version_id=v.id)`. New schema
  `TopicVersionSummaryOut { id, version_no, created_at, is_validated }`.
  *(Optional micro-opt: a repo variant filtering by topic_id — but reusing `list_topic_versions` +
  a Python filter is fine for the version counts in play.)*

### Mobile (web deploy)

- `trustClient.ts`: `TopicVersionDetailView` gains `generation_meta: Record<string, unknown> | null`;
  new `TopicVersionSummaryView { id: string; version_no: number; created_at: string | null;
  is_validated: boolean }`; new `getTopicVersions(projectId, topicId, token): Promise<TopicVersionSummaryView[]>`
  (`GET /projects/{id}/topics/{topicId}/versions`).
- `useTrustProject.ts`: add `listTopicVersions(topicId)` (calls `getTopicVersions`).
- `topic-version/[id].tsx`:
  - **Provenance line** under the title: `describeProvenance(topicVersion.generation_meta)` (reuse the
    existing helper + a muted style, mirror `version/[versionId].tsx`).
  - **Inline history block**: on load, fetch `listTopicVersions(topicVersion.topic_id)`; when `>1`,
    render a "Versions" block (v# · localized date · ✓ when `is_validated` · *current* when
    `id === current`) — non-current rows navigate `router.push('/trust/topic-version/{id}?projectId={projectId}')`.
    Mirror the whole-book history block; defensive (empty/one version → nothing).

## Testing

- **Backend:** `create_topic_version` stores + reads `generation_meta`; `generate_topic_version`
  assembles the `topic_draft` meta (mock the LLM); `get_topic_version` returns `generation_meta`; the
  new versions endpoint returns the topic's versions with `is_validated` and requires access. Migration
  applies (CI runs a real DB).
- **Mobile:** provenance line renders from `generation_meta` (and a null-meta version shows the generic
  fallback, no crash); history block lists sibling versions, marks current, taps navigate; one-version
  → no block. No color-literal asserts.

## Decomposition (SDD)

- **T1 — migration + storage** (0016; `topic_repo` column; router assembles + stores `generation_meta`). Backend tests.
- **T2 — expose + provenance line** (`TopicVersionDetailOut.generation_meta` + handler; client type; viewer provenance line). Backend + mobile tests.
- **T3 — history endpoint + UI** (new endpoint + `TopicVersionSummaryOut`; client `getTopicVersions` + type; hook; viewer history block). Backend + mobile tests.

## Rollout

**Backend refresh + `alembic upgrade head` (→ 0016)**, then web redeploy. No backfill.

## Out of scope (later)

- S3 reviewer feedback thread + revise-from-note (backend migration for a topic-feedback surface).
- S4 manual topic edit. Per-row history-note text (needs the feedback/meta summary in the list).

## Global constraints

Mirror the whole-book `generation_meta`/`artifact_repo` pattern (don't invent a new shape). No backfill;
`describeProvenance` handles null. `require_project_access` on the new endpoint. `asyncpg` for DB;
`useThemedStyles`; reuse `describeProvenance` + existing styles; **no color-literal asserts in
component tests**. `npx tsc --noEmit` + full `npx jest` green; backend `pytest` + `ruff` green. Commit
messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
