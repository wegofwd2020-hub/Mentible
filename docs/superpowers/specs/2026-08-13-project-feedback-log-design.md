# Project-wide feedback log — Design

**Status:** Approved (brainstorming, 2026-08-13). Second Lovable workspace adaptation (from
`docs/lovable-workspace-teardown.md`): a **read-only project-wide "Revision notes" timeline** aggregating
every feedback note across all of a project's drafts. Ours records feedback **per version** (the S3 thread
+ artifact feedback); this rolls it up into one place. The data already exists — a read-only aggregation +
a UI section, **no new table/migration**.

## Data (existing)

- `feedback` = `{id, version_id (artifact_version), author_kind, author_name, body, recorded_by_sub,
  created_at, seq}` — per artifact-version.
- `topic_feedback` = `{id, topic_version_id, author_kind, author_name, body, recorded_by_sub, created_at,
  seq}` — per topic-version (S3).
- `author_kind ∈ ("expert", "operator")`. Draft label: artifact → `artifact.title or format · v{version_no}`;
  topic → `topic_version.title · v{version_no}`.

Both are currently exposed **per-version only** (in the version-detail endpoints). No project-wide view.

## Architecture

### Backend
- **`feedback_repo.list_project_feedback(conn, *, project_id) -> list[ProjectFeedbackItem]`** (put it in
  `feedback_repo.py`, or a small `project_feedback_repo.py`): a `UNION ALL` over the two tables, joined to
  their draft + scoped to the project, newest-first:
  - artifact: `feedback f JOIN artifact_version v ON f.version_id = v.id JOIN artifact a ON v.artifact_id =
    a.id WHERE a.project_id = $1` → `{source:'artifact', draft_label: COALESCE(a.title, a.format),
    format: a.format, version_no: v.version_no, author_kind, author_name, body, created_at}`.
  - topic: `topic_feedback tf JOIN topic_version tv ON tf.topic_version_id = tv.id WHERE tv.project_id = $1`
    → `{source:'topic', draft_label: tv.title, format: null, version_no: tv.version_no, author_kind,
    author_name, body, created_at}`.
  - `ORDER BY created_at DESC, id DESC` across the union (created_at is the cross-table order; `seq` only
    orders within a table).
- **`ProjectFeedbackItemOut`** schema: `{source, draft_label, format: str | None, version_no, author_kind,
  author_name: str | None, body, created_at}`.
- **`GET /projects/{project_id}/feedback`** → `list[ProjectFeedbackItemOut]`. Access: `_require_role(conn,
  account, project_id, need_owner=False)` (**owner OR reviewer** — mirror `list_topic_version_history`).
  Read-only; no key/content beyond the notes themselves.

### Mobile
- **`trustClient.listProjectFeedback(projectId, token) -> ProjectFeedbackItem[]`** + a `ProjectFeedbackItem`
  type. A small fetch on the Feedback phase (or via `useTrustProject`), refetched on focus.
- **`FeedbackPanel` gains a "Revision notes" rollup section** (the existing panel is the review/approve
  version list; add the log to it — a labeled section, e.g. above or below the review content). Each row:
  **draft label · v{n} · author (kind/name) · date · note body**. Newest-first. Empty state: "No revision
  notes yet." Read-only (tapping a row MAY deep-link to that draft's viewer — optional, nice-to-have; the
  minimum is a scannable read-only list). Owner + reviewer see it (the panel already renders for both).
  Keep it visually distinct from the review list so the panel doesn't read as one blob (a header + a subtle
  divider).

## Testing

- **Backend:** a project with feedback on an artifact version AND on a topic version → `GET
  /projects/{id}/feedback` returns both, newest-first, with the correct `draft_label`/`version_no`/
  `author_kind`/`body`; a reviewer (not just owner) can read it; a non-member → 403; an empty project →
  `[]`. Ordering across the two sources is by `created_at DESC`.
- **Mobile:** the FeedbackPanel renders the Revision-notes section with rows (draft label · v · author ·
  date · note) when feedback exists; the empty state when none; a fetch failure degrades to the empty/absent
  section (non-critical — don't error the panel). No color-literal asserts.

## Decomposition (SDD)

- **T1 — backend:** `list_project_feedback` (UNION query) + `ProjectFeedbackItemOut` + `GET
  /projects/{id}/feedback` (owner-or-reviewer). Tests.
- **T2 — mobile:** `listProjectFeedback` client + type + the `FeedbackPanel` "Revision notes" section.
  Tests.

## Rollout

**Backend refresh + web deploy.** No migration (rows exist). Additive endpoint + a UI section.

## Out of scope

- Editing/deleting feedback from the log (it's read-only; feedback is created on the version viewer). A
  notifications/unread model. The unified-4-tab layout (the other workspace adaptation).

## Global constraints

- Owner **or** reviewer access (`need_owner=False`); read-only. The mobile section is non-critical — a
  fetch failure hides/empties it, never errors the panel. No color-literal asserts; theme via
  `useThemedStyles`/tokens; `Alert` from `@/lib/alert`. Backend `ruff check` **and** `ruff format --check`;
  mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
