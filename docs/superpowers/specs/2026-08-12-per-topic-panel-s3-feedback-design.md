# Per-topic panel S3 — reviewer feedback thread + revise-from-note — Design

**Status:** Approved (brainstorming, 2026-08-12). Third sub-slice of the per-topic full-parity arc
(after S1 Revise #414, S2 provenance+history #416). Adds a **reviewer feedback thread** + owner
**"Revise from this note"** to the per-topic viewer, matching the whole-book unified panel (#412).
**New backend surface (migration 0017) + refresh, then web.**

## Problem

The per-topic viewer (post S1/S2) has Revise, provenance, history, Approve/Withdraw — but no
**feedback**: a reviewer can't leave a revision note, and the owner can't revise *from* a note. The
whole-book `feedback` table's FK is `version_id → artifact_version`, so topics need their own surface.

## Goal

Mirror the whole-book unified panel's feedback UX on the per-topic viewer, reusing S1's revise flow.
Role gating per #412: reviewer leaves a note; owner revises (from a note or free guidance).

## Locked decisions

1. **Separate `topic_feedback` table** (migration 0017), NOT a polymorphic `feedback` with a nullable
   FK. Mirrors `feedback` exactly, FK → `topic_version` `ON DELETE CASCADE`, with a `seq bigserial`
   for strict insertion order (like `feedback` after migration 0013).
2. **#412 role gating.** Feedback thread visible to both; the **note-input box is reviewer-only**
   ("Request a revision"); the **owner** gets "Revise from this note" per row (reuse S1's
   `setGuidance(f.body)` + `openRegen()`), not a note box.

## Architecture (mirror the whole-book feedback pattern)

### Backend
- **Migration `0017_topic_feedback`** (`down_revision="0016"`), raw SQL mirroring the `feedback` DDL
  (0009) + `seq` (0013):
  ```sql
  CREATE TABLE topic_feedback (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      seq              bigserial,
      topic_version_id uuid NOT NULL REFERENCES topic_version(id) ON DELETE CASCADE,
      author_kind      text NOT NULL CHECK (author_kind IN ('expert','operator')),
      author_name      text,
      body             text NOT NULL,
      recorded_by_sub  text NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now()
  )
  ```
  downgrade drops the table.
- **`topic_feedback_repo.py`** (mirror `feedback_repo.py`): `_TF = "id, topic_version_id, author_kind,
  author_name, body, recorded_by_sub, created_at"`; `add_topic_feedback(conn, *, topic_version_id,
  author_kind, body, recorded_by_sub, author_name=None)` (validate `author_kind` ∈
  `FEEDBACK_AUTHOR_KINDS`); `list_topic_feedback(conn, *, topic_version_id)` `ORDER BY seq`. Add a
  `TopicFeedback` model (mirror `Feedback`, `version_id`→`topic_version_id`).
- **Endpoint** `POST /topic-versions/{topic_version_id}/feedback` (mirror `add_version_feedback`,
  `router.py:1050`): resolve `project_id` via `topic_repo.project_id_for_topic_version`; 404 if none;
  `_require_role(need_owner=False)`; `author_kind = "expert" if role == "reviewer" else "operator"`;
  `add_topic_feedback(...)`. Response `schemas.TopicFeedbackOut`. Reuse the existing `FeedbackIn`
  request body.
- **Expose** on the detail: `TopicVersionDetailOut` gains `feedback: list[TopicFeedbackOut]`;
  `get_topic_version` handler adds `feedback=[TopicFeedbackOut(...) for f in await
  topic_feedback_repo.list_topic_feedback(conn, topic_version_id=topic_version_id)]`. New schema
  `TopicFeedbackOut { id, topic_version_id, author_kind, author_name, body, created_at }` (mirror
  `FeedbackOut`).

### Mobile
- `trustClient.ts`: `TopicFeedbackView { id: string; author_kind: string; author_name: string | null;
  body: string; created_at: string | null }`; `TopicVersionDetailView` gains
  `feedback: TopicFeedbackView[]`; `addTopicFeedback(topicVersionId, body: { body: string }, token):
  Promise<TopicFeedbackView>` (`POST /topic-versions/${topicVersionId}/feedback`).
- `useTrustProject.ts`: `addTopicFeedback(topicVersionId, body)` (guard `!accessToken`).
- `topic-version/[id].tsx` — add a feedback block (mirror `version/[versionId].tsx` ~lines 406-467),
  placed near the existing actions:
  - **Feedback thread**: `(topicVersion.feedback ?? []).map(...)` — author + date + body.
  - **Owner-only "Revise from this note"** per row → `setGuidance(f.body); openRegen();` (S1 flow).
  - **Reviewer-only note box** (`!isOwner`): a `TextInput` (placeholder "Request a revision…", `maxLength`
    1000, multiline) + a "Request a revision" button → `addTopicFeedback(id, { body })` then reload the
    version so the new note shows. Owner does NOT see the note box.
  - After adding a note (or approve/withdraw), the thread refreshes via the existing `reload()`.

## Testing

- **Backend:** `add_topic_feedback`/`list_topic_feedback` round-trip (ordered by seq); the endpoint
  records a note with role-derived `author_kind` (reviewer→expert, owner→operator), 404s on an unknown
  version, and enforces access (non-member 403); `get_topic_version` returns the `feedback` list.
- **Mobile:** the feedback thread renders notes; a reviewer sees the note box and posting calls
  `addTopicFeedback`; an owner sees "Revise from this note" (not the box) and it prefills guidance +
  opens the revise box (reusing S1). No color-literal asserts.

## Decomposition (SDD)

- **T1 — table + repo** (migration 0017; `topic_feedback_repo` + `TopicFeedback` model). Backend tests.
- **T2 — endpoint + expose** (POST feedback endpoint + `feedback[]` on the detail + `TopicFeedbackOut`).
  Backend tests.
- **T3 — mobile** (client + hook + viewer feedback thread + reviewer note box + owner revise-from-note).
  Mobile tests.

## Rollout

**Backend refresh + `alembic upgrade head` (→ 0017)**, then web redeploy.

## Out of scope (later)

- S4 manual topic edit. Editing/deleting a topic feedback note. Any change to the whole-book feedback.

## Global constraints

Mirror the whole-book `feedback`/`feedback_repo`/`add_version_feedback` pattern exactly — separate
`topic_feedback` table, `author_kind` role-derived, `require_project_access`/`_require_role`. #412 role
gating (reviewer note box; owner revise-from-note). `asyncpg`; `useThemedStyles`; reuse S1's revise
flow + existing styles; **no color-literal asserts in component tests**. Backend `pytest` + `ruff`;
mobile `npx tsc --noEmit` + full `npx jest`. Commit messages end with `Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>`.
