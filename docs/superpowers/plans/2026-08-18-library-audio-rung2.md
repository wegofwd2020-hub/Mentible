# Library Audio Rung 2 — book.json audio + compiler bake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a topic's narration audio travel *inside* a book — a `TopicAudio` ref in `book.json`, bytes in the device media dir (exactly like attached images), and the compiler bakes the clip into the exported EPUB3 artifact (packaged `.mp3` + OPF manifest item + a real `<audio>` in the chapter XHTML).

**Architecture:** Mirror the image media-attach pattern one media type wider, in the same four places images already touch: (1) `mobile/src/types/book.ts` gets a `TopicAudio` ref type alongside `TopicImage`; (2) `mobile/src/storage/mediaStore.ts` gets `attachAudio`/`resolveAudioDataUrls`/`resolveAudioFileUris` siblings to the image functions, and the existing media-lifecycle functions (`bookMediaBytes`, `pruneOrphanMedia`) are extended to count/prune audio too; (3) `mobile/src/lib/compilePayload.ts` (+ a new `renderAudioHtml` in `mobile/src/lib/figuresHtml.ts`) emits a `data:audio/mpeg;base64,…` `<audio controls>` into the compiled topic's lesson HTML, gated on the topic actually carrying resolved audio; (4) `compiler/src/epub.ts` extracts that `data:audio/…` out of the chapter XHTML into a packaged `OEBPS/audio/*.mp3` resource + an `audio/mpeg` OPF manifest item, via a generalized `packMedia` helper shared with the existing `packImages`. A fourth, independent piece — `mobile/src/lib/audioGenerate.ts` `generateAndStoreTopicAudio` — calls the already-shipped `/api/v1/derivatives/audio` endpoint and persists its output through `attachAudio`, so audio-in-book is provably real end to end even with no authoring UI yet. Tasks run T1 → T2 → T3 in that order (each depends on T1's schema); T4 depends only on T1 and can run any time after it.

**Tech Stack:** React Native + Expo (TypeScript) mobile app; `expo-file-system` for device storage; the Node/TypeScript EPUB3 compiler (`compiler/src`, `marked` for markdown→HTML, `jszip` for packaging); Jest for both mobile and compiler test suites; the existing FastAPI `/api/v1/derivatives/audio` endpoint (no backend change in this plan).

**Spec:** `docs/superpowers/specs/2026-08-18-library-audio-rung2-schema-compiler-design.md` (rung 2 of ADR-040, `docs/adr/ADR-040-library-carried-reader-rendered-audio.md`)

## Global Constraints

- **D1 — Audio rides as a ref, bytes in the media dir.** The image precedent exactly (`TopicImage`/`mediaStore`). `book.json` never carries audio bytes.
- **D2 — Include the generate-persist plumbing.** A `generateAndStoreTopicAudio(...)` client fn calls the shipped `/api/v1/derivatives/audio`, writes the returned bytes into the media dir, and adds the `TopicAudio` ref. No UI (the button that calls it is rung 4).
- **D3 — Compiler needs NO new type field.** No change to `compiler/src/types.ts`. Audio reaches the compiler as inline `data:` URIs in the compile payload, exactly like images, extracted by the compiler's pack step.
- **D4 — Rung-2 verification = the exported EPUB carries playable audio.** In-app reader playback is rung 3 (out of scope here).
- **Default (non-audio) EPUB output MUST be byte-unchanged.** Every audio behavior is gated on the presence of audio refs / `data:audio` in the XHTML.
- **No backend change.** The `/api/v1/derivatives/audio` endpoint already exists (P4); this plan only adds a client that calls it and persists the result.
- **Non-goals (do not build in this plan):** no in-app reader audio playback (rung 3 — `topicHtml.ts`/`figuresHtml.ts` reader-side `<audio>` emit + the native `expo-audio`-over-WebView player); no authoring UI / "narrate this topic" button / generate-all (rung 4); no cross-device audio sync; no new managed audio provisioning (BYOK-first, managed dormant — unchanged from P4); no PDF/DOCX audio (EPUB only).
- **No user-facing feature ships in this plan** (per the non-goals above — schema/storage/compiler plumbing only, no button or screen). The CLAUDE.md Definition-of-Done Help-coverage gate (`mobile/__tests__/help/coverage.test.ts`, `FEATURES` in `mobile/src/help-content/features.ts` + a matching topic) therefore does **not** apply to this plan — there is no new `FEATURES` key to declare. Help documentation lands with rung 4's UI.
- **BYOK-first / managed-dormant posture is unchanged** from the P4 audio derivative — `generateAndStoreTopicAudio` passes `api_key` through when present and omits it (never sends `""`) for a keyless managed-plan call, exactly like `useMakeAudio`.
- **Reuse `FileSystem` conventions the image path already uses**: `expo-file-system` `copyAsync`/`writeAsStringAsync`/`getInfoAsync`/`deleteAsync`, `FileSystem.cacheDirectory` for temp files (mirrors `mobile/src/storage/bookBundle.ts` `writeImportedMedia` and `mobile/src/components/AudioNarrationPlayer.tsx`). Mock `expo-file-system` in Jest the same way `mobile/__tests__/storage/mediaStore.test.ts` does (an in-memory `files` map keyed by URI).
- **No EXIF strip for audio** — that step is image-only (`ImageManipulator`); `attachAudio` copies bytes directly, no re-encode.

---

## Task 1: Schema + mediaStore audio (`TopicAudio`, `attachAudio`, resolve fns, lifecycle)

**Files:**
- Modify: `mobile/src/types/book.ts:178` (insert `TopicAudio` right after the closing brace of `TopicImage`, which ends at line 178) and `mobile/src/types/book.ts:201` (add `audio?: TopicAudio[];` next to `images?: TopicImage[];` inside `GeneratedTopic`)
- Modify: `mobile/src/storage/mediaPaths.ts` (add audio MIME/size/count constants + helpers, sibling to the existing image ones)
- Modify: `mobile/src/storage/mediaStore.ts` (add `PickedAudio`, `AttachAudioMeta`, `attachAudio`, `resolveAudioDataUrls`, `resolveAudioFileUris`; extend `bookMediaBytes` and `pruneOrphanMedia` to include audio)
- Test: `mobile/__tests__/storage/mediaStore.test.ts` (extend the existing file — new imports + a new `describe("mediaStore audio")` block)

**Interfaces:**
- Consumes: nothing new from other tasks (this is the foundation task).
- Produces (for T2/T3/T4):
  - `TopicAudio` (`mobile/src/types/book.ts`): `{ id: string; file: string; mime: string; title?: string; transcript?: string; durationMs?: number }`
  - `GeneratedTopic.audio?: TopicAudio[]`
  - `attachAudio(book: Book, topicId: string, src: PickedAudio, meta?: AttachAudioMeta): Promise<Book>` where `PickedAudio = { uri: string; mime: string; fileSize?: number }` and `AttachAudioMeta = { title?: string; transcript?: string; durationMs?: number }`
  - `resolveAudioDataUrls(topic: GeneratedTopic): Promise<Map<string, string>>` — id → `data:audio/mpeg;base64,…`
  - `resolveAudioFileUris(topic: GeneratedTopic): Promise<Map<string, string>>` — id → `file://…` absolute path (existing files only)
  - `MediaCapError` (already exported, reused for audio caps too)

- [ ] **Step 1: Write the failing tests**

Append to `mobile/__tests__/storage/mediaStore.test.ts` — first extend the top-of-file import block:

```ts
import {
  attachImage, deleteImage, resolveFigureDataUrls, pruneOrphanMedia, MediaCapError,
  attachAudio, resolveAudioDataUrls, resolveAudioFileUris,
} from "@/storage/mediaStore";
import {
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC, MAX_MEDIA_PER_BOOK_BYTES,
  MAX_AUDIO_BYTES, MAX_AUDIO_PER_TOPIC,
} from "@/storage/mediaPaths";
```

and add a `fakeAudio` helper next to `fakeImage`:

```ts
function fakeAudio(id: string, file: string): TopicAudio {
  return { id, file, mime: "audio/mpeg" };
}
```

(add `TopicAudio` to the existing `import type { Book, TopicImage } from "@/types/book";` line so it reads `import type { Book, TopicAudio, TopicImage } from "@/types/book";`).

Then append this block at the end of the file (after the closing `});` of `describe("mediaStore", ...)`):

```ts
describe("mediaStore audio", () => {
  it("attaches audio: writes a ref, bytes stay off the book", async () => {
    const book = await attachAudio(
      bookWithTopic(), "t1",
      { uri: "file:///gen.mp3", mime: "audio/mpeg", fileSize: 2000 },
      { title: "Intro", transcript: "Hello there." },
    );
    const clips = book.content!.t1.audio!;
    expect(clips).toHaveLength(1);
    expect(clips[0].file).toMatch(/^media\/bk1\/.+\.mp3$/);
    expect(clips[0].title).toBe("Intro");
    expect(clips[0].transcript).toBe("Hello there.");
    expect(JSON.stringify(book)).not.toContain("data:"); // refs only
  });

  it("rejects a disallowed mime", async () => {
    await expect(
      attachAudio(bookWithTopic(), "t1", { uri: "file:///a.wav", mime: "audio/wav" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects an oversize clip (fileSize present, early-out)", async () => {
    await expect(
      attachAudio(bookWithTopic(), "t1", { uri: "file:///big.mp3", mime: "audio/mpeg", fileSize: MAX_AUDIO_BYTES + 1 }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects an oversize clip by real on-disk size when fileSize is undefined", async () => {
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => {
      if (p === "file:///big2.mp3") return { exists: true, size: MAX_AUDIO_BYTES + 1 };
      return { exists: false, size: 0 };
    });
    await expect(
      attachAudio(bookWithTopic(), "t1", { uri: "file:///big2.mp3", mime: "audio/mpeg" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects attaching to a topic already at MAX_AUDIO_PER_TOPIC", async () => {
    const book = bookWithTopic();
    book.content!.t1.audio = Array.from({ length: MAX_AUDIO_PER_TOPIC }, (_, i) =>
      fakeAudio(`aud${i}`, `media/bk1/aud${i}.mp3`),
    );
    await expect(
      attachAudio(book, "t1", { uri: "file:///one-more.mp3", mime: "audio/mpeg" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects when the real on-disk size would push the book over its shared media budget", async () => {
    const book = bookWithTopic();
    book.content!.t1.audio = [fakeAudio("existing", "media/bk1/existing.mp3")];
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => {
      if (p.endsWith("existing.mp3")) return { exists: true, size: MAX_MEDIA_PER_BOOK_BYTES - 100 };
      if (p === "file:///new.mp3") return { exists: true, size: 200 };
      return { exists: false, size: 0 };
    });
    await expect(
      attachAudio(book, "t1", { uri: "file:///new.mp3", mime: "audio/mpeg" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("resolves refs to data: URLs", async () => {
    const book = await attachAudio(bookWithTopic(), "t1", { uri: "file:///gen.mp3", mime: "audio/mpeg", fileSize: 10 });
    const map = await resolveAudioDataUrls(book.content!.t1);
    const url = [...map.values()][0];
    expect(url).toMatch(/^data:audio\/mpeg;base64,/);
  });

  it("resolveAudioDataUrls skips a missing file without throwing", async () => {
    const gen = {
      topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x",
      audio: [fakeAudio("present", "media/bk1/present.mp3"), fakeAudio("missing", "media/bk1/missing.mp3")],
    };
    (FileSystem.readAsStringAsync as jest.Mock).mockImplementation(async (p: string) => {
      if (p.endsWith("missing.mp3")) throw new Error("ENOENT");
      return "QUJD";
    });
    const map = await resolveAudioDataUrls(gen as any);
    expect(map.has("present")).toBe(true);
    expect(map.has("missing")).toBe(false);
  });

  it("resolveAudioFileUris returns an absolute file:// path per existing clip, skipping missing ones", async () => {
    const gen = {
      topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x",
      audio: [fakeAudio("present", "media/bk1/present.mp3"), fakeAudio("missing", "media/bk1/missing.mp3")],
    };
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => ({
      exists: p.endsWith("present.mp3"), size: 10, uri: p,
    }));
    const map = await resolveAudioFileUris(gen as any);
    expect(map.get("present")).toBe("file:///doc/media/bk1/present.mp3");
    expect(map.has("missing")).toBe(false);
  });

  it("bookMediaBytes / pruneOrphanMedia count and prune BOTH images and audio", async () => {
    const book = bookWithTopic();
    book.content!.t1.images = [fakeImage("keptimg", "media/bk1/keptimg.jpg")];
    book.content!.t1.audio = [fakeAudio("keptaud", "media/bk1/keptaud.mp3")];
    (FileSystem.getInfoAsync as jest.Mock).mockImplementation(async (p: string) => ({ exists: true, size: 1234, uri: p }));
    (FileSystem as any).__files["file:///doc/media/bk1/keptimg.jpg"] = "COPIED";
    (FileSystem as any).__files["file:///doc/media/bk1/keptaud.mp3"] = "COPIED";
    (FileSystem as any).__files["file:///doc/media/bk1/orphan.mp3"] = "COPIED";

    await pruneOrphanMedia(book);

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(
      expect.stringContaining("orphan.mp3"), expect.anything(),
    );
    expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("keptimg.jpg"), expect.anything(),
    );
    expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("keptaud.mp3"), expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest mediaStore -t "mediaStore audio"`
Expected: FAIL — `attachAudio`, `resolveAudioDataUrls`, `resolveAudioFileUris`, `MAX_AUDIO_BYTES`, `MAX_AUDIO_PER_TOPIC`, `TopicAudio` are not exported yet (module resolution / TS errors).

- [ ] **Step 3: Add the `TopicAudio` type + `GeneratedTopic.audio` field**

In `mobile/src/types/book.ts`, insert immediately after the `TopicImage` interface (which currently ends at line 178 with the closing `}`):

```ts
// An audio narration clip attached to a topic (ADR-040 rung 2). Ref only:
// bytes live on device at `media/<bookId>/<id>.mp3` (see mediaStore); they are
// never stored in this JSON. Mirrors TopicImage exactly. `title`/`transcript`
// come free from the P4 narration engine (generate_narration's {title,script})
// when the clip was produced by generateAndStoreTopicAudio — both optional so
// a hand-attached clip (future authoring path) can omit them.
export interface TopicAudio {
  id: string; // randomUUID (@/lib/uuid)
  file: string; // device-relative, e.g. "media/<bookId>/<id>.mp3"
  mime: string; // "audio/mpeg" (the only format the P4 TTS engine produces today)
  title?: string; // narration title, from generate_narration
  transcript?: string; // the narration script — a11y + search; cheap, the engine already returns it
  durationMs?: number; // optional, if cheaply known
}
```

Then change line 201 (inside `GeneratedTopic`) from:

```ts
  // Author-attached images for this topic (ordered = render order). Refs only.
  images?: TopicImage[];
}
```

to:

```ts
  // Author-attached images for this topic (ordered = render order). Refs only.
  images?: TopicImage[];
  // Narration audio clips for this topic (ADR-040 rung 2). Ordered; refs only.
  audio?: TopicAudio[];
}
```

- [ ] **Step 4: Add audio constants + MIME helpers to `mediaPaths.ts`**

Append to `mobile/src/storage/mediaPaths.ts` (after the existing `absPath` function):

```ts
export const AUDIO_MIME_ALLOWLIST = ["audio/mpeg"] as const;
export type AllowedAudioMime = (typeof AUDIO_MIME_ALLOWLIST)[number];

const AUDIO_MIME_EXT: Record<string, string> = {
  "audio/mpeg": "mp3",
};

// A P4 narration clip runs ~60–90s (generate_narration's bound) — well under
// 1-2 MB at typical MP3 bitrates. The cap is set larger than MAX_IMAGE_BYTES
// (10 MB) to leave real headroom for longer clips without acting as a de
// facto duration limit; it shares the book-wide MAX_MEDIA_PER_BOOK_BYTES
// budget with images (bookMediaBytes counts both).
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_PER_TOPIC = 5;

export function extForAudioMime(mime: string): string | null {
  return AUDIO_MIME_EXT[mime] ?? null;
}

export function isAllowedAudioMime(mime: string): mime is AllowedAudioMime {
  return (AUDIO_MIME_ALLOWLIST as readonly string[]).includes(mime);
}
```

- [ ] **Step 5: Add `attachAudio` + resolve fns + lifecycle extension to `mediaStore.ts`**

In `mobile/src/storage/mediaStore.ts`, change the top-of-file imports from:

```ts
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { Book, GeneratedTopic, TopicImage } from "@/types/book";
import { randomUUID } from "@/lib/uuid";
import {
  absPath, extForMime, isAllowedMime, mediaDirRel, mediaFileRel,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC, MAX_MEDIA_PER_BOOK_BYTES,
} from "@/storage/mediaPaths";
```

to:

```ts
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { Book, GeneratedTopic, TopicAudio, TopicImage } from "@/types/book";
import { randomUUID } from "@/lib/uuid";
import {
  absPath, extForMime, extForAudioMime, isAllowedMime, isAllowedAudioMime,
  mediaDirRel, mediaFileRel,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC, MAX_MEDIA_PER_BOOK_BYTES,
  MAX_AUDIO_BYTES, MAX_AUDIO_PER_TOPIC,
} from "@/storage/mediaPaths";
```

Add `PickedAudio`/`AttachAudioMeta` types and a `topicAudio` helper next to the existing `topicImages` helper:

```ts
export type PickedAudio = { uri: string; mime: string; fileSize?: number };

export interface AttachAudioMeta {
  title?: string;
  transcript?: string;
  durationMs?: number;
}

function topicImages(book: Book, topicId: string): TopicImage[] {
  return book.content?.[topicId]?.images ?? [];
}

function topicAudio(book: Book, topicId: string): TopicAudio[] {
  return book.content?.[topicId]?.audio ?? [];
}
```

Replace `bookMediaBytes` with a version that also sums audio bytes:

```ts
async function bookMediaBytes(book: Book): Promise<number> {
  let total = 0;
  for (const gen of Object.values(book.content ?? {})) {
    for (const img of gen.images ?? []) {
      const info = await FileSystem.getInfoAsync(absPath(img.file));
      if (info.exists && typeof info.size === "number") total += info.size;
    }
    for (const aud of gen.audio ?? []) {
      const info = await FileSystem.getInfoAsync(absPath(aud.file));
      if (info.exists && typeof info.size === "number") total += info.size;
    }
  }
  return total;
}
```

Add `attachAudio` right after `attachImage` (before `deleteImage`):

```ts
/**
 * Copy a generated/picked audio clip into the book's media dir and append a
 * ref. Mirrors attachImage's cap-and-copy shape, minus the EXIF-strip step
 * (N/A for audio — the file is copied byte-for-byte).
 */
export async function attachAudio(
  book: Book,
  topicId: string,
  src: PickedAudio,
  meta: AttachAudioMeta = {},
): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen) throw new MediaCapError("Add content to this topic before attaching narration.");
  if (!isAllowedAudioMime(src.mime)) throw new MediaCapError("Only MP3 audio is supported.");
  if (topicAudio(book, topicId).length >= MAX_AUDIO_PER_TOPIC) {
    throw new MediaCapError(`A topic can hold at most ${MAX_AUDIO_PER_TOPIC} narration clips.`);
  }
  // Cheap early-out on a known-oversize source; the real cap enforcement below
  // is against the file's actual on-disk size (fileSize is optional/may lie).
  if (typeof src.fileSize === "number" && src.fileSize > MAX_AUDIO_BYTES) {
    throw new MediaCapError("That audio clip is too large (max 15 MB).");
  }

  const info = await FileSystem.getInfoAsync(src.uri);
  const bytes = info.exists && typeof info.size === "number" ? info.size : (src.fileSize ?? 0);
  if (bytes > MAX_AUDIO_BYTES) {
    throw new MediaCapError("That audio clip is too large (max 15 MB).");
  }
  if ((await bookMediaBytes(book)) + bytes > MAX_MEDIA_PER_BOOK_BYTES) {
    throw new MediaCapError("This book has reached its media storage limit.");
  }

  const ext = extForAudioMime(src.mime)!;
  const id = randomUUID();
  const rel = mediaFileRel(book.id, id, ext);
  await FileSystem.makeDirectoryAsync(absPath(mediaDirRel(book.id)), { intermediates: true });
  await FileSystem.copyAsync({ from: src.uri, to: absPath(rel) });

  const audio: TopicAudio = {
    id, file: rel, mime: src.mime,
    title: meta.title, transcript: meta.transcript, durationMs: meta.durationMs,
  };
  const nextGen: GeneratedTopic = { ...gen, audio: [...(gen.audio ?? []), audio] };
  return { ...book, content: { ...book.content, [topicId]: nextGen }, updatedAt: new Date().toISOString() };
}
```

Add `resolveAudioDataUrls` + `resolveAudioFileUris` right after `resolveFigureDataUrls`:

```ts
/** Read each of a topic's audio clips into a data: URL keyed by audio id (for the compile payload). */
export async function resolveAudioDataUrls(topic: GeneratedTopic): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const aud of topic.audio ?? []) {
    try {
      const b64 = await FileSystem.readAsStringAsync(absPath(aud.file), {
        encoding: FileSystem.EncodingType.Base64,
      });
      out.set(aud.id, `data:${aud.mime};base64,${b64}`);
    } catch {
      // Missing file → skip (compile payload omits that clip).
    }
  }
  return out;
}

/**
 * Resolve each of a topic's audio clips to an absolute file:// URI keyed by
 * audio id, for native playback. Not consumed until rung 3 (the WebView-
 * external expo-audio player) — provided now so that surface has no schema
 * work left to do when it lands.
 */
export async function resolveAudioFileUris(topic: GeneratedTopic): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const aud of topic.audio ?? []) {
    const abs = absPath(aud.file);
    const info = await FileSystem.getInfoAsync(abs);
    if (info.exists) out.set(aud.id, abs);
  }
  return out;
}
```

Extend `pruneOrphanMedia` to also protect referenced audio files (change the `referenced` loop):

```ts
export async function pruneOrphanMedia(book: Book): Promise<void> {
  const dir = absPath(mediaDirRel(book.id));
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const referenced = new Set<string>();
  for (const gen of Object.values(book.content ?? {})) {
    for (const img of gen.images ?? []) referenced.add(img.file.split("/").pop()!);
    for (const aud of gen.audio ?? []) referenced.add(aud.file.split("/").pop()!);
  }
  const names = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(
    names.filter((n) => !referenced.has(n)).map((n) =>
      FileSystem.deleteAsync(`${dir}/${n}`, { idempotent: true }).catch(() => {}),
    ),
  );
}
```

`deleteBookMedia` needs **no code change**: it already deletes the whole `media/<bookId>/` directory (`mobile/src/storage/mediaStore.ts:128-130`), and audio bytes land in that same per-book directory — so it is audio-inclusive by construction. Add a one-line comment above it recording that fact:

```ts
// Deletes the whole media/<bookId>/ dir — already audio-inclusive by
// construction (attachAudio writes into the same directory attachImage does).
export async function deleteBookMedia(bookId: string): Promise<void> {
  await FileSystem.deleteAsync(absPath(mediaDirRel(bookId)), { idempotent: true }).catch(() => {});
}
```

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `cd mobile && npx tsc --noEmit && npx jest mediaStore`
Expected: PASS — all `mediaStore` tests (existing image ones + new audio ones) green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/types/book.ts mobile/src/storage/mediaPaths.ts mobile/src/storage/mediaStore.ts mobile/__tests__/storage/mediaStore.test.ts
git commit -m "feat(mobile): TopicAudio schema + mediaStore attachAudio/resolve (rung 2 T1)"
```

---

## Task 2: Compile payload emits `<audio>` for a topic's audio refs

**Files:**
- Modify: `mobile/src/lib/figuresHtml.ts` (add `renderAudioHtml`)
- Modify: `mobile/src/lib/compilePayload.ts` (resolve `topic.audio` and append a "Narration" section)
- Test: `mobile/__tests__/lib/figuresHtml.test.ts` (extend), `mobile/__tests__/lib/compilePayload.test.ts` (extend)

**Interfaces:**
- Consumes: `TopicAudio` (T1, `@/types/book`), `resolveAudioDataUrls` (T1, `@/storage/mediaStore`)
- Produces (for T3, indirectly — this is what T3's compiler consumes as input): `renderAudioHtml(audio: TopicAudio[], dataUrls: Map<string, string>): string` emitting `<figure class="topic-audio"><audio controls src="data:audio/mpeg;base64,…"></audio><figcaption>…</figcaption></figure>` per resolved clip; `buildCompilePayload` appends a `{ heading: "Narration", body_markdown: <that html> }` `LessonSection` to a topic's `lesson.sections` when the topic has resolved audio.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/__tests__/lib/figuresHtml.test.ts` (add `TopicAudio` to the existing `import type { Book, TopicImage } from "@/types/book";` line, add `renderAudioHtml` to the `import { countBookFigures, renderFiguresHtml } from "@/lib/figuresHtml";` line, and append this new describe block at the end of the file):

```ts
const aud = (id: string, title?: string): TopicAudio => ({
  id, file: `media/b/${id}.mp3`, mime: "audio/mpeg", title,
});

describe("renderAudioHtml", () => {
  it("returns empty string when no clips resolve", () => {
    expect(renderAudioHtml([], new Map())).toBe("");
    expect(renderAudioHtml([aud("a")], new Map())).toBe(""); // no dataUrl → skipped
  });
  it("emits a figure per resolved clip with an <audio controls> and escaped title", () => {
    const urls = new Map([["a", "data:audio/mpeg;base64,AAAA"]]);
    const html = renderAudioHtml([aud("a", "Intro <b>Narration</b>")], urls);
    expect(html).toContain('<figure class="topic-audio">');
    expect(html).toContain('<audio controls src="data:audio/mpeg;base64,AAAA"></audio>');
    expect(html).toContain("Intro &lt;b&gt;Narration&lt;/b&gt;");
    expect(html).not.toContain("<b>Narration</b>");
  });
  it("falls back to 'Narration' when the clip has no title", () => {
    const urls = new Map([["a", "data:audio/mpeg;base64,AAAA"]]);
    const html = renderAudioHtml([aud("a")], urls);
    expect(html).toContain("<figcaption>Narration</figcaption>");
  });
});
```

Append to `mobile/__tests__/lib/compilePayload.test.ts` — first widen the top-of-file mock from:

```ts
jest.mock("@/storage/mediaStore", () => ({
  resolveFigureDataUrls: jest.fn(async (t: any) =>
    new Map((t.images ?? []).map((i: any) => [i.id, `data:${i.mime};base64,ZZ`])),
  ),
}));
```

to:

```ts
jest.mock("@/storage/mediaStore", () => ({
  resolveFigureDataUrls: jest.fn(async (t: any) =>
    new Map((t.images ?? []).map((i: any) => [i.id, `data:${i.mime};base64,ZZ`])),
  ),
  resolveAudioDataUrls: jest.fn(async (t: any) =>
    new Map((t.audio ?? []).map((a: any) => [a.id, `data:${a.mime};base64,AA`])),
  ),
}));
```

then append this describe block at the end of the file:

```ts
describe("buildCompilePayload — audio", () => {
  it("appends a Narration section with an <audio> element; stored book untouched", async () => {
    const book = bookWithTopic({
      content: {
        t1: {
          topicId: "t1", title: "U", generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "Intro" }],
        },
      },
    });
    const payload = await buildCompilePayload(book);
    const secs = payload.content!.t1.lesson.sections;
    expect(secs.at(-1)!.heading).toBe("Narration");
    expect(secs.at(-1)!.body_markdown).toContain('<audio controls src="data:audio/mpeg;base64,AA"></audio>');
    expect(book.content!.t1.lesson.sections).toHaveLength(1); // input not mutated
    expect(JSON.stringify(book)).not.toContain("data:");
  });

  it("a topic with no audio gets no Narration section (default unchanged)", async () => {
    const book = bookWithTopic(); // has images but no audio
    const payload = await buildCompilePayload(book);
    const headings = payload.content!.t1.lesson.sections.map((s) => s.heading);
    expect(headings).not.toContain("Narration");
  });

  it("a topic with audio that fails to resolve gets no Narration section", async () => {
    const book = bookWithTopic({
      content: {
        t1: {
          topicId: "t1", title: "U", generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          audio: [{ id: "missing", file: "media/b/missing.mp3", mime: "audio/mpeg" }],
        },
      },
    });
    const { resolveAudioDataUrls } = jest.requireMock("@/storage/mediaStore");
    (resolveAudioDataUrls as jest.Mock).mockImplementationOnce(async () => new Map());
    const payload = await buildCompilePayload(book);
    const headings = payload.content!.t1.lesson.sections.map((s) => s.heading);
    expect(headings).not.toContain("Narration");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile && npx jest figuresHtml compilePayload`
Expected: FAIL — `renderAudioHtml` is not exported, `resolveAudioDataUrls` mock is unused by the current `buildCompilePayload` (no "Narration" section appears).

- [ ] **Step 3: Add `renderAudioHtml` to `figuresHtml.ts`**

In `mobile/src/lib/figuresHtml.ts`, change the type-only import at the top from:

```ts
import type { Book, TopicImage } from "@/types/book";
```

to:

```ts
import type { Book, TopicAudio, TopicImage } from "@/types/book";
```

Then append this function at the end of the file (after `renderFiguresHtml`):

```ts
/** The figcaption for one narration clip — falls back to a generic label. */
export function audioCaption(audio: TopicAudio): string {
  return audio.title?.trim() || "Narration";
}

/**
 * Audio clips for a topic, as raw `<audio>` markup. Only clips whose id has a
 * resolved data: URL are rendered — same "resolved-only" contract as
 * renderFiguresHtml. `src` is ALWAYS a caller-provided data: URL (never
 * remote) — the local-only invariant.
 *
 * Unlike renderFiguresHtml this returns bare `<figure>` markup with NO
 * wrapping `<section>`/heading: the caller (compilePayload.ts) embeds the
 * result as the body_markdown of its own "Narration" LessonSection, which
 * already carries the heading.
 */
export function renderAudioHtml(audio: TopicAudio[], dataUrls: Map<string, string>): string {
  return (audio ?? [])
    .map((a) => {
      const src = dataUrls.get(a.id);
      if (!src) return "";
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      return `<figure class="topic-audio"><audio controls src="${esc(src)}"></audio>${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
}
```

- [ ] **Step 4: Wire audio resolution into `compilePayload.ts`**

In `mobile/src/lib/compilePayload.ts`, change the imports at the top from:

```ts
import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls } from "@/storage/mediaStore";
import { figureAltText } from "@/lib/figuresHtml";
```

to:

```ts
import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls, resolveAudioDataUrls } from "@/storage/mediaStore";
import { figureAltText, renderAudioHtml } from "@/lib/figuresHtml";
```

Then, inside `buildCompilePayload`'s `for (const gen of Object.values(copy.content ?? {}))` loop, change:

```ts
  for (const gen of Object.values(copy.content ?? {})) {
    const topic = gen as GeneratedTopic;
    if (!topic.images?.length) continue;

    const urls = await resolveFigureDataUrls(topic);
```

to:

```ts
  for (const gen of Object.values(copy.content ?? {})) {
    const topic = gen as GeneratedTopic;

    if (topic.audio?.length) {
      const audioUrls = await resolveAudioDataUrls(topic);
      if (audioUrls.size) {
        const html = renderAudioHtml(topic.audio, audioUrls);
        if (html) {
          const section: LessonSection = { heading: "Narration", body_markdown: html };
          topic.lesson.sections = [...(topic.lesson.sections ?? []), section];
        }
      }
    }

    if (!topic.images?.length) continue;

    const urls = await resolveFigureDataUrls(topic);
```

(the rest of the function — the `images` handling and `return copy;` — is unchanged).

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `cd mobile && npx tsc --noEmit && npx jest figuresHtml compilePayload`
Expected: PASS — all `figuresHtml` and `compilePayload` tests (existing image ones + new audio ones) green.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/lib/figuresHtml.ts mobile/src/lib/compilePayload.ts mobile/__tests__/lib/figuresHtml.test.ts mobile/__tests__/lib/compilePayload.test.ts
git commit -m "feat(mobile): emit <audio> into the compile payload for topic narration (rung 2 T2)"
```

---

## Task 3: Compiler `packAudio` + EPUB3 audio manifest

**Files:**
- Modify: `compiler/src/epub.ts`
- Test: Create `compiler/__tests__/epubAudio.test.ts`

**Interfaces:**
- Consumes: a chapter XHTML string containing `src="data:audio/mpeg;base64,…"` (produced by T2's `buildCompilePayload` + `renderAudioHtml`, already inside `topic.lesson.sections[*].body_markdown` by the time `compileEpub` renders it via `renderCore.ts` `renderMarkdown` — `marked` relays inline/block HTML verbatim, so the `<figure><audio…>` markup survives the markdown→HTML pass unchanged, per `compiler/src/markdown.ts`'s own "marked relays inline HTML as-is" comment).
- Produces: no new exported symbols outside `epub.ts` — `packAudio` is an internal function exactly like `packImages` is today; the observable output is the compiled EPUB's `OEBPS/audio/*.mp3` files, `content.opf` manifest items, and rewritten chapter `<audio src>`.

**Design decision (stated per the spec's "implementer's call"): generalize, don't duplicate.** Both `packImages` and the new `packAudio` do the identical "regex-extract a `data:<prefix>/…;base64,…` src, assign a packaged path, dedupe by base64, rewrite the src" work with only the mime-prefix and the resource directory/id-prefix differing. This task extracts that shared logic into one `packMedia(xhtml, mimePrefix, dir, resources, seen)` helper and makes both `packImages`/`packAudio` one-line wrappers over it — a small generalization, not a rewrite of `packImages`'s existing behavior (its regex, dedupe-by-base64, and `../<dir>/…` rewrite are preserved exactly for images, so existing image tests keep passing unmodified).

- [ ] **Step 1: Write the failing test**

Create `compiler/__tests__/epubAudio.test.ts`:

```ts
import JSZip from "jszip";
import { compileEpub } from "../src/epub";
import type { Book } from "../src/types";

// A tiny fake MP3 payload (not a real decodable clip — this test only proves
// the extract/pack/manifest mechanics, not audio validity; the real-render
// check at the end of this task covers a genuinely playable clip).
const MP3_B64 = Buffer.from("ID3-fake-mp3-bytes").toString("base64");

function audioHtml(b64: string): string {
  return `<figure class="topic-audio"><audio controls src="data:audio/mpeg;base64,${b64}"></audio><figcaption>Intro</figcaption></figure>`;
}

function bookWithAudio(clips: string[]): Book {
  return {
    id: "b1",
    title: "Audio",
    updatedAt: "2026-01-01T00:00:00Z",
    toc: {
      subjects: [{
        subject_label: "S",
        units: clips.map((_, i) => ({ id: `t${i + 1}`, title: `T${i + 1}` })),
      }],
    },
    content: Object.fromEntries(
      clips.map((b64, i) => [
        `t${i + 1}`,
        {
          topicId: `t${i + 1}`,
          title: `T${i + 1}`,
          lesson: {
            topic: `T${i + 1}`, level: "intro", language: "en", synopsis: "s",
            learning_objectives: ["a"],
            sections: [{ heading: "Narration", body_markdown: audioHtml(b64) }],
            key_takeaways: ["k"], further_reading: [],
          },
        },
      ]),
    ),
  } as unknown as Book;
}

describe("compileEpub — embedded audio", () => {
  it("extracts a data-URI audio clip into a packaged resource + manifest item", async () => {
    const bytes = await compileEpub(bookWithAudio([MP3_B64]));
    const zip = await JSZip.loadAsync(bytes);

    const audPath = Object.keys(zip.files).find((f) => /^OEBPS\/audio\/aud-001\.mp3$/.test(f));
    expect(audPath).toBeTruthy();

    const ch = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(ch).toContain('src="../audio/aud-001.mp3"');
    expect(ch).not.toContain("data:audio");
    expect(ch).toContain("<audio controls");

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('href="audio/aud-001.mp3"');
    expect(opf).toContain('media-type="audio/mpeg"');
  });

  it("dedupes identical clips across chapters", async () => {
    const bytes = await compileEpub(bookWithAudio([MP3_B64, MP3_B64]));
    const zip = await JSZip.loadAsync(bytes);
    const audFiles = Object.keys(zip.files).filter((f) => /^OEBPS\/audio\/aud-\d+\.mp3$/.test(f));
    expect(audFiles).toEqual(["OEBPS/audio/aud-001.mp3"]); // second chapter reused aud-001
    const ch2 = await zip.file("OEBPS/chapters/ch-002.xhtml")!.async("string");
    expect(ch2).toContain('src="../audio/aud-001.mp3"');
  });
});

describe("compileEpub — no-audio regression", () => {
  function bookWithNoAudio(): Book {
    return {
      id: "b2",
      title: "Plain",
      updatedAt: "2026-01-01T00:00:00Z",
      toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "T1" }] }] },
      content: {
        t1: {
          topicId: "t1",
          title: "T1",
          lesson: {
            topic: "T1", level: "intro", language: "en", synopsis: "s",
            learning_objectives: ["a"],
            sections: [{ heading: "H", body_markdown: "Just text, no media." }],
            key_takeaways: ["k"], further_reading: [],
          },
        },
      },
    } as unknown as Book;
  }

  it("emits no OEBPS/audio/ entries and no audio/mpeg manifest item", async () => {
    const bytes = await compileEpub(bookWithNoAudio());
    const zip = await JSZip.loadAsync(bytes);
    const audFiles = Object.keys(zip.files).filter((f) => f.startsWith("OEBPS/audio/"));
    expect(audFiles).toHaveLength(0);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain("audio/mpeg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd compiler && npx jest epubAudio`
Expected: FAIL — no `OEBPS/audio/aud-001.mp3` in the zip (audio is never extracted; the `<audio src="data:audio/mpeg;…">` passes straight through to the chapter XHTML untouched, and `packAudio` doesn't exist yet).

- [ ] **Step 3: Add `MEDIA_EXT` audio entry + the `packMedia` generalization**

In `compiler/src/epub.ts`, change the `MEDIA_EXT` map (currently at line 96-103) from:

```ts
const MEDIA_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
```

to:

```ts
const MEDIA_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
};
```

Then replace `packImages` (currently lines 105-131) with a generalized `packMedia` plus two thin wrappers:

```ts
// Pull data-URI media of a given mime-prefix ("image"/"audio") out of chapter
// XHTML into packaged resources: EPUB3 requires referenced media to be
// manifest items, and many readers won't render inline data: URIs. Rewrites
// each `src="data:<mimePrefix>/…;base64,…"` to a packaged path
// (../<dir>/<idPrefix>-NNN.ext) and records the bytes. Identical clips (same
// base64) are shared via `seen`. `resources` and `seen` accumulate across
// chapters — callers keep separate arrays/maps per media type so images and
// audio number independently (img-001, aud-001, …).
function packMedia(
  xhtml: string,
  mimePrefix: "image" | "audio",
  dir: string,
  idPrefix: string,
  resources: ImageRes[],
  seen: Map<string, string>,
): string {
  const re = new RegExp(`(src=")data:(${mimePrefix}\\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)(")`, "gi");
  return xhtml.replace(re, (_full, pre: string, mediaType: string, b64: string, post: string) => {
    let href = seen.get(b64);
    if (!href) {
      const ext = MEDIA_EXT[mediaType.toLowerCase()] ?? "bin";
      const idx = String(resources.length + 1).padStart(3, "0");
      href = `${dir}/${idPrefix}-${idx}.${ext}`;
      resources.push({
        id: `${idPrefix}${idx}`,
        href,
        mediaType: mediaType.toLowerCase(),
        bytes: new Uint8Array(Buffer.from(b64, "base64")),
      });
      seen.set(b64, href);
    }
    // Chapters live in OEBPS/chapters/, media in OEBPS/<dir>/.
    return `${pre}../${href}${post}`;
  });
}

function packImages(xhtml: string, images: ImageRes[], seen: Map<string, string>): string {
  return packMedia(xhtml, "image", "images", "img", images, seen);
}

// Sibling to packImages, one media type wider (ADR-040 rung 2). `audios` and
// `seen` are separate accumulators from packImages's — audio and image
// resources number independently (aud-001 vs img-001).
function packAudio(xhtml: string, audios: ImageRes[], seen: Map<string, string>): string {
  return packMedia(xhtml, "audio", "audio", "aud", audios, seen);
}
```

- [ ] **Step 4: Call `packAudio` in the per-chapter loop and write its bytes into the zip**

In `compileEpub`, change the accumulator declarations (currently around line 202-203):

```ts
  const images: ImageRes[] = [];
  const seenImages = new Map<string, string>();
```

to:

```ts
  const images: ImageRes[] = [];
  const seenImages = new Map<string, string>();
  const audios: ImageRes[] = [];
  const seenAudio = new Map<string, string>();
```

Then change the per-chapter XHTML assembly (currently around line 221-225):

```ts
      const xhtml = packImages(
        xhtmlDocument(title, body, "../css/style.css", lang),
        images,
        seenImages,
      );
```

to:

```ts
      const packedImages = packImages(
        xhtmlDocument(title, body, "../css/style.css", lang),
        images,
        seenImages,
      );
      const xhtml = packAudio(packedImages, audios, seenAudio);
```

Then, in the zip-writing block (currently around line 288-291), change:

```ts
  for (const ch of chapters) zip.file(`OEBPS/${ch.href}`, ch.xhtml);
  for (const img of images) zip.file(`OEBPS/${img.href}`, img.bytes);
```

to:

```ts
  for (const ch of chapters) zip.file(`OEBPS/${ch.href}`, ch.xhtml);
  for (const img of images) zip.file(`OEBPS/${img.href}`, img.bytes);
  for (const aud of audios) zip.file(`OEBPS/${aud.href}`, aud.bytes);
```

And change the `buildOpf` call (currently around line 278):

```ts
  zip.file("OEBPS/content.opf", buildOpf(book, chapters, images, auxFront, auxBack, profile));
```

to:

```ts
  zip.file("OEBPS/content.opf", buildOpf(book, chapters, images, audios, auxFront, auxBack, profile));
```

- [ ] **Step 5: Add the audio manifest items to `buildOpf`**

Change the `buildOpf` signature (currently lines 439-446) from:

```ts
function buildOpf(
  book: Book,
  chapters: Chapter[],
  images: ImageRes[] = [],
  auxFront: AuxDoc[] = [],
  auxBack: AuxDoc[] = [],
  profile: "default" | "kdp" = "default",
): string {
```

to:

```ts
function buildOpf(
  book: Book,
  chapters: Chapter[],
  images: ImageRes[] = [],
  audios: ImageRes[] = [],
  auxFront: AuxDoc[] = [],
  auxBack: AuxDoc[] = [],
  profile: "default" | "kdp" = "default",
): string {
```

Then, inside the `manifest` array (currently around lines 466-468), change:

```ts
    ...images.map(
      (img) => `<item id="${img.id}" href="${escapeHtml(img.href)}" media-type="${img.mediaType}"/>`,
    ),
```

to:

```ts
    ...images.map(
      (img) => `<item id="${img.id}" href="${escapeHtml(img.href)}" media-type="${img.mediaType}"/>`,
    ),
    ...audios.map(
      (aud) => `<item id="${aud.id}" href="${escapeHtml(aud.href)}" media-type="${aud.mediaType}"/>`,
    ),
```

- [ ] **Step 6: Run tests + typecheck to verify they all pass**

Run: `cd compiler && npx tsc --noEmit && npx jest epub`
Expected: PASS — `epub.test.ts`, `epubImages.test.ts`, `kdpEpubcheck.test.ts`, and the new `epubAudio.test.ts` all green. The existing image tests passing unmodified confirms `packMedia`'s generalization preserved `packImages`'s exact prior behavior.

- [ ] **Step 7: Manual real-render verification (the rung-2 bar, D4)**

Mocked Jest tests prove the extraction mechanics but cannot prove the packaged bytes are a genuinely playable MP3 inside a real reader-openable EPUB (mirrors the KDP cover-crash lesson: mocked tests + a green CI can still miss a real-artifact defect). Before calling this task done, run one real compile with an actual small MP3:

```bash
cd compiler && npm run build
```

Then, using a real MP3 file (e.g. `/tmp/clip.mp3`, any short clip) and `node`, build a minimal fixture `book.json` whose one topic's lesson section `body_markdown` is `<figure class="topic-audio"><audio controls src="data:audio/mpeg;base64,<BASE64 of clip.mp3>"></audio><figcaption>Intro</figcaption></figure>` (base64-encode with `base64 -w0 /tmp/clip.mp3`), save it as `/tmp/audio-fixture-book.json`, then:

```bash
node dist/cli.js compile /tmp/audio-fixture-book.json -o /tmp/audio-fixture.epub --format epub
cd /tmp && mkdir -p epub-check && cd epub-check && unzip -o ../audio-fixture.epub
```

Verify by hand:
- `OEBPS/audio/aud-001.mp3` exists and its first bytes are a real MP3 signature (`ID3` or the `FF FB`/`FF F3`/`FF F2` frame sync — check with `xxd OEBPS/audio/aud-001.mp3 | head -1`).
- `OEBPS/content.opf` contains an `<item ... media-type="audio/mpeg"/>` pointing at `audio/aud-001.mp3`.
- `OEBPS/chapters/ch-001.xhtml` contains `<audio controls src="../audio/aud-001.mp3">`.
- (Optional but recommended) open the `.epub` in any real EPUB3 reader (e.g. Calibre) and confirm the `<audio>` control actually plays the clip.

This manual check is the actual rung-2 acceptance bar (D4) — the Jest suite above is necessary but not sufficient proof.

- [ ] **Step 8: Commit**

```bash
git add compiler/src/epub.ts compiler/__tests__/epubAudio.test.ts
git commit -m "feat(compiler): packAudio + EPUB3 audio/mpeg manifest items (rung 2 T3)"
```

---

## Task 4: `generateAndStoreTopicAudio` — generate-persist plumbing

**Files:**
- Create: `mobile/src/lib/audioGenerate.ts`
- Test: Create `mobile/__tests__/lib/audioGenerate.test.ts`

**Interfaces:**
- Consumes: `attachAudio` (T1, `@/storage/mediaStore`), `makeAudio`/`MakeAudioRequest`/`MakeAudioResponse` (already shipped, `@/api/derivativesClient`), `Book`/`TopicAudio` (T1, `@/types/book`)
- Produces: `AudioGenerateError` (an `Error` subclass), `GenerateAndStoreAudioArgs`, `GenerateAndStoreAudioResult`, and `generateAndStoreTopicAudio(args: GenerateAndStoreAudioArgs): Promise<GenerateAndStoreAudioResult>` — for rung 4's future authoring button to call directly.

- [ ] **Step 1: Write the failing tests**

Create `mobile/__tests__/lib/audioGenerate.test.ts`:

```ts
jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  return {
    documentDirectory: "file:///doc/",
    cacheDirectory: "file:///cache/",
    getInfoAsync: jest.fn(async (p: string) => ({ exists: p in files, size: (files[p] ?? "").length, uri: p })),
    makeDirectoryAsync: jest.fn(async () => {}),
    writeAsStringAsync: jest.fn(async (uri: string, data: string) => { files[uri] = data; }),
    copyAsync: jest.fn(async ({ from, to }: { from: string; to: string }) => {
      files[to] = files[from] ?? "COPIED";
    }),
    deleteAsync: jest.fn(async (p: string) => { delete files[p]; }),
    readAsStringAsync: jest.fn(async (p: string) => files[p] ?? "QUJD"),
    EncodingType: { Base64: "base64" },
    __files: files,
  };
});

jest.mock("@/api/derivativesClient", () => ({
  makeAudio: jest.fn(),
}));

import * as FileSystem from "expo-file-system";
import { makeAudio } from "@/api/derivativesClient";
import { generateAndStoreTopicAudio, AudioGenerateError } from "@/lib/audioGenerate";
import type { Book } from "@/types/book";

function bookWithTopic(): Book {
  return {
    id: "bk1", title: "T",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "U" }] }] },
    createdAt: "x", updatedAt: "x",
    content: { t1: { topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x" } },
  } as unknown as Book;
}

afterEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys((FileSystem as any).__files)) delete (FileSystem as any).__files[k];
});

describe("generateAndStoreTopicAudio", () => {
  it("calls makeAudio, stores the bytes, and returns a ref carrying the transcript", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "Hello there.", title: "Intro Narration",
      audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    const book = bookWithTopic();
    const { book: next, audio } = await generateAndStoreTopicAudio({
      book, topicId: "t1", source_text: "Some lesson text.", apiKey: "sk-test",
    });
    expect(makeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ source_text: "Some lesson text.", api_key: "sk-test" }),
    );
    expect(audio.title).toBe("Intro Narration");
    expect(audio.transcript).toBe("Hello there.");
    expect(audio.mime).toBe("audio/mpeg");
    expect(next.content!.t1.audio).toHaveLength(1);
    expect(next.content!.t1.audio![0].id).toBe(audio.id);
    // original book untouched — fail-open / no-mutation invariant
    expect(book.content!.t1.audio).toBeUndefined();
  });

  it("never sends api_key when the caller omits it (keyless managed-plan request)", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "s", title: "t", audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    await generateAndStoreTopicAudio({ book: bookWithTopic(), topicId: "t1", source_text: "x" });
    const call = (makeAudio as jest.Mock).mock.calls[0][0];
    expect(call).not.toHaveProperty("api_key");
  });

  it("cleans up its temp file after a successful write", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "s", title: "t", audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    await generateAndStoreTopicAudio({ book: bookWithTopic(), topicId: "t1", source_text: "x" });
    const tmp = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls[0][0];
    expect((FileSystem as any).__files[tmp]).toBeUndefined();
  });

  it("fails open on a makeAudio error: throws AudioGenerateError, never touches the book", async () => {
    (makeAudio as jest.Mock).mockRejectedValue(new Error("503 upstream"));
    const book = bookWithTopic();
    await expect(
      generateAndStoreTopicAudio({ book, topicId: "t1", source_text: "x" }),
    ).rejects.toBeInstanceOf(AudioGenerateError);
    expect(book.content!.t1.audio).toBeUndefined();
  });

  it("fails open on a write error (e.g. disk full): throws a clear error, book not corrupted", async () => {
    (makeAudio as jest.Mock).mockResolvedValue({
      script: "s", title: "t", audio_base64: "QUJD", mime: "audio/mpeg", provenance: "ai-generated",
    });
    (FileSystem.copyAsync as jest.Mock).mockRejectedValueOnce(new Error("ENOSPC"));
    const book = bookWithTopic();
    await expect(
      generateAndStoreTopicAudio({ book, topicId: "t1", source_text: "x" }),
    ).rejects.toBeInstanceOf(AudioGenerateError);
    expect(book.content!.t1.audio).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest audioGenerate`
Expected: FAIL — cannot find module `@/lib/audioGenerate`.

- [ ] **Step 3: Implement `generateAndStoreTopicAudio`**

Create `mobile/src/lib/audioGenerate.ts`:

```ts
import * as FileSystem from "expo-file-system";
import type { Book, TopicAudio } from "@/types/book";
import { attachAudio } from "@/storage/mediaStore";
import { makeAudio, type MakeAudioRequest } from "@/api/derivativesClient";

export class AudioGenerateError extends Error {}

export interface GenerateAndStoreAudioArgs {
  book: Book;
  topicId: string;
  // Exactly one of source_text / topic_version_id — the caller (the future
  // rung-4 "narrate this topic" action) enforces that, this fn just forwards it.
  source_text?: string;
  topic_version_id?: string;
  tone?: string;
  voice?: string;
  provider_id?: string; // default "openai" (makeAudio's own default) if omitted
  // Omit entirely (never pass "") for a keyless managed-plan request — the
  // backend resolves the vendor key from the caller's entitlement instead.
  apiKey?: string;
}

export interface GenerateAndStoreAudioResult {
  // The updated book, ready for the caller to persist (this fn never
  // mutates/persists args.book itself — attachAudio returns a copy).
  book: Book;
  audio: TopicAudio;
}

/**
 * Calls the shipped P4 /derivatives/audio endpoint and persists the returned
 * clip into the topic's media dir + a TopicAudio ref (ADR-040 rung 2, D2). No
 * UI here — the button that calls this is rung 4. Fail-open: any failure
 * (network, write) throws AudioGenerateError and args.book is left untouched
 * (attachAudio is copy-on-write, so a failure never corrupts the caller's book).
 */
export async function generateAndStoreTopicAudio(
  args: GenerateAndStoreAudioArgs,
): Promise<GenerateAndStoreAudioResult> {
  const { book, topicId, source_text, topic_version_id, tone, voice, provider_id, apiKey } = args;

  let res;
  try {
    res = await makeAudio({
      ...(topic_version_id ? { topic_version_id } : { source_text }),
      ...(tone ? { tone } : {}),
      ...(voice ? { voice } : {}),
      // Never send api_key: "" — omit the field entirely for a keyless
      // (managed-plan) request, mirrors useMakeAudio.
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(provider_id ? { provider_id } : {}),
    } as MakeAudioRequest);
  } catch (err) {
    throw new AudioGenerateError(
      err instanceof Error ? err.message : "Could not generate narration.",
    );
  }

  // The P4 TTS engine (backend/src/derivatives/tts.py) produces MP3 only today.
  const tmpUri = `${FileSystem.cacheDirectory}audio-gen-${topicId}-${Date.now()}.mp3`;
  try {
    await FileSystem.writeAsStringAsync(tmpUri, res.audio_base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const nextBook = await attachAudio(
      book,
      topicId,
      { uri: tmpUri, mime: res.mime },
      { title: res.title, transcript: res.script },
    );
    const audio = nextBook.content![topicId]!.audio!.at(-1)!;
    return { book: nextBook, audio };
  } catch (err) {
    throw new AudioGenerateError(
      err instanceof Error ? err.message : "Could not save narration to this book.",
    );
  } finally {
    await FileSystem.deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests + typecheck to verify they pass**

Run: `cd mobile && npx tsc --noEmit && npx jest audioGenerate`
Expected: PASS — all `generateAndStoreTopicAudio` tests green.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/audioGenerate.ts mobile/__tests__/lib/audioGenerate.test.ts
git commit -m "feat(mobile): generateAndStoreTopicAudio — persist P4 narration into a book (rung 2 T4)"
```

---

## After all four tasks

Run the full mobile and compiler suites once more to catch any cross-task interaction:

```bash
cd mobile && npx tsc --noEmit && npx jest
cd compiler && npx tsc --noEmit && npx jest
```

Rung 2 is complete when: a book with a topic carrying a `TopicAudio` ref compiles to an EPUB whose `OEBPS/audio/*.mp3` is a real, playable clip referenced by both the OPF manifest and a chapter's `<audio controls>` (Step 7 of Task 3), and `generateAndStoreTopicAudio` can turn a live `/derivatives/audio` call into that ref end to end (Task 4). Reader playback (rung 3) and any authoring UI (rung 4) are explicitly out of scope and untouched by this plan.
