# Slice C2b — Drafts per-topic mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-topic authoring visible — a Whole-book/Per-topic toggle in the Drafts phase; per-topic = the TOC (grouped by subject) with each topic's status, Generate/Regenerate, and Open (a read-only topic-draft viewer).

**Architecture:** Extend the shipped `topic_status` rollup with the latest version id (so Open can fetch it), add a read-only topic-version viewer route, and add the per-topic mode to the Drafts phase. Backend change is a field add (no migration); everything else is mobile UI over the C1/C2a endpoints.

**Tech Stack:** FastAPI + asyncpg (pytest); React Native + Expo TS (Jest/RNTL); Studio primitives + expo-router.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-08-slice-c2-per-topic-ui-design.md` (C2b section) + the C2b brainstorm decisions (extend `topic_status` with `latest_version_id`/`version_no`; read-only viewer for C2b; grouped-by-subject list; mode default = Whole book).
- Reuse the **live** C1/C2a endpoints + client: `generateTopic` (hook), `getTopicVersion` (client), `project.topic_status`/`book_validated`. Per-topic **validation is C2c** — NOT in this slice (viewer is read-only; no approve/withdraw UI here).
- Per-topic mode is available only when `project.toc?.subjects?.length` > 0; default = Whole book (the existing generate grid + artifact list — unchanged).
- Owner-only Generate (reviewers see status + Open, no Generate). ADR-001: `generateTopic` loads the key via the hook (mirrors `generateVersion`) — the screen never handles the key.
- Studio primitives (Card/Label/Button); `useThemedStyles`; no color-literal test assertions; RN-web nested-Pressable guard where relevant.
- `npx tsc --noEmit` strict clean + full `npx jest` green; backend `ruff` clean.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `backend/src/trust/router.py` (`_topic_status_rollup`), `backend/src/trust/schemas.py` (`TopicStatusOut`) — add `latest_version_id`/`version_no` (T1)
- `mobile/src/api/trustClient.ts` — `topic_status` entry type gains the two fields (T1)
- `mobile/app/trust/topic-version/[id].tsx` (new) — read-only topic-draft viewer (T2)
- `mobile/app/trust/[projectId].tsx` — `DraftsPanel` gets the mode toggle + per-topic list (T3)
- Tests: `backend/tests/test_trust_router.py`; `mobile/__tests__/screens/TopicVersionViewer.test.tsx` (new); `mobile/__tests__/screens/TrustProjectDetail.pertopic.test.tsx` (new)

---

### Task 1: Backend — `latest_version_id`/`version_no` on topic_status (+ client type)

**Files:**
- Modify: `backend/src/trust/router.py`, `backend/src/trust/schemas.py`, `mobile/src/api/trustClient.ts`
- Test: `backend/tests/test_trust_router.py`

**Interfaces:**
- Produces: `TopicStatusOut{topic_id, status, latest_version_id: str | None, version_no: int | None}`; the mobile `topic_status` entry type gains the same two optional fields.

- [ ] **Step 1: Write the failing test** (`test_trust_router.py`, extend the existing topic-status test): a project with toc topics `t1,t2`; generate `t1` (→ drafted); `GET /projects/{id}` → the `t1` entry has `latest_version_id` == the generated version's id and `version_no == 1`; the `t2` entry (`not_generated`) has `latest_version_id is None` and `version_no is None`. Orphan/other cases unchanged.

- [ ] **Step 2: Run — verify fail** — `cd backend && python -m pytest tests/test_trust_router.py -k topic_status -v` → FAIL (no field).

- [ ] **Step 3: Schema (`schemas.py`).** Extend `TopicStatusOut`:
```python
class TopicStatusOut(BaseModel):
    topic_id: str
    status: TopicStatus
    latest_version_id: str | None = None
    version_no: int | None = None
```

- [ ] **Step 4: Rollup (`router.py` `_topic_status_rollup`).** The loop already resolves `latest` (the latest `topic_version` for the topic, or None). Populate the two fields from it:
```python
        statuses.append(
            schemas.TopicStatusOut(
                topic_id=topic_id,
                status=status_value,
                latest_version_id=str(latest.id) if latest is not None else None,
                version_no=latest.version_no if latest is not None else None,
            )
        )
```
(Match the exact `TopicStatusOut(...)` construction already there — only add the two kwargs.)

- [ ] **Step 5: Client type (`trustClient.ts`).** Extend the `topic_status` entry type added in C2a:
```ts
topic_status?: { topic_id: string; status: "not_generated" | "drafted" | "validated"; latest_version_id?: string | null; version_no?: number | null }[];
```

- [ ] **Step 6: Run tests + ruff + tsc** — `cd backend && python -m pytest tests/test_trust_router.py -v`; ruff clean from repo root; `cd ../mobile && npx tsc --noEmit`.

- [ ] **Step 7: Commit.**
```bash
git add backend/src/trust/router.py backend/src/trust/schemas.py mobile/src/api/trustClient.ts backend/tests/test_trust_router.py
git commit -m "feat(trust): topic_status carries latest_version_id + version_no (Slice C2b)"
```

---

### Task 2: Mobile — read-only topic-draft viewer route

**Files:**
- Create: `mobile/app/trust/topic-version/[id].tsx`
- Test: `mobile/__tests__/screens/TopicVersionViewer.test.tsx` (new)

**Interfaces:**
- Consumes: `getTopicVersion(id, token)` → `TopicVersionDetailView` (C2a).
- Produces: a route `/trust/topic-version/{id}` that renders the topic draft's title + sections read-only + a validated badge.

- [ ] **Step 1: Write the failing test** (`TopicVersionViewer.test.tsx`): mock `getTopicVersion` to resolve a `TopicVersionDetailView` with `title:"Reading music"`, `content.sections:[{heading:"Staff",body:"5 lines",source_ids:[]}]`, `is_validated:true`, `recorded_via:"operator"`; render the route (mock `useLocalSearchParams` → `{id:"tv1"}` and the auth token like the existing `version/[versionId]` test); assert the title, the section heading + body, and a validated indicator render. Loading + not-signed-in states handled (assert no crash when token missing).

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer.test.tsx`.

- [ ] **Step 3: Implement `topic-version/[id].tsx`.** Model on `version/[versionId].tsx`'s data-load shape but READ-ONLY (no edit/feedback/approve): `useLocalSearchParams<{id:string}>()`, load the token (mirror how the version viewer gets `accessToken`), `useState` for the loaded `TopicVersionDetailView` + loading/error, `useEffect` → `getTopicVersion(id, token)`. Render (Studio primitives): a Playfair title (the topic title), a validated badge when `is_validated` (reuse the approval-badge treatment / `recorded_via`), then each section as a heading (Label or Playfair small) + body (`Text`). Handle loading (spinner) + error (message) + not-signed-in (like the other trust screens). No editing, no generate, no approve (C2c). `useThemedStyles`.

- [ ] **Step 4: Run test + tsc** — `cd mobile && npx jest __tests__/screens/TopicVersionViewer.test.tsx && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__/screens/TopicVersionViewer.test.tsx
git commit -m "feat(trust): read-only topic-draft viewer route (Slice C2b)"
```

---

### Task 3: Mobile — Drafts per-topic mode (toggle + list + Generate + Open)

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (`DraftsPanel` + the hook wiring)
- Test: `mobile/__tests__/screens/TrustProjectDetail.pertopic.test.tsx` (new)

**Interfaces:**
- Consumes: `useTrustProject().generateTopic` (C2a), `project.toc`, `project.topic_status` (with `latest_version_id`, T1), the router (`expo-router`) to Open the viewer.

- [ ] **Step 1: Write the failing test** (`TrustProjectDetail.pertopic.test.tsx`, mirror the existing `TrustProjectDetail.*` setup mocking `useTrustProject`): an owner project with `toc` (subjects→topics `t1,t2`) + `topic_status` (`t1: drafted, latest_version_id:"tv1"`; `t2: not_generated`). On the Drafts phase, assert:
  - a **mode toggle** with a "Per topic" control is present (only because the project has a TOC);
  - switching to Per topic shows the topic titles grouped under their subject, each with a status chip;
  - pressing **Generate** on `t2` calls `generateTopic("t2")`;
  - pressing **Open** on `t1` navigates to `/trust/topic-version/tv1` (assert via the mocked router `push`);
  - a project with NO toc shows no "Per topic" control (whole-book only).

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail.pertopic.test.tsx`.

- [ ] **Step 3: Implement in `DraftsPanel` (`[projectId].tsx`).**
  - Add local `mode` state (`"whole" | "topic"`), default `"whole"`. Render a segmented `Whole book | Per topic` toggle (Studio primitives) ONLY when `toc?.subjects?.length` — pass `toc` + `topicStatus` + `generateTopic` + a `busyTopicId` into `DraftsPanel` (thread from `TrustProjectDetailInner`, which has `project.toc`/`project.topic_status` + the hook's `generateTopic`).
  - `mode === "whole"` → the existing generate grid + artifact list (unchanged).
  - `mode === "topic"` → for each subject in `toc.subjects`, a subject header (`Label`), then each unit as a row: title (Playfair small) + status chip (map `topic_status` by `topic_id`; a `Chip`/`Label` reading not_generated/drafted/validated) + **Generate/Regenerate** `Button` (owner only; label "Generate" if not_generated else "Regenerate"; busy spinner via a `busyTopicId` state set around the `generateTopic` call) + **Open** `Button` (shown when the topic's status has a `latest_version_id`; `onPress` → `router.push('/trust/topic-version/' + latest_version_id)`).
  - Add a `generateTopic` handler in `TrustProjectDetailInner` wrapping the hook (`setBusyTopicId(topicId)`; `await generateTopic(topicId)`; catch → Alert via `@/lib/alert` with `ApiError.userMessage()`; finally clear busy). `router` from `expo-router` (already imported in the screen — confirm).
  - Reviewer: sees the toggle + list + status + Open, but NO Generate (mirror the owner-gating elsewhere).

- [ ] **Step 4: Run the pertopic test + full TrustProjectDetail suite + tsc** — `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`. Existing Drafts/whole-book tests must stay green (the whole-book path is unchanged; the toggle defaults to it). If a Drafts test asserted a structure that moved under the toggle, adjust it to the new whole-book branch (note in report; don't weaken behavior).

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.pertopic.test.tsx
git commit -m "feat(trust): Drafts per-topic mode — toggle, topic list, Generate, Open (Slice C2b)"
```

---

## Final verification (after all tasks)

- [ ] Backend: `cd backend && python -m pytest tests/test_trust_router.py -v` (topic-status + existing pass); ruff clean.
- [ ] Mobile: `cd mobile && npx jest && npx tsc --noEmit` — full suite green + clean.
- [ ] Device/web (optional): the per-topic toggle appears for a project with a TOC; Generate a topic → status flips to drafted; Open → the read-only viewer renders the sections.
- [ ] PR body: backend field add (no migration) → **prod backend refresh**; **web redeploy** for the UI. Per-topic **validation is C2c** (this slice is generate/open only).

## Self-Review

- **Spec coverage:** `latest_version_id`/`version_no` on the rollup (T1) · read-only topic viewer (T2) · Drafts per-topic mode toggle + grouped list + Generate + Open (T3). Validation (C2c) + compare-across-topic-versions correctly excluded.
- **Type consistency:** `TopicStatusOut` fields (T1) match the client `topic_status` entry type (T1); `getTopicVersion`/`TopicVersionDetailView` (C2a) consumed by T2; `generateTopic` (C2a hook) + `topic_status.latest_version_id` consumed by T3; the viewer route path `/trust/topic-version/{id}` (T2) is exactly what T3's Open navigates to.
- **Placeholders:** none — the rollup edit, schema, viewer, and Drafts-mode logic are concrete; "mirror version/[versionId] load shape" points at real code.
- **ADR-001** preserved (key only via the hook's `generateTopic`); owner-gating on Generate; no per-topic validation UI (C2c).
