# Topic Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an author attach image files to a specific topic — stored device-local, rendered in a Figures block in both readers, embedded in the compiled EPUB/PDF, and carried in an export bundle. Free tier, no backend change.

**Architecture:** Bytes live on device (`expo-file-system`) under `media/<bookId>/`; the `Book` schema holds refs only (`TopicImage`). Bytes are materialized into base64 `data:` URIs only in two transient places that never persist: the reader's figure resolver and the compile payload. The remote compiler is unchanged — the app inflates refs into a synthetic "Figures" markdown section in the POSTed Book, which the existing `packImages()` extracts. Export becomes an `fflate` zip bundle (`.book.zip`).

**Tech Stack:** React Native + Expo (`expo-image-picker`, `expo-image-manipulator`, `expo-file-system`), TypeScript, `fflate` (already a dep), Jest + RNTL, jsdom-jest for pure builders.

**Spec:** `docs/superpowers/specs/2026-07-15-topic-images-attach-design.md`

## Global Constraints

- **Refs only in stored JSON.** `TopicImage.file` is a device-relative path; image bytes never appear in a stored `Book`/`.book.json`. Bytes → `data:` URI only in the reader resolver (§5) and compile payload (§6), both transient.
- **Local-only `src` invariant.** Every rendered `<img src>` is a `data:` URL built from a device file — never `http(s)://`. Tests assert this over the parsed DOM.
- **MIME allowlist:** `image/jpeg`, `image/png`, `image/webp` only. Reject others at pick/import.
- **Caps (exact values):** `MAX_IMAGE_BYTES = 10 * 1024 * 1024`; `MAX_IMAGES_PER_TOPIC = 20`; `MAX_MEDIA_PER_BOOK_BYTES = 100 * 1024 * 1024`. Any breach rejects the attach with a clear message; no partial write.
- **EXIF strip on every ingest.** Re-encode via `expo-image-manipulator` (drops all EXIF incl. GPS) on both attach and bundle-import.
- **Attach only where content exists.** The "Add figure" affordance appears only on a topic that already has a `GeneratedTopic` (`hasRenderableLesson`).
- **UUIDs via `@/lib/uuid` `randomUUID`** (Hermes has no global crypto). Never `crypto.randomUUID()`.
- **No live services in CI** (mock `expo-*`). **Help coverage gate** must stay green — a new `FEATURES` key requires a matching `HelpTopic`.
- **Two readers kept in step:** `mobile/src/reader/renderContent.ts` (web) and `mobile/src/components/contentHtml.ts` (in-app WebView) both emit the Figures block via one shared pure builder.

---

## File Structure

**Create:**
- `mobile/src/storage/mediaPaths.ts` — pure path/constant helpers (dirs, caps, MIME↔ext).
- `mobile/src/storage/mediaStore.ts` — device media I/O: attach, delete, resolve→dataURL, prune, delete-book-media.
- `mobile/src/lib/figuresHtml.ts` — pure shared builder: `renderFiguresHtml(images, dataUrls)`.
- `mobile/src/reader/useTopicFigures.ts` — hook resolving a topic's images → `Map<id, dataUrl>`.
- `mobile/src/lib/compilePayload.ts` — `buildCompilePayload(book)` inflating refs → transient Figures sections.
- `mobile/src/storage/bookBundle.ts` — `exportBookBundle` / `parseBookBundle` (fflate).
- `mobile/src/components/FiguresPanel.tsx` — attach/caption/reorder/delete UI for a topic.
- Test files mirroring each above under `mobile/__tests__/…`.

**Modify:**
- `mobile/src/types/book.ts` — add `TopicImage` + `GeneratedTopic.images`.
- `mobile/src/reader/renderContent.ts` — `renderTopicToSafeHtml(topic, dataUrls?)` appends Figures.
- `mobile/src/components/contentHtml.ts` — `buildTopicHtml(topic, dataUrls?)` appends Figures.
- `mobile/app/book/topic/[bookId]/[topicId].tsx` — mount `FiguresPanel`; pass resolved figures to renderer.
- `mobile/src/lib/trackedExport.ts` (or `mobile/src/api/client.ts exportBook`) — inflate payload before POST.
- `mobile/src/storage/pickBookFile.ts` — add a `.book.zip` picker branch.
- `mobile/src/components/ExportBookJsonButton.tsx` — export a bundle when the book has media.
- `mobile/app/book/import.tsx` — route zip imports through `parseBookBundle`.
- `mobile/src/help-content/features.ts` + `topics.ts` — add the `figures` feature + topic.
- `SCOPE.md` — note the author-supplied media class (attach-only).

---

## Task 1: Schema + path/cap constants

**Files:**
- Modify: `mobile/src/types/book.ts:136` (`GeneratedTopic`)
- Create: `mobile/src/storage/mediaPaths.ts`
- Test: `mobile/__tests__/storage/mediaPaths.test.ts`

**Interfaces:**
- Produces: `TopicImage`, `GeneratedTopic.images?`; `mediaDirRel(bookId)`, `mediaFileRel(bookId, id, ext)`, `absPath(rel)`, `extForMime(mime)`, `MIME_ALLOWLIST`, `MAX_IMAGE_BYTES`, `MAX_IMAGES_PER_TOPIC`, `MAX_MEDIA_PER_BOOK_BYTES`.

- [ ] **Step 1: Add the type.** In `mobile/src/types/book.ts`, above `GeneratedTopic` (line ~134), add:

```ts
// An image file attached by the author to a topic (media feature slice 1).
// Ref only: bytes live on device at `media/<bookId>/<id>.<ext>` (see mediaStore);
// they are never stored in this JSON. Rendered in a Figures block and inflated
// into the compile payload as a data: URI.
export interface TopicImage {
  id: string;        // randomUUID (@/lib/uuid)
  file: string;      // device-relative, e.g. "media/<bookId>/<id>.jpg"
  mime: string;      // one of MIME_ALLOWLIST
  caption?: string;  // plain-text caption / alt
  width?: number;
  height?: number;
  addedAt: string;   // ISO
}
```

Then add to `GeneratedTopic` (after `revisionCount?`):

```ts
  // Author-attached images for this topic (ordered = render order). Refs only.
  images?: TopicImage[];
```

- [ ] **Step 2: Write the failing test** — `mobile/__tests__/storage/mediaPaths.test.ts`:

```ts
import {
  mediaDirRel, mediaFileRel, extForMime, MIME_ALLOWLIST,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC,
} from "@/storage/mediaPaths";

describe("mediaPaths", () => {
  it("builds book-scoped relative paths", () => {
    expect(mediaDirRel("bk1")).toBe("media/bk1");
    expect(mediaFileRel("bk1", "img9", "png")).toBe("media/bk1/img9.png");
  });
  it("maps allowed mimes to extensions and rejects others", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/webp")).toBe("webp");
    expect(extForMime("image/gif")).toBeNull();
    expect(MIME_ALLOWLIST).toEqual(["image/jpeg", "image/png", "image/webp"]);
  });
  it("exposes caps", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(MAX_IMAGES_PER_TOPIC).toBe(20);
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/storage/mediaPaths.test.ts`
Expected: FAIL — `Cannot find module '@/storage/mediaPaths'`.

- [ ] **Step 4: Implement** — `mobile/src/storage/mediaPaths.ts`:

```ts
import * as FileSystem from "expo-file-system";

export const MIME_ALLOWLIST = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedMime = (typeof MIME_ALLOWLIST)[number];

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES_PER_TOPIC = 20;
export const MAX_MEDIA_PER_BOOK_BYTES = 100 * 1024 * 1024;

export function extForMime(mime: string): string | null {
  return MIME_EXT[mime] ?? null;
}

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (MIME_ALLOWLIST as readonly string[]).includes(mime);
}

/** Device-relative media dir for a book, e.g. "media/<bookId>". */
export function mediaDirRel(bookId: string): string {
  return `media/${bookId}`;
}

/** Device-relative file path, e.g. "media/<bookId>/<id>.<ext>". */
export function mediaFileRel(bookId: string, id: string, ext: string): string {
  return `${mediaDirRel(bookId)}/${id}.${ext}`;
}

/** Absolute FS path for a device-relative ref (documentDirectory + rel). */
export function absPath(rel: string): string {
  return `${FileSystem.documentDirectory}${rel}`;
}
```

- [ ] **Step 5: Run — verify it passes**

Run: `cd mobile && npx jest __tests__/storage/mediaPaths.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/types/book.ts mobile/src/storage/mediaPaths.ts mobile/__tests__/storage/mediaPaths.test.ts
git commit -m "feat(media): TopicImage schema + media path/cap constants"
```

---

## Task 2: Media storage layer + deps

**Files:**
- Create: `mobile/src/storage/mediaStore.ts`
- Modify: `mobile/package.json` (add `expo-image-picker`, `expo-image-manipulator`)
- Test: `mobile/__tests__/storage/mediaStore.test.ts`

**Interfaces:**
- Consumes: Task 1 paths/caps; `Book`, `TopicImage`, `GeneratedTopic` (`@/types/book`); `randomUUID` (`@/lib/uuid`); `setTopicContent` (`@/storage/bookStore`).
- Produces:
  - `attachImage(book: Book, topicId: string, src: PickedImage): Promise<Book>`
  - `deleteImage(book: Book, topicId: string, imageId: string): Promise<Book>`
  - `resolveFigureDataUrls(topic: GeneratedTopic): Promise<Map<string, string>>`
  - `pruneOrphanMedia(book: Book): Promise<void>`
  - `deleteBookMedia(bookId: string): Promise<void>`
  - `type PickedImage = { uri: string; mime: string; width?: number; height?: number; fileSize?: number }`
  - `class MediaCapError extends Error` (thrown on cap/mime breach)

- [ ] **Step 1: Add deps.** In `mobile/package.json` `dependencies`, add (versions aligned to Expo SDK 53):

```json
    "expo-image-manipulator": "~13.1.5",
    "expo-image-picker": "~16.1.4",
```

Run: `cd mobile && npx expo install expo-image-picker expo-image-manipulator` (reconciles exact versions).

- [ ] **Step 2: Write the failing test** — `mobile/__tests__/storage/mediaStore.test.ts`.
Mock `expo-file-system`, `expo-image-manipulator`. Use a fake in-memory file map.

```ts
import type { Book } from "@/types/book";

jest.mock("expo-file-system", () => {
  const files: Record<string, string> = {};
  return {
    documentDirectory: "file:///doc/",
    getInfoAsync: jest.fn(async (p: string) => ({ exists: p in files, size: 1234, uri: p })),
    makeDirectoryAsync: jest.fn(async () => {}),
    copyAsync: jest.fn(async ({ to }: { to: string }) => { files[to] = "COPIED"; }),
    deleteAsync: jest.fn(async (p: string) => { delete files[p]; }),
    readAsStringAsync: jest.fn(async () => "QUJD"), // base64 "ABC"
    readDirectoryAsync: jest.fn(async () => Object.keys(files).map((f) => f.split("/").pop()!)),
    __files: files,
    EncodingType: { Base64: "base64" },
  };
});
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async (uri: string) => ({ uri: uri + ".stripped", width: 10, height: 8 })),
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

import { attachImage, deleteImage, resolveFigureDataUrls, MediaCapError } from "@/storage/mediaStore";
import { MAX_IMAGE_BYTES } from "@/storage/mediaPaths";

function bookWithTopic(): Book {
  return {
    id: "bk1", title: "T",
    toc: { subjects: [{ title: "S", units: [{ id: "t1", title: "U" }] }] } as any,
    createdAt: "x", updatedAt: "x",
    content: { t1: { topicId: "t1", title: "U", lesson: { topic: "U", synopsis: "s", sections: [] } as any, generatedAt: "x" } },
  };
}

describe("mediaStore", () => {
  it("attaches an image: strips EXIF, writes a ref, bytes stay off the book", async () => {
    const book = await attachImage(bookWithTopic(), "t1", { uri: "file:///pick.jpg", mime: "image/jpeg", fileSize: 2000 });
    const imgs = book.content!.t1.images!;
    expect(imgs).toHaveLength(1);
    expect(imgs[0].file).toMatch(/^media\/bk1\/.+\.jpg$/);
    expect(JSON.stringify(book)).not.toContain("data:"); // refs only
  });

  it("rejects a disallowed mime", async () => {
    await expect(
      attachImage(bookWithTopic(), "t1", { uri: "file:///a.gif", mime: "image/gif" }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("rejects an oversize image", async () => {
    await expect(
      attachImage(bookWithTopic(), "t1", { uri: "file:///big.jpg", mime: "image/jpeg", fileSize: MAX_IMAGE_BYTES + 1 }),
    ).rejects.toBeInstanceOf(MediaCapError);
  });

  it("resolves refs to data: URLs", async () => {
    const book = await attachImage(bookWithTopic(), "t1", { uri: "file:///pick.png", mime: "image/png", fileSize: 10 });
    const map = await resolveFigureDataUrls(book.content!.t1);
    const url = [...map.values()][0];
    expect(url).toMatch(/^data:image\/png;base64,/);
  });

  it("delete removes the ref", async () => {
    let book = await attachImage(bookWithTopic(), "t1", { uri: "file:///pick.png", mime: "image/png", fileSize: 10 });
    const id = book.content!.t1.images![0].id;
    book = await deleteImage(book, "t1", id);
    expect(book.content!.t1.images).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/storage/mediaStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — `mobile/src/storage/mediaStore.ts`:

```ts
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { Book, GeneratedTopic, TopicImage } from "@/types/book";
import { randomUUID } from "@/lib/uuid";
import {
  absPath, extForMime, isAllowedMime, mediaDirRel, mediaFileRel,
  MAX_IMAGE_BYTES, MAX_IMAGES_PER_TOPIC, MAX_MEDIA_PER_BOOK_BYTES,
} from "@/storage/mediaPaths";

export type PickedImage = {
  uri: string; mime: string; width?: number; height?: number; fileSize?: number;
};

export class MediaCapError extends Error {}

const SAVE_FORMAT: Record<string, ImageManipulator.SaveFormat> = {
  "image/jpeg": ImageManipulator.SaveFormat.JPEG,
  "image/png": ImageManipulator.SaveFormat.PNG,
  "image/webp": ImageManipulator.SaveFormat.WEBP,
};

function topicImages(book: Book, topicId: string): TopicImage[] {
  return book.content?.[topicId]?.images ?? [];
}

async function bookMediaBytes(book: Book): Promise<number> {
  let total = 0;
  for (const gen of Object.values(book.content ?? {})) {
    for (const img of gen.images ?? []) {
      const info = await FileSystem.getInfoAsync(absPath(img.file));
      if (info.exists && typeof info.size === "number") total += info.size;
    }
  }
  return total;
}

/** Copy a picked image into the book's media dir, stripping EXIF, and append a ref. */
export async function attachImage(book: Book, topicId: string, src: PickedImage): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen) throw new MediaCapError("Add content to this topic before attaching a figure.");
  if (!isAllowedMime(src.mime)) throw new MediaCapError("Only JPEG, PNG or WebP images are supported.");
  if (typeof src.fileSize === "number" && src.fileSize > MAX_IMAGE_BYTES) {
    throw new MediaCapError("That image is too large (max 10 MB).");
  }
  if (topicImages(book, topicId).length >= MAX_IMAGES_PER_TOPIC) {
    throw new MediaCapError(`A topic can hold at most ${MAX_IMAGES_PER_TOPIC} figures.`);
  }
  if ((await bookMediaBytes(book)) + (src.fileSize ?? 0) > MAX_MEDIA_PER_BOOK_BYTES) {
    throw new MediaCapError("This book has reached its image storage limit.");
  }

  // Re-encode to strip EXIF (incl. GPS). No transform ops = format/quality pass only.
  const stripped = await ImageManipulator.manipulateAsync(src.uri, [], {
    compress: 0.9,
    format: SAVE_FORMAT[src.mime],
  });

  const ext = extForMime(src.mime)!;
  const id = randomUUID();
  const rel = mediaFileRel(book.id, id, ext);
  await FileSystem.makeDirectoryAsync(absPath(mediaDirRel(book.id)), { intermediates: true });
  await FileSystem.copyAsync({ from: stripped.uri, to: absPath(rel) });

  const image: TopicImage = {
    id, file: rel, mime: src.mime, width: stripped.width, height: stripped.height,
    addedAt: new Date().toISOString(),
  };
  const nextGen: GeneratedTopic = { ...gen, images: [...(gen.images ?? []), image] };
  return { ...book, content: { ...book.content, [topicId]: nextGen }, updatedAt: new Date().toISOString() };
}

export async function deleteImage(book: Book, topicId: string, imageId: string): Promise<Book> {
  const gen = book.content?.[topicId];
  if (!gen?.images) return book;
  const img = gen.images.find((i) => i.id === imageId);
  const nextGen: GeneratedTopic = { ...gen, images: gen.images.filter((i) => i.id !== imageId) };
  const next = { ...book, content: { ...book.content, [topicId]: nextGen }, updatedAt: new Date().toISOString() };
  if (img) await FileSystem.deleteAsync(absPath(img.file), { idempotent: true }).catch(() => {});
  return next;
}

/** Read each of a topic's images into a data: URL keyed by image id. */
export async function resolveFigureDataUrls(topic: GeneratedTopic): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const img of topic.images ?? []) {
    try {
      const b64 = await FileSystem.readAsStringAsync(absPath(img.file), {
        encoding: FileSystem.EncodingType.Base64,
      });
      out.set(img.id, `data:${img.mime};base64,${b64}`);
    } catch {
      // Missing file → skip (renderer omits that figure).
    }
  }
  return out;
}

/** Delete any file under media/<bookId>/ not referenced by a surviving ref. */
export async function pruneOrphanMedia(book: Book): Promise<void> {
  const dir = absPath(mediaDirRel(book.id));
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return;
  const referenced = new Set<string>();
  for (const gen of Object.values(book.content ?? {})) {
    for (const img of gen.images ?? []) referenced.add(img.file.split("/").pop()!);
  }
  const names = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(
    names.filter((n) => !referenced.has(n)).map((n) =>
      FileSystem.deleteAsync(`${dir}/${n}`, { idempotent: true }).catch(() => {}),
    ),
  );
}

export async function deleteBookMedia(bookId: string): Promise<void> {
  await FileSystem.deleteAsync(absPath(mediaDirRel(bookId)), { idempotent: true }).catch(() => {});
}
```

- [ ] **Step 5: Run — verify it passes**

Run: `cd mobile && npx jest __tests__/storage/mediaStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/storage/mediaStore.ts mobile/__tests__/storage/mediaStore.test.ts
git commit -m "feat(media): device media store (attach/delete/resolve/prune) + expo-image-picker/manipulator"
```

---

## Task 3: Shared Figures HTML builder + both renderers + sanitize proof

**Files:**
- Create: `mobile/src/lib/figuresHtml.ts`, `mobile/src/reader/useTopicFigures.ts`
- Modify: `mobile/src/reader/renderContent.ts:114`, `mobile/src/components/contentHtml.ts:316`
- Test: `mobile/__tests__/lib/figuresHtml.test.ts`, `mobile/__tests__/reader/figures-sanitize.test.ts`

**Interfaces:**
- Consumes: Task 1 `TopicImage`; `escapeHtml` (`@/reader/markdown` for web; a local escaper for contentHtml); `sanitizeFragment` (`@/reader/sanitize`); `resolveFigureDataUrls` (Task 2).
- Produces: `renderFiguresHtml(images: TopicImage[], dataUrls: Map<string,string>): string`; `renderTopicToSafeHtml(topic, dataUrls?)`; `buildTopicHtml(topic, dataUrls?)`; `useTopicFigures(topic): Map<string,string>`.

- [ ] **Step 1: Write the failing test** — `mobile/__tests__/lib/figuresHtml.test.ts`:

```ts
import { renderFiguresHtml } from "@/lib/figuresHtml";
import type { TopicImage } from "@/types/book";

const img = (id: string, caption?: string): TopicImage => ({
  id, file: `media/b/${id}.png`, mime: "image/png", caption, addedAt: "x",
});

describe("renderFiguresHtml", () => {
  it("returns empty string when no images resolve", () => {
    expect(renderFiguresHtml([], new Map())).toBe("");
    expect(renderFiguresHtml([img("a")], new Map())).toBe(""); // no dataUrl → skipped
  });
  it("emits a figure per resolved image with escaped caption and data: src", () => {
    const urls = new Map([["a", "data:image/png;base64,AAAA"]]);
    const html = renderFiguresHtml([img("a", "A <b>cap</b>")], urls);
    expect(html).toContain('<section class="figures">');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain("A &lt;b&gt;cap&lt;/b&gt;");
    expect(html).not.toContain("<b>cap</b>");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/lib/figuresHtml.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder** — `mobile/src/lib/figuresHtml.ts`:

```ts
import type { TopicImage } from "@/types/book";

// Self-contained HTML escaper (this module is imported by both the web reader and
// the WebView builder; keep it dependency-free).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A "Figures" section for a topic's attached images. Only images whose id has a
 * resolved data: URL are rendered. `src` is ALWAYS a caller-provided data: URL
 * (never remote) — the local-only invariant.
 */
export function renderFiguresHtml(images: TopicImage[], dataUrls: Map<string, string>): string {
  const figs = (images ?? [])
    .map((img) => {
      const src = dataUrls.get(img.id);
      if (!src) return "";
      const cap = img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : "";
      return `<figure class="attached-figure"><img src="${esc(src)}" alt="${esc(img.caption ?? "")}">${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
  if (!figs) return "";
  return `<hr class="section-divider"><section class="figures"><h3>Figures</h3>${figs}</section>`;
}
```

- [ ] **Step 4: Run the builder test — verify it passes**

Run: `cd mobile && npx jest __tests__/lib/figuresHtml.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the web reader.** In `mobile/src/reader/renderContent.ts`, add the import at top and change the export (line 114):

```ts
import { renderFiguresHtml } from "@/lib/figuresHtml";
```

```ts
export function renderTopicToSafeHtml(
  topic: GeneratedTopic,
  dataUrls?: Map<string, string>,
): string {
  let html = renderLesson(topic.lesson);
  if (topic.tutorial) html += renderTutorial(topic.tutorial);
  if (topic.quizSets?.length) html += renderQuizzes(topic.quizSets);
  if (topic.experiment) html += renderExperiment(topic.experiment);
  if (topic.images?.length && dataUrls?.size) html += renderFiguresHtml(topic.images, dataUrls);
  return sanitizeFragment(html);
}
```

- [ ] **Step 6: Wire into the WebView builder.** In `mobile/src/components/contentHtml.ts`, add the import and thread the arg into `buildTopicHtml` (line 316) — append the figures HTML into the body string before it is wrapped by `htmlDocument(...)`:

```ts
import { renderFiguresHtml } from "@/lib/figuresHtml";
```

```ts
export function buildTopicHtml(topic: GeneratedTopic, dataUrls?: Map<string, string>): string {
  const figures =
    topic.images?.length && dataUrls?.size ? renderFiguresHtml(topic.images, dataUrls) : "";
  return htmlDocument(
    /* existing body expression */ + figures,  // append figures to the assembled body
  );
}
```

(Read `contentHtml.ts:316-330` and insert `figures` into the concatenated body string passed to `htmlDocument`; do not alter the document shell.)

- [ ] **Step 7: Sanitize proof test** — `mobile/__tests__/reader/figures-sanitize.test.ts` (jsdom env; the reader already relies on jsdom for DOMPurify):

```ts
/** @jest-environment jsdom */
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import type { GeneratedTopic } from "@/types/book";

const topic: GeneratedTopic = {
  topicId: "t", title: "T",
  lesson: { topic: "T", synopsis: "s", learning_objectives: [], sections: [], key_takeaways: [] } as any,
  images: [{ id: "a", file: "media/b/a.png", mime: "image/png", caption: "Cap", addedAt: "x" }],
  generatedAt: "x",
};

describe("figures survive sanitize with a data: src", () => {
  it("keeps the data: URL and never emits a remote src", () => {
    const html = renderTopicToSafeHtml(topic, new Map([["a", "data:image/png;base64,iVBORw0KGgo="]]));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = [...doc.querySelectorAll("img")];
    expect(imgs).toHaveLength(1);
    for (const el of imgs) expect(el.getAttribute("src")!).toMatch(/^data:image\//);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
```

If this test shows DOMPurify stripped the `<img>`/`data:` src or `<figure>`/`<figcaption>`, add the minimum to `SANITIZE_CONFIG` in `mobile/src/reader/sanitize.ts` (`ADD_TAGS: [...ANIMATION_TAGS, "figure", "figcaption"]` and/or `ADD_DATA_URI_TAGS: ["img"]`) — and only that. Re-run.

- [ ] **Step 8: Implement the resolver hook** — `mobile/src/reader/useTopicFigures.ts`:

```ts
import { useEffect, useState } from "react";
import type { GeneratedTopic } from "@/types/book";
import { resolveFigureDataUrls } from "@/storage/mediaStore";

/** Resolve a topic's attached images to a data:URL map for rendering. */
export function useTopicFigures(topic: GeneratedTopic | null | undefined): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    if (!topic?.images?.length) { setUrls(new Map()); return; }
    resolveFigureDataUrls(topic).then((m) => { if (live) setUrls(m); });
    return () => { live = false; };
  }, [topic]);
  return urls;
}
```

- [ ] **Step 9: Run all Task 3 tests**

Run: `cd mobile && npx jest __tests__/lib/figuresHtml.test.ts __tests__/reader/figures-sanitize.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add mobile/src/lib/figuresHtml.ts mobile/src/reader/useTopicFigures.ts mobile/src/reader/renderContent.ts mobile/src/components/contentHtml.ts mobile/src/reader/sanitize.ts mobile/__tests__/lib/figuresHtml.test.ts mobile/__tests__/reader/figures-sanitize.test.ts
git commit -m "feat(media): shared Figures builder wired into both readers; sanitize keeps data: img"
```

---

## Task 4: Attach UX — picker + FiguresPanel on the topic screen

**Files:**
- Create: `mobile/src/components/FiguresPanel.tsx`
- Modify: `mobile/app/book/topic/[bookId]/[topicId].tsx` (action bar `:175-207`; render `:258-266`)
- Test: `mobile/__tests__/components/FiguresPanel.test.tsx`

**Interfaces:**
- Consumes: `attachImage`, `deleteImage`, `PickedImage`, `MediaCapError` (Task 2); `useTopicFigures` (Task 3); `saveBook`, `pruneOrphanMedia`; `Alert` from `@/lib/alert` (web-safe — RN-web no-ops `Alert.alert`); `expo-image-picker`.
- Produces: `<FiguresPanel book topicId onBookChange />`.

- [ ] **Step 1: Write the failing test** — `mobile/__tests__/components/FiguresPanel.test.tsx`.
Mock `expo-image-picker` to return one asset; assert `attachImage` path updates and a thumbnail renders. (RNTL; mock `@/storage/mediaStore` + `expo-image-picker`.)

```tsx
import React from "react";
import { render, fireEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [{ uri: "file:///p.jpg", mimeType: "image/jpeg", width: 4, height: 3, fileSize: 100 }],
  })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
}));
const attachImage = jest.fn(async (b) => ({ ...b, __attached: true }));
jest.mock("@/storage/mediaStore", () => ({
  attachImage: (...a: any[]) => attachImage(...a),
  deleteImage: jest.fn(async (b) => b),
  resolveFigureDataUrls: jest.fn(async () => new Map()),
}));
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));

import { FiguresPanel } from "@/components/FiguresPanel";

const book: any = {
  id: "b", title: "T", content: { t1: { topicId: "t1", title: "U", lesson: {}, generatedAt: "x", images: [] } },
};

it("adds an image from the library", async () => {
  const onBookChange = jest.fn();
  const { getByText } = render(<FiguresPanel book={book} topicId="t1" onBookChange={onBookChange} />);
  fireEvent.press(getByText(/Add figure/i));
  fireEvent.press(getByText(/Choose from library/i));
  await waitFor(() => expect(attachImage).toHaveBeenCalled());
  await waitFor(() => expect(onBookChange).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/components/FiguresPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `FiguresPanel.tsx`.** Renders the topic's images (thumbnails via `useTopicFigures`), an "Add figure" button opening a library/camera choice, per-image caption edit + delete. On any mutation: call the store, `await saveBook(next)`, `await pruneOrphanMedia(next)`, then `onBookChange(next)`. Wrap `attachImage` in try/catch and surface `MediaCapError.message` via `Alert.alert` (from `@/lib/alert`). Use `expo-image-picker` with `mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1`; map the asset to `PickedImage` (`{ uri, mime: asset.mimeType, width, height, fileSize: asset.fileSize }`). Voice: "Add figure", "Choose from library", "Take photo" — never "upload to AI". Include a one-line note "Figures stay on your device."

(Full component — follow the existing panel pattern at `[topicId].tsx:209-240` for styling; use `@/constants/theme` colors and `sizeMd` typography API. Keep it under ~180 lines.)

- [ ] **Step 4: Run — verify it passes**

Run: `cd mobile && npx jest __tests__/components/FiguresPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Mount on the topic screen.** In `mobile/app/book/topic/[bookId]/[topicId].tsx`:
- Import `FiguresPanel` and `useTopicFigures`.
- Below the action bar (after `:207`), when `topic` is truthy (has content), render `<FiguresPanel book={book} topicId={topicId} onBookChange={setBook} />`.
- Compute `const figures = useTopicFigures(topic);` and pass it to the renderer: `<TopicRenderer topic={topic} figures={figures} />` — thread `figures` through `LessonRenderer`/`TopicRenderer` into `buildTopicHtml(topic, figures)`.

- [ ] **Step 6: Thread `figures` through `TopicRenderer`.** In `mobile/src/components/LessonRenderer.tsx`, add an optional `figures?: Map<string,string>` prop to `TopicRenderer` and pass it to `buildTopicHtml(topic, figures)` (`:62`).

- [ ] **Step 7: Run the topic-screen + renderer tests**

Run: `cd mobile && npx jest __tests__/components/FiguresPanel.test.tsx __tests__/ -t "topic"`
Expected: PASS; no regressions in existing LessonRenderer tests.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/components/FiguresPanel.tsx mobile/app/book/topic/ mobile/src/components/LessonRenderer.tsx mobile/__tests__/components/FiguresPanel.test.tsx
git commit -m "feat(media): Figures panel on topic screen (pick/caption/delete) + render attached figures"
```

---

## Task 5: Compile-payload inflation

**Files:**
- Create: `mobile/src/lib/compilePayload.ts`
- Modify: `mobile/src/lib/trackedExport.ts` (or `mobile/src/api/client.ts exportBook`) — inflate before POST
- Test: `mobile/__tests__/lib/compilePayload.test.ts`

**Interfaces:**
- Consumes: `resolveFigureDataUrls` (Task 2); `Book`, `LessonSection` (`@/types/book`, `@/types/lesson`).
- Produces: `buildCompilePayload(book: Book): Promise<Book>` — a deep copy where each topic with images gains a trailing "Figures" `LessonSection`; the input is not mutated.

- [ ] **Step 1: Write the failing test** — `mobile/__tests__/lib/compilePayload.test.ts`:

```ts
jest.mock("@/storage/mediaStore", () => ({
  resolveFigureDataUrls: jest.fn(async (t: any) =>
    new Map((t.images ?? []).map((i: any) => [i.id, `data:${i.mime};base64,ZZ`])),
  ),
}));
import { buildCompilePayload } from "@/lib/compilePayload";
import type { Book } from "@/types/book";

const book: Book = {
  id: "b", title: "T",
  toc: { subjects: [] } as any, createdAt: "x", updatedAt: "x",
  content: {
    t1: {
      topicId: "t1", title: "U", generatedAt: "x",
      lesson: { topic: "U", synopsis: "s", learning_objectives: [], sections: [{ heading: "H", body_markdown: "b" }], key_takeaways: [] } as any,
      images: [{ id: "a", file: "media/b/a.jpg", mime: "image/jpeg", caption: "Cap", addedAt: "x" }],
    },
  },
};

it("appends a Figures section with a data: image; stored book untouched", async () => {
  const payload = await buildCompilePayload(book);
  const secs = payload.content!.t1.lesson.sections;
  expect(secs.at(-1)!.heading).toBe("Figures");
  expect(secs.at(-1)!.body_markdown).toContain("![Fig 1. Cap](data:image/jpeg;base64,ZZ)");
  // input not mutated:
  expect(book.content!.t1.lesson.sections).toHaveLength(1);
  expect(JSON.stringify(book)).not.toContain("data:");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/lib/compilePayload.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `mobile/src/lib/compilePayload.ts`:

```ts
import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls } from "@/storage/mediaStore";

function mdEsc(s: string): string {
  return s.replace(/([[\]()\\])/g, "\\$1");
}

/**
 * Deep-copy the book and, for each topic with attached images, append a synthetic
 * "Figures" lesson section whose markdown embeds each image as a data: URI. The
 * remote compiler's packImages() extracts these into EPUB resources; the PDF path
 * renders the same inline <img>. The stored book is never mutated (refs only).
 */
export async function buildCompilePayload(book: Book): Promise<Book> {
  const copy: Book = JSON.parse(JSON.stringify(book));
  for (const [id, gen] of Object.entries(copy.content ?? {})) {
    const g = gen as GeneratedTopic;
    if (!g.images?.length) continue;
    const urls = await resolveFigureDataUrls(g);
    const md = g.images
      .map((img, i) => {
        const src = urls.get(img.id);
        if (!src) return "";
        const cap = img.caption ? `${mdEsc(img.caption)}` : "";
        return `![Fig ${i + 1}. ${cap}](${src})`;
      })
      .filter(Boolean)
      .join("\n\n");
    if (!md) continue;
    const section: LessonSection = { heading: "Figures", body_markdown: md };
    g.lesson.sections = [...(g.lesson.sections ?? []), section];
  }
  return copy;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd mobile && npx jest __tests__/lib/compilePayload.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into export.** In `mobile/src/lib/trackedExport.ts`, before calling `exportBook(book, …)`, replace `book` with `await buildCompilePayload(book)` (applies to both `epub` and `pdf`; the `cover` format may skip inflation — covers don't use content images). Confirm the seam: `exportBook` receives the payload, not the stored book.

- [ ] **Step 6: Add a wiring test** — assert `trackedExport` passes an inflated payload for a book with images (mock `exportBook`, assert its arg's topic has the Figures section). Run:

Run: `cd mobile && npx jest __tests__/lib/trackedExport`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/lib/compilePayload.ts mobile/src/lib/trackedExport.ts mobile/__tests__/lib/compilePayload.test.ts mobile/__tests__/lib/trackedExport*
git commit -m "feat(media): inflate attached images into a data: Figures section for the compile payload"
```

---

## Task 6: Export/import bundle (fflate)

**Files:**
- Create: `mobile/src/storage/bookBundle.ts`
- Modify: `mobile/src/components/ExportBookJsonButton.tsx`, `mobile/src/storage/pickBookFile.ts`, `mobile/app/book/import.tsx`
- Test: `mobile/__tests__/storage/bookBundle.test.ts`

**Interfaces:**
- Consumes: `fflate` (`zipSync`, `unzipSync`, `strToU8`, `strFromU8`); `Book`, `TopicImage`; `absPath`, `mediaDirRel`, `mediaFileRel`, `isAllowedMime`, `MAX_IMAGE_BYTES` (Task 1); `parseBook` (`@/storage/importBook`); `randomUUID`; `expo-file-system`; `expo-image-manipulator` (re-strip EXIF on import).
- Produces: `exportBookBundle(book: Book): Promise<Uint8Array>`; `parseBookBundle(bytes: Uint8Array): Promise<Book>`.

- [ ] **Step 1: Write the failing test** — `mobile/__tests__/storage/bookBundle.test.ts`. Mock FS + manipulator (reuse Task 2's mock shape). Round-trip: export a book with one image → unzip contains `book.json` + `media/…`; import rewrites the ref to the new book id and writes the file.

```ts
// (reuse the expo-file-system + expo-image-manipulator mocks from mediaStore.test.ts)
import { exportBookBundle, parseBookBundle } from "@/storage/bookBundle";
import { unzipSync, strFromU8 } from "fflate";
// ...build a book with content.t1.images = [{ id:"a", file:"media/b/a.png", mime:"image/png", addedAt:"x" }]
it("round-trips a book + media through a zip bundle", async () => {
  const zip = await exportBookBundle(book);
  const entries = unzipSync(zip);
  expect(Object.keys(entries)).toContain("book.json");
  expect(Object.keys(entries).some((k) => k.startsWith("media/"))).toBe(true);
  const back = await parseBookBundle(zip);
  expect(back.id).not.toBe(book.id);              // fresh id on import
  expect(back.content!.t1.images![0].file).toMatch(new RegExp(`^media/${back.id}/`));
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/storage/bookBundle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `bookBundle.ts`.** `exportBookBundle`: prune orphans, collect each referenced media file's bytes (read base64 → `Uint8Array`), rewrite refs to `media/<basename>` inside a book copy, `zipSync({ "book.json": strToU8(json), "media/<basename>": bytes, … })`. `parseBookBundle`: `unzipSync`, `parseBook(strFromU8(entries["book.json"]))` (which assigns/keeps ids — force a fresh `book.id = randomUUID()`), then for each `media/*` entry: validate mime by extension + byte cap, re-strip EXIF via manipulator, write to `absPath(mediaFileRel(newId, id, ext))`, and set the matching `TopicImage.file`. Drop refs whose file is absent/invalid with a collected warning.

- [ ] **Step 4: Run — verify it passes**

Run: `cd mobile && npx jest __tests__/storage/bookBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Export button.** In `ExportBookJsonButton.tsx`: if the book has any `images`, call `exportBookBundle(book)` → `downloadArtifact(bytes, "${slug}.book.zip", "application/zip")` (`epubLibrary.ts:59`); else keep the existing `.book.json` text path.

- [ ] **Step 6: Import.** In `pickBookFile.ts`, add `pickBookBundleContents()` that accepts `application/zip`/`.book.zip` and returns bytes (mirror `pickEpubFile` `:76-95`). In `mobile/app/book/import.tsx`, branch: zip bytes → `parseBookBundle` → `saveBook`; JSON text → existing `importBook`.

- [ ] **Step 7: Run import/export tests + regressions**

Run: `cd mobile && npx jest __tests__/storage/bookBundle.test.ts __tests__/storage/importBook* __tests__/storage/pickBookFile*`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/storage/bookBundle.ts mobile/src/components/ExportBookJsonButton.tsx mobile/src/storage/pickBookFile.ts mobile/app/book/import.tsx mobile/__tests__/storage/bookBundle.test.ts
git commit -m "feat(media): .book.zip export/import bundle (fflate); EXIF re-stripped on import"
```

---

## Task 7: Help topic + SCOPE note

**Files:**
- Modify: `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`, `SCOPE.md`
- Test: `mobile/__tests__/help/coverage.test.ts` (existing gate — must stay green)

**Interfaces:**
- Consumes: `FEATURES` shape `{ key, label }`; `HelpTopic { id, title, keywords, blocks, featureKey }`.

- [ ] **Step 1: Add the feature key.** In `mobile/src/help-content/features.ts`, add to `FEATURES`:

```ts
  { key: "figures", label: "Figures (attached images)" },
```

- [ ] **Step 2: Run the coverage gate — verify it FAILS** (feature without a topic):

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: FAIL — `uncoveredFeatures` includes `"figures"`.

- [ ] **Step 3: Add the topic.** In `mobile/src/help-content/topics.ts`, append to `HELP_TOPICS`:

```ts
  {
    id: "attach-figures",
    title: "Add figures to a topic",
    featureKey: "figures",
    keywords: ["image", "figure", "photo", "picture", "attach", "diagram", "camera", "media"],
    blocks: [
      {
        kind: "text",
        text: "You can attach images — a photo, a diagram, a scan — to any topic that already has content. They appear in a Figures section when you read the topic and are included when you export the book. Your figures stay on your device; nothing is sent to the AI.",
      },
      {
        kind: "steps",
        steps: [
          "Open a topic that has generated content.",
          "Tap Add figure, then Choose from library or Take photo.",
          "Add an optional caption. The image is saved on your device.",
          "Export the book to include your figures in the EPUB or PDF.",
        ],
      },
      {
        kind: "defs",
        defs: [
          { term: "Supported formats", def: "JPEG, PNG and WebP, up to 10 MB each." },
          { term: "Where are my images stored?", def: "On your device only. Location data (EXIF/GPS) is stripped automatically." },
        ],
      },
    ],
  },
```

- [ ] **Step 4: Run the coverage gate — verify it PASSES**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: SCOPE note.** In `SCOPE.md`, under the rich-media / §6.8 defer note, add one line: attached images (author-supplied media class, device-local, attach-only) shipped as media slice 1 — see `docs/superpowers/specs/2026-07-15-topic-images-attach-design.md`; AI processing of media remains deferred (ADR-034 gates).

- [ ] **Step 6: Commit**

```bash
git add mobile/src/help-content/features.ts mobile/src/help-content/topics.ts SCOPE.md
git commit -m "docs(media): help topic for attaching figures + SCOPE media-slice-1 note"
```

---

## Final verification

- [ ] Run the full mobile suite: `cd mobile && npx jest`
  Expected: green (baseline 685 + new tests).
- [ ] Typecheck: `cd mobile && npx tsc --noEmit`
  Expected: no new errors.
- [ ] Manual device smoke (BYOK loop unaffected): attach a photo to a topic → see it in the reader Figures block → export `.book.zip` → re-import → figure still present → EXIF absent.

## Self-Review (planner)

- **Spec coverage:** §1 tier (T4 copy + T7 help), §2 schema (T1), §3 storage/caps/prune (T1,T2), §4 UX (T4), §5 both readers + resolver (T3), §6 inflation (T5), §7 bundle (T6), §8 EXIF/local-src (T2,T3,T6), §9 tests (each task), §10 help/SCOPE (T7). All mapped.
- **Placeholder scan:** two intentional "read the file and insert" steps (T3.6 contentHtml body concat, T4.3 full component) reference exact seams with the code shape given — acceptable given they edit a large existing file; the implementer has the interface + example. No TBDs.
- **Type consistency:** `renderTopicToSafeHtml(topic, dataUrls?)`, `buildTopicHtml(topic, dataUrls?)`, `renderFiguresHtml(images, dataUrls)`, `resolveFigureDataUrls(topic): Map<id,dataUrl>`, `buildCompilePayload(book): Book`, `attachImage/deleteImage(book, topicId, …): Book` — consistent across tasks.
