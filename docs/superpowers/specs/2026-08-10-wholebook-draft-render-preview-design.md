# Whole-book draft render preview — Design

**Status:** Approved (brainstorming, 2026-08-10). Follows the mermaid saga + #405 (whole-book drafts
now contain diagrams). Related: [[project_mermaid_render_robustness]], [[project_reader_one_renderer]],
[[reference_rnw_scrollview_needs_flex]].

## Problem

#405 gave whole-book (`book`/`essay`) trust drafts grounded mermaid/svg diagrams. But the whole-book
draft viewer (`mobile/app/trust/version/[versionId].tsx`) renders section bodies as **plain text**
(`<Text>{s.body}</Text>`) in both view and edit modes — it has no reader path (it predates the
per-topic visuals work). So authors see raw ```svg / ```mermaid fence source in-app; diagrams only
render on Publish (the compiler draws them in the EPUB/PDF). The user reported "SVG images not
rendering" here.

The per-topic draft viewer already renders diagrams in-app via `TopicRenderer` (#395). The whole-book
viewer should have the same in-app rendered preview — but it can't just drop the reader in: the
whole-book viewer wraps its content in a page **`ScrollView`**, and the reader **scrolls its own
content** (`.mentible-reader { height:100%; overflow-y:auto }`). A self-scrolling element inside a
ScrollView has no definite height and collapses to zero (the known RN-web trap the per-topic viewer
avoided by NOT using a page ScrollView; `book/shared/[id].tsx` still hits it).

## Goal

The whole-book draft viewer's **view mode** renders section bodies through the shared reader (so SVG +
mermaid draw in-app, matching per-topic); **edit mode** stays raw-text `TextInput`s. Achieved by
giving the shared reader an opt-in **inline / auto-height mode** that flows inside a parent scroll
container instead of scrolling itself.

## Locked decisions (brainstorming 2026-08-10)

1. **Add a reader inline/auto-height mode** (not restructure the viewer, not a fixed-height box).
2. **Web first.** The inline mode targets the WEB reader (a real DOM div — auto-height is trivial).
   The **native** WebView reader auto-sizing to content inside a ScrollView is a separate hard
   problem (WebView needs an explicit height); on native the whole-book preview keeps the current
   plain-text render for now (documented follow-up). The active test surface + APK is web.
3. Reuse the ONE reader ([[project_reader_one_renderer]]) — no second renderer. The topic passed to
   the reader is **memoized** (the #400 flicker lesson: never build it inline in JSX).

## Architecture

### 1. Reader inline mode — web (`readerStyles.ts` + `NativeTopicReader.web.tsx`)

- `readerStyles.ts`: add a static modifier rule (always present in the stylesheet) —
  `.mentible-reader.inline { height: auto; overflow: visible; }` (keep `max-width` + centering; only
  the self-scroll + full height are dropped). This is additive — the base `.mentible-reader` rule is
  unchanged, so standalone readers are unaffected.
- `NativeTopicReader.web.tsx`: accept an `inline?: boolean` prop. When `inline`, add the `inline`
  class to the content div (`className={inline ? \`${READER_ROOT_CLASS} inline\` : READER_ROOT_CLASS}`)
  and do NOT apply `flex:1` to the outer `View` (inline needs natural height, not a flex fill). The
  `ReaderBody` React.memo (from #403) keeps a stable prop set (add `inline` to it) so the diagram-
  freeze guarantee holds.
- `TopicRenderer` (`LessonRenderer.tsx`): thread `inline` through to `NativeTopicReader`. On native
  (`WebViewTopicRenderer`), `inline` is accepted but has no effect (the caller uses the plain-text
  fallback on native — see §3), so no native WebView-height work here.

### 2. `versionToTopic` (generalize `topicVersionToTopic.ts`)

Extract the shared core from `topicVersionToTopic` — `sectionsToTopic(id, title, sections, createdAt)`
building the `GeneratedTopic` lesson shape — and add `versionToTopic(v: VersionDetailView):
GeneratedTopic` (title `""`; `v.content.sections` → lesson sections; `v.id`; `v.created_at`).
`topicVersionToTopic` delegates to the same core (behavior unchanged — its tests still pass).

### 3. Whole-book viewer view mode (`trust/version/[versionId].tsx`)

- Memoize the preview topic: `const previewTopic = useMemo(() => version ? versionToTopic(version) :
  null, [version])` (stable identity — the #400 lesson).
- **View mode** (`!editing`): replace the `sections.map(<Text>{s.body})` block with, on web,
  `<TopicRenderer topic={previewTopic} inline />`; on native, keep the current plain-text section map.
  (Branch on `Platform.OS === "web"`.)
- The per-section source-id chips currently shown inline in view mode are dropped from the rendered
  preview (the reader renders one doc — same as the per-topic viewer, which shows no per-section
  chips). Preserve attribution with an **aggregate source-chip row** below the preview: the unique
  `source_ids` across all sections, mapped via the existing `labelFor`. Edit mode (per-section) is
  unchanged, and the underlying data keeps every section's `source_ids`.
- Everything else (Copy/Edit/Regenerate, approve/withdraw, revision notes/feedback) is unchanged.

## Testing

- **`readerStyles`:** the stylesheet contains the `.mentible-reader.inline` height/overflow override.
- **`NativeTopicReader.web` (jsdom):** with `inline`, the content div carries the `inline` class; the
  `ReaderBody` still renders the `dangerouslySetInnerHTML` content (freeze intact). Without `inline`,
  no `inline` class (default self-scroll).
- **`versionToTopic`:** maps `content.sections` (body→body_markdown) to the `GeneratedTopic` shape;
  `topicVersionToTopic` still produces its exact prior output (delegation didn't change it).
- **Whole-book viewer:** in view mode on web, the reader renders (a ```svg/```mermaid section body
  becomes the reader doc, not raw fence text — mirror the per-topic `.visuals` test); edit mode still
  shows `TextInput`s; the aggregate source chips render; approve/withdraw/notes assertions unchanged.
- **Manual/device:** jsdom can't render real SVG/mermaid → a web screenshot pass: open a generated
  whole-book draft → view mode shows rendered diagrams that survive scroll (the page ScrollView
  scrolls the whole thing; the reader flows inline).

## Files

- Modify: `mobile/src/reader/readerStyles.ts` (inline modifier rule)
- Modify: `mobile/src/reader/NativeTopicReader.web.tsx` (`inline` prop → class + non-flex container)
- Modify: `mobile/src/components/LessonRenderer.tsx` (`TopicRenderer` threads `inline`)
- Modify: `mobile/src/lib/topicVersionToTopic.ts` (extract core + `versionToTopic`)
- Modify: `mobile/app/trust/version/[versionId].tsx` (memoized preview via `TopicRenderer inline` on web; aggregate source chips)
- Tests under `mobile/__tests__/`

## Decomposition (SDD)

- **T1 — reader inline mode:** `readerStyles.ts` modifier + `NativeTopicReader.web.tsx` `inline` prop
  (+ `ReaderBody` memo) + `TopicRenderer` threading. Tests.
- **T2 — `versionToTopic`:** generalize `topicVersionToTopic.ts`. Tests.
- **T3 — whole-book viewer view mode:** memoized `TopicRenderer inline` (web) + plain-text native
  fallback + aggregate source chips. Tests + noted web screenshot verify.

## Rollout

Mobile-only → **web redeploy**, no backend. Native whole-book preview stays plain-text (follow-up:
native WebView content-height for inline embeds).

## Out of scope

- Native inline/auto-height WebView rendering (the whole-book preview is plain-text on native for now).
- `book/shared/[id].tsx`'s existing collapse (the inline mode could later fix it — separate).
- Changing the compiler / publish path (diagrams already render in EPUB/PDF).

## Global constraints

Reuse the ONE reader (no second renderer). The preview topic MUST be memoized (never built inline in
JSX — the #400 flicker lesson); the `ReaderBody` React.memo freeze (#403) stays intact. The inline
modifier is additive — standalone readers keep own-scroll. `useThemedStyles`; no color-literal test
asserts. `npx tsc --noEmit` clean + full `npx jest` green.
