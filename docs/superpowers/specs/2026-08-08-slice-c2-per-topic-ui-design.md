# Slice C2 — per-topic mobile UI — Design

**Status:** Approved (brainstorming, 2026-08-08). Consumes the shipped Slice C1 backend
(`docs/superpowers/specs/2026-08-08-slice-c-per-topic-design.md`, live: `topic_version`/
`topic_approval`, generate/approve/withdraw, `topic_status`+`book_validated` on the project detail).

## Problem

Slice C1 shipped the per-topic backend but nothing consumes it — an SME still can't author a
book/essay topic-by-topic in the app. C2 is the mobile UI that drives the C1 endpoints, threaded
through the existing Drafts (generate) and Validate (approve) phases.

## Goal

For a book/essay project with a TOC, let the author **switch into a per-topic mode** and, per TOC
topic, generate a grounded draft (Drafts phase) and validate it (Validate phase), with a book-level
"X/Y topics validated" rollup — reusing the shipped draft viewer, compare, and approval badge.

## Locked decisions (brainstorming 2026-08-08)

1. **Split by phase** (consistent with whole-book): Drafts per-topic = **Generate / Open** each topic;
   Validate per-topic = **Approve / Withdraw** each topic + the book rollup.
2. **Mode toggle** in Drafts + Validate (book/essay only): **Whole book** (existing, default —
   non-disruptive) vs **Per topic**. Per-topic is disabled/empty until a TOC exists.
3. **Reuse** the shipped draft **viewer** + **compare** (topic drafts are the same `{sections}` shape)
   and the **approval badge** + `recorded_via` (per topic).
4. **Backend gap to close (C2a):** C1 has no read endpoint for a `topic_version`'s content — add
   `GET /topic-versions/{id}` (same shape as `GET /versions/{id}`), so the viewer/compare can open a
   topic draft.

## Architecture

### Backend (C2a)

`GET /topic-versions/{topic_version_id}` (owner-or-member, mirror `get_version`'s auth via
`topic_repo.project_id_for_topic_version` → `require_project_access`) → `TopicVersionDetailOut{
id, topic_id, title, content, version_no, created_at, is_validated, recorded_via }` — `content` is the
`{sections:[{heading,body,source_ids}]}` the generator wrote; `is_validated`/`recorded_via` from the
latest `topic_approval` (reuse `topic_approval_repo.is_topic_validated` + `get_latest_topic_approval`).
No migration.

### Mobile client + hook (C2a)

- **Types** (`trustClient.ts`): extend `ProjectDetailView` with `topic_status?: { topic_id: string;
  status: "not_generated"|"drafted"|"validated" }[]` and `book_validated?: boolean` (C1 already returns
  them). Add `TopicVersionDetailView` (mirrors `VersionDetailView` + `topic_id`).
- **Calls** (`trustClient.ts`, mirroring the artifact equivalents):
  - `generateTopic(projectId, topicId, body:{api_key, provider_id?}, token) -> TopicVersionCreatedView`
    (POST `/projects/{id}/topics/{topicId}/generate`).
  - `getTopicVersion(id, token) -> TopicVersionDetailView` (GET).
  - `recordTopicApproval(id, body, token)` / `withdrawTopicApproval(id, body, token)` (mirror
    `approveVersion`/`withdrawApproval` against `/topic-versions/{id}/approvals[/withdraw]`).
- **Hook** (`useTrustProject.ts`): `generateTopic(topicId)` (loads the Anthropic key like
  `generateVersion`, POST, `refresh()`), `approveTopic(id, opts)` / `withdrawTopic(id)` (mirror
  `approve`/`unapprove`), and surface `project.topic_status` / `project.book_validated`. `getTopicVersion`
  is called directly by the viewer (like `getVersion`), not via the hook.

### Mobile UI (C2b Drafts, C2c Validate)

- **C2b — Drafts per-topic mode:** a `Whole book | Per topic` toggle in the Drafts phase (book/essay,
  TOC present). Per-topic = a list of the TOC topics (from `project.toc` × `topic_status`), each row:
  title + status chip + **Generate/Regenerate** (calls `generateTopic`) + **Open** (routes to the draft
  viewer for the latest topic_version). Reuse the compare affordance across two topic versions if easy;
  otherwise defer compare to a follow-up.
- **C2c — Validate per-topic:** the same topic list in the Validate phase, each row: status + **Approve/
  Withdraw** (reuse the approval badge + `recorded_via`, mirror the artifact approve/unapprove UI) +
  the book rollup header ("N/M topics validated", `book_validated`).
- **Viewer reuse:** the version viewer (`app/trust/version/[versionId].tsx`) opens a topic_version —
  either a small new route `app/trust/topic-version/[id].tsx` that reuses the same section-render
  component, or a param on the existing viewer that fetches via `getTopicVersion`. Decided in C2b.

## Decomposition (each its own spec→plan→SDD)

- **C2a — plumbing (THIS FIRST):** backend `GET /topic-versions/{id}` + client types/calls + hook
  wiring. No visible UI; fully testable (backend endpoint + client/hook unit tests + tsc).
- **C2b — Drafts per-topic mode:** the toggle + topic list + Generate + Open (viewer reuse).
- **C2c — Validate per-topic:** per-topic Approve/Withdraw + book rollup.

**This spec covers C2's whole design; the first plan is C2a.**

## Testing (C2a)

- **Backend:** `GET /topic-versions/{id}` returns the content + `is_validated`/`recorded_via`;
  owner-or-member allowed, non-member 403, unknown id 404; a validated vs drafted topic_version reports
  the right `is_validated`.
- **Mobile:** `generateTopic`/`getTopicVersion`/`recordTopicApproval`/`withdrawTopicApproval` hit the
  right paths/methods (mock `trustFetch`, mirror the existing client tests); the hook's `generateTopic`
  loads the key + POSTs + refreshes, `approveTopic`/`withdrawTopic` mirror `approve`/`unapprove`;
  `ProjectDetailView` type carries `topic_status`/`book_validated`. tsc strict clean.

## Rollout

C2a: backend **`GET /topic-versions/{id}`** (no migration) → **prod backend refresh**. Client/hook are
mobile plumbing — no visible change, ships with the next web redeploy (or bundled with C2b). C2b/C2c
ship the visible UI later.

## Out of scope

- Slice D (Publish assembly — validated topics → a book via `artifactToBook`).
- Per-subtopic validation; a whole-book↔per-topic content merge.
- Compare across topic versions is best-effort in C2b, not a C2a concern.

## Global constraints

Owner-only generate; approve/withdraw owner-or-reviewer (the C1 backend already enforces). ADR-001:
the api key flows only into `generateTopic`'s request body (mirror `generateVersion`), never logged/
rendered. `useThemedStyles`; no color-literal test asserts; reuse the Studio primitives + viewer/badge.
