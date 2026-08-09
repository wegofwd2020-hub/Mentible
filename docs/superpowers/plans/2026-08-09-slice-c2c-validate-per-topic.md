# Slice C2c — Validate per-topic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-topic validation — Approve/Withdraw on the topic viewer (mirroring the artifact approval UX) + a Validate-phase Whole-book/Per-topic toggle with a topic list and a book-validated rollup. Completes the per-topic loop.

**Architecture:** Mobile-only over the live C1/C2a/C2b stack. Make the C2b read-only topic viewer read-write (reuse the artifact viewer's approve/withdraw logic via the C2a hook methods). Add a per-topic mode to the Validate phase (FeedbackPanel), mirroring the C2b Drafts toggle. Thread `projectId` to the viewer so it knows `my_role`.

**Tech Stack:** React Native + Expo TS (Jest/RNTL); Studio primitives; expo-router.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-09-slice-c2c-validate-per-topic-design.md`.
- Mirror the ARTIFACT viewer approve/withdraw UX (`mobile/app/trust/version/[versionId].tsx`): owner tapping Approve reveals an expert-name field (required → operator); reviewer approves in one tap (expert_self); Withdraw (confirm dialog) when validated; **reload the version after approve/withdraw** so the badge updates (best-effort `.catch(()=>{})`). Use the C2a hook methods `approveTopic(id,{expertName?})` / `withdrawTopic(id)` + `getTopicVersion` to reload.
- `isOwner = project?.my_role === "owner"` (from `useTrustProject(projectId)`).
- Approve/Withdraw is owner-or-reviewer (backend enforces); the UI branches on role. ADR-001: no key on this path.
- Per-topic mode in Validate is TOC-gated (`toc?.subjects?.length`), default whole-book (existing FeedbackPanel unchanged under that branch). Approve is NOT inline on the Validate list (it's on the viewer).
- Errors via `Alert` from `@/lib/alert` + `ApiError.userMessage()`. Studio primitives (Card/Label/Button/Chip); `useThemedStyles`; no color-literal test assertions; RN-web nested-Pressable guard where relevant.
- Mobile-only: `npx tsc --noEmit` strict clean + full `npx jest` green. No backend, no migration.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/app/trust/topic-version/[id].tsx` — read-write: approve/withdraw + `projectId` param (T1)
- `mobile/app/trust/[projectId].tsx` — `onOpenTopic` passes `projectId` (T1 for Drafts, used by T2); `FeedbackPanel` per-topic mode + rollup (T2)
- Tests: `mobile/__tests__/screens/TopicVersionViewer.approve.test.tsx` (new, T1); `mobile/__tests__/screens/TrustProjectDetail.validate-pertopic.test.tsx` (new, T2)

---

### Task 1: Topic viewer read-write (approve/withdraw) + projectId thread

**Files:**
- Modify: `mobile/app/trust/topic-version/[id].tsx`, `mobile/app/trust/[projectId].tsx` (the Drafts `onOpenTopic` → pass `projectId`)
- Test: `mobile/__tests__/screens/TopicVersionViewer.approve.test.tsx` (new); update `TopicVersionViewer.test.tsx` if it asserted the old param shape

**Interfaces:**
- Consumes: `useTrustProject(projectId)` → `my_role`, `approveTopic(id,{expertName?})`, `withdrawTopic(id)`; `getTopicVersion(id, token)` (reload).
- Produces: the topic viewer accepts `{ id, projectId }` params and shows Approve/Withdraw.

- [ ] **Step 1: Write the failing test** (`TopicVersionViewer.approve.test.tsx`, mirror the artifact viewer's approve test + the C2b viewer test): mock `useLocalSearchParams` → `{ id:"tv1", projectId:"p1" }`; mock `useTrustProject` returning `{ project:{ project:{...}, my_role:"owner", ... }, approveTopic: jest.fn().mockResolvedValue({...}), withdrawTopic: jest.fn() }` and mock `getTopicVersion` → a not-yet-validated `TopicVersionDetailView`. Assert:
  - OWNER: tap "Approve" → an expert-name input appears; type a name + submit → `approveTopic("tv1", { expertName: "Dr X" })` called.
  - REVIEWER (`my_role:"reviewer"`): tap "Approve" → `approveTopic("tv1")` called with no name (one tap, no field).
  - a VALIDATED version (`is_validated:true`) shows the validated badge + a "Withdraw"/"Unapprove" control → tapping it (through the confirm) → `withdrawTopic("tv1")`.
  Colors from theme; assert by accessibilityLabel/text. Mock `@/lib/alert`.

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer.approve.test.tsx`.

- [ ] **Step 3: Implement** in `topic-version/[id].tsx`:
  - Params: `useLocalSearchParams<{ id: string; projectId: string }>()`. Use `useTrustProject(projectId)` for `project` (→ `isOwner = project?.my_role === "owner"`), `approveTopic`, `withdrawTopic`. Keep the existing `getTopicVersion(id, token)` load; add a `reload()` that re-fetches it.
  - Port the artifact viewer's approve/withdraw handlers (see `version/[versionId].tsx` `runApprove`/`onApprove`/`submitOwnerApprove`/`onUnapprove`), swapping `approve`→`approveTopic(id,...)`, `unapprove`→`withdrawTopic(id)`, `reloadVersion`→`reload`: owner Approve reveals the name field (`askName` state) → `submitOwnerApprove` calls `approveTopic(id,{expertName})`; reviewer Approve → `approveTopic(id)`; `onUnapprove` → confirm Alert → `withdrawTopic(id)`; each → `await reload().catch(()=>{})` + success/failure Alert.
  - Render the Approve/Withdraw controls (Studio Button; the owner name-field input) below the existing read-only sections + validated badge. Owner sees the name-field on Approve; reviewer one-tap. Withdraw shown when `is_validated`.
  - In `[projectId].tsx`, update the Drafts `onOpenTopic(versionId)` to `router.push('/trust/topic-version/' + versionId + '?projectId=' + projectId)` (so the viewer gets projectId). If a `TopicVersionViewer.test.tsx` (C2b) asserted the old param-only shape, update it to include `projectId` (note in report).

- [ ] **Step 4: Run test + tsc** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/topic-version/[id].tsx" "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TopicVersionViewer.approve.test.tsx
git commit -m "feat(trust): topic viewer approve/withdraw (per-topic validation) (Slice C2c)"
```

---

### Task 2: Validate phase per-topic mode (toggle + list + rollup)

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (`FeedbackPanel` + thread props)
- Test: `mobile/__tests__/screens/TrustProjectDetail.validate-pertopic.test.tsx` (new)

**Interfaces:**
- Consumes: `project.toc`, `project.topic_status` (with `latest_version_id`), `project.book_validated`; an `onOpenTopic(versionId)` (routes to the viewer with `projectId`).

- [ ] **Step 1: Write the failing test** (`TrustProjectDetail.validate-pertopic.test.tsx`, mirror the C2b pertopic test): owner project with `toc` (topics `t1,t2`) + `topic_status` (`t1: validated, latest_version_id:"tv1"`; `t2: drafted, latest_version_id:"tv2"`) + `book_validated:false`. Switch to the Validate phase, assert:
  - a "Per topic" toggle is present (TOC exists);
  - switching to Per topic shows a **rollup header** reading "1/2" (or "1 of 2 topics validated") + a not-yet-`book_validated` state;
  - the topic titles + a status badge each;
  - pressing **Open** on `t1` routes to `/trust/topic-version/tv1?projectId={id}` (mocked router `push`);
  - there is **no inline Approve** on the list rows (approve is on the viewer);
  - a project with NO toc shows no "Per topic" control.

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail.validate-pertopic.test.tsx`.

- [ ] **Step 3: Implement** in `FeedbackPanel` (`[projectId].tsx`):
  - Add a `mode` state (`"whole" | "topic"`, default `"whole"`), render the `Whole book | Per topic` toggle only when `toc?.subjects?.length`. Reuse the same toggle component/pattern as the C2b Drafts toggle (extract a small shared `ModeToggle` if it reduces duplication, or replicate consistently).
  - `mode==="whole"` → the existing FeedbackPanel content (invite-expert + version list), UNCHANGED.
  - `mode==="topic"` → a **rollup header**: compute `validated = topic_status.filter(s=>s.status==="validated").length`, `total = current toc topic count`; render "`{validated}/{total}` topics validated" + a `book_validated` indicator (Label/Chip; from `project.book_validated`). Then the TOC grouped by subject (reuse the C2b list shape): each topic = title + status badge + **Open** (shown when `latest_version_id`) → `onOpenTopic(latest_version_id)`. NO Generate, NO inline Approve.
  - Thread `toc`, `topicStatus`, `bookValidated`, `onOpenTopic` into FeedbackPanel from `TrustProjectDetailInner` (which already has them + the router). `onOpenTopic` = the same projectId-passing push as T1.

- [ ] **Step 4: Run the validate-pertopic test + full TrustProjectDetail suite + full jest + tsc** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx jest && npx tsc --noEmit`. Existing FeedbackPanel (whole-book) tests must stay green (unchanged under the default branch). If one asserted structure now under the whole-book branch, adjust to that branch (note in report).

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.validate-pertopic.test.tsx
git commit -m "feat(trust): Validate phase per-topic mode — toggle, list, book rollup (Slice C2c)"
```

---

## Final verification (after both tasks)

- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green + clean; lint clean.
- [ ] Manual (optional, local): Validate phase → Per topic → rollup header + topic list; Open a topic → the viewer shows Approve (owner names an expert / reviewer one-tap) → badge flips validated; withdraw reverts; when all topics validated the rollup shows book_validated.
- [ ] PR body: **mobile-only → web redeploy** (no backend refresh, no migration). Completes the per-topic loop (generate → view → validate → book validated).

## Self-Review

- **Spec coverage:** topic viewer approve/withdraw + projectId thread (T1) · Validate per-topic toggle + list + rollup (T2). Per-topic feedback + inline-approve correctly excluded.
- **Type consistency:** `approveTopic(id,{expertName?})`/`withdrawTopic(id)` (C2a hook) consumed by T1; `topic_status.latest_version_id`/`book_validated` (C2b) consumed by T2; the Open route `/trust/topic-version/{id}?projectId={id}` is written the same in T1 (Drafts) and T2 (Validate) and matches the viewer's params (T1).
- **Placeholders:** none — "port the artifact viewer's runApprove/onUnapprove" points at concrete code; the toggle/list reuse points at the C2b implementation.
- **ADR-001:** no key on the approve path; owner/reviewer branch on `my_role`, backend enforces.
