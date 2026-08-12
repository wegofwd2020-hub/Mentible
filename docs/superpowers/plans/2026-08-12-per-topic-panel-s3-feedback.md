# Per-topic panel S3 — feedback thread + revise-from-note — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reviewer feedback thread + owner "Revise from this note" to the per-topic viewer,
mirroring the whole-book unified panel — a new `topic_feedback` table + endpoint, surfaced in the
mobile viewer (reusing S1's revise flow).

**Architecture:** Migration `0017` (topic_feedback) + `topic_feedback_repo` (mirror `feedback_repo`) +
a POST endpoint + `feedback[]` on the topic detail; mobile client/hook/viewer changes reusing S1's
`openRegen`/`setGuidance`.

**Tech Stack:** FastAPI + asyncpg + alembic; React Native + Expo TS; pytest / Jest.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-per-topic-panel-s3-feedback-design.md`.
- **Mirror the whole-book feedback pattern exactly** — `feedback` DDL (`0009` ~104-112) + `seq`
  (`0013`), `backend/src/trust/feedback_repo.py`, the `add_version_feedback` endpoint
  (`router.py:1050`), `FeedbackOut` (`schemas.py:93`), and the whole-book viewer's feedback JSX
  (`mobile/app/trust/version/[versionId].tsx` ~406-467). Separate `topic_feedback` table (NOT
  polymorphic). `author_kind` role-derived (reviewer→expert, owner→operator).
- **#412 role gating**: feedback thread visible to both; note-input box reviewer-only; owner uses
  "Revise from this note" (reuse S1 `setGuidance(f.body); openRegen()`).
- Endpoint uses `_require_role(..., need_owner=False)` (owner OR reviewer). `asyncpg`.
- `useThemedStyles`; reuse existing styles + S1 flow; **no color-literal asserts in component tests**.
- Backend `ruff` + `pytest`; mobile `npx tsc --noEmit` + full `npx jest`. Commit messages end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

Tasks sequential (T2 depends on T1's table/repo; T3 on T2's endpoint+detail shape). Backend DB tests
run in CI (real Postgres); a local temp PG is ideal for red→green (as S2-T1 did).

## File Structure & anchors

- `backend/alembic/versions/0017_topic_feedback.py` — NEW (head is `0016`).
- `backend/src/trust/topic_feedback_repo.py` — NEW (mirror `feedback_repo.py`).
- `backend/src/trust/models.py` — add `TopicFeedback` (mirror `Feedback`; `FEEDBACK_AUTHOR_KINDS` exists).
- `backend/src/trust/router.py` — new POST endpoint (mirror `add_version_feedback` @1050); `get_topic_version` handler (~826) adds `feedback=[...]`. `topic_repo.project_id_for_topic_version` exists.
- `backend/src/trust/schemas.py` — `TopicFeedbackOut` (mirror `FeedbackOut`); `TopicVersionDetailOut` gains `feedback`. Reuse existing `FeedbackIn`.
- `mobile/src/api/trustClient.ts` — `TopicFeedbackView`, `TopicVersionDetailView.feedback`, `addTopicFeedback`.
- `mobile/src/hooks/useTrustProject.ts` — `addTopicFeedback`.
- `mobile/app/trust/topic-version/[id].tsx` — feedback block (has S1 `openRegen`/`setGuidance`, S2 `reload`).

---

### Task 1: `topic_feedback` table + repo (backend)

**Files:** Create `0017_…py`, `topic_feedback_repo.py`; modify `models.py`; test under `backend/tests/`.

- [ ] **Step 1: Write the failing test** (mirror the feedback repo test): `add_topic_feedback` then
  `list_topic_feedback` round-trips (fields equal), ordered by `seq` (insertion order), and
  `add_topic_feedback` rejects a bad `author_kind`. Run — fail.

- [ ] **Step 2: Migration** `0017_topic_feedback.py` (`revision="0017"`, `down_revision="0016"`), raw
  `op.execute` CREATE TABLE `topic_feedback` per the design (id/seq bigserial/topic_version_id FK→
  topic_version ON DELETE CASCADE/author_kind CHECK/author_name/body/recorded_by_sub/created_at);
  downgrade `DROP TABLE topic_feedback`.

- [ ] **Step 3: Model + repo.** `models.py`: `@dataclass(frozen=True) class TopicFeedback` mirroring
  `Feedback` with `topic_version_id`. `topic_feedback_repo.py`: `_TF`, `_topic_feedback(r)`,
  `add_topic_feedback(conn, *, topic_version_id, author_kind, body, recorded_by_sub, author_name=None)`
  (validate `author_kind in FEEDBACK_AUTHOR_KINDS`; INSERT; RETURNING `_TF`), `list_topic_feedback(conn,
  *, topic_version_id)` (`SELECT _TF … WHERE topic_version_id=$1 ORDER BY seq`). Mirror `feedback_repo`
  verbatim (swap `version_id`→`topic_version_id`, `feedback`→`topic_feedback`).

- [ ] **Step 4: Run** — `cd backend && ruff check src/trust && ruff format --check src/trust && pytest tests -k "topic" -q`.

- [ ] **Step 5: Commit.**
```bash
git add backend/alembic/versions/0017_topic_feedback.py backend/src/trust/topic_feedback_repo.py backend/src/trust/models.py backend/tests
git commit -m "feat(trust): topic_feedback table + repo (migration 0017)"
```

---

### Task 2: Feedback endpoint + expose on detail (backend)

**Files:** `router.py`, `schemas.py`; tests.

- [ ] **Step 1: Failing test** — `POST /topic-versions/{id}/feedback` records a note with role-derived
  `author_kind` (reviewer→expert, owner→operator), 404s on unknown version, 403s for a non-member;
  `get_topic_version` returns the `feedback` list (ordered). Run — fail.

- [ ] **Step 2: Schemas.** `TopicFeedbackOut { id: str; topic_version_id: str; author_kind: str;
  author_name: str | None; body: str; created_at: datetime | None }` (mirror `FeedbackOut`).
  `TopicVersionDetailOut`: add `feedback: list[TopicFeedbackOut] = []`.

- [ ] **Step 3: Endpoint** (mirror `add_version_feedback`): `@router.post("/topic-versions/{topic_version_id}/feedback",
  response_model=schemas.TopicFeedbackOut)` — strip/validate body; `project_id =
  topic_repo.project_id_for_topic_version(...)`; 404 if None; `account = _account(...)`; `role =
  _require_role(conn, account, project_id, need_owner=False)`; `author_kind = "expert" if role ==
  "reviewer" else "operator"`; `f = topic_feedback_repo.add_topic_feedback(..., author_name=account.email
  or principal.sub, recorded_by_sub=principal.sub)`; return `TopicFeedbackOut(...)`.

- [ ] **Step 4: Expose** — in `get_topic_version` handler, add
  `feedback=[schemas.TopicFeedbackOut(id=str(f.id), topic_version_id=str(f.topic_version_id),
  author_kind=f.author_kind, author_name=f.author_name, body=f.body, created_at=f.created_at) for f in
  await topic_feedback_repo.list_topic_feedback(conn, topic_version_id=topic_version_id)]`.

- [ ] **Step 5: Run** — `cd backend && ruff check src/trust && pytest tests -k topic -q`.

- [ ] **Step 6: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py backend/tests
git commit -m "feat(trust): topic-version feedback endpoint + feedback[] on the detail"
```

---

### Task 3: Mobile feedback thread + note box + revise-from-note

**Files:** `trustClient.ts`, `useTrustProject.ts`, `topic-version/[id].tsx`; tests.

- [ ] **Step 1: Failing test** — the feedback thread renders notes from `topicVersion.feedback`; a
  **reviewer** (`my_role !== "owner"`) sees a "Request a revision…" note box and posting calls the
  hook `addTopicFeedback`; an **owner** sees "Revise from this note" per row (not the box), and
  pressing it prefills the guidance box (opens revise) — reusing S1. Follow the topic-viewer test seam.
  Run — fail.

- [ ] **Step 2: Client + hook.** `trustClient.ts`: `TopicFeedbackView { id: string; author_kind:
  string; author_name: string | null; body: string; created_at: string | null }`;
  `TopicVersionDetailView` gains `feedback: TopicFeedbackView[]`; `addTopicFeedback(topicVersionId,
  body: { body: string }, token): Promise<TopicFeedbackView>` (`POST /topic-versions/${topicVersionId}/feedback`).
  `useTrustProject.ts`: `addTopicFeedback(topicVersionId, body)` (guard `!accessToken`).

- [ ] **Step 3: Viewer feedback block.** In `topic-version/[id].tsx`, mirror the whole-book viewer's
  feedback JSX (`version/[versionId].tsx` ~406-467): a "Revision notes" block with the thread
  (`(topicVersion.feedback ?? []).map`), owner-only "Revise from this note" per row (`onPress: () => {
  setGuidance(f.body); openRegen(); }` — S1's existing state), and a **reviewer-only** note box
  (`!isOwner`) → `addTopicFeedback(String(id), { body: note })` then `await reload()` (S2's reload
  refetches the version incl. its feedback). Add local `note`/`noteBusy` state. Reuse the existing
  note/thread styles (copy the style names from the whole-book viewer). No new color literals.

- [ ] **Step 4: Run** — `cd mobile && npx jest <topic viewer test> && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__
git commit -m "feat(trust): per-topic feedback thread + reviewer note box + owner revise-from-note"
```

---

## Final verification (after all tasks)

- [ ] `cd backend && ruff check . && pytest -q` (CI runs DB tests); `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] Migration applies (`alembic upgrade head` → `0017`); downgrade drops `topic_feedback`.
- [ ] Grep the diff: backend limited to trust module + migration; mobile to client/hook/viewer + tests.
- [ ] **Deploy:** backend refresh + `alembic upgrade head`, then web. **Web verify** (local recipe with
  the `status:"signed_in"` + token patch; stub answering `/topic-versions/{id}` with a `feedback` list
  and accepting the feedback POST): reviewer view shows the note box + thread; owner view shows the
  thread + "Revise from this note" (prefills guidance).
- [ ] PR body: per-topic S3 — feedback thread + revise-from-note (migration 0017); backend refresh +
  migration, then web. Arc: S1/S2 done; S4 (manual edit) optional next.

## Self-Review

- **Spec coverage:** table+repo (T1) · endpoint+expose (T2) · mobile thread+box+revise-from-note (T3).
  S4/edit/delete correctly deferred.
- **Type consistency:** `topic_feedback` mirrors `feedback`; `TopicFeedbackOut`/`TopicFeedbackView`
  fields align; `addTopicFeedback` body `{ body }` matches `FeedbackIn`.
- **Constraints:** mirror whole-book pattern; separate table; role-derived author_kind; #412 gating;
  reuse S1 revise; no color-literal asserts.
