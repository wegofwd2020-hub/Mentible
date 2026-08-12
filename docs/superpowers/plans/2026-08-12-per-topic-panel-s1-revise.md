# Per-topic panel S1 — Revise (with guidance) + hierarchy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a project owner a "Revise → new topic version (with guidance)" action in the per-topic
draft viewer, styled secondary so "Approve" stays the single filled primary — aligning it with the
whole-book panel. UI-only (the topic-generate endpoint already accepts `guidance`).

**Architecture:** Wire `guidance` through the `generateTopic` client + hook; add a Revise/guidance flow
to `topic-version/[id].tsx` that regenerates and navigates to the new version.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-12-per-topic-panel-s1-revise-design.md`.
- **Mobile-only. No backend/generation change** — `guidance` is already accepted by
  `/projects/{id}/topics/{topic_id}/generate` (`DraftGenerateIn.guidance`).
- **Owner-only** Revise (`isOwner = project?.my_role === "owner"`); reviewer unaffected. Approve stays
  `Button variant="primary"` (single primary); Revise is `variant="ghost"` (secondary).
- Read `project`/`topicVersion` defensively. `useThemedStyles`; reuse `Button` primitives + existing
  styles; **no color-literal test asserts**.
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

Two tasks, sequential (T2 depends on T1's hook signature).

## File Structure & anchors

- `mobile/src/api/trustClient.ts` — `generateTopic(projectId, topicId, body, token)` at line ~183;
  `body` currently `{ api_key: string; provider_id?: string; model?: string }`; it JSON-stringifies
  the whole body. Returns `TopicVersionCreatedView` (`{ id, topic_id, version_no, created_at }`).
- `mobile/src/hooks/useTrustProject.ts` — `generateTopic` at line ~125:
  `const generateTopic = useCallback(async (topicId) => { … generateTopicApi(projectId, topicId, { api_key: key, provider_id: "anthropic" }, accessToken) … })`.
- `mobile/app/trust/topic-version/[id].tsx` — viewer; `isOwner` (line 36), `topicVersion` state
  (has `topic_id`, `version_no`, `is_validated`), `router`, `projectId` param; actions row uses
  `<Button variant="primary" label="Approve">` + `<Button variant="ghost" label="Withdraw">`. Import
  path: `ApiError` from `@/api/client`, `Alert` from `@/lib/alert` (mirror the whole-book viewer).

---

### Task 1: Wire `guidance` through generateTopic (client + hook)

**Files:**
- Modify: `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/` (extend an existing trustClient/hook test, or add a focused one)

- [ ] **Step 1: Write the failing test.** Assert (mock `fetch`/`trustFetch`): calling the hook
  `generateTopic(topicId, { guidance: "tighten the intro" })` results in a POST whose JSON body
  includes `guidance: "tighten the intro"` (and `api_key`, `provider_id: "anthropic"`); and
  `generateTopic(topicId)` (no opts) posts a body WITHOUT a `guidance` key (or `undefined`). Follow the
  existing hook/client test seam (mock `loadApiKey` to return a dummy key, `getProject`, etc. as the
  existing `useTrustProject` tests do). If a client-level test is simpler, assert on `trustFetch`'s
  body arg instead.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement.**
  - `trustClient.ts` `generateTopic`: widen `body` type to
    `{ api_key: string; provider_id?: string; model?: string; guidance?: string }`. No other change
    (the whole body is already stringified).
  - `useTrustProject.ts` `generateTopic`: signature →
    `async (topicId: string, opts?: { guidance?: string })`; pass
    `{ api_key: key, provider_id: "anthropic", guidance: opts?.guidance }` to `generateTopicApi`.
    Keep `await refresh(); return v;`.

- [ ] **Step 4: Run** — `cd mobile && npx jest <the test> && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__
git commit -m "feat(trust): generateTopic accepts guidance (endpoint already supports it)"
```

---

### Task 2: Revise flow in the topic viewer

**Files:**
- Modify: `mobile/app/trust/topic-version/[id].tsx`
- Test: its existing test (extend) or a focused new test.

**Interfaces:** consumes `generateTopic(topicId, { guidance })` (T1).

- [ ] **Step 1: Write the failing test.** As **owner** (mock `useTrustProject` with `my_role:"owner"`,
  `generateTopic` returning `{ id: "tv2", topic_id: "t1", version_no: 2 }`; mock `getTopicVersion`,
  `useRouter`): a "Revise" control (accessibilityLabel "Revise draft") renders; pressing it (version
  NOT validated → no confirm) reveals a guidance TextInput; typing guidance + pressing "Generate new
  version" calls `generateTopic("t1", { guidance: <typed> })` and then `router.replace` to
  `/trust/topic-version/tv2?projectId=<projectId>`. As **reviewer** (`my_role:"reviewer"`): no
  "Revise" control. Approve control still present. No color-literal asserts.

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement.** In `topic-version/[id].tsx`:
  - Add `generateTopic` to the `useTrustProject` destructure.
  - Add state `const [regen, setRegen] = useState(false); const [guidance, setGuidance] = useState(""); const [genBusy, setGenBusy] = useState(false);`.
  - `const openRegen = () => { const go = () => setRegen(true); if (topicVersion?.is_validated) { Alert.alert("Revise a validated draft?", \`This creates a new version. The approval on v${topicVersion.version_no} stays; the new version needs re-approval.\`, [{ text: "Cancel", style: "cancel" }, { text: "Revise", onPress: go }]); } else { go(); } };`
  - `const doRegen = async () => { if (!topicVersion) return; setGenBusy(true); try { const nv = await generateTopic(topicVersion.topic_id, { guidance: guidance.trim() || undefined }); setRegen(false); setGuidance(""); router.replace(\`/trust/topic-version/${nv.id}?projectId=${projectId}\`); } catch (e) { Alert.alert("Couldn't revise", e instanceof ApiError ? e.userMessage() : "Try again."); } finally { setGenBusy(false); } };`
  - In the actions row, add an owner-only `<Button variant="ghost" label="Revise" accessibilityLabel="Revise draft" onPress={openRegen} />` (alongside Approve/Withdraw). Keep Approve `variant="primary"`.
  - When `regen`, render (near the actions) a guidance `TextInput` (`accessibilityLabel="Revision guidance"`, placeholder "Describe the change — a new version is created", `maxLength={500}`, `multiline`, `value={guidance}`, `onChangeText={setGuidance}`, `placeholderTextColor={theme.textMuted}`) + a `<Button variant="primary" label="Generate new version" busy={genBusy} onPress={doRegen} accessibilityLabel="Generate new version" />`. Reuse existing input style (mirror the whole-book viewer's guidance input) — no new color literals.
  - Ensure `ApiError` (`@/api/client`) and `Alert` (`@/lib/alert`) are imported.

- [ ] **Step 4: Run** — `cd mobile && npx jest <the viewer test> && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/topic-version/[id].tsx" mobile/__tests__
git commit -m "feat(trust): owner can Revise a topic (guidance → new version) from the viewer"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] No backend touched (grep the diff: only the 3 mobile files + tests).
- [ ] **Web screenshot verify** (local recipe): open a per-topic draft as owner → a secondary "Revise"
  next to the primary "Approve"; Revise → guidance box → generating navigates to the new version.
  Reviewer sees no Revise.
- [ ] PR body: per-topic S1 — owner Revise (guidance) + hierarchy alignment; mobile-only → web
  redeploy, no backend. First of the per-topic full-parity arc (S2 provenance+history, S3 feedback
  next).

## Self-Review

- **Spec coverage:** guidance wiring (T1) · viewer Revise + hierarchy (T2). Provenance/history/feedback/
  edit correctly deferred.
- **Type consistency:** `generateTopic(topicId, opts?)` optional opts keeps the Drafts-list caller
  valid; `TopicVersionCreatedView.id` used for nav.
- **Constraints:** mobile-only; owner-only; Approve primary / Revise ghost; defensive; no color-literal
  asserts.
