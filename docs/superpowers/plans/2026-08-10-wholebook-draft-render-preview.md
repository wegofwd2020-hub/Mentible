# Whole-book draft render preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the whole-book trust draft's VIEW mode through the shared reader (so SVG/mermaid draw in-app like the per-topic viewer), via a new reader inline/auto-height mode that flows inside the viewer's page ScrollView; EDIT mode stays raw text.

**Architecture:** Add an opt-in `inline` mode to the web reader (auto-height, no self-scroll) + thread it through `TopicRenderer`; generalize `topicVersionToTopic` to also map a whole-book `VersionDetailView`; render a memoized `<TopicRenderer inline>` in the whole-book viewer's view mode (web), plain-text on native.

**Tech Stack:** React Native + Expo (RN-web); TypeScript; Jest/RNTL + jsdom.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-10-wholebook-draft-render-preview-design.md`.
- **Reuse the ONE reader** (`[[project_reader_one_renderer]]`) — no second renderer.
- **The preview topic MUST be memoized** — never build it inline in JSX (the #400 flicker lesson). The `ReaderBody` React.memo freeze (#403) must stay intact.
- The inline modifier is **additive** — the base `.mentible-reader` rule is unchanged; standalone readers keep own-scroll (`height:100%; overflow-y:auto`).
- Web is the target; **native** whole-book preview stays plain-text (no native WebView height work).
- `useThemedStyles`; NO color-literal test asserts. `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/reader/readerStyles.ts` — add `.mentible-reader.inline` modifier (T1)
- `mobile/src/reader/NativeTopicReader.web.tsx` — `inline` prop → class + non-flex container (T1)
- `mobile/src/components/LessonRenderer.tsx` — `TopicRenderer` threads `inline` (T1)
- `mobile/src/lib/topicVersionToTopic.ts` — extract core + add `versionToTopic` (T2)
- `mobile/app/trust/version/[versionId].tsx` — view-mode preview + aggregate source chips (T3)
- Tests under `mobile/__tests__/`

---

### Task 1: Reader inline / auto-height mode (web)

**Files:**
- Modify: `mobile/src/reader/readerStyles.ts`, `mobile/src/reader/NativeTopicReader.web.tsx`, `mobile/src/components/LessonRenderer.tsx`
- Test: `mobile/__tests__/reader/readerStyles.test.ts` (extend), `mobile/__tests__/reader/NativeTopicReader.test.tsx` (extend)

**Interfaces:**
- Produces: `readerCss(palette)` output now includes a `.mentible-reader.inline { height:auto; overflow:visible }` rule; `NativeTopicReader({ topic, figures, inline? })`; `TopicRenderer({ topic, figures, inline? })`.

- [ ] **Step 1: Write the failing tests.**
  - `readerStyles.test.ts`: `expect(readerCss(studioDarkColors)).toContain(".mentible-reader.inline")` and that the inline rule sets `height: auto` + `overflow: visible`.
  - `NativeTopicReader.test.tsx` (jsdom): render `<NativeTopicReader topic={t} inline />` → the content div's `className` includes `inline`; render without `inline` → it does not. (Mirror how the existing NativeTopicReader test inspects the rendered tree; assert on the `className` prop.)

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/reader/readerStyles.test.ts __tests__/reader/NativeTopicReader.test.tsx`.

- [ ] **Step 3: Implement.**
  - `readerStyles.ts`: in the string `readerCss` returns, after the base `.mentible-reader { … }` root rule, add:
    `.${READER_ROOT_CLASS}.inline { height: auto; overflow: visible; }`
    (additive; keeps max-width/centering from the base rule).
  - `NativeTopicReader.web.tsx`: add `inline?: boolean` to the component props AND to the `ReaderBody` React.memo props. Pass it into `ReaderBody`. In `ReaderBody`, set `className={inline ? \`${READER_ROOT_CLASS} inline\` : READER_ROOT_CLASS}`. In `NativeTopicReader`, the outer `View` style: when `inline`, drop `flex:1` (use a non-flex container so height is natural) — e.g. `style={[inline ? styles.inlineContainer : styles.container, { backgroundColor: theme.background }]}` with `inlineContainer: {}` (no flex). Keep the memo comparator default (add `inline` to the props object so a change re-renders correctly).
  - `LessonRenderer.tsx`: add `inline?: boolean` to `TopicRenderer`'s props and pass it to `<NativeTopicReader inline={inline} …>` (web branch). The native `WebViewTopicRenderer` accepts but ignores it (no signature break).

- [ ] **Step 4: Run tests + tsc** — `cd mobile && npx jest __tests__/reader && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/reader/readerStyles.ts mobile/src/reader/NativeTopicReader.web.tsx mobile/src/components/LessonRenderer.tsx mobile/__tests__/reader
git commit -m "feat(reader): opt-in inline/auto-height mode so the reader can flow inside a ScrollView"
```

---

### Task 2: `versionToTopic` (generalize the mapper)

**Files:**
- Modify: `mobile/src/lib/topicVersionToTopic.ts`
- Test: `mobile/__tests__/lib/topicVersionToTopic.test.ts` (extend) or a new `versionToTopic` test

**Interfaces:**
- Consumes: `VersionDetailView` (`{ id, content: { sections: DraftSection[] }, created_at }`) from `@/api/trustClient`.
- Produces: `versionToTopic(v: VersionDetailView): GeneratedTopic` (title `""`). `topicVersionToTopic` unchanged in output.

- [ ] **Step 1: Write the failing test** — `versionToTopic({ id:"v1", content:{ sections:[{heading:"H", body:"```mermaid\\nflowchart TD\\n A-->B\\n```", source_ids:[] }] }, created_at:"" })` returns a `GeneratedTopic` whose `lesson.sections[0].body_markdown` equals the section body verbatim (fence preserved) and `topicId === "v1"`. Also a guard test: `topicVersionToTopic` still returns its exact prior shape (heading/body_markdown mapping) after the refactor.

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/lib/topicVersionToTopic.test.ts`.

- [ ] **Step 3: Implement.** Extract a private core:
```ts
function sectionsToTopic(
  id: string,
  title: string,
  sections: { heading: string; body: string }[],
  createdAt: string,
): GeneratedTopic {
  const lessonSections: LessonSection[] = sections.map((s) => ({ heading: s.heading, body_markdown: s.body }));
  const lesson: LessonOutput = {
    topic: title, level: "", language: "en", synopsis: "",
    learning_objectives: [], sections: lessonSections, key_takeaways: [], further_reading: [],
  };
  return { topicId: id, title, lesson, generatedAt: createdAt };
}
```
Rewrite `topicVersionToTopic(tv)` to `return sectionsToTopic(tv.id, tv.title, tv.content.sections, tv.created_at ?? "");` and add:
```ts
import type { VersionDetailView } from "@/api/trustClient";
export function versionToTopic(v: VersionDetailView): GeneratedTopic {
  return sectionsToTopic(v.id, "", v.content.sections, v.created_at ?? "");
}
```

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__/lib/topicVersionToTopic.test.ts && npx tsc --noEmit`.

- [ ] **Step 5: Commit.**
```bash
git add mobile/src/lib/topicVersionToTopic.ts mobile/__tests__/lib/topicVersionToTopic.test.ts
git commit -m "feat(trust): versionToTopic maps a whole-book draft version to the reader topic shape"
```

---

### Task 3: Whole-book viewer view-mode render preview

**Files:**
- Modify: `mobile/app/trust/version/[versionId].tsx`
- Test: its existing test under `mobile/__tests__/` (update)

**Interfaces:**
- Consumes: `versionToTopic` (T2), `TopicRenderer` with `inline` (T1).

- [ ] **Step 1: READ `trust/version/[versionId].tsx` fully.** Note: it wraps content in a `<ScrollView>`; `editing` toggles view vs edit; view mode currently maps `version.content.sections` → `<Text heading>` + `<Text bodyText>{s.body}</Text>` + per-section `citeRow` source chips (~lines 351-365); `labelFor` maps a source id → label.

- [ ] **Step 2: Update/write the test.** In the whole-book viewer test: on web, a version whose section body contains a ```svg (and a ```mermaid) fence renders through the reader — assert the raw fence text is NOT shown verbatim and the reader render is present (mirror `TopicVersionViewer.visuals.test.tsx`'s assertion style: `embeddedHtml(doc)` contains `class="mermaid"` / the sanitized `anim-svg` figure). Assert edit mode still shows `TextInput`s. Assert an aggregate source-chip row renders (a label from `labelFor`). Keep approve/withdraw/notes/feedback assertions unchanged. (Gate the DOM/web assertion to the web variant like the reader's own tests do.)

- [ ] **Step 3: Implement.**
  - `import { Platform } from "react-native";` (if not present), `import { versionToTopic } from "@/lib/topicVersionToTopic";`, `import { TopicRenderer } from "@/components/LessonRenderer";`.
  - Add a memoized preview topic near the other derived values: `const previewTopic = useMemo(() => (version ? versionToTopic(version) : null), [version]);`
  - In VIEW mode (the `: (` branch at ~line 351), replace the `sections.map(<Text>…)` with:
    - web: `{previewTopic ? <TopicRenderer topic={previewTopic} inline /> : null}` followed by an **aggregate source-chip row** — compute `const previewSources = useMemo(() => Array.from(new Set((version?.content?.sections ?? []).flatMap((s) => s.source_ids ?? []))), [version]);` and render a `citeRow` of `previewSources.map((id) => <Text style={styles.cite}>{labelFor.get(id) ?? "cited"}</Text>)`.
    - native (`Platform.OS !== "web"`): keep the existing plain-text `sections.map` (unchanged).
    Structure it as `Platform.OS === "web" ? (<>reader + aggregate chips</>) : (<>existing plain-text map</>)`.
  - EDIT mode is unchanged. Do NOT change Copy/Regenerate/approve/withdraw/notes.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Vv]ersion" && npx tsc --noEmit`. Also run the whole-book viewer's own test file by path if the `-t` name doesn't match.

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/version/[versionId].tsx" mobile/__tests__
git commit -m "feat(trust): whole-book draft view mode renders diagrams via the inline reader"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] Grep the whole-book viewer: the preview topic is memoized (no inline `versionToTopic(...)` in JSX); `TopicRenderer` gets `inline`; native path still plain-text.
- [ ] **Web screenshot verify** (jsdom can't render real SVG/mermaid): open a generated whole-book draft → view mode shows rendered diagrams; scrolling the page scrolls the whole view (the reader flows inline, doesn't self-scroll or collapse); edit mode still shows editable text.
- [ ] PR body: reader inline mode + whole-book view-mode preview; web-only render (native stays plain text); mobile-only → web redeploy, no backend.

## Self-Review

- **Spec coverage:** reader inline mode (T1) · versionToTopic (T2) · view-mode preview + aggregate chips (T3). Native inline + book/shared fix correctly out of scope.
- **Type consistency:** `inline?: boolean` added consistently to `NativeTopicReader`/`ReaderBody`/`TopicRenderer`; `versionToTopic` returns the same `GeneratedTopic` the reader consumes; `sectionsToTopic` core shared by both mappers.
- **Constraints:** memoized preview topic (#400); ReaderBody freeze intact (#403); additive inline rule (standalone readers unaffected); one renderer; web-scoped.
