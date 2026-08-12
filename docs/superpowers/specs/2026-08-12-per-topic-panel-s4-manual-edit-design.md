# Per-topic panel S4 — manual topic edit — Design

**Status:** Approved (brainstorming, 2026-08-12). Fourth/final sub-slice of the per-topic full-parity
arc (S1 Revise #414, S2 provenance+history #416, S3 feedback #417). Adds owner **manual edit** of a
topic version's content → a new version, mirroring the whole-book viewer's Edit path. **Backend
refresh, NO migration** (`create_topic_version` already exists from S1).

## Problem

The per-topic viewer can Revise (regenerate), Approve, comment, browse history — but the owner can't
**manually edit** the draft text (fix a typo, tweak a sentence) the way the whole-book viewer allows
(`Edit text` → section editors → "Save as new version"). Whole-book uses
`POST /artifacts/{id}/versions {content}` → `create_version`; topics have no equivalent endpoint.

## Goal

Give the owner an "Edit text" mode on the topic viewer that saves the edited content as a new topic
version, mirroring the whole-book edit UI. Owner-only; append-only (a new version, re-approval needed).

## Locked decisions

1. **Mirror the whole-book edit UI** — per-section heading/body editors, add/remove section,
   "Save as new version" (mirror `version/[versionId].tsx`'s `draft`/`startEdit`/`updateSection`/
   `removeSection`/`save`).
2. **Provenance tagged** — a manual edit stores `generation_meta = {"kind": "manual_edit",
   "source_input_ids": <union of the edited sections' source_ids>}`, so the provenance line reads
   "Generated from N sources" (not a bare "Generated draft"). *(Wording nuance — "Generated" vs
   "Edited" — left for a later `describeProvenance` polish if desired; out of scope here.)*
3. **No migration** — reuse `create_topic_version` (S1). Backend refresh only.

## Architecture

### Backend (mirror `create_version` @ `router.py:236`)
- **`POST /projects/{project_id}/topics/{topic_id}/versions`** (RESTful POST alongside the S2 GET on
  the same path), `response_model=schemas.TopicVersionOut`, body a content-only schema
  `TopicVersionContentIn { content: dict }` (do NOT accept `generation_meta` from the client — it's
  server-set). Handler:
  - `_require_role(conn, account, project_id, need_owner=True)` — **owner-only** (edit is authoring).
  - Resolve the topic's latest version via `topic_repo.list_topic_versions(conn,
    project_id=project_id)` filtered to `topic_id`; if none → 404 "topic not found" (also validates
    the topic belongs to this project). `title = latest.title`.
  - `source_ids = sorted({sid for s in body.content.get("sections", []) for sid in s.get("source_ids", [])})`.
  - `generation_meta = {"kind": "manual_edit", "source_input_ids": source_ids}`.
  - `v = await topic_repo.create_topic_version(conn, project_id=project_id, topic_id=topic_id,
    title=title, source_ids=source_ids, content=body.content, created_by_sub=principal.sub,
    generation_meta=generation_meta)`. Return `TopicVersionOut(...)` (mirror `generate_topic_version`'s
    response mapping).

### Mobile
- `trustClient.ts`: `createTopicVersion(projectId, topicId, content: object, token):
  Promise<TopicVersionCreatedView>` (`POST /projects/${projectId}/topics/${topicId}/versions`,
  `{ content }`). (`TopicVersionCreatedView` already exists — `{ id, topic_id, version_no, created_at }`.)
- `useTrustProject.ts`: `editTopic(topicId, content)` → `createTopicVersion(projectId, topicId,
  content, accessToken)` (guard `!accessToken`).
- `topic-version/[id].tsx` — mirror the whole-book edit mode:
  - Owner-only **"Edit text"** button (secondary/`variant="ghost"`, next to Revise). On press:
    `startEdit()` — if `topicVersion.is_validated`, confirm ("Edit a validated draft? This creates a
    new version… re-approval needed"), then `setDraft(sections copy); setEditing(true)`.
  - **Edit mode** (`editing`): per-section heading `TextInput` + body `TextInput` (multiline) +
    "Remove section"; an "Add section" button; a **"Save as new version"** button →
    `const v = await editTopic(topicVersion.topic_id, { sections: draft });` then
    `router.replace('/trust/topic-version/'+v.id+'?projectId='+projectId)`. On error, Alert.
  - While `editing`, hide the read-only reader render + the revise/approve/history/feedback blocks
    (mirror the whole-book viewer, which gates those on `!editing`). Reuse the whole-book viewer's
    edit styles (copy names).
  - `draft` state `{ heading; body; source_ids }[]`; `updateSection`/`removeSection`/add mirror the
    whole-book viewer.

## Testing

- **Backend:** owner POST with content creates a new topic version (version_no increments, content
  stored, `source_ids` = derived union, `generation_meta.kind == "manual_edit"`); a **reviewer** gets
  403 (need_owner); unknown topic → 404; `get_topic_version` on the new id returns the edited content
  + the manual-edit provenance.
- **Mobile:** owner sees "Edit text"; entering edit mode shows section editors seeded from the
  content; editing a section + "Save as new version" calls `editTopic` with `{ sections }` and
  navigates to the returned id; a reviewer does NOT see "Edit text". No color-literal asserts.

## Decomposition (SDD)

- **T1 — backend endpoint** (POST create-from-content + `TopicVersionContentIn`). Backend tests.
- **T2 — mobile edit mode** (client `createTopicVersion` + hook `editTopic` + viewer edit UI). Mobile tests.

## Rollout

**Backend refresh (NO migration)**, then web redeploy.

## Out of scope

- Editing/deleting an individual version; a diff view. `describeProvenance` "Edited" wording polish.
  Whole-book changes.

## Global constraints

Mirror `create_version` (owner-only `need_owner=True`; content-only body; server-set generation_meta)
and the whole-book viewer's edit mode. No migration. `require_project_access`/`_require_role`;
`asyncpg`. `useThemedStyles`; reuse the whole-book edit styles + S1-S3 flows; **no color-literal
asserts in component tests**. Backend `ruff check` **and** `ruff format --check` (CI runs both);
mobile `npx tsc --noEmit` + full `npx jest`. Commit messages end with `Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>`.
