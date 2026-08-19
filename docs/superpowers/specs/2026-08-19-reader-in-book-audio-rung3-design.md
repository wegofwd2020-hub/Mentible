# Reader In-Book Audio (ADR-040 rung 3) — Design Spec

**Status:** Proposed · **Date:** 2026-08-19 · **Area:** `mobile/src/reader`, `mobile/src/components`, `mobile/src/storage` · **Implements:** ADR-040 rung 3 · **Follows:** rung 1 (P4 share derivative), rung 2 (library-carried audio: `book.json` audio + compiler bake)

## Why

ADR-040's north-star is a **multi-modal Personal Library that only our reader renders fully**. Rung 2 put audio *into* a book — `TopicAudio` refs in `book.json`, bytes in the device media dir, and a compiler bake into the EPUB. But **nothing in the in-app reader plays it**: `renderTopicToHtml` renders a topic's images (`resolveFigureDataUrls` → `renderFiguresHtml`) and never touches `topic.audio`. Rung 3 makes the baked audio **audible in the reader**, on both the web reader and the native (Android) reader, with a real transport (play/pause/stop + seek + elapsed/total time).

This is a **reader-integration** slice — the media-resolution layer already exists (`resolveAudioDataUrls`, `resolveAudioFileUris` in `mediaStore.ts`, built in rung 2/P4) and the native playback engine already exists (`AudioNarrationPlayer` + `expo-audio`, P4). The net-new work is: render an audio block in the shared topic renderer, and wire a WebView bridge so the native reader drives `expo-audio` playback.

## Key constraints (load-bearing)

1. **One shared renderer.** `@/reader/topicHtml.ts` `renderTopicToHtml` is the single topic renderer for web and native ([[project_reader_one_renderer]] — the WebView twin was deleted in #326). Rung 3 must NOT reintroduce a second renderer; audio rendering is a param on the shared one.
2. **Native ExoPlayer `data:`-URI playback is unreliable across OEMs.** `AudioNarrationPlayer.tsx`'s own comment (P4): AVPlayer/ExoPlayer support for `data:` URIs is inconsistent, so it writes the base64 to a cache file and plays a `file://` URI, never `data:`. Therefore the **native reader cannot play a `<audio src="data:…">` inside the WebView** — it must bridge out to `expo-audio` playing a `file://`.
3. **Web reader is direct-to-DOM, native is a sandboxed WebView.** `NativeTopicReader.web.tsx` injects `renderTopicToSafeHtml` output straight into the page DOM (no iframe — the sanitizer is the whole boundary). `NativeTopicReader.tsx`/`LessonRenderer`'s `WebViewTopicRenderer` renders the same HTML in a `react-native-webview` whose only current bridge is `window.ReactNativeWebView.postMessage` (auto-height). So `<audio controls src="data:…">` works as-is on web; native needs the bridge.
4. **Sanitizer already permits `<audio>` with `data:`.** DOMPurify's DATA_URI_TAGS include `audio`/`source` (`sanitize.ts`), so a web `<audio src="data:…">` survives. The native bridge control is a plain `<button>`/`<input type="range">` — no new sanitizer allowance beyond confirming `data-*` attrs and the range input survive (test it).
5. **Only the clip id crosses the bridge — never base64.** The native side re-resolves the `file://` from `mediaStore` by id; the postMessage payload is `{t:"audio", …, id}`, keeping large payloads out of the bridge.
6. **Transcript always renders** (a11y + resilience), mirroring the epub2 transcript ethos: even if playback fails, the narration words are present.

## Decisions

- **D1 — `renderTopicToHtml` gains audio rendering, param-driven by target.** New optional args: an audio URL map and a `target: "web" | "native"` (default keep current behavior when no audio). For each `topic.audio[]` clip, emit an **audio block** (`<figure class="rd-audio-fig">`) containing: the title, a transport control, and the transcript in a `<details>`.
  - **web target:** `<audio class="rd-audio" controls preload="none" src="<data-uri>">` — the browser's native transport gives play/pause/seek/time for free. Data URI from `resolveAudioDataUrls`.
  - **native target:** a scriptable control block keyed by `data-audio-id="<id>"` — a play/pause `<button>`, an `<input type="range" class="rd-audio-seek">`, and a `<span class="rd-audio-time">` — NO `<audio>` element. The WebView's injected JS wires these to the bridge; RN drives them back via `injectJavaScript`.
- **D2 — `useTopicAudio` hook (mirrors `useTopicFigures`).** Resolves a topic's audio to the map the target needs: web → `resolveAudioDataUrls` (data: URIs), native → `resolveAudioFileUris` (file:// URIs, consumed by RN, not injected into the HTML). Returns `{ webUrls, fileUris }` (each platform uses one). Empty map when the topic has no audio.
- **D3 — Native bridge protocol (bidirectional).** Extend `WebViewTopicRenderer`:
  - **Injected JS (WebView → RN):** on `.rd-audio` control interaction, `postMessage(JSON.stringify({t:"audio", action, id, positionMs?}))` where `action ∈ {"toggle","seek"}`. Also keep the existing auto-height message (disambiguated by shape — height is a bare number string, audio is a JSON object; the handler parses and branches).
  - **RN handler (onMessage):** owns one `expo-audio` player at a time (the "active clip"). `toggle` → play/pause the file:// for `id` (resolve via `resolveAudioFileUris`, cache the file like `AudioNarrationPlayer` if the uri is not already a playable file). `seek` → `player.seekTo(positionMs/1000)`.
  - **RN → WebView (`injectJavaScript`):** on `useAudioPlayerStatus` change, push `{playing, positionMs, durationMs, id}` into the WebView to update that clip's button label (▶/⏸), range `value`/`max`, and time text. A tiny `window.__rdAudioState(msg)` function defined in the page script applies it.
- **D4 — One active clip.** Playing a second clip stops the first (single `expo-audio` player in the RN host). Web inherits the browser's default (multiple `<audio>` can each play; acceptable — no extra work). Keep scope minimal: no cross-topic persistence, no background playback, no playlist.
- **D5 — Wiring.** `NativeTopicReader.web.tsx` passes `target:"web"` + `webUrls` to the renderer. `LessonRenderer`'s `WebViewTopicRenderer` (native) passes `target:"native"`, holds the `expo-audio` player + status, and runs the bridge. `renderTopicToSafeHtml` (web sanitize path) must keep the `<audio>`/`data:` and the native control markup intact (the native markup is inert on web but never rendered there anyway; web only ever gets `target:"web"`).
- **D6 — Help DoD.** `reader-audio` FEATURES key + a Help topic (how to play a book's narration, transcript availability, that audio is part of *our* reader) + a HELP_TREE leaf (under the reader/library branch).

## Architecture (touch-points)

- **`mobile/src/reader/topicHtml.ts`** — `renderTopicToHtml(topic, dataUrls?, opts?)` extended: `opts.audioUrls?: Map<id,string>`, `opts.audioTarget?: "web"|"native"`. New `renderAudioBlockHtml(clips, urls, target)` helper (sibling to `renderFiguresHtml`), escaping title/transcript via the existing `escapeHtml`.
- **`mobile/src/reader/useTopicAudio.ts`** (new) — the resolution hook (mirrors `useTopicFigures.ts`).
- **`mobile/src/components/LessonRenderer.tsx`** — `WebViewTopicRenderer` gains the audio bridge: `expo-audio` player + `useAudioPlayerStatus`, an `onMessage` branch for `{t:"audio"}`, an `injectJavaScript` push of status, and an extended injected-JS string (auto-height + audio-control wiring + `window.__rdAudioState`).
- **`mobile/src/reader/NativeTopicReader.web.tsx`** — pass `target:"web"` + resolved data: URLs.
- **`mobile/src/reader/sanitize.ts`** — confirm (test, likely no change) that the native control markup (`<button>`, `<input type="range">`, `data-audio-id`, `class`) and web `<audio controls src="data:">` survive the topic-sanitize path.
- **Help:** `features.ts`, `topics.ts`, `tree.ts`.

## Non-goals

- **No authoring UI** (narrate-a-topic button, generate-all-narration) — that's rung 4.
- **No video / A-V** — deferred (ffmpeg, ADR-040).
- **No background / lock-screen playback, no playlist, no cross-topic queue.** One active clip, foreground, in-reader.
- **No new audio format** — `audio/mpeg` only (what the P4 TTS engine emits).
- **No change to rung-2 compiler bake or the EPUB output.** This is the *reader*, not the export.

## Testing

- **Renderer (`topicHtml`):** a topic with an audio clip →
  - web target: contains `<audio class="rd-audio" controls … src="data:…">` and the transcript `<details>`; no native `<button data-audio-id>`.
  - native target: contains the `data-audio-id` control block (button + range + time) and the transcript; no `<audio>` element; no `data:` URI in the markup.
  - a topic with no audio: neither block (byte-unchanged from today for the images-only path).
- **Sanitizer:** the web `<audio controls src="data:…">` survives `renderTopicToSafeHtml`; the native control markup (`<button>`, `<input type="range">`, `data-audio-id`, `class`) survives; no `src`/`data:` on a non-DATA_URI element leaks (reuse the sanitize-vectors fixtures).
- **Hook (`useTopicAudio`):** resolves web → data: map, native → file:// map; empty when no audio; unsubscribes on unmount (mirror `useTopicFigures` test).
- **Bridge (LessonRenderer):** the `onMessage` handler parses `{t:"audio",action,id}` and drives the player (mock `expo-audio`): `toggle` play/pause, `seek` calls `seekTo`; a bare-number height message still auto-heights (not misrouted to audio); a status change calls `injectJavaScript` with the state shape. (RNTL + mocked `expo-audio`/`react-native-webview`, per `reference_mobile_test_env_traps` — no real WebView.)
- **Player reliability:** the file-cache technique from `AudioNarrationPlayer` is reused for a non-file uri; a `file://` from `resolveAudioFileUris` is played directly.
- **Device-verify (native, per `mobile:verify`):** seed a book with an audio clip (import a `.book.zip` with `media/…mp3` + `book.json` audio), open the topic, confirm the control plays via expo-audio, seek works, and a second clip stops the first. Mocked tests can't prove native playback (`reference_mobile_test_env_traps`).

## Rollout

Mobile-only (no backend, no migration, no compiler change). Web deploy + APK. Rung 3 makes rung-2's baked audio audible; rung 4 (authoring UI to *create* topic audio in-app) is the next rung — until then, audio enters a book only via `generateAndStoreTopicAudio`/import, so rung 3 is verified with a seeded/imported book.
