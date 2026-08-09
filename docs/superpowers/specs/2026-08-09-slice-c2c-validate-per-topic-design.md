# Slice C2c — Validate per-topic — Design

**Status:** Approved (brainstorming, 2026-08-09). Final slice of the per-topic UI (C2), on the live
C1/C2a/C2b stack. Completes the per-topic loop: generate → view → **validate → book validated**.

## Problem

C2b made per-topic authoring visible (generate/open a topic draft), but the topic viewer is
read-only — an SME can't yet mark a topic validated, and there's no book-level "all topics validated"
view. C2c adds per-topic validation, mirroring the shipped artifact-version approval UX.

## Goal

From the Validate phase (per-topic mode), see each topic's status + a book rollup, Open a topic draft,
and **Approve/Withdraw** it there (owner records a named expert; reviewer self-approves) — so a
book/essay validates topic-by-topic and `book_validated` flips when all current topics are validated.

## Locked decisions (brainstorming 2026-08-09)

1. **Approve/Withdraw lives on the topic *viewer*** (not inline on the Validate list) — a faithful
   mirror of the artifact pattern (`version/[versionId].tsx`, where "Approve/Unapprove lives ON the
   draft view"). The C2b read-only topic viewer becomes **read-write**.
2. **Expert flow = the artifact flow:** owner tapping Approve reveals an **expert-name field**
   (required → `recorded_via="operator"`); reviewer approves in **one tap** (`expert_self`). Withdraw
   when currently validated (confirm dialog). Backend already enforces this (C1).
3. **Validate phase gains a `Whole book | Per topic` toggle** (TOC-gated, default whole-book — mirrors
   the Drafts toggle from C2b). Per-topic = the TOC grouped by subject, each topic: **status badge +
   Open**, plus a **book rollup header** ("N/M topics validated" + `book_validated`).
4. **Thread `projectId` to the topic viewer** (via the Open navigation) so it can read `my_role`
   (owner/reviewer) + refresh — the C2b Open passes only the version id today.
5. Per-topic **feedback/comments** stays out of scope.
6. **Mobile-only** — the approve/withdraw endpoints + `book_validated`/`topic_status` rollup are
   already live (C1/C2b). No backend, no migration → **web redeploy only**.

## Architecture

### Topic viewer read-write (`app/trust/topic-version/[id].tsx`)

- Route gains a `projectId` param (from the Open nav). Use `useTrustProject(projectId)` for
  `my_role` (→ `isOwner`), `approveTopic`/`withdrawTopic` (C2a hook), and a project refresh.
- Add the approve/withdraw UI, mirroring the artifact viewer's `runApprove`/`onApprove`/
  `submitOwnerApprove`/`onUnapprove`:
  - `onApprove`: owner → reveal the expert-name field (`setAskName(true)`), `submitOwnerApprove` calls
    `approveTopic(id, { expertName })`; reviewer → `approveTopic(id)` (one tap).
  - `onUnapprove`: confirm dialog → `withdrawTopic(id)`.
  - After either → **reload the topic version** (`getTopicVersion(id)`) so the validated badge +
    `recorded_via` update (best-effort, like the artifact viewer's `reloadVersion().catch(()=>{})`).
  - Errors via `Alert` (`@/lib/alert`) + `ApiError.userMessage()`.
- The validated badge / `recorded_via` rendering is already in the C2b viewer — keep it; it now
  updates after approve/withdraw.

### Validate phase per-topic mode (`app/trust/[projectId].tsx`, `FeedbackPanel`)

- Add a `mode` toggle `Whole book | Per topic` (render only when `toc?.subjects?.length`; default
  whole-book — the existing FeedbackPanel content unchanged under `mode==="whole"`).
- Per-topic view: a **book rollup header** — `validatedCount/total` current topics + a `book_validated`
  indicator (compute from `project.topic_status` / `project.book_validated`, already on the detail).
  Then the TOC grouped by subject, each topic: title + **status badge** (from `topic_status`) +
  **Open** (→ the topic viewer, passing `projectId` + `latest_version_id`). No inline approve
  (that's on the viewer, decision 1). Open is shown when the topic has a `latest_version_id`.
- Thread `project.toc` / `project.topic_status` / `project.book_validated` + an `onOpenTopic(versionId)`
  (→ `router.push('/trust/topic-version/' + versionId + '?projectId=' + projectId)`) into FeedbackPanel.
  (Update C2b's Drafts `onOpenTopic` to pass `projectId` too, so both phases open the viewer the same way.)

## Reuse

- Artifact viewer approve/withdraw logic (`runApprove`/expert-name/`onUnapprove`/reload) → copied to
  the topic viewer with `approveTopic`/`withdrawTopic`/`getTopicVersion`.
- The C2b topic list (grouped-by-subject + status chip + Open) → the Validate per-topic list is the
  same shape minus Generate.
- `topic_status`/`book_validated` (C1/C2b) → the rollup header.

## Data flow

```
Validate › Per topic → topic list (status from topic_status) + rollup (book_validated)
  Open(topic) → /trust/topic-version/{latest_version_id}?projectId={id}
    viewer: read sections + [Approve]/[Withdraw]
      owner → name expert → approveTopic(id,{expertName}) (operator)
      reviewer → approveTopic(id) (expert_self)
      withdraw → withdrawTopic(id)
    → reload getTopicVersion → badge updates; project refresh → topic_status/book_validated update
```

## Testing

**Mobile (Jest + RNTL):**
- Topic viewer: owner tap Approve → name field appears → submit → `approveTopic(id,{expertName})`
  called; reviewer tap Approve → `approveTopic(id)` (no name); a validated version shows the badge +
  Withdraw → `withdrawTopic(id)`; error path Alerts. (Mock `useTrustProject` + `getTopicVersion`.)
- Validate per-topic: the toggle shows only with a TOC; per-topic shows the rollup header
  ("N/M validated") + topic list with status; Open routes to `/trust/topic-version/{id}?projectId={id}`;
  no-TOC hides per-topic. Existing FeedbackPanel (whole-book) tests stay green.
- `getTopicVersion`/`approveTopic`/`withdrawTopic` already unit-tested (C2a).

## Files

- `mobile/app/trust/topic-version/[id].tsx` (read-write: approve/withdraw + projectId param)
- `mobile/app/trust/[projectId].tsx` (`FeedbackPanel` per-topic mode + rollup; `onOpenTopic` passes
  projectId; the C2b Drafts `onOpenTopic` updated to match)
- Tests: `mobile/__tests__/screens/TopicVersionViewer.approve.test.tsx` (new);
  `mobile/__tests__/screens/TrustProjectDetail.validate-pertopic.test.tsx` (new)

## Decomposition (C2c plan)

- **T1 — topic viewer approve/withdraw** (read-write + projectId thread) — the core.
- **T2 — Validate phase per-topic mode** (toggle + topic list + rollup header + Open-with-projectId,
  incl. updating the Drafts Open to pass projectId).

## Rollout

**Mobile-only → web redeploy** (no backend refresh, no migration). Completes Slice C2 / the per-topic
authoring loop. Remaining after this: arc **Slice D** (Publish assembly) + Studio **P2** (app chrome).

## Global constraints

Owner-or-reviewer approve/withdraw (backend enforces; UI branches on `my_role`); reviewer→expert_self,
owner→operator+expert_name. ADR-001: no key on this path (approve carries no key). Studio primitives;
`useThemedStyles`; no color-literal test asserts; RN-web nested-Pressable guard where relevant.
