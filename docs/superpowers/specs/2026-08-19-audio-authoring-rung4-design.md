# Audio Authoring UI (ADR-040 rung 4) — Design Spec

**Status:** Proposed · **Date:** 2026-08-19 · **Area:** `mobile/` (authoring screens, hooks, storage) · **Implements:** ADR-040 rung 4 · **Follows:** rung 1 (P4 share derivative), rung 2 (library-carried audio: `book.json` audio + compiler bake), rung 3 (reader plays in-book audio)

## Why

ADR-040's staged path ends at rung 4: **author narration in-app**. Rungs 2-3 made audio a first-class part of a book (`TopicAudio` in `book.json`, bytes in the media dir, reader playback web + native) — but there is **no UI to create it**. The generate-and-store engine already exists: `mobile/src/lib/audioGenerate.ts` `generateAndStoreTopicAudio` calls the shipped P4 `/derivatives/audio` endpoint, writes the MP3, and `attachAudio`s a `TopicAudio` ref — its own comment says *"No UI here — the button that calls this is rung 4."* Rung 4 is therefore **UI + wiring**, not new capability:

1. A per-topic **"Generate narration"** panel in the topic editor.
2. A book-level **"Generate all narration"** fan-out.
3. A **bundle-gap fix**: `.book.zip` export/import carries images but **not** audio, so authored narration is silently lost on round-trip — fixed here so authored audio is durable.
4. Help.

After rung 4, audio is fully first-class: authored in-app, carried in the library, played in the reader, exported/imported without loss.

## Key constraints (load-bearing)

1. **Reuse the shipped engine.** `generateAndStoreTopicAudio` (generate → write → `attachAudio`, copy-on-write, never mutates the caller's book) is the single generate-store path — the UI calls it, does not reimplement it. `attachAudio` enforces `MAX_AUDIO_PER_TOPIC` (5), MP3-only, and requires the topic to have content.
2. **Mirror the image-attach precedent exactly.** `FiguresPanel` (`busy` state, `persist(next)=saveBook(next)`, `onBookChange`, `ActivityIndicator`, `disabled={busy}`) mounted in the topic editor (`app/book/topic/[bookId]/[topicId].tsx`, gated `canEdit && book`) is the template for `NarrationPanel`. Don't invent a new authoring pattern.
3. **Key resolution mirrors `useMakeAudio`.** Narration always uses provider `openai` (the only TTS-capable provider, `backend/tts.TTS_CAPABLE`). Resolve the BYOK OpenAI key lazily via `getApiKey`, apply the same fail-open plan guard (`plan.is_pro === false && !apiKey` → block with "paste your OpenAI key"; Pro/loading → keyless, backend decides). **Managed audio is dormant** (no plan carries openai in managed providers), so this ships BYOK-OpenAI in practice — same posture as shipped P4.
4. **Client-side generate-all, mirroring `useGenerateAll`.** Per-topic sequential calls, persist each clip on completion, skip topics that already have audio (resumable — never re-bill a done topic), `progress[]`/`running`/`finished`/counts, cancelable, injectable interval for tests. No backend/migration (each `/derivatives/audio` call is an independent sync request that persists locally on success).
5. **ADR-001 key discipline.** The OpenAI key is read lazily at call time (`getApiKey`), never held in component state, never logged. `generateAndStoreTopicAudio` already omits `api_key` entirely for a keyless request (never sends `""`).
6. **No compiler/backend change.** The backend `/derivatives/audio` endpoint, TTS engine, and the compiler audio bake are all shipped. Rung 4 is mobile-only except it touches no server code.

## Decisions

- **D1 — `NarrationPanel` component** (`mobile/src/components/NarrationPanel.tsx`), mirroring `FiguresPanel`. Mounted in `app/book/topic/[bookId]/[topicId].tsx` beside `FiguresPanel`, gated `canEdit && book`. Contents:
  - **"Generate narration" button** → resolves the OpenAI key + plan guard (a small shared helper, see D3), derives `source_text` via a new pure helper `lessonToNarratableText(lesson): string` (concatenate the topic's `synopsis` + each `section.body_markdown` + `key_takeaways` into plain text — the backend `generate_narration` rewrites it into speakable prose, so the input only needs the topic's substance; there is no existing reusable lesson→text util — `app/(tabs)/posts.tsx` builds its `cardText` ad hoc), calls `generateAndStoreTopicAudio({ book, topicId, source_text, apiKey, provider_id:"openai" })`, then `persist(result.book)` + `onBookChange(result.book)`. `busy` gates the button; errors surface via `@/lib/alert`.
  - **Clip list**: each existing `TopicAudio` with its title + an inline player (reuse `AudioNarrationPlayer` — reads the clip from the media dir; resolve its base64/file via `resolveAudioDataUrls`/the media path) + a delete control. **`deleteAudio` does not exist yet** — add `deleteAudio(book, topicId, audioId): Promise<Book>` to `mediaStore.ts`, mirroring `deleteImage` exactly (copy-on-write, remove the ref + best-effort delete the file) → `persist`.
  - **Cap feedback**: at `MAX_AUDIO_PER_TOPIC` the generate button disables with a hint; `attachAudio`'s `MediaCapError` is caught and shown.
- **D2 — `useGenerateAllNarration` hook** (`mobile/src/hooks/useGenerateAllNarration.ts`), mirroring `useGenerateAll`'s SHAPE (not its generation call): inputs `{ book, getApiKey, onBookChange, alreadyDone?, intervalMs? }`; iterates the book's content-bearing topics, per topic calls `generateAndStoreTopicAudio` (skipping any topic already in `alreadyDone` / already carrying audio), calls `onBookChange`/persists after each success, exposes `progress[]` (`{topicId,title,status}`), `running`, `finished`, `doneCount`, `failedCount`, `total`, `start()`, `cancel()`. A per-topic failure marks that topic `failed` and continues (never aborts the whole run). Resumable: a re-run only fills gaps.
- **D3 — Shared OpenAI key+guard helper.** Extract the tiny "resolve OpenAI key, apply the not-Pro guard" logic so both `NarrationPanel` and `useGenerateAllNarration` share it (avoid duplicating `useMakeAudio`'s guard). Either a small hook (`useOpenAiNarrationKey`) or reuse `useMakeAudio`'s guard shape — pick the smallest DRY option that both call sites can use. The key source is the same secure store the Publish audio mode reads (OpenAI BYOK).
- **D4 — Generate-all UI surface.** A "Generate all narration" action co-located with the existing "generate full book" entry (`app/book/generate/[id].tsx` or the book home), showing the `useGenerateAllNarration` progress list (per-topic status, done/failed counts) + a cancel. Skips + resumes cleanly.
- **D5 — Bundle carries audio.** Extend `mobile/src/storage/bookBundle.ts`:
  - **Export (`buildBookBundle`):** for each topic's `audio[]`, read the clip bytes and add `media/<basename>` to the zip (mirror the image loop), rewriting the ref's `file` to the bundle-relative `media/<basename>` (as images do). A clip whose file can't be read is dropped with a warning (mirror images).
  - **Import (`parseBookBundle`):** for each topic's `audio[]`, restore the clip under the new book id's media dir via a `writeImportedMedia`-equivalent (audio has no EXIF strip; validate `isAllowedAudioMime` + `MAX_AUDIO_BYTES`, drop malformed/oversize/missing with a warning), re-mint a fresh audio id + path (never trust the bundle's id/path — same path-traversal discipline as images). Audio-less topics pass through unchanged (keep the current byte-identical fast path for image-less/audio-less content).
- **D6 — Help DoD.** A `narrate-topic` FEATURES key + topic + tree leaf (how to generate narration for a topic and for a whole book, that it needs an OpenAI key, that clips play in the reader and export with the book). If generate-all warrants its own topic, add `generate-all-narration` too; otherwise one topic covers both.

## Architecture (touch-points)

- **New:** `mobile/src/components/NarrationPanel.tsx`, `mobile/src/hooks/useGenerateAllNarration.ts`, `mobile/src/lib/lessonToNarratableText.ts` (pure helper), (maybe) `mobile/src/hooks/useOpenAiNarrationKey.ts`.
- **Modify:** `app/book/topic/[bookId]/[topicId].tsx` (mount NarrationPanel), the generate-all surface (`app/book/generate/[id].tsx` or book home) for the "Generate all narration" action, `mobile/src/storage/bookBundle.ts` (audio export+import), `mobile/src/storage/mediaStore.ts` (add `deleteAudio`), Help content files.
- **Reuse unchanged:** `generateAndStoreTopicAudio`, `attachAudio`, `AudioNarrationPlayer`, `useMakeAudio`'s guard shape, `useGenerateAll`'s hook shape, `resolveAudioDataUrls`.

## Non-goals

- **No new backend/TTS/compiler work** — `/derivatives/audio`, the TTS engine, and the compiler bake are shipped.
- **No durable backend narration job** — generate-all is client-side per-topic (decision: independent sync calls, per-topic persist, resumable).
- **No managed-audio enablement** — managed remains dormant; this ships BYOK-OpenAI. Turning managed on (a plan carrying openai + caps) is a separate ops decision.
- **No new voices/tone UI beyond what `/derivatives/audio` already accepts** — expose tone/voice only if trivially passthrough; otherwise defaults.
- **No video / A-V** — deferred (ffmpeg).
- **No re-narration diffing** — regenerating adds a new clip (up to the cap) or replaces per the panel's delete+generate; no "content changed, audio stale" tracking in this slice.

## Testing

- **NarrationPanel:** generate → calls `generateAndStoreTopicAudio` with `source_text` + resolved key + provider "openai", persists the returned book, calls `onBookChange`; a not-Pro user with no key is blocked with the key hint (no call); at `MAX_AUDIO_PER_TOPIC` the button disables; delete removes a clip + persists; `busy` disables during the call; errors surface via alert. (RNTL + mocked `audioGenerate`/`mediaStore`/`saveBook`/key source.)
- **useGenerateAllNarration:** iterates content-bearing topics; skips `alreadyDone`/already-has-audio; persists per success via `onBookChange`; a per-topic failure marks `failed` and continues; `progress`/counts/`finished` correct; `cancel()` stops further topics; resumable (second run only fills gaps). Mock `generateAndStoreTopicAudio`.
- **Key discipline:** the key is read via `getApiKey` at call time, never stored in state; a keyless (Pro/loading) run omits `api_key`. Assert no key value in any rendered prop/log.
- **bookBundle audio round-trip:** a book with a topic carrying audio → `buildBookBundle` includes `media/<basename>` + rewrites the ref; `parseBookBundle` restores the clip under a fresh id/path (re-minted, not the bundle's), validates mime/size, drops a missing/oversize/disallowed clip with a warning, and an audio-less book stays byte-identical (existing image tests still green). A crafted bundle with a path-traversal audio `file`/`id` cannot escape the media dir.
- **Help:** coverage + tree gates pass for `narrate-topic` (+ `generate-all-narration` if added).
- **Device-verify (per `mobile:verify`, native, not CI):** with a signed-in build + an OpenAI BYOK key, open a topic with content, tap "Generate narration", confirm a clip appears + plays (rung-3 playback), then run "Generate all narration" over a small book and confirm per-topic progress + resume-skip; export the book to `.book.zip`, re-import, confirm the audio survives.

## Rollout

Mobile-only (no backend, no migration, no compiler). Web deploy + APK. Rung 4 completes ADR-040's audio arc (author → library → reader → export). Video/A-V remains deferred.
