# Trust Input — per-kind source fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the trust Input (Capture) phase, make the source-kind picker meaningful: a **Link**
captures a URL (→ `source_ref`); **Transcript / Note** keep the paste box. The "Add source" button
enables on the chosen kind's real field, fixing the "all three the same" complaint and the
greyed-button trap.

**Architecture:** Single-file change to `SourcesPanel` in `mobile/app/trust/[projectId].tsx` +
parent screen state. A new `sourceUrl` state threaded as a prop (mirroring `sourceContent`);
conditional URL-vs-paste rendering; `canAdd` gating; `onAddSource` link branch. No backend change.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-11-trust-input-per-kind-fields-design.md`.
- **Mobile-only. NO backend/schema/migration change** — `ProjectInputIn` already accepts
  `source_ref`; `addInput`/`addProjectInput` already forward it.
- No generation-behavior change. Touch only the ADD form + its state; do NOT change edit mode,
  per-topic, or generation.
- **Link mapping:** `{ kind:"link", title: sourceTitle.trim()||undefined, content: url,
  source_ref: url }` where `url = sourceUrl.trim()`. `content = url` (backend `content` is
  `min_length=1`).
- `canAdd = sourceKind === "link" ? sourceUrl.trim().length > 0 : sourceContent.trim().length > 0`.
- Reuse existing input styles (`inviteInput` for single-line, `sourceContentInput` for the paste
  box); `useThemedStyles` pattern already in file. **NO color-literal test asserts.**
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/app/trust/[projectId].tsx` — `SourcesPanel` (render + props) and the parent screen
  (`sourceUrl` state + call site + `onAddSource` branch).
- Test: extend the existing test that covers `SourcesPanel` / the Input add flow (search
  `__tests__` for `Add source` / `SourcesPanel` / `sourceKind`; if none isolates the panel, add a
  focused RNTL test rendering the Capture phase).

---

### Task 1: Per-kind Input fields + gating

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: existing `[projectId]` / Input test (extend) or a new focused test under `mobile/__tests__/`

**Interfaces:**
- `SourcesPanel` props gain: `sourceUrl: string; setSourceUrl: (v: string) => void;` (placed next to
  `sourceContent` / `setSourceContent` in both the destructure and the type literal, lines ~139–155).
- Parent screen (`ProjectDetailScreen`, the component holding `const [sourceContent, setSourceContent]
  = useState("")` at ~line 1122) gains `const [sourceUrl, setSourceUrl] = useState("")`.

- [ ] **Step 1: Write the failing test.** In the Input/SourcesPanel test, render the Capture phase
  as owner and assert:
  - Selecting the **Link** kind shows a URL field (query by placeholder `https://…` or
    `accessibilityLabel="Source URL"`) and does NOT show the multiline paste box (placeholder
    `Paste a transcript, note, or link…`).
  - With kind=Link and the URL field filled, the **Add source** button is enabled; empty URL →
    disabled. (Assert via the button's `accessibilityState.disabled` or that pressing it while empty
    does not call the add handler.)
  - Adding a link calls the add path with `source_ref` = the URL and `content` = the URL, `kind` =
    `"link"`. (Mock `addInput`/`addProjectInput` or the hook per the existing test's seam; assert the
    body.)
  - kind=Note with the paste box filled still sends `{ kind:"note", content }` and NO `source_ref`.
  Use the file's existing render/seam helpers; no color-literal asserts.

- [ ] **Step 2: Run — verify fail.** `cd mobile && npx jest <the test file/name>`.

- [ ] **Step 3: Add `sourceUrl` state + thread the prop.**
  - In the parent screen add `const [sourceUrl, setSourceUrl] = useState("");` next to
    `sourceContent`.
  - Pass `sourceUrl={sourceUrl}` and `setSourceUrl={setSourceUrl}` at the `SourcesPanel` call site
    (~line 1442, next to `sourceContent`/`setSourceContent`).
  - Add `sourceUrl` / `setSourceUrl` to `SourcesPanel`'s destructured params and its prop type
    literal (~lines 139–155).

- [ ] **Step 4: Conditional render in `SourcesPanel`.** In the owner add form (~lines 250–264),
  replace the single content `TextInput` block with a kind branch:
  - Keep the Title input for all kinds, but set its placeholder to `Label (optional)` when
    `sourceKind === "link"`, else `Title (optional)`.
  - When `sourceKind === "link"`: render a single-line URL `TextInput` (`style={styles.inviteInput}`,
    `accessibilityLabel="Source URL"`, `placeholder="https://…"`,
    `placeholderTextColor={theme.textMuted}`, `value={sourceUrl}`, `onChangeText={setSourceUrl}`,
    `autoCapitalize="none"`, `keyboardType="url"`, `autoCorrect={false}`) — no paste box.
  - Else: the existing multiline `sourceContentInput` paste box (unchanged).

- [ ] **Step 5: Gate the button.** Compute
  `const canAdd = sourceKind === "link" ? sourceUrl.trim().length > 0 : sourceContent.trim().length > 0;`
  and set the Add button `disabled={!canAdd}` (replacing `disabled={!sourceContent.trim()}`).

- [ ] **Step 6: Branch `onAddSource`** (parent screen, ~line 1355). For `sourceKind === "link"`:
  ```ts
  const url = sourceUrl.trim();
  if (!url) return;
  setAddSourceBusy(true);
  try {
    await addInput({ kind: "link", title: sourceTitle.trim() || undefined, content: url, source_ref: url });
    setSourceTitle(""); setSourceContent(""); setSourceUrl(""); setSourceKind("note");
  } catch (e) {
    Alert.alert("Couldn't add source", e instanceof ApiError ? e.userMessage() : "Please try again.");
  } finally {
    setAddSourceBusy(false);
  }
  ```
  For the non-link kinds keep the existing body, but also `setSourceUrl("")` on success so switching
  kinds later starts clean. (Factor the shared busy/try/catch however reads cleanly; behavior above is
  the contract.)

- [ ] **Step 7: Run** — `cd mobile && npx jest <the test> && npx tsc --noEmit`.

- [ ] **Step 8: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__
git commit -m "feat(trust): capture a Link source's URL — per-kind Input fields + button gating"
```

---

## Final verification (after the task)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] No backend/schema/migration touched (grep the diff: only `[projectId].tsx` + tests).
- [ ] **Web screenshot verify:** Input phase → pick Link → URL field appears, Add enables on URL,
  the new source row shows and (expanded) shows the URL in `source_ref`; pick Note → paste box, Add
  enables on the box. Button never stuck greyed when the visible field is filled.
- [ ] PR body: per-kind Input fields (Link → URL/source_ref); fixes Sridhar's "all three same" +
  greyed-button report; mobile-only → web redeploy, no backend.

## Self-Review

- **Spec coverage:** per-kind render (Link URL vs paste box) + link mapping + `canAdd` gating +
  clear-on-success — all in T1. Edit mode, backend, URL validation correctly out of scope.
- **Type consistency:** `sourceUrl: string` / `setSourceUrl: (v: string) => void` added to both the
  parent state and `SourcesPanel` props; `addInput` body matches the hook's existing
  `{ kind; title?; content; source_ref? }` signature.
- **Constraints:** mobile-only; no generation change; reuse `inviteInput`/`sourceContentInput`
  styles; no color-literal asserts.
