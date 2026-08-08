# Slice C — per-topic generation + validation — Design

**Status:** Approved (brainstorming, 2026-08-08). Slice C of the Projects TOC-structure arc
(`docs/superpowers/specs/2026-08-07-projects-toc-structure-arc-design.md`). Follows Slice B
(Structure/TOC) + the deeper-Suggest follow-up.

## Problem

The Structure phase produces a real outline (`project.toc`: subjects → topics → subtopics with
`source_ids`), but generation ignores it: `generate_draft` free-invents 1–6 sections for the *whole*
artifact, and validation is per whole-artifact. The outline the SME curated doesn't shape the book,
and there's no way to draft/validate one topic at a time. Slice C makes the **TOC topic** the unit of
generation and validation — the trust spine at topic granularity.

## Goal

Author a book/essay **topic-by-topic**: generate a grounded draft per TOC topic (a section per
subtopic), version it, and validate it independently; the book is "validated" when every current TOC
topic is validated. This coexists with the existing whole-book flow; social/short-form are unchanged.

## Locked decisions (brainstorming 2026-08-08)

1. **Topics-as-rows.** A new **`topic_version`** table holds per-topic drafts (NOT reusing `artifact`).
2. **Separate `topic_approval`** table — its own append-only + `recorded_via` + withdraw + "validated =
   latest action is approve" logic, parallel to `approval` (deliberate separation, accepted duplication).
3. **Both coexist** for book/essay: the author chooses **whole-book** (existing `generate_draft` →
   `artifact_version`, unchanged) **or per-topic** (new). Social/short-form: unchanged (whole-artifact).
4. **Topic content = section per subtopic**, reusing the artifact draft shape
   `{sections:[{heading, body, source_ids}]}` — so the shipped draft **viewer + compare** render a
   `topic_version` unchanged.
5. **Identity/snapshot:** a `topic_version` is keyed to the TOC unit's client `id` (stable across
   rename/reorder — `TopicTreeEditor` preserves ids) and **snapshots** the topic `title` + `source_ids`
   at generate time (self-describing; survives TOC edits).
6. **Orphan rule:** a `topic_version` whose `topic_id` is no longer in `project.toc` is **orphaned** —
   kept (trust evidence is immutable) but excluded from the book-validated rollup.
7. **Book validated = every current TOC topic has a validated `topic_version`.**

## Data model (`backend/src/trust/`)

Migration **0015** (head is 0014). Nullable-free new tables; downgrade drops them.

**`topic_version`:**
| col | type | note |
|---|---|---|
| `id` | uuid pk | |
| `project_id` | uuid fk → project | |
| `topic_id` | text | the TOC unit's client uuid (from `project.toc`) |
| `title` | text | snapshot of the topic title at generate time |
| `source_ids` | jsonb | snapshot of the topic's source input ids |
| `content` | jsonb | `{sections:[{heading, body, source_ids}]}` (artifact-draft shape) |
| `seq` | int | per-`(project_id, topic_id)` monotonic version number |
| `created_at` | timestamptz default now() | |

Index `(project_id, topic_id, seq)`.

**`topic_approval`** (mirrors `approval`):
| col | type | note |
|---|---|---|
| `id` | uuid pk | |
| `topic_version_id` | uuid fk → topic_version | |
| `seq` | int | append order |
| `action` | text | `'approve'` \| `'withdraw'` (reuse `APPROVAL_ACTION` values) |
| `recorded_via` | text | provenance (mirror the artifact approval's values) |
| `expert_name` / `expert_email` | text null | as on `approval` |
| `note` | text null | |
| `created_at` | timestamptz default now() | |

A `topic_version` is **validated** iff its latest `topic_approval` (by seq) has `action='approve'`.

**Models (`models.py`):** `TopicVersion`, `TopicApproval` dataclasses (mirror `ArtifactVersion` /
`Approval`). **Repos:** `topic_repo.py` — `create_topic_version`, `list_topic_versions(project_id)`
(or per topic), `get_topic_version`; `topic_approval_repo.py` — `record_topic_approval`,
`get_latest_topic_approval` (mirror `approval_repo`).

## Generation

New `generate_topic.py` (mirrors `generate.py`): `generate_topic_draft(*, sources, topic_title,
subtopics, audience, goal, provider_id, api_key, model)` → `{sections}` where the model writes a
**section per subtopic** (`heading` = the subtopic label, `body` grounded ONLY in the topic's sources).
`toc`-prompt-style grounding ("use ONLY these sources / invent nothing"), `[S1..Sn]` labelling scoped
to the topic's `source_ids`. Reuse `build_provider` + `generate_validated`.

**Endpoint** `POST /projects/{project_id}/topics/{topic_id}/generate` (owner-only,
`enforce_rate_limit`): look up the topic in `project.toc` (404 if absent), resolve its `source_ids`
to the project's inputs (422 if the topic has no sources), key handling + LLM error mapping identical
to `generate_version`, snapshot `title`+`source_ids`, persist a new `topic_version` (next `seq`),
return it. ADR-001: key never logged/returned (keep the same assertion pattern).

**Validation endpoints** (mirror the artifact approval routes):
`POST /topic-versions/{id}/approvals` (owner records; expert_name required for owner-recorded) and
`POST /topic-versions/{id}/approvals/withdraw`.

## Book rollup + status

`GET /projects/{id}` (ProjectDetailOut) gains a **per-topic status** map derived from the CURRENT
`project.toc` topics × their latest `topic_version`/`topic_approval`:
`not_generated | drafted | validated` per topic, and a project-level `book_validated` boolean (true
iff `project.toc` has ≥1 topic and every current topic is `validated`). Orphaned `topic_version`s are
excluded.

## Coexistence (book/essay)

- Whole-book path (existing `generate_draft` → `artifact_version` + `approval`): **unchanged**.
- Per-topic path (new): the author opts in per artifact. Validation stories reconcile in the Validate
  phase — a whole-book artifact validates as today; a per-topic book validates when `book_validated`.
- Social/short-form: unchanged (whole-artifact only).

## Mobile (Slice C2 — separate sub-slice)

Drafts phase for book/essay gains a **mode toggle**: whole-book (as today) or **per-topic** — a list
of the TOC topics, each showing its status and offering **Generate** / open version (reuse the shipped
draft **viewer** + **compare**) / **validate** (reuse the approval badge + `recorded_via`). New trust
client calls: `generateTopic(projectId, topicId, key, token)`, topic-approval record/withdraw, and the
per-topic status off the project detail.

## Reuse map

- Draft **viewer + compare** render a `topic_version` unchanged (same `{sections}` shape).
- `generate_draft` grounding + `S`-label mapping + key handling + error mapping → copied into
  `generate_topic`.
- Approval **UI** (badge, `recorded_via`, expert fields) reused; approval **backend** is deliberately
  re-implemented as `topic_approval` (decision 2).
- `TopicTreeEditor`/`project.toc` supply the topic list + ids + subtopics + source_ids.

## Decomposition (each its own spec→plan→SDD)

- **C1 — backend:** migration 0015 (`topic_version` + `topic_approval`) + models + repos +
  `generate_topic` + the generate/approve/withdraw endpoints + per-topic status in `GET /projects/{id}`.
- **C2 — mobile:** the per-topic Drafts/Validate UI (mode toggle, topic list, reuse viewer/compare/
  approval badge) + client/hook wiring.

This spec covers Slice C's whole design; **the first plan is C1 (backend).**

## Testing (C1)

- `generate_topic_draft`: prompt scoped to the topic's sources, "invent nothing", section-per-subtopic
  instruction; returns `{sections}` validated; a topic with no sources → 422 at the endpoint.
- Endpoint: unknown topic id → 404; owner-only (reviewer 403); key never in response (ADR-001); a new
  `topic_version` persists with snapshot `title`/`source_ids`; `seq` increments per topic.
- `topic_approval`: record approve → topic validated; withdraw appends → not validated; owner
  expert_name required; append-only (no update/delete).
- Book rollup: `GET /projects/{id}` → per-topic status correct across not_generated/drafted/validated;
  `book_validated` true only when all current topics validated; an orphaned `topic_version` (topic_id
  not in `toc`) is excluded.
- Migration 0015 up/down; existing projects (no topic rows) read back cleanly.

## Rollout

Backend **migration 0015** + endpoints → **prod backend refresh + `alembic upgrade head` on ship**.
C2 (mobile UI) ships separately (web redeploy). No change to the existing whole-book/social flows.

## Out of scope

- **Slice D** — Publish assembly (validated topics → a multi-topic book via `artifactToBook`).
- Per-subtopic (vs per-topic) validation. Auto-regenerating a topic when its sources change (the
  orphan/stale story stays passive: orphaned versions are excluded, not auto-invalidated).
- Reconciling a book that mixes whole-book and per-topic drafts (author picks one mode per artifact).

## Global constraints reminder

Owner-only generate/validate; reviewers validate per the existing recorded_via rules (expert path).
App-level authz via `require_project_access` — NO RLS, no tenant column; the new tables are
project-scoped like the rest of the trust aggregate. ADR-001 key discipline on the new generate path.
"Invent nothing beyond the topic's sources" grounding. ruff clean; migration `down_revision="0014"`.
