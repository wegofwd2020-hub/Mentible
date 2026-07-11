# Cleanup: remove the dead web iframe reader path

**Status:** Design approved 2026-07-11.
**Scope:** delete the now-dead web `<iframe>` reader, the `EXPO_PUBLIC_NATIVE_READER` flag
indirection, and the unused single-lesson renderer. Web-only cleanup; the Android WebView reader
is untouched.

## Background

The D1 flip is complete: the native web reader is live on both web surfaces (demo + full app),
so on web `TopicRenderer` always renders `NativeTopicReader`. That leaves three dead pieces on
web:
- the `EXPO_PUBLIC_NATIVE_READER` flag (`USE_NATIVE_WEB_READER`), always true on web / false on
  native — pure indirection now;
- the web `<iframe>` renderer (`HtmlViewWeb`), never reached on web anymore;
- the single-lesson `LessonRenderer` + `buildHtml`, with no consumers since ADR-009 removed the
  single-lesson surface (only a stale comment in `BookCover.tsx` references it).

**Android still uses** `TopicRenderer` (native branch) → the WebView renderer → `buildTopicHtml`
→ `react-native-webview`. The native reader is web-only by design (DOMPurify/marked/mermaid can't
run in RN), so this WebView path stays permanently. The cleanup must not touch it.

**Decision (committing to the native reader):** removing the flag + web iframe also removes the
web kill-switch (there's no longer an iframe to fall back to). This is deliberate — the native
reader is live and verified on both surfaces.

## What is removed

1. **The flag.**
   - Delete `mobile/src/constants/readerFlag.ts`.
   - In `TopicRenderer` (`mobile/src/components/LessonRenderer.tsx`), replace
     `if (USE_NATIVE_WEB_READER) return <NativeTopicReader …/>` with
     `if (Platform.OS === "web") return <NativeTopicReader …/>`, and drop the `readerFlag` import.
   - Remove the `export EXPO_PUBLIC_NATIVE_READER=1` line from **both** arms (demo + app) of
     `scripts/deploy/web-deploy.sh`. It is set nowhere else (`.env*`, `app.json`, `eas.json`, CI).

2. **The web `<iframe>`.**
   - Remove `HtmlViewWeb` (the sandboxed `srcDoc` iframe) and collapse `HtmlView` to the native
     WebView host. After this there is **no `<iframe>` anywhere in the app** — the web
     token-exfil surface the native reader was built to escape is *gone*, not just sandboxed.

3. **The dead single-lesson renderer.**
   - Remove the unused `LessonRenderer` component and `buildHtml` (+ any helper used *only* by
     `buildHtml`). Keep `buildTopicHtml` and helpers shared with it — Android renders through
     `buildTopicHtml`.

## What stays (must not regress)

- `TopicRenderer` and its two call sites (`app/book/topic/[bookId]/[topicId].tsx`,
  `app/book/shared/[id].tsx`).
- The Android path: native branch of `TopicRenderer` → WebView renderer → `buildTopicHtml` →
  `react-native-webview`, with the lazy `Platform.OS !== "web"` require of the WebView.
- **D3 bundle protection:** `NativeTopicReader` stays a `.web` module with a throwing native
  stub; the web branch is guarded by `Platform.OS === "web"`, so the native bundle still never
  imports DOMPurify/marked/mermaid.
- Native WebView hardening (`originWhitelist={["*"]}`) is a *separate*, pre-existing item — out
  of scope here.

## Naming

- Rename the internal `IframeTopicRenderer` → `WebViewTopicRenderer` (it renders no iframe now).
- **Keep the filename** `mobile/src/components/LessonRenderer.tsx` to avoid churning its two app
  import sites; add a one-line header comment noting it now hosts `TopicRenderer` + the topic
  HTML builders. (A file rename is deferred as not worth the churn.)

## Tests

- **Delete** `mobile/__tests__/reader/readerFlag.test.ts` (subject removed).
- **Delete** `mobile/__tests__/components/LessonRenderer.test.tsx` — it renders `LessonRenderer`
  specifically to assert the web iframe's `sandbox="allow-scripts"`; both the component and the
  iframe are gone.
- **Rewrite** `mobile/__tests__/components/TopicRenderer.switch.test.tsx`: assert
  `Platform.OS === "web"` → `NativeTopicReader` with **0 `<iframe>`**, and native → the WebView
  path. Remove the iframe-sandbox regression case (no iframe exists after this).
- **Edit** `mobile/__tests__/components/contentHtml.test.ts`: drop the `buildHtml` cases, keep
  the `buildTopicHtml` cases.
- **Verify** `mobile/__tests__/app/book-shared.test.tsx` still passes (it exercises
  `TopicRenderer`, which is unchanged in behavior on its platform).

## Verification

- `npm run typecheck` — catches any dangling import of the removed symbols.
- `npm run lint`, `npm test` — full suite green.
- Grep gate: `git grep -n "USE_NATIVE_WEB_READER\|HtmlViewWeb\|readerFlag"` returns nothing in
  `mobile/`, and no `<iframe` remains in `mobile/src/components/`.
- The native reader tests (`NativeTopicReader`, `quizReveal`, `enhance`, `sanitize`) are
  unaffected and stay green.

## Non-goals

- Any change to the Android WebView renderer or `buildTopicHtml`.
- Native WebView `originWhitelist` hardening (separate follow-up).
- Renaming the `LessonRenderer.tsx` file or the `contentHtml.ts` module.
- Removing `react-native-webview` (Android needs it).

## Files

```
EDIT   mobile/src/components/LessonRenderer.tsx    flag→Platform.OS; remove HtmlViewWeb +
                                                   LessonRenderer + buildHtml re-export; rename
                                                   IframeTopicRenderer→WebViewTopicRenderer
EDIT   mobile/src/components/contentHtml.ts        remove buildHtml (+ helpers only it uses)
DELETE mobile/src/constants/readerFlag.ts
EDIT   scripts/deploy/web-deploy.sh                remove EXPO_PUBLIC_NATIVE_READER from both arms
DELETE mobile/__tests__/reader/readerFlag.test.ts
DELETE mobile/__tests__/components/LessonRenderer.test.tsx
EDIT   mobile/__tests__/components/TopicRenderer.switch.test.tsx   flag→Platform.OS; drop iframe guard
EDIT   mobile/__tests__/components/contentHtml.test.ts             drop buildHtml cases
```
