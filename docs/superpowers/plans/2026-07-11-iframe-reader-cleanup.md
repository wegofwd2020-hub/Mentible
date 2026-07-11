# Remove the Dead Web Iframe Reader Path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the now-dead web `<iframe>` reader, the `EXPO_PUBLIC_NATIVE_READER` flag, and the unused single-lesson renderer — leaving web with one reader (native) and Android's WebView reader untouched.

**Architecture:** After the D1 flip, web always renders `NativeTopicReader`. Switch `TopicRenderer` from the flag to `Platform.OS === "web"`, delete the flag, then remove the web iframe host (`HtmlViewWeb`) and the unused `LessonRenderer`/`buildHtml`. The native branch (`TopicRenderer` → WebView renderer → `buildTopicHtml` → `react-native-webview`) is unchanged.

**Tech Stack:** TypeScript, React Native / react-native-web, jest + jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-11-iframe-reader-cleanup-design.md`

## Global Constraints

- **Do not touch the Android path:** the native branch of `TopicRenderer`, the WebView host, `buildTopicHtml`, and the `Platform.OS !== "web"` lazy `require("react-native-webview")` all stay. No change to `react-native-webview` usage.
- **Preserve D3 bundle protection:** `NativeTopicReader` stays a `.web` module with a throwing native stub; the web branch is guarded by `Platform.OS === "web"` so the native bundle never imports DOMPurify/marked/mermaid.
- **No `<iframe>` may remain** in `mobile/src/components/` after Task 2.
- **Keep the filename** `mobile/src/components/LessonRenderer.tsx` (its two app import sites reference `TopicRenderer` from it). Rename only the internal component `IframeTopicRenderer` → `WebViewTopicRenderer`.
- Run tests from `mobile/`: `cd mobile && npx jest <path>`.
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Switch TopicRenderer to Platform.OS and delete the flag

**Files:**
- Modify: `mobile/src/components/LessonRenderer.tsx` (TopicRenderer + its comment + the readerFlag import)
- Delete: `mobile/src/constants/readerFlag.ts`
- Delete: `mobile/__tests__/reader/readerFlag.test.ts`
- Rewrite: `mobile/__tests__/components/TopicRenderer.switch.test.tsx`
- Modify: `scripts/deploy/web-deploy.sh` (remove the flag export from both arms)

**Interfaces:**
- Produces: on web, `TopicRenderer` renders `NativeTopicReader`; on native it renders the WebView path. No `USE_NATIVE_WEB_READER` symbol remains.

- [ ] **Step 1: Rewrite the switch test to the new contract.** Replace the ENTIRE contents of `mobile/__tests__/components/TopicRenderer.switch.test.tsx` with:

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { Platform } from "react-native";
import { render } from "@testing-library/react-native";
import type { GeneratedTopic } from "@/types/book";

jest.mock("react-native-webview", () => ({ default: () => null }));

// NativeTopicReader is web-only; stand it in with a marker so we can assert the
// web branch of TopicRenderer resolves to it (and never to an iframe).
jest.mock("@/reader/NativeTopicReader", () => ({
   
  NativeTopicReader: () =>
    require("react").createElement("div", { className: "native-reader-stand-in" }),
}));

beforeAll(() => {
  Platform.OS = "web";
});
afterAll(() => {
  Platform.OS = "ios";
});

 
import { TopicRenderer } from "@/components/LessonRenderer";

const topic: GeneratedTopic = {
  topicId: "t1", title: "T", generatedAt: "2026-07-11T00:00:00Z",
  lesson: {
    topic: "T", level: "adult", language: "en", synopsis: "S",
    learning_objectives: [], sections: [], key_takeaways: [], further_reading: [],
  },
};

 
type TestNode = { type: unknown; props: any };

it("on web, TopicRenderer renders the native reader and no iframe", () => {
  const { UNSAFE_root } = render(<TopicRenderer topic={topic} />);
  const natives = UNSAFE_root.findAll(
    (n: TestNode) => n.type === ("div" as never) && n.props.className === "native-reader-stand-in",
  );
  const iframes = UNSAFE_root.findAll((n: TestNode) => n.type === ("iframe" as never));
  expect(natives).toHaveLength(1);
  expect(iframes).toHaveLength(0);
});
```

- [ ] **Step 2: Run the switch test — verify it FAILS**

Run: `cd mobile && npx jest __tests__/components/TopicRenderer.switch.test.tsx`
Expected: FAIL — the current `TopicRenderer` still keys off the (now-mocked-away) `readerFlag`, so with no flag mock it renders the iframe path, not the native stand-in.

- [ ] **Step 3: Switch TopicRenderer to Platform.OS.** In `mobile/src/components/LessonRenderer.tsx`:

(a) Delete the readerFlag import (line 7):
```tsx
import { USE_NATIVE_WEB_READER } from "@/constants/readerFlag";
```

(b) Replace the `TopicRenderer` doc comment + body (the block from `/**` above `export function TopicRenderer` through the end of that function) with:

```tsx
/**
 * Renders a full book topic — lesson plus any tutorial / quiz sets / experiment.
 *
 * Web renders the native reader (real DOM: selection, find-in-page, semantic
 * headings, bundled fonts). Native renders the same content through a WebView.
 * The switch lives here (not at the two call sites) so the Studio topic screen and
 * the shared-draft reader can never drift apart.
 *
 * `NativeTopicReader` resolves to a throwing stub off-web, so the `Platform.OS`
 * guard is what keeps DOMPurify/marked/mermaid out of the native bundle (D3).
 */
export function TopicRenderer({ topic }: { topic: GeneratedTopic }) {
  if (Platform.OS === "web") return <NativeTopicReader topic={topic} />;
  return <IframeTopicRenderer topic={topic} />;
}
```

- [ ] **Step 4: Delete the flag module and its test**

Run:
```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git rm mobile/src/constants/readerFlag.ts mobile/__tests__/reader/readerFlag.test.ts
```

- [ ] **Step 5: Remove the flag export from the deploy script.** In `scripts/deploy/web-deploy.sh`, delete the demo-arm block:

```sh
    # D1 flip (demo first, 2026-07-11): enable the native web reader on the demo
    # surface only. The full app keeps the iframe until its own follow-up PR. Web-only
    # by construction — readerFlag.ts also gates on Platform.OS === "web".
    export EXPO_PUBLIC_NATIVE_READER=1
```

and the app-arm block:

```sh
    # D1 flip (full app, follow-up to the demo-first flip): enable the native web
    # reader on /app/mentible now that it has soaked on the demo. Web-only —
    # readerFlag.ts also gates on Platform.OS === "web".
    export EXPO_PUBLIC_NATIVE_READER=1
```

- [ ] **Step 6: Run the switch test + typecheck — verify GREEN**

Run: `cd mobile && npx jest __tests__/components/TopicRenderer.switch.test.tsx && npm run typecheck`
Expected: PASS; `tsc` 0 errors (no dangling `readerFlag`/`USE_NATIVE_WEB_READER` reference).

- [ ] **Step 7: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/components/LessonRenderer.tsx mobile/__tests__/components/TopicRenderer.switch.test.tsx scripts/deploy/web-deploy.sh
git commit -m "$(printf 'refactor(reader): switch TopicRenderer to Platform.OS, drop the flag\n\nWeb always uses the native reader post-D1-flip. Replaces USE_NATIVE_WEB_READER\nwith Platform.OS===web and removes readerFlag.ts + its test + the deploy-script\nexports. HtmlViewWeb / LessonRenderer removed in the next task.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Remove the web iframe host and the dead single-lesson renderer

**Files:**
- Modify: `mobile/src/components/LessonRenderer.tsx` (remove `HtmlViewWeb`, collapse `HtmlView`, remove `LessonRenderer` + `buildHtml` re-export + `LessonOutput` import; rename `IframeTopicRenderer` → `WebViewTopicRenderer`)
- Modify: `mobile/src/components/contentHtml.ts` (remove `buildHtml` + the `LessonOutput` import)
- Delete: `mobile/__tests__/components/LessonRenderer.test.tsx`
- Modify: `mobile/__tests__/components/contentHtml.test.ts` (drop the `buildHtml` cases + imports)

**Interfaces:**
- Consumes (from Task 1): `TopicRenderer` renders `IframeTopicRenderer` on native.
- Produces: the native fallback component is `WebViewTopicRenderer`; there is no `HtmlViewWeb`, `LessonRenderer`, or `buildHtml`.

- [ ] **Step 1: Delete the obsolete iframe-sandbox test**

Run:
```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git rm mobile/__tests__/components/LessonRenderer.test.tsx
```
(That test rendered `LessonRenderer` solely to assert the web iframe's `sandbox`; both are being removed.)

- [ ] **Step 2: Remove `buildHtml` from the content builder.** In `mobile/src/components/contentHtml.ts`:

(a) delete the `buildHtml` function (the `/** Single lesson … */` comment + the function):
```ts
/** Single lesson — the original single-lesson reader path. */
export function buildHtml(lesson: LessonOutput): string {
  return htmlDocument(JSON.stringify(lesson), "html += renderLesson(DATA);");
}
```

(b) delete the now-unused type import near the top (line ~12):
```ts
import type { LessonOutput } from "@/types/lesson";
```

- [ ] **Step 3: Rewrite `LessonRenderer.tsx`'s renderer section.** Apply these edits:

(a) Remove the `LessonOutput` import (line 4):
```tsx
import type { LessonOutput } from "@/types/lesson";
```

(b) Change the builder import + re-export (lines 5 and 12) to drop `buildHtml`:
```tsx
import { buildHtml, buildTopicHtml } from "@/components/contentHtml";
```
→
```tsx
import { buildTopicHtml } from "@/components/contentHtml";
```
and
```tsx
export { buildHtml, buildTopicHtml };
```
→
```tsx
export { buildTopicHtml };
```

(c) Remove the `HtmlViewWeb` function entirely (the `function HtmlViewWeb(...) { … }` block, including its comment) and collapse the `HtmlView` dispatcher into the native host — replace both `HtmlViewWeb`, `HtmlViewNative`, and `HtmlView` with a single:

```tsx
function HtmlView({ html, label }: HtmlViewProps) {
  return (
    <View style={styles.container}>
      <WebView
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        originWhitelist={["*"]}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        allowsInlineMediaPlayback={false}
        mixedContentMode="always"
        accessibilityLabel={label}
      />
    </View>
  );
}
```

(d) Remove the dead `LessonRenderer` function:
```tsx
/** Renders a single lesson (single-lesson generate path). */
export function LessonRenderer({ lesson }: { lesson: LessonOutput }) {
  const html = useMemo(() => buildHtml(lesson), [lesson]);
  return <HtmlView html={html} label="Lesson content" />;
}
```

(e) Rename `IframeTopicRenderer` → `WebViewTopicRenderer` (its definition and the reference inside `TopicRenderer`):
```tsx
export function TopicRenderer({ topic }: { topic: GeneratedTopic }) {
  if (Platform.OS === "web") return <NativeTopicReader topic={topic} />;
  return <WebViewTopicRenderer topic={topic} />;
}

function WebViewTopicRenderer({ topic }: { topic: GeneratedTopic }) {
  const html = useMemo(() => buildTopicHtml(topic), [topic]);
  return <HtmlView html={html} label="Topic content" />;
}
```

(Note: `useMemo` is still used by `WebViewTopicRenderer`, so keep the `React, { useMemo }` import. `HtmlViewProps` stays.)

- [ ] **Step 4: Drop the `buildHtml` cases from the content test.** In `mobile/__tests__/components/contentHtml.test.ts`:

(a) change the import (line 1) to drop `buildHtml`:
```ts
import { buildHtml, buildTopicHtml } from "@/components/contentHtml";
```
→
```ts
import { buildTopicHtml } from "@/components/contentHtml";
```

(b) delete the unused `LessonOutput` type import (line 3):
```ts
import type { LessonOutput } from "@/types/lesson";
```

(c) delete the entire `describe("buildHtml (single lesson)", () => { … })` block.

If removing the `LessonOutput` import leaves a `lesson` fixture unused, delete that fixture too; run the test and let the failure name any straggler.

- [ ] **Step 5: Run the affected tests + typecheck — verify GREEN**

Run: `cd mobile && npx jest __tests__/components/contentHtml.test.ts __tests__/components/TopicRenderer.switch.test.tsx __tests__/app/book-shared.test.tsx && npm run typecheck`
Expected: PASS; `tsc` 0 errors (no dangling `buildHtml`/`LessonRenderer`/`HtmlViewWeb`/`LessonOutput`).

- [ ] **Step 6: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/components/LessonRenderer.tsx mobile/src/components/contentHtml.ts mobile/__tests__/components/contentHtml.test.ts
git commit -m "$(printf 'refactor(reader): remove the web iframe host + dead single-lesson renderer\n\nDeletes HtmlViewWeb (web <iframe>), the unused LessonRenderer + buildHtml, and\nrenames IframeTopicRenderer -> WebViewTopicRenderer. No <iframe> remains; the\nAndroid WebView path (buildTopicHtml) is unchanged.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Full-suite gate + dead-symbol grep

**Files:** none (verification only).

- [ ] **Step 1: Typecheck, lint, full jest**

Run:
```bash
cd mobile && npm run typecheck && npm run lint && npm test
```
Expected: `tsc` 0 errors; lint 0 errors; jest all suites pass (two suites removed: `readerFlag`, `LessonRenderer`).

- [ ] **Step 2: Grep gate — confirm nothing dead remains**

Run (from repo root):
```bash
git grep -n "USE_NATIVE_WEB_READER\|HtmlViewWeb\|readerFlag\|EXPO_PUBLIC_NATIVE_READER" -- mobile/ scripts/ || echo "clean: no dead flag/iframe symbols"
git grep -n "<iframe" -- mobile/src/components/ || echo "clean: no <iframe> in components"
git grep -n "\bbuildHtml\b\|\bLessonRenderer\b" -- mobile/src mobile/__tests__ || echo "clean: no buildHtml/LessonRenderer"
```
Expected: each prints its `clean:` line (the `LessonRenderer.tsx` *filename* is fine — the grep is for the `LessonRenderer` symbol/`buildHtml`, which should be gone; a match on the filename in an import path of `TopicRenderer` is acceptable, but there should be no `LessonRenderer(` component or `buildHtml` reference).

- [ ] **Step 3: (optional) confirm the Android path still builds its HTML**

The native renderer is exercised by `__tests__/app/book-shared.test.tsx` (already run in Step 1). No extra action.

---

## Notes for the implementer

- **Never touch** `buildTopicHtml`, the WebView props, or the `Platform.OS !== "web"` lazy require — Android depends on all of them.
- After Task 2, `LessonRenderer.tsx` no longer exports a `LessonRenderer` component (only `TopicRenderer` + `buildTopicHtml` re-export). The filename is kept deliberately (its importers reference `TopicRenderer`); do not rename the file.
- If `npm run typecheck` flags an unused import after a deletion, remove that import — do not add an eslint-disable.
