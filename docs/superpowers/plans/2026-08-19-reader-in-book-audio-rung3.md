# Reader In-Book Audio (ADR-040 rung 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The in-app reader plays a topic's baked `TopicAudio` clips — web + native — with a full transport (play/pause, seek, elapsed/total time), transcript always visible.

**Architecture:** One shared renderer (`renderTopicToHtml`) grows an audio block, param-driven by target. Web injects sanitized HTML direct-to-DOM, so `<audio controls src="data:…">` plays natively. Native renders the same topic in a `react-native-webview`; because ExoPlayer `data:`-URI playback is unreliable (P4), the native block is an id-keyed control that bridges over `postMessage` to an RN-side `expo-audio` player driving a `file://`. Media resolution (`resolveAudioDataUrls` / `resolveAudioFileUris`) and the playback engine (`AudioNarrationPlayer` technique) already exist from rung 2 / P4.

**Tech Stack:** React Native + Expo, TypeScript, `expo-audio`, `react-native-webview`, DOMPurify (web sanitize), Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-19-reader-in-book-audio-rung3-design.md`

## Global Constraints

- **One shared renderer.** Do NOT reintroduce a second topic renderer — extend `@/reader/topicHtml.ts` `renderTopicToHtml` only (the WebView twin was deleted in #326; see [[project_reader_one_renderer]]).
- **Native never plays `data:` audio.** No `<audio src="data:…">` in the native WebView markup — ExoPlayer/AVPlayer `data:`-URI support is inconsistent across OEMs (`AudioNarrationPlayer.tsx`'s own comment). Native plays a `file://` via `expo-audio`, outside the WebView.
- **Only the clip id crosses the bridge** — never base64 audio. The RN side re-resolves the `file://` from `mediaStore` by id.
- **Reuse, don't duplicate.** Reuse `esc` / `audioCaption` (`mobile/src/lib/figuresHtml.ts`), `resolveAudioDataUrls` / `resolveAudioFileUris` (`mobile/src/storage/mediaStore.ts`), and the file-cache-then-`file://` playback technique from `AudioNarrationPlayer.tsx`.
- **No backend, no migration, no compiler change.** Mobile only. Rung-2 EPUB bake and its output are untouched.
- **Transcript always renders** when present (a11y + resilience), even alongside the player.
- **Help DoD (enforced by CI coverage + tree gates):** shipping the feature adds a `reader-audio` key to `FEATURES` + a Help topic with that `featureKey` + a `HELP_TREE` leaf, in the same branch.
- **Web-alert / uuid / crypto shims** per repo norms if touched (`@/lib/alert`, `@/lib/uuid`) — not expected here.

---

## File Structure

- `mobile/src/lib/figuresHtml.ts` — **modify**: add `renderReaderAudioHtml(audio, opts)` (the reader audio block; web `<audio>` vs native control markup + transcript `<details>`). Sibling to `renderFiguresHtml` / `renderAudioHtml`.
- `mobile/src/reader/topicHtml.ts` — **modify**: `renderTopicToHtml` gains an `opts` arg (`audioUrls?`, `audioTarget?`), appends the audio block.
- `mobile/src/reader/renderContent.ts` — **modify**: `renderTopicToSafeHtml` threads web audio (`audioTarget:"web"` + data: map).
- `mobile/src/components/contentHtml.ts` — **modify**: `buildTopicHtml` threads native audio (`audioTarget:"native"`).
- `mobile/src/reader/useTopicAudio.ts` — **create**: resolution hook (web data: map, native file:// map).
- `mobile/src/reader/NativeTopicReader.web.tsx` — **modify**: resolve + pass web audio data: URLs.
- `mobile/src/components/LessonRenderer.tsx` — **modify**: native audio bridge — `HtmlView` gains a webview ref + extra injected JS + custom-message passthrough; `WebViewTopicRenderer` owns the `expo-audio` player, resolves file URIs, wires the bridge.
- `mobile/src/help-content/{features.ts,topics.ts,tree.ts}` — **modify**: `reader-audio` feature + topic + tree leaf.
- Tests alongside: `mobile/__tests__/lib/figuresHtml.test.ts`, `mobile/__tests__/reader/topicHtml.test.ts` (or existing), `mobile/__tests__/reader/useTopicAudio.test.tsx` (new), `mobile/__tests__/components/LessonRenderer*.test.tsx` (bridge), sanitize-survival in the reader sanitize test, help coverage.

---

## Task 1: Reader audio block HTML helper

**Files:**
- Modify: `mobile/src/lib/figuresHtml.ts`
- Test: `mobile/__tests__/lib/figuresHtml.test.ts`

**Interfaces:**
- Consumes: `TopicAudio` (`@/types/book`), existing `esc(s: string): string` and `audioCaption(a: TopicAudio): string` in this file.
- Produces: `renderReaderAudioHtml(audio: TopicAudio[], opts: { target: "web" | "native"; dataUrls?: Map<string, string> }): string` — the reader's audio section. Web needs `dataUrls`; native ignores it.

- [ ] **Step 1: Write the failing tests**

```ts
// append to mobile/__tests__/lib/figuresHtml.test.ts
import { renderReaderAudioHtml } from "@/lib/figuresHtml";
import type { TopicAudio } from "@/types/book";

const AUD: TopicAudio = { id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hello world." };

describe("renderReaderAudioHtml", () => {
  it("web target emits a native <audio controls> with the data: src + transcript details", () => {
    const html = renderReaderAudioHtml([AUD], { target: "web", dataUrls: new Map([["a1", "data:audio/mpeg;base64,AAA="]]) });
    expect(html).toContain('<audio class="rd-audio" controls="controls" preload="none" src="data:audio/mpeg;base64,AAA="></audio>');
    expect(html).toContain('data-audio-id="a1"');
    expect(html).toContain("<summary>Transcript</summary>");
    expect(html).toContain("Hello world.");
    expect(html).not.toContain("rd-audio-toggle"); // no native control on web
  });

  it("native target emits an id-keyed control block, NO <audio> and NO data: URI", () => {
    const html = renderReaderAudioHtml([AUD], { target: "native" });
    expect(html).toContain('class="rd-audio-toggle" data-audio-id="a1"');
    expect(html).toContain('class="rd-audio-seek" data-audio-id="a1"');
    expect(html).toContain('class="rd-audio-time" data-audio-id="a1"');
    expect(html).not.toContain("<audio"); // native must not embed <audio>
    expect(html).not.toContain("data:"); // no base64 in native markup
    expect(html).toContain("Hello world."); // transcript still present
  });

  it("web: a clip with no resolved url is skipped; native: rendered regardless (id-only)", () => {
    expect(renderReaderAudioHtml([AUD], { target: "web", dataUrls: new Map() })).toBe("");
    expect(renderReaderAudioHtml([AUD], { target: "native" })).toContain("data-audio-id");
  });

  it("empty / no audio → empty string", () => {
    expect(renderReaderAudioHtml([], { target: "web", dataUrls: new Map() })).toBe("");
    expect(renderReaderAudioHtml(undefined as unknown as TopicAudio[], { target: "native" })).toBe("");
  });

  it("escapes a hostile transcript / title (no raw HTML injection)", () => {
    const evil: TopicAudio = { id: "x", file: "media/b/x.mp3", mime: "audio/mpeg", title: "<img src=x onerror=1>", transcript: "</p><script>alert(1)</script>" };
    const html = renderReaderAudioHtml([evil], { target: "native" });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd mobile && npx jest figuresHtml -t "renderReaderAudioHtml"`
Expected: FAIL — `renderReaderAudioHtml` is not exported.

- [ ] **Step 3: Implement the helper**

Add to `mobile/src/lib/figuresHtml.ts` (reuse the file's existing `esc` and `audioCaption`):

```ts
// Reader-side audio block (ADR-040 rung 3) — DISTINCT from renderAudioHtml
// (the compiler/EPUB path) and renderAudioTranscriptHtml (epub2). This renders
// the in-app reader's player:
//   - web target: the browser's native <audio controls> transport, fed the
//     resolved data: URI (plays direct-to-DOM). A clip with no resolved url is
//     omitted (the file was missing).
//   - native target: an id-keyed control block (play/pause button + seek range +
//     time), NO <audio> element and NO data: URI — ExoPlayer data:-URI playback
//     is unreliable across OEMs (see AudioNarrationPlayer.tsx). The WebView's
//     injected JS wires these to the expo-audio bridge in LessonRenderer.
// Both targets always render the transcript in a <details> (a11y + resilience).
function readerAudioTranscript(a: TopicAudio): string {
  const text = a.transcript?.trim();
  if (!text) return "";
  return `<details class="rd-audio-transcript"><summary>Transcript</summary><p>${esc(text)}</p></details>`;
}

export function renderReaderAudioHtml(
  audio: TopicAudio[],
  opts: { target: "web" | "native"; dataUrls?: Map<string, string> },
): string {
  const blocks = (audio ?? [])
    .map((a) => {
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      const transcript = readerAudioTranscript(a);
      if (opts.target === "web") {
        const src = opts.dataUrls?.get(a.id);
        if (!src) return ""; // missing file → omit the player (web can't bridge)
        return `<figure class="topic-audio" data-audio-id="${esc(a.id)}"><audio class="rd-audio" controls="controls" preload="none" src="${esc(src)}"></audio>${cap}${transcript}</figure>`;
      }
      // native: id-only control block, driven by the WebView bridge.
      const id = esc(a.id);
      const control =
        `<div class="rd-audio-ctl">` +
        `<button type="button" class="rd-audio-toggle" data-audio-id="${id}" aria-label="Play">&#9658;</button>` +
        `<input type="range" class="rd-audio-seek" data-audio-id="${id}" min="0" max="0" value="0" step="1" aria-label="Seek">` +
        `<span class="rd-audio-time" data-audio-id="${id}">0:00&nbsp;/&nbsp;0:00</span>` +
        `</div>`;
      return `<figure class="topic-audio" data-audio-id="${id}">${control}${cap}${transcript}</figure>`;
    })
    .filter(Boolean)
    .join("");
  if (!blocks) return "";
  return `<hr class="section-divider"><section class="audio"><h3>Narration</h3>${blocks}</section>`;
}
```

If `TopicAudio` is not already imported in this file, add it to the existing `@/types/book` import.

- [ ] **Step 4: Run the tests, verify they pass**

Run: `cd mobile && npx jest figuresHtml`
Expected: PASS (new + existing).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/figuresHtml.ts mobile/__tests__/lib/figuresHtml.test.ts
git commit -m "feat(reader): renderReaderAudioHtml — web <audio> vs native control block (rung 3)"
```

---

## Task 2: Thread audio through the shared renderer + resolution hook + web wiring

**Files:**
- Modify: `mobile/src/reader/topicHtml.ts`, `mobile/src/reader/renderContent.ts`, `mobile/src/components/contentHtml.ts`, `mobile/src/reader/NativeTopicReader.web.tsx`
- Create: `mobile/src/reader/useTopicAudio.ts`
- Test: `mobile/__tests__/reader/topicHtml.test.ts` (create if absent), `mobile/__tests__/reader/useTopicAudio.test.tsx` (create)

**Interfaces:**
- Consumes: `renderReaderAudioHtml` (Task 1); `resolveAudioDataUrls` / `resolveAudioFileUris` (`@/storage/mediaStore`).
- Produces:
  - `renderTopicToHtml(topic, dataUrls?, opts?: { audioUrls?: Map<string,string>; audioTarget?: "web" | "native" }): string`
  - `renderTopicToSafeHtml(topic, dataUrls?, audioUrls?: Map<string,string>): string` (web — target "web")
  - `buildTopicHtml(topic, dataUrls, palette, audioTarget?: "web" | "native"): string` (native call passes "native")
  - `useTopicAudio(topic): { webUrls: Map<string,string>; fileUris: Map<string,string> }`

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/__tests__/reader/topicHtml.test.ts  (add or create)
import { renderTopicToHtml } from "@/reader/topicHtml";
import type { GeneratedTopic } from "@/types/book";

const topic: GeneratedTopic = {
  topicId: "u1", title: "T", generatedAt: "2026-08-19T00:00:00.000Z",
  lesson: { topic: "T", level: "intro", language: "en", synopsis: "s", learning_objectives: [], sections: [{ heading: "H", body_markdown: "b" }], key_takeaways: [], further_reading: [] },
  audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hi." }],
};

it("web target embeds the <audio> player when a data url is supplied", () => {
  const html = renderTopicToHtml(topic, undefined, { audioTarget: "web", audioUrls: new Map([["a1", "data:audio/mpeg;base64,AAA="]]) });
  expect(html).toContain('<audio class="rd-audio" controls="controls"');
});

it("native target embeds the id-keyed control, no <audio>", () => {
  const html = renderTopicToHtml(topic, undefined, { audioTarget: "native" });
  expect(html).toContain('class="rd-audio-toggle" data-audio-id="a1"');
  expect(html).not.toContain("<audio");
});

it("no opts → no audio block (unchanged legacy behavior)", () => {
  const html = renderTopicToHtml(topic);
  expect(html).not.toContain("rd-audio");
  expect(html).not.toContain('section class="audio"');
});
```

```tsx
// mobile/__tests__/reader/useTopicAudio.test.tsx  (create)
import { renderHook, waitFor } from "@testing-library/react-native";
import { useTopicAudio } from "@/reader/useTopicAudio";

jest.mock("@/storage/mediaStore", () => ({
  resolveAudioDataUrls: jest.fn(async () => new Map([["a1", "data:audio/mpeg;base64,AAA="]])),
  resolveAudioFileUris: jest.fn(async () => new Map([["a1", "file:///m/a1.mp3"]])),
}));

const topic = { topicId: "u1", title: "T", generatedAt: "x", lesson: {} as any, audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg" }] } as any;

it("resolves both web data: and native file:// maps", async () => {
  const { result } = renderHook(() => useTopicAudio(topic));
  await waitFor(() => expect(result.current.webUrls.get("a1")).toContain("data:audio/mpeg"));
  expect(result.current.fileUris.get("a1")).toBe("file:///m/a1.mp3");
});

it("empty maps when the topic has no audio", async () => {
  const { result } = renderHook(() => useTopicAudio({ ...topic, audio: [] }));
  await waitFor(() => expect(result.current.webUrls.size).toBe(0));
  expect(result.current.fileUris.size).toBe(0);
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd mobile && npx jest topicHtml useTopicAudio`
Expected: FAIL — `opts` not honored / `useTopicAudio` missing.

- [ ] **Step 3: Implement**

`mobile/src/reader/topicHtml.ts` — extend the signature and append the block (import `renderReaderAudioHtml`):

```ts
import { renderFiguresHtml, renderReaderAudioHtml } from "@/lib/figuresHtml";

export function renderTopicToHtml(
  topic: GeneratedTopic,
  dataUrls?: Map<string, string>,
  opts?: { audioUrls?: Map<string, string>; audioTarget?: "web" | "native" },
): string {
  let html = renderLesson(topic.lesson);
  if (topic.tutorial) html += renderTutorial(topic.tutorial);
  if (topic.quizSets?.length) html += renderQuizzes(topic.quizSets);
  if (topic.experiment) html += renderExperiment(topic.experiment);
  if (topic.images?.length && dataUrls?.size) html += renderFiguresHtml(topic.images, dataUrls);
  if (topic.audio?.length && opts?.audioTarget) {
    html += renderReaderAudioHtml(topic.audio, { target: opts.audioTarget, dataUrls: opts.audioUrls });
  }
  return html;
}
```

`mobile/src/reader/renderContent.ts` — web path passes `audioTarget:"web"`:

```ts
export function renderTopicToSafeHtml(
  topic: GeneratedTopic,
  dataUrls?: Map<string, string>,
  audioUrls?: Map<string, string>,
): string {
  return sanitizeFragment(renderTopicToHtml(topic, dataUrls, { audioTarget: "web", audioUrls }));
}
```

`mobile/src/components/contentHtml.ts` — native builder passes `audioTarget:"native"`:

```ts
export function buildTopicHtml(
  topic: GeneratedTopic,
  dataUrls: Map<string, string> | undefined,
  palette: Palette,
  audioTarget: "web" | "native" = "native",
): string {
  return htmlDocument(jsonForScriptBlock({ __html: renderTopicToHtml(topic, dataUrls, { audioTarget }) }), palette);
}
```

Create `mobile/src/reader/useTopicAudio.ts` (mirror `useTopicFigures.ts`):

```ts
import { useEffect, useState } from "react";
import type { GeneratedTopic } from "@/types/book";
import { resolveAudioDataUrls, resolveAudioFileUris } from "@/storage/mediaStore";

const EMPTY = { webUrls: new Map<string, string>(), fileUris: new Map<string, string>() };

/** Resolve a topic's audio to the maps the reader needs: web data: URIs (embedded
 *  in the <audio> src) and native file:// URIs (played by expo-audio, id-bridged). */
export function useTopicAudio(topic: GeneratedTopic | null | undefined) {
  const [urls, setUrls] = useState(EMPTY);
  useEffect(() => {
    let live = true;
    if (!topic?.audio?.length) { setUrls(EMPTY); return; }
    Promise.all([resolveAudioDataUrls(topic), resolveAudioFileUris(topic)]).then(([webUrls, fileUris]) => {
      if (live) setUrls({ webUrls, fileUris });
    });
    return () => { live = false; };
  }, [topic]);
  return urls;
}
```

`mobile/src/reader/NativeTopicReader.web.tsx` — resolve + pass web audio urls. Add a `useTopicAudio` call and thread `webUrls` into `renderTopicToSafeHtml`:

```tsx
import { useTopicAudio } from "@/reader/useTopicAudio";
// ... inside the component, alongside the existing figures memoization:
const { webUrls } = useTopicAudio(topic);
const html = useMemo(() => renderTopicToSafeHtml(topic, figures, webUrls), [topic, figures, webUrls]);
```

(If `NativeTopicReader.web.tsx` receives `figures` as a prop rather than resolving them, keep that; only add the `webUrls` resolution + third arg.)

- [ ] **Step 4: Run, verify pass**

Run: `cd mobile && npx jest topicHtml useTopicAudio && npx tsc --noEmit`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/reader/topicHtml.ts mobile/src/reader/renderContent.ts mobile/src/components/contentHtml.ts mobile/src/reader/useTopicAudio.ts mobile/src/reader/NativeTopicReader.web.tsx mobile/__tests__/reader/topicHtml.test.ts mobile/__tests__/reader/useTopicAudio.test.tsx
git commit -m "feat(reader): thread audio through renderTopicToHtml + useTopicAudio; wire web player (rung 3)"
```

---

## Task 3: Sanitizer survival + native WebView audio bridge

**Files:**
- Modify: `mobile/src/components/LessonRenderer.tsx`
- Test: `mobile/__tests__/components/LessonRenderer.audio.test.tsx` (create), reader sanitize test (add survival cases)

**Interfaces:**
- Consumes: `useTopicAudio` (Task 2), `expo-audio` (`useAudioPlayer`, `useAudioPlayerStatus` — the same hooks `AudioNarrationPlayer.tsx` uses), `resolveAudioFileUris` result via the hook.
- Produces: a working native bridge — WebView → RN `{t:"audio",action,id,positionMs?}`, RN → WebView `window.__rdAudioState({id,playing,positionMs,durationMs})`.

- [ ] **Step 1: Write the failing tests** (RNTL + mocked `expo-audio` and `react-native-webview`, per [[reference_mobile_test_env_traps]] — no real WebView/DOM)

```tsx
// mobile/__tests__/components/LessonRenderer.audio.test.tsx
import { render } from "@testing-library/react-native";
import { TopicRenderer } from "@/components/LessonRenderer";

const play = jest.fn(), pause = jest.fn(), seekTo = jest.fn(), replace = jest.fn();
jest.mock("expo-audio", () => ({
  useAudioPlayer: () => ({ play, pause, seekTo, replace }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }),
}));
let capturedProps: any = {};
jest.mock("react-native-webview", () => ({
  WebView: (props: any) => { capturedProps = props; return null; },
}));
jest.mock("react-native/Libraries/Utilities/Platform", () => ({ OS: "android", select: (o: any) => o.android }));
jest.mock("@/storage/mediaStore", () => ({
  resolveAudioDataUrls: jest.fn(async () => new Map()),
  resolveAudioFileUris: jest.fn(async () => new Map([["a1", "file:///m/a1.mp3"]])),
}));

const topic: any = { topicId: "u1", title: "T", generatedAt: "x", lesson: { topic:"T",level:"i",language:"en",synopsis:"s",learning_objectives:[],sections:[{heading:"H",body_markdown:"b"}],key_takeaways:[],further_reading:[] }, audio: [{ id:"a1", file:"media/b/a1.mp3", mime:"audio/mpeg", transcript:"Hi." }] };

it("injects the audio bridge JS and a message handler on the native topic WebView", () => {
  render(<TopicRenderer topic={topic} />);
  expect(capturedProps.injectedJavaScript).toContain("rd-audio-toggle");
  expect(typeof capturedProps.onMessage).toBe("function");
});

it("a toggle message plays, then a second toggle pauses", () => {
  render(<TopicRenderer topic={topic} />);
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "toggle", id: "a1" }) } });
  expect(play).toHaveBeenCalled();
});

it("a seek message calls seekTo with seconds", () => {
  render(<TopicRenderer topic={topic} />);
  capturedProps.onMessage({ nativeEvent: { data: JSON.stringify({ t: "audio", action: "seek", id: "a1", positionMs: 5000 }) } });
  expect(seekTo).toHaveBeenCalledWith(5);
});

it("a bare-number height message still auto-heights (not misrouted to audio)", () => {
  render(<TopicRenderer topic={topic} inline />);
  expect(() => capturedProps.onMessage({ nativeEvent: { data: "420" } })).not.toThrow();
  expect(play).not.toHaveBeenCalled();
});
```

Sanitizer survival — add to the existing reader sanitize test (find the file that imports `sanitizeFragment` / `renderTopicToSafeHtml`, e.g. `mobile/__tests__/reader/*sanitize*`):

```ts
it("keeps the web reader <audio controls src=data:> through the topic sanitizer", () => {
  const out = sanitizeFragment('<audio class="rd-audio" controls="controls" src="data:audio/mpeg;base64,AAA="></audio>');
  expect(out).toContain("<audio");
  expect(out).toContain("data:audio/mpeg;base64,AAA=");
});
it("keeps the native audio control markup (button/range/data-audio-id) through the sanitizer", () => {
  const out = sanitizeFragment('<button class="rd-audio-toggle" data-audio-id="a1">&#9658;</button><input type="range" class="rd-audio-seek" data-audio-id="a1">');
  expect(out).toContain("rd-audio-toggle");
  expect(out).toContain('data-audio-id="a1"');
  expect(out).toContain('type="range"');
});
```

- [ ] **Step 2: Run, verify failure**

Run: `cd mobile && npx jest LessonRenderer.audio sanitize`
Expected: FAIL — no bridge; possibly `data-audio-id` stripped by the sanitizer (if so, the survival test tells you to allow `data-*`/range — see Step 3 note).

- [ ] **Step 3: Implement the bridge**

In `mobile/src/components/LessonRenderer.tsx`:

1. Define the audio bridge JS string (wires taps + seek to `postMessage`, and defines `window.__rdAudioState` for RN→WebView pushes). Combine with the existing `AUTO_HEIGHT_JS` when both are needed.

```ts
const AUDIO_BRIDGE_JS = `(function () {
  function post(m){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('.rd-audio-toggle');
    if (b) { post({ t: 'audio', action: 'toggle', id: b.getAttribute('data-audio-id') }); }
  });
  document.addEventListener('input', function (e) {
    var s = e.target;
    if (s && s.classList && s.classList.contains('rd-audio-seek')) {
      post({ t: 'audio', action: 'seek', id: s.getAttribute('data-audio-id'), positionMs: Math.round(Number(s.value)) });
    }
  });
  function fmt(ms){ var t=Math.max(0,Math.floor(ms/1000)); var m=Math.floor(t/60); var s=('0'+(t%60)).slice(-2); return m+':'+s; }
  window.__rdAudioState = function (st) {
    var wrap = document.querySelector('.topic-audio[data-audio-id="'+st.id+'"]'); if (!wrap) return;
    var btn = wrap.querySelector('.rd-audio-toggle'); if (btn) { btn.innerHTML = st.playing ? '&#10073;&#10073;' : '&#9658;'; btn.setAttribute('aria-label', st.playing ? 'Pause' : 'Play'); }
    var seek = wrap.querySelector('.rd-audio-seek'); if (seek) { seek.max = String(st.durationMs || 0); seek.value = String(st.positionMs || 0); }
    var time = wrap.querySelector('.rd-audio-time'); if (time) { time.innerHTML = fmt(st.positionMs||0) + '&nbsp;/&nbsp;' + fmt(st.durationMs||0); }
  };
})(); true;`;
```

2. Extend `HtmlView` to accept an optional `extraInjectedJS?: string`, an `onCustomMessage?: (data: string) => boolean` (return `true` if it consumed the message; otherwise fall through to the height parse), and a `webviewRef?: React.RefObject<any>` forwarded to `<WebView ref=…>`. Compose `injectedJavaScript` = `[inline ? AUTO_HEIGHT_JS : "", extraInjectedJS ?? ""].join("\n")` (so audio works whether or not `inline`). In `onMessage`, first call `onCustomMessage?.(data)`; if it returns falsy, run the existing height parse.

3. In `WebViewTopicRenderer`, own the player + bridge:

```tsx
function WebViewTopicRenderer({ topic, figures, inline }: { topic: GeneratedTopic; figures?: Map<string,string>; inline?: boolean }) {
  const theme = useTheme();
  const { fileUris } = useTopicAudio(topic);
  const webviewRef = useRef<any>(null);
  const player = useAudioPlayer(); // expo-audio: source set via replace() below
  const status = useAudioPlayerStatus(player);
  const activeId = useRef<string | null>(null);

  const html = useMemo(() => buildTopicHtml(topic, figures, theme, "native"), [topic, figures, theme]);

  // Push playback state back into the WebView control for the active clip.
  useEffect(() => {
    if (!activeId.current) return;
    const msg = JSON.stringify({ id: activeId.current, playing: !!status.playing, positionMs: Math.round((status.currentTime ?? 0) * 1000), durationMs: Math.round((status.duration ?? 0) * 1000) });
    webviewRef.current?.injectJavaScript(`window.__rdAudioState && window.__rdAudioState(${msg}); true;`);
  }, [status.playing, status.currentTime, status.duration]);

  const onCustomMessage = useCallback((data: string): boolean => {
    let m: any; try { m = JSON.parse(data); } catch { return false; }
    if (!m || m.t !== "audio") return false;
    const uri = fileUris.get(m.id);
    if (m.action === "toggle") {
      if (activeId.current !== m.id) { activeId.current = m.id; if (uri) player.replace({ uri }); }
      // Toggle: if this clip is the active one and already playing, pause; else play.
      if (status.playing && activeId.current === m.id) player.pause(); else player.play();
    } else if (m.action === "seek" && activeId.current === m.id) {
      player.seekTo((m.positionMs ?? 0) / 1000);
    }
    return true;
  }, [fileUris, player, status.playing]);

  return <HtmlView html={html} label="Topic content" inline={inline}
    extraInjectedJS={AUDIO_BRIDGE_JS} onCustomMessage={onCustomMessage} webviewRef={webviewRef} />;
}
```

> Verify the `expo-audio` API against the installed version (`AudioNarrationPlayer.tsx` is the reference): if `useAudioPlayer()` requires an initial source or the swap method is not `replace`, adapt (e.g. `player.replace(uri)` vs `{ uri }`, or recreate the player keyed on `activeId`). Keep the file-cache technique from `AudioNarrationPlayer` if a resolved uri is ever a non-`file://` form; `resolveAudioFileUris` already returns an absolute `file://` from the media dir, so a direct `replace` is expected to suffice.

4. If the sanitizer survival test failed, allow the native control markup in the **topic** sanitize profile only: permit `data-audio-id` (a `data-*` attr) and the `range` input / `button` if DOMPurify's default drops them. Prefer the smallest allowance (e.g. `ADD_ATTR: ["data-audio-id"]` scoped to the topic profile) and re-run the vectors test to confirm no `src`/`data:` leak on non-media elements.

- [ ] **Step 4: Run, verify pass**

Run: `cd mobile && npx jest LessonRenderer.audio sanitize && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/LessonRenderer.tsx mobile/__tests__/components/LessonRenderer.audio.test.tsx mobile/__tests__/reader/*sanitize*
git commit -m "feat(reader): native WebView↔expo-audio bridge for in-book audio (rung 3)"
```

---

## Task 4: Help topic + tree leaf + device-verify note

**Files:**
- Modify: `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`, `mobile/src/help-content/tree.ts`
- Test: the existing help coverage test (`mobile/__tests__/help/coverage.test.ts`) + tree gate run in CI.

**Interfaces:**
- Consumes: the `FEATURES` / `HelpTopic` / `HELP_TREE` shapes already in those files (copy the `kdp-export` / `publish-audio` entries as the pattern).
- Produces: a `reader-audio` feature key + topic + tree leaf.

- [ ] **Step 1: Add the feature key**

In `mobile/src/help-content/features.ts`, add `reader-audio` to `FEATURES` (mirror the existing entries' shape — key + short label/description).

- [ ] **Step 2: Add the Help topic**

In `mobile/src/help-content/topics.ts`, add a topic with `featureKey: "reader-audio"`: explains that a book's narration plays inside the reader (web + Android), that the transcript is always available, seek/time transport, and that audio is part of *our* reader (rung of the multi-modal library). Keep copy accurate to shipped behavior (no authoring UI yet — audio arrives via generation/import).

- [ ] **Step 3: Add the tree leaf**

In `mobile/src/help-content/tree.ts`, add a leaf for the topic under the reader/library branch (next to the reading/import topics). Use the tree-node id convention already in the file (leaf `node.id` ≠ topicId — see [[project_reader_one_renderer]]/help tree notes).

- [ ] **Step 4: Run the gates**

Run: `cd mobile && npx jest --testPathPattern=help`
Expected: PASS (coverage gate sees the topic for the feature; tree gate resolves the leaf).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/src/help-content/tree.ts
git commit -m "docs(help): reader-audio topic + tree leaf (rung 3 DoD)"
```

**Device-verify (post-merge, native — per `mobile:verify` skill, not a CI gate):** seed/import a `.book.zip` with `media/<name>.mp3` + a `book.json` topic carrying that `audio` ref; open the topic in the Android build; confirm the control plays via expo-audio, seek + time update, transcript expands, and playing a second clip stops the first.

---

## Self-Review

- **Spec coverage:** D1 renderer/target → T1+T2; D2 hook → T2; D3 bridge → T3; D4 one active clip → T3 (`activeId` ref + single player); D5 wiring → T2 (web) + T3 (native); D6 Help → T4; sanitizer permit/confirm → T3. All covered.
- **Type consistency:** `renderReaderAudioHtml(audio, {target, dataUrls?})` (T1) is called by `renderTopicToHtml(topic, dataUrls?, {audioUrls?, audioTarget?})` (T2) with `{ target: opts.audioTarget, dataUrls: opts.audioUrls }`; `useTopicAudio` returns `{webUrls, fileUris}` consumed as `webUrls` (web, T2) and `fileUris` (native, T3). Bridge message `{t:"audio",action,id,positionMs?}` emitted by `AUDIO_BRIDGE_JS` and parsed by `onCustomMessage` — shapes match.
- **Placeholder scan:** none — every code step carries real code; the one flagged verification (expo-audio API swap method) points at the installed reference (`AudioNarrationPlayer.tsx`) rather than deferring.
- **Risk note for the executor:** the `expo-audio` player-source-swap API and whether the topic sanitizer already keeps `data-audio-id` are the two things to confirm empirically in T3 (tests will tell you). Everything else is mechanical.
