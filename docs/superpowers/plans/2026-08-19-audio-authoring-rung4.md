# Audio Authoring UI (ADR-040 rung 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author narration in-app — a per-topic "Generate narration" panel + a book-level "Generate all narration" fan-out — and make authored audio survive `.book.zip` export/import.

**Architecture:** Pure UI + wiring over shipped pieces. `generateAndStoreTopicAudio` (generate → write MP3 → `attachAudio`) already exists; rung 4 adds the buttons that call it, mirroring `FiguresPanel` (image attach) and `useGenerateAll` (client-side per-topic batch). Plus a `bookBundle.ts` extension so audio round-trips like images do.

**Tech Stack:** React Native + Expo, TypeScript, `expo-audio` (via the shipped `AudioNarrationPlayer`), Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-08-19-audio-authoring-rung4-design.md`

## Global Constraints

- **Reuse the shipped engine.** `generateAndStoreTopicAudio` (`mobile/src/lib/audioGenerate.ts`) is the only generate-store path — the UI calls it, never reimplements generate/write/attach. `attachAudio` enforces `MAX_AUDIO_PER_TOPIC` (5), MP3-only, requires topic content.
- **Mirror the precedents exactly.** `NarrationPanel` mirrors `FiguresPanel` (`busy` state, `persist(next)=saveBook(next)`+prune, `onBookChange`, `disabled={busy}`, `Alert` from `@/lib/alert`). `useGenerateAllNarration` mirrors `useGenerateAll`'s shape (`progress[]`,`running`,`finished`,`doneCount`,`failedCount`,`total`,`start`,`cancel`, sequential, per-topic failure continues, skip already-done).
- **Provider is always `openai`** (only TTS-capable). Key = `loadApiKey("openai")`, read lazily via `getApiKey` at call time, never held in state (ADR-001). Plan guard mirrors `useMakeAudio`: `plan.is_pro===false && !apiKey` → block with the key hint; Pro/loading → keyless (omit `api_key`, never `""`). Managed audio is dormant → BYOK-OpenAI in practice.
- **Client-side generate-all** — no backend/migration. Each `/derivatives/audio` call is an independent sync request that persists locally on success; resumable (skip topics already carrying audio).
- **Bundle import re-mints ids** — never trust a bundle's audio `id`/`file` (path-traversal); mint a fresh id for both the filename and the ref, exactly as images do. Validate `isAllowedAudioMime` + `MAX_AUDIO_BYTES`; drop malformed/oversize/missing with a collected warning; audio-less books stay byte-identical.
- **No backend/TTS/compiler change.** Mobile-only.
- **Help DoD (CI coverage + tree gates):** a `narrate-topic` FEATURES key + topic + tree leaf in the same branch.

---

## File Structure

- **Create:** `mobile/src/lib/lessonToNarratableText.ts` (pure), `mobile/src/components/NarrationPanel.tsx`, `mobile/src/hooks/useGenerateAllNarration.ts`, `mobile/src/components/GenerateAllNarration.tsx` (the batch UI).
- **Modify:** `mobile/src/storage/mediaStore.ts` (add `deleteAudio`), `app/book/topic/[bookId]/[topicId].tsx` (mount `NarrationPanel`), the book home/studio screen (mount `GenerateAllNarration`), `mobile/src/storage/bookBundle.ts` (audio export+import), Help content files.
- **Tests alongside:** `mobile/__tests__/lib/lessonToNarratableText.test.ts`, `mobile/__tests__/storage/mediaStore.test.ts` (deleteAudio), `mobile/__tests__/components/NarrationPanel.test.tsx`, `mobile/__tests__/hooks/useGenerateAllNarration.test.tsx`, `mobile/__tests__/storage/bookBundle.test.ts` (audio round-trip), help coverage.

---

## Task 1: `deleteAudio` + `lessonToNarratableText` (foundations)

**Files:**
- Modify: `mobile/src/storage/mediaStore.ts`
- Create: `mobile/src/lib/lessonToNarratableText.ts`
- Test: `mobile/__tests__/storage/mediaStore.test.ts`, `mobile/__tests__/lib/lessonToNarratableText.test.ts`

**Interfaces:**
- Consumes: `deleteImage`'s shape (`mediaStore.ts`), `LessonOutput` (`@/types/lesson`).
- Produces: `deleteAudio(book: Book, topicId: string, audioId: string): Promise<Book>`; `lessonToNarratableText(lesson: LessonOutput): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/__tests__/lib/lessonToNarratableText.test.ts
import { lessonToNarratableText } from "@/lib/lessonToNarratableText";

const lesson: any = {
  topic: "Energy", synopsis: "Energy is the capacity to do work.",
  sections: [{ heading: "Kinetic", body_markdown: "Motion energy: **½mv²**." }, { heading: "Potential", body_markdown: "Stored energy." }],
  key_takeaways: ["Energy is conserved."],
};

it("concatenates synopsis + section bodies + takeaways into plain text", () => {
  const t = lessonToNarratableText(lesson);
  expect(t).toContain("Energy is the capacity to do work.");
  expect(t).toContain("Motion energy"); // section body included
  expect(t).toContain("Stored energy.");
  expect(t).toContain("Energy is conserved."); // takeaway
});

it("is non-empty for a minimal lesson and trims", () => {
  expect(lessonToNarratableText({ synopsis: "S", sections: [], key_takeaways: [] } as any)).toBe("S");
});

it("tolerates missing arrays", () => {
  expect(() => lessonToNarratableText({ synopsis: "" } as any)).not.toThrow();
});
```

```ts
// append to mobile/__tests__/storage/mediaStore.test.ts
import { deleteAudio } from "@/storage/mediaStore";
// (reuse the file's existing book/topic fixtures; a topic with an audio ref)
it("deleteAudio removes the ref (copy-on-write) and leaves other clips", async () => {
  const book: any = { id: "b", content: { u1: { topicId: "u1", audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg" }, { id: "a2", file: "media/b/a2.mp3", mime: "audio/mpeg" }] } } };
  const next = await deleteAudio(book, "u1", "a1");
  expect(next).not.toBe(book); // copy
  expect(next.content.u1.audio.map((a: any) => a.id)).toEqual(["a2"]);
  expect(book.content.u1.audio).toHaveLength(2); // original untouched
});
it("deleteAudio is a no-op when the topic/clip is absent", async () => {
  const book: any = { id: "b", content: { u1: { topicId: "u1" } } };
  expect(await deleteAudio(book, "u1", "x")).toBe(book);
});
```

- [ ] **Step 2: Run, verify failure** — `cd mobile && npx jest lessonToNarratableText mediaStore` → FAIL (not exported).

- [ ] **Step 3: Implement**

`mobile/src/lib/lessonToNarratableText.ts`:

```ts
import type { LessonOutput } from "@/types/lesson";

// Flatten a topic's lesson into plain narratable text for /derivatives/audio's
// source_text. The backend generate_narration rewrites this into speakable
// prose, so this only needs the topic's substance (not polished markup) —
// synopsis, each section body, then the key takeaways. Book authoring has no
// topic_version_id (that's the trust surface), so this is how a book topic
// becomes a narration source.
export function lessonToNarratableText(lesson: LessonOutput): string {
  const parts: string[] = [];
  if (lesson?.synopsis) parts.push(lesson.synopsis);
  for (const s of lesson?.sections ?? []) {
    if (s?.body_markdown) parts.push(s.body_markdown);
  }
  for (const k of lesson?.key_takeaways ?? []) {
    if (k) parts.push(k);
  }
  return parts.join("\n\n").trim();
}
```

`mobile/src/storage/mediaStore.ts` — add beside `deleteImage` (mirror it; audio has no alt/caption and no image-map to prune beyond the standard file delete):

```ts
/** Remove one narration clip from a topic (copy-on-write), best-effort deleting
 *  its file. Mirrors deleteImage. A missing topic/clip is a no-op (returns the
 *  same book). */
export async function deleteAudio(book: Book, topicId: string, audioId: string): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen?.audio) return book;
  const clip = gen.audio.find((a) => a.id === audioId);
  if (!clip) return book;
  const audio = gen.audio.filter((a) => a.id !== audioId);
  await FileSystem.deleteAsync(absPath(clip.file), { idempotent: true }).catch(() => {});
  return {
    ...book,
    content: { ...book.content, [topicId]: { ...gen, audio } },
    updatedAt: new Date().toISOString(),
  };
}
```

(Match `deleteImage`'s exact use of `absPath` / `FileSystem` — read it and mirror the file-delete line precisely.)

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest lessonToNarratableText mediaStore && npx tsc --noEmit` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/lessonToNarratableText.ts mobile/src/storage/mediaStore.ts mobile/__tests__/lib/lessonToNarratableText.test.ts mobile/__tests__/storage/mediaStore.test.ts
git commit -m "feat(audio): deleteAudio + lessonToNarratableText (rung 4 foundations)"
```

---

## Task 2: `NarrationPanel` + mount in the topic editor

**Files:**
- Create: `mobile/src/components/NarrationPanel.tsx`
- Modify: `app/book/topic/[bookId]/[topicId].tsx`
- Test: `mobile/__tests__/components/NarrationPanel.test.tsx`

**Interfaces:**
- Consumes: `generateAndStoreTopicAudio` (`@/lib/audioGenerate`), `deleteAudio` + `MediaCapError` + `MAX_AUDIO_PER_TOPIC` (`@/storage/mediaStore` / `@/storage/mediaPaths`), `lessonToNarratableText` (T1), `saveBook`+`pruneOrphanMedia`, `loadApiKey` from `@/secure/keyStore` (the same source `posts.tsx` uses: `loadApiKey("openai")`), `useBillingPlan`, `AudioNarrationPlayer`, `Alert` (`@/lib/alert`).
- Produces: `<NarrationPanel book topicId onBookChange />` (same prop shape as `FiguresPanel`).

- [ ] **Step 1: Write the failing tests** (RNTL; mock `@/lib/audioGenerate`, `@/storage/bookStore`, `@/storage/mediaStore`, the key loader, `useBillingPlan`, `AudioNarrationPlayer`)

```tsx
// mobile/__tests__/components/NarrationPanel.test.tsx
import { render, fireEvent, waitFor } from "@testing-library/react-native";
import { NarrationPanel } from "@/components/NarrationPanel";

const genStore = jest.fn(async () => ({ book: book2, audio: { id: "a1" } }));
jest.mock("@/lib/audioGenerate", () => ({ generateAndStoreTopicAudio: (...a: any) => genStore(...a), AudioGenerateError: class extends Error {} }));
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));
jest.mock("@/storage/mediaStore", () => ({ deleteAudio: jest.fn(async (b: any) => b), pruneOrphanMedia: jest.fn(async () => {}), MediaCapError: class extends Error {}, MAX_AUDIO_PER_TOPIC: 5 }));
jest.mock("@/components/AudioNarrationPlayer", () => ({ AudioNarrationPlayer: () => null }));
let planValue: any = { is_pro: false };
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: planValue }) }));
const loadApiKey = jest.fn(async () => "sk-openai");
jest.mock("@/secure/keyStore", () => ({ loadApiKey: (...a: any) => loadApiKey(...a) }));

const lesson = { topic: "T", synopsis: "S", sections: [{ heading: "H", body_markdown: "B" }], key_takeaways: ["K"], learning_objectives: [], further_reading: [], level: "i", language: "en" };
const book: any = { id: "b", content: { u1: { topicId: "u1", title: "T", lesson, audio: [] } } };
const book2: any = { id: "b", content: { u1: { topicId: "u1", title: "T", lesson, audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "T" }] } } };

it("generate narration calls the engine with source_text + openai key, then persists", async () => {
  const onBookChange = jest.fn();
  const { getByLabelText } = render(<NarrationPanel book={book} topicId="u1" onBookChange={onBookChange} />);
  fireEvent.press(getByLabelText(/generate narration/i));
  await waitFor(() => expect(genStore).toHaveBeenCalled());
  const arg = genStore.mock.calls[0][0];
  expect(arg.provider_id).toBe("openai");
  expect(arg.apiKey).toBe("sk-openai");
  expect(typeof arg.source_text).toBe("string");
  expect(arg.source_text).toContain("S"); // from lessonToNarratableText
  await waitFor(() => expect(onBookChange).toHaveBeenCalledWith(book2));
});

it("a not-Pro user with no key is blocked (no engine call)", async () => {
  planValue = { is_pro: false }; loadApiKey.mockResolvedValueOnce(null);
  const { getByLabelText } = render(<NarrationPanel book={book} topicId="u1" onBookChange={jest.fn()} />);
  fireEvent.press(getByLabelText(/generate narration/i));
  await waitFor(() => expect(loadApiKey).toHaveBeenCalledWith("openai"));
  expect(genStore).not.toHaveBeenCalled();
});

it("at the clip cap the generate button is disabled", () => {
  const full: any = { id: "b", content: { u1: { topicId: "u1", lesson, audio: Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, file: `media/b/a${i}.mp3`, mime: "audio/mpeg" })) } } };
  const { getByLabelText } = render(<NarrationPanel book={full} topicId="u1" onBookChange={jest.fn()} />);
  expect(getByLabelText(/generate narration/i).props.accessibilityState?.disabled).toBe(true);
});
```

> The `loadApiKey` module path in the mock is a placeholder — **find the real source** (`posts.tsx` imports it; grep `loadApiKey`) and mock THAT path. Reset `genStore.mockClear()` in `beforeEach` (jest.config has no clearMocks).

- [ ] **Step 2: Run, verify failure** — `cd mobile && npx jest NarrationPanel` → FAIL (component missing).

- [ ] **Step 3: Implement `NarrationPanel`** — copy `FiguresPanel.tsx`'s skeleton (imports, `busy`, `persist`, `makeStyles`, header + list + note layout, `Alert`) and adapt:
  - Header title "Narration", button labeled "＋ Generate narration" with `accessibilityLabel="Generate narration for this topic"`, `disabled={busy || atCap}` where `atCap = (topic?.audio?.length ?? 0) >= MAX_AUDIO_PER_TOPIC`.
  - `onGenerate`: `setBusy(true)`; `const apiKey = await loadApiKey("openai")`; `const { plan } = useBillingPlan()` at top and `const knownNotPro = plan!=null && plan.is_pro===false`; if `!apiKey && knownNotPro` → `Alert.alert("API key needed","Add your OpenAI key in Settings to generate narration.")` and return (finally clears busy); else `source_text = lessonToNarratableText(topic.lesson)`; `const { book: next } = await generateAndStoreTopicAudio({ book, topicId, source_text, provider_id:"openai", ...(apiKey?{apiKey}:{}) })`; `await persist(next)`; catch → `Alert.alert("Couldn't generate narration", e instanceof MediaCapError ? e.message : (e?.message ?? "Please try again."))`; finally `setBusy(false)`.
  - Clip list: for each `topic.audio`, a row with the title + `<AudioNarrationPlayer base64=... mime=... />` (resolve base64 via `resolveAudioDataUrls` in a `useTopicAudio`-style effect, OR pass the file — match AudioNarrationPlayer's actual props; read it) + a delete `✕` → `remove(id)` = `persist(await deleteAudio(book, topicId, id))`.
  - Note line: "Narration is generated with your OpenAI key and saved into this book."
  - Reuse `makeStyles` from FiguresPanel (copy + trim image-specific styles).

  Mount in `app/book/topic/[bookId]/[topicId].tsx` directly under the existing `<FiguresPanel …/>` (line ~272), same `{canEdit && book && ( … )}` guard:

```tsx
<NarrationPanel book={book} topicId={topicId} onBookChange={setBook} />
```

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest NarrationPanel && npx tsc --noEmit` → PASS + clean. Confirm the topic-screen test still passes.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/NarrationPanel.tsx "app/book/topic/[bookId]/[topicId].tsx" mobile/__tests__/components/NarrationPanel.test.tsx
git commit -m "feat(audio): NarrationPanel — generate/list/delete narration per topic (rung 4)"
```

---

## Task 3: `useGenerateAllNarration` hook + batch UI

**Files:**
- Create: `mobile/src/hooks/useGenerateAllNarration.ts`, `mobile/src/components/GenerateAllNarration.tsx`
- Modify: the book home / studio screen (mount `GenerateAllNarration`) — find it (the screen that links to `app/book/generate/[id].tsx`); mount the batch control there or on the generate screen beside "Generate all topics".
- Test: `mobile/__tests__/hooks/useGenerateAllNarration.test.tsx`

**Interfaces:**
- Consumes: `generateAndStoreTopicAudio` (T-engine), `lessonToNarratableText` (T1), `useBillingPlan`, `loadApiKey`.
- Produces: `useGenerateAllNarration({ book, getApiKey, onBookChange, intervalMs? }): { progress: {topicId,title,status}[], running, finished, doneCount, failedCount, total, errorMsg, start, cancel }` (same surface as `useGenerateAll`).

- [ ] **Step 1: Write the failing tests** (mock `@/lib/audioGenerate`, `useBillingPlan`, key loader)

```tsx
// mobile/__tests__/hooks/useGenerateAllNarration.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useGenerateAllNarration } from "@/hooks/useGenerateAllNarration";

const gen = jest.fn();
jest.mock("@/lib/audioGenerate", () => ({ generateAndStoreTopicAudio: (...a: any) => gen(...a), AudioGenerateError: class extends Error {} }));
jest.mock("@/hooks/useBillingPlan", () => ({ useBillingPlan: () => ({ plan: { is_pro: true } }) }));

const mk = (audio?: any[]) => ({ lesson: { synopsis: "s", sections: [], key_takeaways: [] }, ...(audio ? { audio } : {}) });
const book: any = { id: "b", content: { u1: { topicId: "u1", title: "One", ...mk() }, u2: { topicId: "u2", title: "Two", ...mk([{ id: "x", file: "m", mime: "audio/mpeg" }]) } } };

beforeEach(() => gen.mockReset());

it("narrates only topics without audio (skips u2), persists each, finishes", async () => {
  gen.mockResolvedValue({ book, audio: { id: "n" } });
  const onBookChange = jest.fn();
  const { result } = renderHook(() => useGenerateAllNarration({ book, getApiKey: async () => "sk", onBookChange, intervalMs: 0 }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.finished).toBe(true));
  expect(gen).toHaveBeenCalledTimes(1); // only u1
  expect(gen.mock.calls[0][0].topicId).toBe("u1");
  expect(result.current.doneCount).toBeGreaterThanOrEqual(1);
  expect(onBookChange).toHaveBeenCalled();
});

it("a per-topic failure marks that topic failed and continues", async () => {
  const b3: any = { id: "b", content: { u1: { topicId: "u1", title: "One", ...mk() }, u2: { topicId: "u2", title: "Two", ...mk() } } };
  gen.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ book: b3, audio: { id: "n" } });
  const { result } = renderHook(() => useGenerateAllNarration({ book: b3, getApiKey: async () => "sk", onBookChange: jest.fn(), intervalMs: 0 }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.finished).toBe(true));
  expect(result.current.failedCount).toBe(1);
  expect(result.current.doneCount).toBe(1);
});

it("cancel stops further topics", async () => {
  const b3: any = { id: "b", content: { u1: { topicId: "u1", title: "One", ...mk() }, u2: { topicId: "u2", title: "Two", ...mk() } } };
  gen.mockImplementation(async () => { act(() => result.current.cancel()); return { book: b3, audio: { id: "n" } }; });
  const { result } = renderHook(() => useGenerateAllNarration({ book: b3, getApiKey: async () => "sk", onBookChange: jest.fn(), intervalMs: 0 }));
  act(() => result.current.start());
  await waitFor(() => expect(result.current.running).toBe(false));
  expect(gen.mock.calls.length).toBeLessThan(2);
});
```

- [ ] **Step 2: Run, verify failure** — `cd mobile && npx jest useGenerateAllNarration` → FAIL.

- [ ] **Step 3: Implement the hook** — model on `useGenerateAll.ts` (read it):
  - Build `targets` = book's content-bearing topics (`Object.entries(book.content)` where the topic has a `lesson`), each `{ topicId, title }`. A topic already carrying `audio?.length` is seeded `status:"done"` and skipped by `start()` (gap-fill), unless a `force` option is passed (skip force for now — narration cap makes force ambiguous; omit).
  - State: `progress[]`, `running`, `finished`, `errorMsg`; `doneCount`/`failedCount`/`total` derived from `progress`.
  - `start()`: set running; a cancel `ref` (set false); loop targets sequentially, skipping `done`; for each, set `generating`, then `try { const { book: next } = await generateAndStoreTopicAudio({ book: currentBook, topicId, source_text: lessonToNarratableText(topic.lesson), provider_id:"openai", ...(apiKey?{apiKey}:{}) }); await onBookChange(next); currentBook = next; mark done } catch { mark failed; continue }`; check the cancel ref between topics and stop. Resolve `apiKey = await getApiKey()` once at start; apply the same `knownNotPro && !apiKey` guard → set `errorMsg` + don't run. Respect `intervalMs` (a small awaitable delay between topics; 0 in tests). **Thread the book through the loop** (each success returns a new book; the next topic must attach onto it) — persist via `onBookChange` after each.
  - `cancel()`: set the cancel ref true; set running false.
- [ ] **Step 3b: Implement `GenerateAllNarration.tsx`** — a compact control: a "Generate all narration" button (`start()`), a per-topic progress list (reuse the `STATUS_GLYPH` + row pattern from `app/book/generate/[id].tsx`), done/failed/total counts, and a Cancel while running. `getApiKey={() => loadApiKey("openai")}`, `onBookChange` persists via `saveBook` + updates the screen's book state. Mount it on the book home/studio (or the generate screen) — wherever the "Generate all topics" entry lives.

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest useGenerateAllNarration && npx tsc --noEmit` → PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/hooks/useGenerateAllNarration.ts mobile/src/components/GenerateAllNarration.tsx <the-screen-you-mounted-it-in> mobile/__tests__/hooks/useGenerateAllNarration.test.tsx
git commit -m "feat(audio): useGenerateAllNarration + batch UI (rung 4, client-side resumable)"
```

---

## Task 4: `bookBundle` carries audio (export + import round-trip)

**Files:**
- Modify: `mobile/src/storage/bookBundle.ts`
- Test: `mobile/__tests__/storage/bookBundle.test.ts`

**Interfaces:**
- Consumes: `extForAudioMime` / `isAllowedAudioMime` / `MAX_AUDIO_BYTES` (already imported in `bookBundle.ts`), `randomUUID`, `mediaFileRel` / `mediaDirRel` / `absPath`, `basenameOf`, the existing `writeImportedMedia` (image) as the pattern for a new `writeImportedAudio`.
- Produces: audio survives a `buildBookBundle`→`parseBookBundle` round-trip with re-minted ids/paths.

- [ ] **Step 1: Write the failing tests** (mock `expo-file-system` as the existing bundle tests do; add an audio clip to a fixture book)

```ts
// append to mobile/__tests__/storage/bookBundle.test.ts
it("round-trips a topic's audio (export includes the file; import restores under a fresh id/path)", async () => {
  // build a book with one audio clip whose file the FS mock can read as base64
  // ... (mirror the existing image round-trip test's setup)
  const bundle = await buildBookBundle(bookWithAudio);
  const back = await parseBookBundle(bundle);
  const aud = back.content!.u1!.audio!;
  expect(aud).toHaveLength(1);
  expect(aud[0].id).not.toBe("orig-audio-id");        // re-minted, never the bundle's id
  expect(aud[0].file).toMatch(/^media\/[0-9a-f-]+\/[0-9a-f-]+\.mp3$/); // under the new book id
  expect(aud[0].mime).toBe("audio/mpeg");
  expect(aud[0].transcript).toBe("hello"); // non-file metadata preserved
});

it("drops an audio clip with a disallowed mime / oversize / missing file, keeps the book", async () => {
  // a bundle whose audio ref mime is not allowed → clip dropped, import still succeeds
});

it("an audio-less book is byte-identical to today (existing image round-trip unaffected)", async () => {
  // the existing image-only test must still pass unchanged
});
```

(Model the setup on the file's existing image round-trip test — same FS mock, same `unzipSync` assertions.)

- [ ] **Step 2: Run, verify failure** — `cd mobile && npx jest bookBundle` → FAIL (audio not carried).

- [ ] **Step 3: Implement**
  - **Export (`buildBookBundle`):** after the per-topic image loop, add a per-topic `audio` loop: for each clip read `absPath(aud.file)` base64 → `mediaFiles["media/"+basenameOf(aud.file)] = bytes`; push `{ ...aud, file: "media/"+basenameOf(aud.file) }` to a `nextAudio`; a clip whose file can't be read is dropped with a `console.warn` (mirror the image branch). Set the topic's `audio: nextAudio` in the exported book JSON (alongside `images: nextImages`). Keep image-less+audio-less topics on the current fast path.
  - **Import (`parseBookBundle`):** after the image loop, add an `audio` loop mirroring it: guard each clip (`typeof aud.file==="string"`, else drop+warn); `entryKey = "media/"+basenameOf(aud.file)`; `data = entries[entryKey]` (missing→drop+warn); `isAllowedAudioMime(aud.mime)` (else drop+warn); `data.byteLength > MAX_AUDIO_BYTES` (else drop+warn); `ext = extForAudioMime(aud.mime)` (falsy→drop+warn); `const freshAudioId = randomUUID(); const rel = await writeImportedAudio(newId, freshAudioId, ext, data); nextAudio.push({ ...aud, id: freshAudioId, file: rel })`. Set `nextContent[topicId] = { ...gen, images: nextImages, audio: nextAudio }` (only include `audio` when the topic had any, to keep audio-less output identical). Add `writeImportedAudio(newBookId, audioId, ext, data)` mirroring `writeImportedMedia` but WITHOUT the EXIF strip (audio has none): write base64 to a temp file, `makeDirectoryAsync(mediaDirRel(newBookId))`, `copyAsync` to `absPath(mediaFileRel(newBookId, audioId, ext))`, delete the temp, return the rel path.
  - **Path-traversal:** the fresh id is generator-controlled and used for BOTH the filename and the ref id — never the bundle's `id`/`file` — exactly as images do.

- [ ] **Step 4: Run, verify pass** — `cd mobile && npx jest bookBundle && npx tsc --noEmit` → PASS + clean. Existing image tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/storage/bookBundle.ts mobile/__tests__/storage/bookBundle.test.ts
git commit -m "fix(audio): .book.zip export/import carries TopicAudio (rung 4 — closes round-trip loss)"
```

---

## Task 5: Help topic + tree leaf

**Files:**
- Modify: `mobile/src/help-content/features.ts`, `topics.ts`, `tree.ts`
- Test: `mobile/__tests__/help/coverage.test.ts` + tree gate (CI)

**Interfaces:** copy an existing feature's shape (e.g. `reader-audio` from rung 3, or `publish-audio`).

- [ ] **Step 1** Add `narrate-topic` to `FEATURES` (`features.ts`).
- [ ] **Step 2** Add a `HelpTopic` with `featureKey:"narrate-topic"` (`topics.ts`): how to generate narration for a topic (Generate narration button in the topic editor) and for a whole book (Generate all narration), that it needs an OpenAI key (Settings), that clips play in the reader and export with the book. Accurate to shipped behavior.
- [ ] **Step 3** Add a `HELP_TREE` leaf under the authoring/library branch (`tree.ts`), node id distinct from the topicId (follow the file's convention).
- [ ] **Step 4** Run `cd mobile && npx jest --testPathPattern=help` → coverage + tree gates PASS.
- [ ] **Step 5** Commit `docs(help): narrate-topic (rung 4 DoD)`.

---

## Self-Review

- **Spec coverage:** D1 NarrationPanel → T2; D2 useGenerateAllNarration → T3; D3 shared key+guard → inlined in T2/T3 (mirrors useMakeAudio; a shared helper is optional — the guard is 2 lines, duplicated deliberately rather than over-abstracted); D4 batch UI → T3; D5 bundle audio → T4; D6 Help → T5; deleteAudio + lessonToNarratableText → T1. Covered.
- **Type consistency:** `generateAndStoreTopicAudio({book,topicId,source_text,provider_id,apiKey?})` returns `{book,audio}` — used identically in T2 (single) and T3 (loop, threading `book`). `deleteAudio(book,topicId,audioId)→Book` (T1) called in T2. `useGenerateAllNarration` return surface matches `useGenerateAll`. `lessonToNarratableText(lesson)→string` (T1) used in T2+T3.
- **Placeholder scan:** the two real "find the exact thing" notes are (a) the `loadApiKey` module path (grep it — `posts.tsx` imports it) and (b) which screen hosts "Generate all topics" (mount the batch UI there). Both are locate-don't-invent, flagged in-task. No fabricated APIs.
- **Risk note:** `AudioNarrationPlayer`'s real props (base64 vs file uri) — read the component in T2 and pass what it wants (the spec assumes base64 via `resolveAudioDataUrls`; confirm). Everything else is mechanical mirroring of shipped templates.
