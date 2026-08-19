# Library Audio Rung 2 — book.json audio + compiler bake — Design Spec

**Status:** Proposed · **Date:** 2026-08-18 · **Area:** `mobile/src/types`, `mobile/src/storage`, `mobile/src/lib`, `mobile/src/api`, `compiler/src` · **Implements:** ADR-040 rung 2 · **Reuses:** P1-5 P4 audio engine

## Why

ADR-040 decides audio becomes library-carried + reader-rendered by staged extension. Rung 1 (the P4 Share derivative) shipped the TTS engine + player. **Rung 2** makes audio *travel inside a book*: a topic can carry a narration audio ref, the bytes live in the book's media dir (exactly like attached images), and the **compiler bakes the audio into the exported EPUB3 artifact**. No in-app reader playback yet (rung 3); no authoring UI yet (rung 4). The bar: **export a book → the .epub contains the mp3 + a manifest item + an `<audio>` in the chapter XHTML** (playable in any EPUB3 reader).

## Decisions (locked with the user)

- **D1 — Audio rides as a ref, bytes in the media dir** — the image precedent exactly (`TopicImage`/`mediaStore`). `book.json` never carries audio bytes.
- **D2 — Include the generate-persist plumbing** — a `generateAndStoreTopicAudio(...)` client fn that calls the shipped `/api/v1/derivatives/audio`, writes the returned bytes into the media dir, and adds the `TopicAudio` ref. No UI (the button that calls it is rung 4). This makes audio-in-book real end to end, testable now.
- **D3 — Compiler needs NO new type field.** Verified: images reach the compiler as inline `data:` URIs in the compile payload (`mobile/src/lib/compilePayload.ts` `resolveFigureDataUrls` → `renderFiguresHtml`), and `compiler/src/epub.ts` `packImages` extracts `src="data:image/…"` from the XHTML. Audio follows the identical path — no field on `compiler/src/types.ts`.
- **D4 — Rung-2 verification = the exported EPUB carries playable audio.** In-app reader playback is rung 3.

## Architecture

### 1. Schema (mobile) — `TopicAudio` ref, mirroring `TopicImage`
`mobile/src/types/book.ts`:
```ts
export interface TopicAudio {
  id: string;
  file: string;      // device-relative: "media/<bookId>/<id>.mp3" — REF, not bytes
  mime: string;      // "audio/mpeg"
  title?: string;    // narration title (from generate_narration)
  transcript?: string; // the narration script — a11y + search (cheap: engine already returns it)
  durationMs?: number; // optional, if cheaply known
}
```
Add `audio?: TopicAudio[]` to `GeneratedTopic` (`book.ts:~201`, next to `images?`). **No change to `compiler/src/types.ts`** (D3).

### 2. Storage (mobile) — `mediaStore` audio siblings
`mobile/src/storage/mediaStore.ts` (the store images use):
- `attachAudio(bookId, topicId, srcUri, mime, meta?) : Promise<TopicAudio>` — mirror `attachImage`: enforce a `audio/mpeg` MIME allowlist + a size cap (`MediaCapError`; audio cap larger than the image cap — a narration clip is ~0.5–2 MB), copy into `media/<bookId>/<freshUuid>.mp3` via `FileSystem.copyAsync`, push a `TopicAudio` ref onto `gen.audio`. (No EXIF strip — N/A for audio.)
- `resolveAudioUris(topic) : Promise<Map<id, string>>` — mirror `resolveFigureDataUrls`, but resolve to the appropriate form per caller: a **`file://` path** for native playback (rung 3), and a **`data:` URI** for the compile payload (rung 2 needs data: for the compiler). Provide both (e.g. `resolveAudioFileUris` → file://, `resolveAudioDataUrls` → data:) or one fn + a flag — keep it explicit.
- Extend the media lifecycle: `bookMediaBytes`/`pruneOrphanMedia`/`deleteBookMedia` must count/prune/delete audio files too (grep every place that iterates `images` for media cleanup and add `audio`).

### 3. Generate-persist plumbing (mobile) — reuse the P4 endpoint
`mobile/src/lib/` (or `mobile/src/api/`): `generateAndStoreTopicAudio({ bookId, topicId, source_text|topic_version_id, provider_id, apiKey, voice?, tone? }) : Promise<TopicAudio>`:
1. call the shipped `makeAudio` client (`mobile/src/api/derivativesClient.ts`) → `{ audio_base64, mime, title, script }`.
2. write the base64 to a temp file, `attachAudio(...)` it into the media dir (carrying `title` + `transcript: script`).
3. return the ref (caller persists the updated book).
No UI. Fail-open on the write (surface a clear error; never corrupt the book). Uses the P4 managed/BYOK posture unchanged (BYOK-OpenAI live, managed dormant).

### 4. Compile payload (mobile) — emit `<audio>` like figures
`mobile/src/lib/compilePayload.ts` (which today resolves figure data URLs) + a `renderAudioHtml(audio, dataUrls)` sibling to `mobile/src/lib/figuresHtml.ts` `renderFiguresHtml`:
- resolve `topic.audio` → `data:audio/mpeg;base64,…` (via `resolveAudioDataUrls`), emit `<figure class="topic-audio"><audio controls src="data:…"></audio><figcaption>…</figcaption></figure>` into the compiled topic HTML — **data: URI only** (matches the local-only invariant + what `packImages` consumes).
- Gate on `topic.audio?.length && audioDataUrls?.size`, mirroring the figures gate in `topicHtml.ts:140`.

### 5. Compiler — `packAudio` + EPUB3 audio manifest
`compiler/src/epub.ts`:
- `MEDIA_EXT` (`:97`): add `"audio/mpeg": "mp3"`.
- `packAudio(xhtml, audios, seen)` — sibling to `packImages` (`:110`): scan `src="data:audio/[type];base64,…"`, extract bytes into `OEBPS/audio/aud-NNN.mp3`, rewrite `src` to `../audio/aud-NNN.mp3`, dedupe identical clips. (Or generalize `packImages` to a `packMedia(dir, mimePrefix)` used for both — implementer's call; do NOT duplicate the whole regex/extract block if a small generalization is clean.)
- zip write: write the audio bytes to `OEBPS/audio/…` (mirror the `for img of images` loop at `:291`).
- `buildOpf` (`:439`): add `<item id="aud-NNN" href="audio/aud-NNN.mp3" media-type="audio/mpeg"/>` for each packed clip (mirror the image manifest items at `:466`).
- The `<audio controls>` element itself is already in the chapter XHTML (from the compile payload, step 4) with its `src` rewritten to the packaged path — so the exported EPUB has a real, playable `<audio>`. EPUB3 permits audio; no reader/nav change.
- **Default (non-audio) output byte-unchanged** — a book with no `audio` refs compiles identically (the new pack step is a no-op when the XHTML has no `data:audio`).

## Non-goals (rung 2)

- No in-app reader audio playback (rung 3 — `topicHtml.ts` `<audio>` emit + the native expo-audio-over-WebView player).
- No authoring UI / narrate-this-topic button / generate-all (rung 4).
- No cross-device audio sync (the hardest open question, ADR-040 §Open — device-local only here).
- No new managed audio provisioning (BYOK-first, managed dormant — unchanged from P4).
- No PDF/DOCX audio (EPUB only; audio has no place in a paged PDF).

## Testing

- **Schema/storage:** `attachAudio` enforces the mime allowlist + size cap (`MediaCapError` on oversize/wrong-type), copies to `media/<bookId>/`, adds the ref; `resolveAudioDataUrls`/`resolveAudioFileUris` return the right form; `deleteBookMedia`/`pruneOrphanMedia` remove audio files (no orphan/leak).
- **Generate-persist:** `generateAndStoreTopicAudio` calls `makeAudio`, stores the bytes, returns a ref carrying `transcript`; fail-open on write error (book not corrupted). Mock the client + `expo-file-system`.
- **Compile payload:** `renderAudioHtml` emits `<audio controls src="data:…">` only for topics with audio refs + resolved data URLs; a topic without audio emits nothing (default unchanged).
- **Compiler:** `packAudio` extracts `data:audio/mpeg` from XHTML → `OEBPS/audio/*.mp3` + rewrites src + adds an `audio/mpeg` manifest item; identical clips deduped; a book with NO audio compiles byte-identically to before (regression).
- **Real-run (the rung-2 bar):** an in-container / local `--format epub` compile of a fixture book carrying one `data:audio/mpeg` clip → unzip the .epub and assert `OEBPS/audio/aud-001.mp3` exists (valid MP3 magic `ID3`/`FF FB`), the OPF has the `audio/mpeg` item, and a chapter XHTML has `<audio controls src="../audio/aud-001.mp3">`. (Mirrors the KDP/pack real-render verification discipline — mocked tests can't prove the packaged artifact.)

## Rollout

Compiler + mobile only (no backend change — the `/audio` endpoint already exists; no migration). Web deploy + backend ROOT refresh (the compiler layer in the api image gains `packAudio` — used by server-side compiles) + APK. Audio-in-book is **device-local + export-only** at this rung; it becomes app-playable at rung 3.
