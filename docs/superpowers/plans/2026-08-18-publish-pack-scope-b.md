# Publish Pack (P2-6 Scope B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--format pack` artifact — a `publish-pack.zip` bundling the KDP-clean EPUB, its raster cover, a human-readable metadata sheet, and a per-retailer upload checklist — end to end: compiler CLI → backend `/export` + `/export/jobs` → a "Publish pack" button on the mobile Library Check-out panel.

**Architecture:** A new pure module `compiler/src/pack.ts` assembles the zip with JSZip by calling the already-shipped Scope-A building blocks (`compileEpub(book,{profile:"kdp"})`, `buildCoverSvgRaster`/`renderCoverJpeg`) — no new EPUB packager, no new rasterizer. `cli.ts` gets a `"pack"` format value that dispatches to it. The backend's `/export` and `/export/jobs` routers add `"pack"` to their format allow-lists and **exempt** it from the existing `profile=kdp` + non-epub 422 guard (pack always emits a kdp-profile EPUB internally, so the guard's *purpose* is already satisfied). Because `pack` is a brand-new format string, the existing per-format Pro gate (`export_{fmt}`) would otherwise silently invent an ungranted `export_pack` feature that blocks every user forever — a small `_export_gate_feature()` mapper reuses the existing `export_epub` gate for `pack` instead, per the spec's "do not invent a new gate" instruction. Mobile's `CheckoutButton` adds a fourth "Publish pack" action mirroring the existing `checkoutKdp` pattern exactly (same async-job export path, same state machine, same distinct-artifact bypass of `trackedExport`).

**Tech Stack:** TypeScript (compiler, Node/JSZip/Jest), Python (FastAPI backend, pytest), TypeScript/React Native (mobile, Jest + React Native Testing Library).

**Spec:** `docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md`

## Global Constraints

- Reuse the shipped Scope-A building blocks; do NOT write a second EPUB packager or a second cover rasterizer. The pack cover uses `buildCoverSvgRaster` (`compiler/src/cover.ts`) — NOT the viewBox-only `buildCoverSvg`, which crashed prod with "Node has 0 width" (fixed in commit `4e591a4`).
- D1: exactly one artifact, `publish-pack.zip`, containing exactly `book.epub`, `cover.jpg`, `metadata.txt`, `README.html` — no more, no fewer.
- D2: `metadata.txt` is a human-readable sheet only — no ONIX, no CSV. Never invent subtitle/keyword/BISAC values; they are labeled blanks the author fills in.
- D3: `README.html` links Amazon KDP, Draft2Digital, and PublishDrive; Apple Books is *noted* ("needs a Mac + Transporter"), never linked as a dead end; IngramSpark is omitted entirely (print-first, paid).
- D4: ebook cover only (the 1600×2560 JPEG already produced) — no paperback/print wrap.
- D5: delivered on `CheckoutButton` (the Library Check-out panel), a "Publish pack" action next to "Kindle (KDP)".
- Backend: `asyncio.create_subprocess_exec(*argv)` never `shell=True`; `--format pack` is always a fixed literal (never a user string) — enforced by the router's format allow-list, same as every other format.
- Backend: no `backend/__init__.py`; run `ruff format` on every changed `.py` file.
- Backend: do NOT invent a new billing feature (`export_pack`) — `pack` must reuse the existing `export_epub` gate so a currently-entitled user isn't silently locked out.
- Escape every book-derived string that lands in `README.html` (it's HTML shipped inside the zip) — reuse `compiler/src/html.ts`'s `escapeHtml`, never a second escaper.
- Mobile: a new user-facing "Publish pack" button requires a Help feature key + topic + `HELP_TREE` leaf in the **same** task (the coverage gate `mobile/__tests__/help/coverage.test.ts` and the reachability gate `mobile/__tests__/help/tree.test.ts` both fail otherwise).
- Mobile: use the existing `downloadArtifact` (`mobile/src/storage/epubLibrary.ts`) + `@/lib/alert` conventions `checkoutKdp` already uses — no new download or alert helper.
- Default/other formats are unchanged; `pack` is purely additive everywhere it's threaded.

---

## Task 1: compiler — `compilePack` + `--format pack`

**Files:**
- Create: `compiler/src/pack.ts`
- Create: `compiler/__tests__/pack.test.ts`
- Modify: `compiler/src/cli.ts:1-129` (imports, `Format` union, `parseArgs`, `main()` dispatch)

**Interfaces:**
- Consumes: `compileEpub(book: Book, opts: CompileOptions): Promise<Uint8Array>` and `isoDate(raw: string): string`, both exported from `compiler/src/epub.ts`; `buildCoverSvgRaster(input: CoverInput): string` and `coverInputForBook(book: Book): CoverInput`, both exported from `compiler/src/cover.ts`; `renderCoverJpeg(svg: string, width?: number, quality?: number): Promise<Buffer>`, exported from `compiler/src/coverRaster.ts`; `escapeHtml(value: unknown): string`, exported from `compiler/src/html.ts`; the `Book`/`BookMetadata` types from `compiler/src/types.ts`.
- Produces: `compilePack(book: Book): Promise<Buffer>`, `buildMetadataSheet(book: Book): string`, `buildPublishReadme(book: Book): string` — all exported from `compiler/src/pack.ts`. Task 2 (backend) and Task 3 (mobile) only depend on the CLI's `--format pack` flag, not on these TS symbols directly.

- [ ] **Step 1: Write the failing test file `compiler/__tests__/pack.test.ts`**

```typescript
import JSZip from "jszip";
import { parseArgs } from "../src/cli";
import { compilePack, buildMetadataSheet, buildPublishReadme } from "../src/pack";
import { KdpDraftError } from "../src/epub";
import type { Book, BookMetadata, LessonOutput } from "../src/types";

// Stand in for Puppeteer/Chromium (kdpEpubcheck.test.ts's pattern). Both
// compilePack's own cover.jpg raster AND the kdp-profile book.epub's embedded
// cover raster go through renderCoverJpeg -> rasterize.ts's rasterizeToJpeg.
// A real, verified-valid tiny (2x2) JPEG — epubcheck decodes image bytes
// elsewhere in the suite, so this stays a genuine JPEG, not arbitrary bytes.
jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[]) => svgs.map(() => Buffer.from("unused"))),
  rasterizeManyToPngResilient: jest.fn(async (svgs: string[]) => svgs.map(() => Buffer.from("unused"))),
  rasterizeToPng: jest.fn(async () => Buffer.from("unused")),
  rasterizeToJpeg: jest.fn(async () =>
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=",
      "base64",
    ),
  ),
}));

const LESSON: LessonOutput = {
  topic: "Publish Pack Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the publish-pack gate — no math, no diagrams.",
  learning_objectives: ["Understand the pack"],
  sections: [{ heading: "Section", body_markdown: "Plain prose, no math or diagrams." }],
  key_takeaways: ["It packs"],
  further_reading: [],
};

function fixtureBook(metadata: BookMetadata = { author: "Ada Lovelace", status: "release" }): Book {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    title: "Publish Pack Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    metadata,
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-18T00:00:00.000Z" } },
  };
}

describe("parseArgs — --format pack", () => {
  it("recognizes --format pack", () => {
    expect(parseArgs(["book.json", "--format", "pack"]).format).toBe("pack");
  });
});

describe("buildMetadataSheet", () => {
  it("includes the book's title and author", () => {
    const sheet = buildMetadataSheet(fixtureBook());
    expect(sheet).toContain("Publish Pack Fixture");
    expect(sheet).toContain("Ada Lovelace");
  });

  it("labels subtitle, keywords, and BISAC categories as blanks, never invented", () => {
    const sheet = buildMetadataSheet(fixtureBook());
    expect(sheet).toContain("Subtitle:");
    expect(sheet).toContain("Keywords (up to 7):");
    expect(sheet).toContain("Categories (BISAC):");
  });

  it("falls back to em-dash placeholders for absent optional fields", () => {
    const sheet = buildMetadataSheet(fixtureBook({ author: "Ada Lovelace", status: "release" }));
    expect(sheet).toMatch(/ISBN:\s+—/);
    expect(sheet).toMatch(/Translator:\s+—/);
  });
});

describe("buildPublishReadme", () => {
  it("links KDP, Draft2Digital, and PublishDrive, and notes Apple without linking it", () => {
    const readme = buildPublishReadme(fixtureBook());
    expect(readme).toContain("kdp.amazon.com");
    expect(readme).toContain("draft2digital.com");
    expect(readme).toContain("publishdrive.com");
    expect(readme).toMatch(/Apple Books direct requires a Mac/);
    expect(readme).not.toContain('href="https://apple.com');
    expect(readme).not.toContain("ingramspark");
  });

  it("escapes a book title with HTML-significant characters", () => {
    const book = fixtureBook();
    book.title = "Cats & <Dogs>";
    const readme = buildPublishReadme(book);
    expect(readme).toContain("Cats &amp; &lt;Dogs&gt;");
    expect(readme).not.toContain("<Dogs>");
  });
});

describe("compilePack", () => {
  it("zips exactly book.epub, cover.jpg, metadata.txt, and README.html", async () => {
    const buf = await compilePack(fixtureBook());
    const zip = await JSZip.loadAsync(buf);
    expect(Object.keys(zip.files).sort()).toEqual(
      ["README.html", "book.epub", "cover.jpg", "metadata.txt"].sort(),
    );
  });

  it("book.epub starts with the EPUB PK magic", async () => {
    const buf = await compilePack(fixtureBook());
    const zip = await JSZip.loadAsync(buf);
    const epubBytes = await zip.file("book.epub")!.async("nodebuffer");
    expect(epubBytes.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("metadata.txt and README.html carry the book's content", async () => {
    const buf = await compilePack(fixtureBook());
    const zip = await JSZip.loadAsync(buf);
    const metadataTxt = await zip.file("metadata.txt")!.async("string");
    const readme = await zip.file("README.html")!.async("string");
    expect(metadataTxt).toContain("Publish Pack Fixture");
    expect(readme).toContain("kdp.amazon.com");
  });

  it("refuses to compile a draft book (inherits the KDP draft guard)", async () => {
    await expect(
      compilePack(fixtureBook({ author: "Ada Lovelace", status: "draft" })),
    ).rejects.toBeInstanceOf(KdpDraftError);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd compiler && npx jest pack`
Expected: FAIL — `Cannot find module '../src/pack'` (the module doesn't exist yet), and the `parseArgs` test fails because `--format pack` currently falls through to `"epub"`.

- [ ] **Step 3: Implement `compiler/src/pack.ts`**

```typescript
// Publish Pack (P2-6 Scope B, docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md):
// bundle everything an author needs to hand a book to a retailer into one zip
// — the KDP-clean EPUB, its raster cover, a human-readable metadata sheet, and
// a per-retailer upload checklist — so the manual upload is one download + a
// copy-paste, not a scavenger hunt. Still no retailer API (none exist); the
// author still uploads by hand.

import JSZip from "jszip";
import { compileEpub, isoDate } from "./epub";
import { buildCoverSvgRaster, coverInputForBook } from "./cover";
import { renderCoverJpeg } from "./coverRaster";
import { escapeHtml } from "./html";
import type { Book } from "./types";

// D2: a human-readable sheet only — no ONIX, no CSV. Lists the fields we
// store, plus labeled blanks for the KDP fields we don't (subtitle, up to 7
// keywords, BISAC categories) so the author fills them into the retailer's
// form. Never invent keyword/category/subtitle values — they stay blank.
export function buildMetadataSheet(book: Book): string {
  const m = book.metadata ?? {};
  const author = m.author ?? "—";
  const authorFileAs = m.authorFileAs || m.author || "—";
  const language = m.language || "en";
  const date = m.date ? isoDate(m.date) : "—";
  const isbn = m.isbn ?? "—";
  const translator = m.translator ?? "—";
  const description = m.description ?? "—";
  return [
    `Title:        ${book.title}`,
    `Author:       ${author}            (Sort-as: ${authorFileAs})`,
    `Language:     ${language}       Publication date: ${date}`,
    `ISBN:         ${isbn}            Translator: ${translator}`,
    ``,
    `Description:`,
    description,
    ``,
    `— Fill these in on the retailer's form (Mentible doesn't store them yet) —`,
    `Subtitle:     ____________________`,
    `Keywords (up to 7):  ______ , ______ , ______ , ______ , ______ , ______ , ______`,
    `Categories (BISAC):  ____________________`,
    ``,
  ].join("\n");
}

// D3: KDP + Draft2Digital + PublishDrive are linked; Apple Books direct is
// NOTED (needs a Mac + Transporter — no web upload), not linked as a dead
// end; IngramSpark is omitted (print-first, paid). Escape every book-derived
// string — this HTML ships inside the zip and could be opened directly.
export function buildPublishReadme(book: Book): string {
  const title = escapeHtml(book.title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Publish pack — ${title}</title>
<style>
body{font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:2rem auto;padding:0 1.5rem;color:#1a1a1a;line-height:1.5}
h1{font-size:1.4rem}
h2{font-size:1.1rem;margin-top:2rem}
code{background:#f0f0f0;padding:0 .25rem;border-radius:3px}
.note{background:#fff8e1;border-left:4px solid #d4a017;padding:.75rem 1rem;margin:1rem 0}
</style>
</head>
<body>
<h1>Publish pack — ${title}</h1>
<p>This zip contains everything you need to hand this book to a retailer:</p>
<ul>
<li><code>book.epub</code> — the KDP-clean EPUB (rasterized math/diagrams, JPEG cover)</li>
<li><code>cover.jpg</code> — the 1600&times;2560 ebook cover</li>
<li><code>metadata.txt</code> — a plain-text metadata sheet to copy into the retailer's form</li>
<li><code>README.html</code> — this file</li>
</ul>

<h2>Amazon KDP</h2>
<ol>
<li>Go to <a href="https://kdp.amazon.com">kdp.amazon.com</a> &rarr; Bookshelf &rarr; + Create &rarr; New Kindle eBook.</li>
<li>Upload <code>book.epub</code> as the manuscript.</li>
<li>Upload <code>cover.jpg</code> as the cover.</li>
<li>Copy the fields from <code>metadata.txt</code> into KDP's title/author/description/keywords/category form.</li>
</ol>

<h2>Draft2Digital</h2>
<p>Go to <a href="https://draft2digital.com">draft2digital.com</a> and upload the same <code>book.epub</code> + <code>cover.jpg</code> once — Draft2Digital fans that single upload out to Apple Books, Kobo, Barnes &amp; Noble, and more.</p>

<h2>PublishDrive</h2>
<p>Go to <a href="https://www.publishdrive.com">publishdrive.com</a>, another aggregator covering additional storefronts and libraries.</p>

<div class="note">Apple Books direct requires a Mac (Transporter) — no web upload. Use Draft2Digital above to reach Apple Books without one.</div>
</body>
</html>
`;
}

// D1: exactly `book.epub`, `cover.jpg`, `metadata.txt`, `README.html`.
// book.epub reuses compileEpub's own kdp-profile cover raster internally;
// this standalone cover.jpg is a second, independent raster of the same
// input so the pack carries its cover as a plain file a retailer form can
// upload directly (no unzip-the-EPUB step). Calling compileEpub FIRST means
// a draft book's KdpDraftError surfaces before any further Chromium work.
export async function compilePack(book: Book): Promise<Buffer> {
  const epubBytes = await compileEpub(book, { profile: "kdp" });
  const coverJpeg = await renderCoverJpeg(buildCoverSvgRaster(coverInputForBook(book)));

  const zip = new JSZip();
  zip.file("book.epub", epubBytes);
  zip.file("cover.jpg", coverJpeg);
  zip.file("metadata.txt", buildMetadataSheet(book));
  zip.file("README.html", buildPublishReadme(book));
  return zip.generateAsync({ type: "nodebuffer" });
}
```

- [ ] **Step 4: Run the test, verify the `pack.ts`-only tests pass (the `parseArgs` test still fails)**

Run: `cd compiler && npx jest pack`
Expected: `buildMetadataSheet`, `buildPublishReadme`, and `compilePack` describe blocks PASS. `parseArgs — --format pack` still FAILS (cli.ts not wired yet).

- [ ] **Step 5: Modify `compiler/src/cli.ts` — import, `Format` union, doc comment, `parseArgs`, `main()` dispatch**

Add the import (after the existing `carousel`/`animated` imports, before `import type { Book }`):

```typescript
import { compilePack } from "./pack";
```

Replace the doc comment (lines 14–26):

```typescript
// compile <book.json|-> [-o out|-] [--format epub|pdf|docx|cover|card|carousel|animated|pack] [--mermaid]
//   input      a path, or "-" / omitted to read book JSON from stdin
//   -o         a path, or "-" to write to stdout (default when reading stdin)
//   --format   epub (default) | pdf (Vivliostyle textbook layout) |
//              docx (Word) | cover (a PNG thumbnail of the book's cover, for
//              the Library) | card (a branded quote/summary PNG card, for
//              Publish — reads a CardInput JSON on stdin, not a Book) |
//              carousel (N branded PNG card frames, one Chromium pass — reads
//              a CarouselInput JSON on stdin, emits {png_base64: string[]}) |
//              animated (a branded animated GIF card — reads an AnimatedInput
//              JSON on stdin, not a Book) | pack (a zip Publish Pack —
//              KDP-clean EPUB + cover.jpg + metadata.txt + README.html, D1
//              docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md;
//              always emits a kdp-profile EPUB internally, ignoring --profile)
//   --mermaid  render diagrams to inline SVG (needs a headless browser); else
//              diagrams fall back to a readable text placeholder.
```

Replace the `Format` type (line 28):

```typescript
type Format = "epub" | "pdf" | "cover" | "docx" | "card" | "carousel" | "animated" | "pack";
```

Replace the `--format` parse branch inside `parseArgs` (the nested ternary at lines 46–61):

```typescript
    else if (a === "--format") {
      const f = argv[++i];
      format =
        f === "pdf"
          ? "pdf"
          : f === "cover"
            ? "cover"
            : f === "docx"
              ? "docx"
              : f === "card"
                ? "card"
                : f === "carousel"
                  ? "carousel"
                  : f === "animated"
                    ? "animated"
                    : f === "pack"
                      ? "pack"
                      : "epub";
    }
```

Replace the `main()` dispatch ternary (lines 102–109):

```typescript
  const mermaidOpt = mermaid ? { mermaid: new PuppeteerMermaidRenderer() } : {};
  const out =
    format === "pdf"
      ? await compilePdf(book, mermaidOpt)
      : format === "cover"
        ? await renderCoverPng(buildCoverSvgFile(coverInputForBook(book)))
        : format === "docx"
          ? await compileDocx(book)
          : format === "pack"
            ? await compilePack(book)
            : await compileEpub(book, { ...mermaidOpt, profile });
```

- [ ] **Step 6: Run the full test file, verify all tests pass**

Run: `cd compiler && npx jest pack`
Expected: PASS — all `describe` blocks in `pack.test.ts` green, including `parseArgs — --format pack`.

- [ ] **Step 7: Typecheck the whole compiler project**

Run: `cd compiler && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add compiler/src/pack.ts compiler/src/cli.ts compiler/__tests__/pack.test.ts
git commit -m "feat(compiler): add --format pack (Publish Pack, P2-6 Scope B)"
```

---

## Task 2: backend — `format=pack` on `/export` and `/export/jobs`

**Files:**
- Modify: `backend/src/export/compiler.py:65-83` (docstring only — `compile_book` already threads any `fmt` string generically)
- Modify: `backend/src/export/router.py:45-253`
- Modify: `backend/src/export/tasks.py:59-68`
- Modify: `backend/tests/test_export_kdp_profile.py`

**Interfaces:**
- Consumes: `compiler.compile_book(raw_book: bytes, *, fmt: str = "epub", diagrams: bool = False, profile: str = "default") -> ExportResult` (unchanged signature, from Task 1's `compiler/src/pack.ts` via the CLI's `--format pack`); `has_feature(conn, *, account_id, feature: str) -> bool` and `feature_required(feature: str) -> HTTPException` (`backend/src/billing/access.py` / `backend/src/billing/quota.py`, unchanged).
- Produces: `_export_gate_feature(fmt: str) -> str`, a new pure function in `backend/src/export/router.py`, mapping `"pack"` → `"export_epub"` and every other format to `f"export_{fmt}"`. Task 3 (mobile) depends only on the HTTP contract: `POST /api/v1/export?format=pack` and `POST /api/v1/export/jobs?format=pack` both accept `format=pack` (with or without `profile=kdp`), respond with `application/zip`, and a draft book still yields a clean 422.

- [ ] **Step 1: Write the failing tests — append to `backend/tests/test_export_kdp_profile.py`**

Add these test functions at the end of the file (after `test_sync_export_rejects_unknown_profile_value`):

```python
# ── Publish Pack (P2-6 Scope B) ───────────────────────────────────────────────
# docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md. `pack`
# always emits a kdp-profile EPUB internally (compiler/src/pack.ts), so the
# router must EXEMPT it from the kdp+non-epub 422 guard, and must NOT gate it
# behind a brand-new (unentitled) `export_pack` feature — it reuses the
# existing `export_epub` gate.


async def test_compile_book_threads_format_pack_into_argv():
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(return_value=(b"ZIPBYTES", b""))
    mock_proc.returncode = 0
    with patch(
        "backend.src.export.compiler.asyncio.create_subprocess_exec",
        AsyncMock(return_value=mock_proc),
    ) as create_exec:
        await compiler.compile_book(
            b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
            fmt="pack",
        )
    argv = create_exec.call_args.args
    assert "--format" in argv
    assert argv[argv.index("--format") + 1] == "pack"
    # pack ignores --profile entirely (it always emits a kdp EPUB internally).
    assert "--profile" not in argv


async def test_compile_book_maps_kdp_draft_error_for_pack_format():
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(
        return_value=(
            b"",
            b'The KDP export profile requires a released book (metadata.status must not be "draft").',
        )
    )
    mock_proc.returncode = 1
    with patch(
        "backend.src.export.compiler.asyncio.create_subprocess_exec",
        AsyncMock(return_value=mock_proc),
    ):
        with pytest.raises(compiler.ExportValidationError, match="released book"):
            await compiler.compile_book(
                b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
                fmt="pack",
            )


def test_export_gate_feature_maps_pack_to_the_epub_gate():
    from backend.src.export.router import _export_gate_feature

    assert _export_gate_feature("pack") == "export_epub"
    assert _export_gate_feature("epub") == "export_epub"
    assert _export_gate_feature("pdf") == "export_pdf"
    assert _export_gate_feature("docx") == "export_docx"


async def test_sync_export_allows_format_pack_with_kdp_profile(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False, profile="default"):
        return compiler.ExportResult(data=b"PK\x03\x04zipbytes", title="Physics & Friends", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export?format=pack&profile=kdp", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/zip")
    assert resp.headers["content-disposition"] == 'attachment; filename="physics-friends-publish-pack.zip"'


async def test_sync_export_allows_format_pack_without_profile(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False, profile="default"):
        return compiler.ExportResult(data=b"PK\x03\x04zipbytes", title="Physics & Friends", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export?format=pack", content=json.dumps(_BOOK))
    assert resp.status_code == 200


async def test_async_export_allows_format_pack(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False, profile="default"):
        return compiler.ExportResult(data=b"PK\x03\x04zipbytes", title="Physics & Friends", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export/jobs?format=pack", content=json.dumps(_BOOK))
    assert resp.status_code == 202


async def test_sync_export_still_rejects_kdp_profile_for_pdf_after_pack_exemption(client):
    # Regression: exempting pack from the guard must not loosen it for pdf/docx.
    resp = await client.post("/api/v1/export?format=pdf&profile=kdp", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "kdp" in resp.json()["detail"].lower()
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `python -m pytest backend/tests/test_export_kdp_profile.py -q`
Expected: FAIL — `test_export_gate_feature_maps_pack_to_the_epub_gate` errors with `ImportError: cannot import name '_export_gate_feature'`; `test_compile_book_threads_format_pack_into_argv` and `test_compile_book_maps_kdp_draft_error_for_pack_format` PASS already (compile_book is already format-agnostic); the three `allows_format_pack` tests FAIL with 422 (`format must be 'epub', 'pdf' or 'docx'.`).

- [ ] **Step 3: Modify `backend/src/export/compiler.py` — docstring**

Replace the `compile_book` docstring (lines 74–80):

```python
    """Compile raw book.json bytes into an artifact (EPUB, PDF, DOCX, or a zip
    Publish Pack) via the Node compiler.

    fmt:      "epub" | "pdf" | "docx" | "pack" ("pack" bundles a KDP-clean
    EPUB + cover + metadata sheet + retailer README — see
    docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md; it
    always emits a kdp-profile EPUB internally, so it needs no `profile=kdp`
    from the caller). diagrams: render Mermaid → SVG (needs Chromium; much
    slower, so it gets the longer diagram timeout). profile: "default" |
    "kdp" (KDP-clean export profile, epub-only — see
    docs/specs/kdp-clean-export-profile.md). Raises ExportValidationError for
    bad input, CompilerError otherwise.
    """
```

- [ ] **Step 4: Modify `backend/src/export/router.py`**

Replace the `_FORMATS` dict and `_filename` helper (lines 45–61):

```python
_FORMATS = {
    "epub": ("application/epub+zip", "epub"),
    "pdf": ("application/pdf", "pdf"),
    "docx": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "docx",
    ),
    # A PNG thumbnail of the book's cover — lets the mobile Library show the real
    # cover (the EPUB carries only the vector cover.svg, which the app can't
    # render on-device).
    "cover": ("image/png", "png"),
    # Publish Pack (P2-6 Scope B, docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md):
    # a zip bundling the KDP-clean EPUB + raster cover + a metadata sheet + a
    # retailer upload checklist. Always emits a kdp-profile EPUB internally
    # (compiler/src/pack.ts), so it needs no `profile=kdp` from the caller.
    "pack": ("application/zip", "zip"),
}


def _export_gate_feature(fmt: str) -> str:
    """The billing feature key that gates a given export format (T2). `pack`
    reuses the `epub` gate rather than requiring a new, unentitled feature
    grant — it bundles the same KDP-clean EPUB the `epub`/kdp-profile export
    already produces, and no plan defines an `export_pack` feature (see
    docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md D5)."""
    return f"export_{'epub' if fmt == 'pack' else fmt}"


def _filename(title: str, ext: str, *, suffix: str | None = None) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower() or "book"
    base = f"{slug[:60]}-{suffix}" if suffix else slug[:60]
    return f"{base}.{ext}"
```

Replace the `profile == "kdp"` guard inside `export_book` (lines 86–90):

```python
    if profile == "kdp" and fmt not in ("epub", "pack"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "the kdp profile is only supported for format=epub or format=pack."},
        )
```

Replace the gate block inside `export_book` (lines 101–109):

```python
    if fmt != "cover" and principal is not None:
        pool = getattr(request.app.state, "db", None)
        if pool is not None:
            async with pool.acquire() as conn:
                account = await accounts_repo.get_or_create_account(
                    conn, idp_sub=principal.sub, email=principal.email
                )
                gate_feature = _export_gate_feature(fmt)
                if not await has_feature(conn, account_id=account.id, feature=gate_feature):
                    raise feature_required(gate_feature)
```

Inside `export_book`, the `headers = {` block (lines 132–138) currently starts:

```python
    headers = {
        "Content-Disposition": f'attachment; filename="{_filename(result.title, ext)}"',
        "X-Content-Warnings": str(len(result.warnings)),
    }
```

Replace only the `"Content-Disposition"` line with:

```python
        "Content-Disposition": (
            f'attachment; filename="'
            f'{_filename(result.title, ext, suffix="publish-pack" if fmt == "pack" else None)}"'
        ),
```

(The `"X-Content-Warnings"` line and the closing `}` are unchanged.)

Replace `_ASYNC_FORMATS` (line 166):

```python
_ASYNC_FORMATS = {"epub", "pdf", "docx", "pack"}
```

Replace the format-rejection message inside `submit_export` (lines 191–195):

```python
    fmt = format.lower()
    if fmt not in _ASYNC_FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub', 'pdf', 'docx' or 'pack'."},
        )
```

Replace the `profile == "kdp"` guard inside `submit_export` (lines 201–205):

```python
    if profile == "kdp" and fmt not in ("epub", "pack"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "the kdp profile is only supported for format=epub or format=pack."},
        )
```

Replace the gate block inside `submit_export` (lines 227–235):

```python
    if principal is not None:
        pool = getattr(request.app.state, "db", None)
        if pool is not None:
            async with pool.acquire() as conn:
                account = await accounts_repo.get_or_create_account(
                    conn, idp_sub=principal.sub, email=principal.email
                )
                gate_feature = _export_gate_feature(fmt)
                if not await has_feature(conn, account_id=account.id, feature=gate_feature):
                    raise feature_required(gate_feature)
```

- [ ] **Step 5: Modify `backend/src/export/tasks.py`**

Replace `_MEDIA_TYPES` (lines 59–63):

```python
_MEDIA_TYPES = {
    "epub": "application/epub+zip",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pack": "application/zip",
}
```

Replace `artifact_filename` (lines 66–68):

```python
def artifact_filename(title: str, fmt: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower() or "book"
    if fmt == "pack":
        return f"{slug[:60]}-publish-pack.zip"
    return f"{slug[:60]}.{fmt}"
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `python -m pytest backend/tests -q -k "export"`
Expected: PASS — all tests in `test_export.py`, `test_export_async.py`, `test_export_kdp_profile.py`, `test_export_docx_gate.py`, `test_export_trust.py` green (no regression on the existing epub/pdf/docx/cover paths).

- [ ] **Step 7: Format the changed Python files**

Run: `ruff format backend/src/export/compiler.py backend/src/export/router.py backend/src/export/tasks.py backend/tests/test_export_kdp_profile.py`
Expected: files reformatted (or reported unchanged) with no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/src/export/compiler.py backend/src/export/router.py backend/src/export/tasks.py backend/tests/test_export_kdp_profile.py
git commit -m "feat(export): accept format=pack on /export and /export/jobs (Publish Pack)"
```

---

## Task 3: mobile — "Publish pack" button + Help

**Files:**
- Modify: `mobile/src/api/client.ts:164-175,255-260`
- Modify: `mobile/src/components/CheckoutButton.tsx:1-161`
- Modify: `mobile/__tests__/components/CheckoutButton.test.tsx`
- Modify: `mobile/src/help-content/features.ts:1-29`
- Modify: `mobile/src/help-content/topics.ts` (insert after the `kdp-export` topic, ~line 415)
- Modify: `mobile/src/help-content/tree.ts` (insert after the `leaf-kdp-export` leaf)

**Interfaces:**
- Consumes: `exportBook(book: Book, opts: ExportOptions): Promise<ExportedArtifact>` and `downloadArtifact(bytes: ArrayBuffer, filename: string, mimeType: string): Promise<{savedPath?: string}>` (unchanged call shape, Task 2's `format=pack` HTTP contract); `buildCompilePayload(book: Book): Promise<Book>` (unchanged, `mobile/src/lib/compilePayload.ts`).
- Produces: nothing consumed by a later task — this is the final, user-facing task.

- [ ] **Step 1: Write the failing tests — append to `mobile/__tests__/components/CheckoutButton.test.tsx`**

Add these tests at the end of the file (after the existing `"Kindle (KDP) checks out a distinct, profile=kdp EPUB"` test):

```tsx
it("renders the Publish pack button", () => {
  render(<CheckoutButton book={book} />);
  expect(
    screen.getByRole("button", { name: "Download a publish pack for retailers" }),
  ).toBeTruthy();
});

it("Publish pack requests format=pack and downloads a .zip", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Download a publish pack for retailers" }));

  await waitFor(() => expect(screen.getByText(/Publish pack downloaded|Saved:/)).toBeTruthy());
  expect(mockExport).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ format: "pack" }),
  );
  expect(mockDownload).toHaveBeenCalledWith(
    expect.anything(),
    "physics-publish-pack.zip",
    "application/zip",
  );
});

it("Publish pack button re-enables after a failed export", async () => {
  mockExport.mockRejectedValue(new Error("network fetch failed"));
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Download a publish pack for retailers" }));

  await waitFor(() => expect(screen.getByText(/Couldn’t reach the server/)).toBeTruthy());
  const button = screen.getByRole("button", { name: "Download a publish pack for retailers" });
  expect(button.props.accessibilityState?.disabled).toBe(false);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd mobile && npx jest CheckoutButton`
Expected: FAIL — `getByRole("button", { name: "Download a publish pack for retailers" })` finds no element (the button doesn't exist yet).

- [ ] **Step 3: Modify `mobile/src/api/client.ts`**

Replace the `ExportOptions.format` field (line 165):

```typescript
export interface ExportOptions {
  format?: "epub" | "pdf" | "cover" | "docx" | "pack"; // "cover" → a PNG thumbnail of the cover; "pack" → a zip Publish Pack (P2-6 Scope B)
```

Replace the `submitExportJob` signature (lines 255–260):

```typescript
async function submitExportJob(
  book: Book,
  format: "epub" | "pdf" | "docx" | "pack",
  diagrams: boolean,
  profile?: "default" | "kdp",
): Promise<string> {
```

- [ ] **Step 4: Modify `mobile/src/components/CheckoutButton.tsx`**

Replace the `State` type (lines 14–18):

```tsx
type State =
  | { kind: "idle" }
  | { kind: "working"; fmt: "epub" | "pdf" | "pack" }
  | { kind: "done"; msg: string; trust?: TrustManifest }
  | { kind: "error"; msg: string };
```

Insert the `checkoutPack` handler right after `checkoutKdp` (after its closing lines 70–78, before `const working = state.kind === "working";` at line 80):

```tsx
  // Publish pack (P2-6 Scope B, docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md)
  // — a single zip bundling the KDP-clean EPUB, a raster cover, a metadata
  // sheet, and a retailer upload checklist. Same distinct-artifact pattern as
  // checkoutKdp: bypasses trackedExport's exportStatus tracking (keyed by
  // format "epub"/"pdf"/"docx" — a concurrent plain-EPUB export would collide
  // with this one under the same "epub" key).
  const checkoutPack = async () => {
    setState({ kind: "working", fmt: "pack" });
    try {
      const payload = await buildCompilePayload(book);
      const { artifact, trust } = await exportBook(payload, { format: "pack" });
      const res = await downloadArtifact(
        artifact,
        `${slug(book.title)}-publish-pack.zip`,
        "application/zip",
      );
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "Publish pack downloaded.",
        trust,
      });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };
```

Insert the fourth button right after the "Kindle (KDP)" button (after lines 102–109, still inside the `<View style={styles.row}>`):

```tsx
        <Button
          variant="ghost"
          label="Publish pack"
          onPress={checkoutPack}
          disabled={working}
          accessibilityLabel="Download a publish pack for retailers"
          style={styles.btn}
        />
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `cd mobile && npx jest CheckoutButton`
Expected: PASS — all tests in `CheckoutButton.test.tsx` green, including the three new Publish-pack tests.

- [ ] **Step 6: Modify `mobile/src/help-content/features.ts`**

Insert a new entry right after `kdp-export` (line 26):

```typescript
  { key: "kdp-export", label: "Export for Kindle (KDP)" },
  { key: "publish-pack", label: "Download a publish pack for retailers" },
```

- [ ] **Step 7: Modify `mobile/src/help-content/topics.ts`**

Insert a new topic object right after the `kdp-export` topic's closing brace (after line 415, before the `project-fields` topic starting at line 416):

```typescript
  {
    id: "publish-pack",
    title: "Download a publish pack for retailers",
    featureKey: "publish-pack",
    keywords: ["publish", "pack", "kdp", "draft2digital", "publishdrive", "retailer", "export", "metadata"],
    blocks: [
      {
        kind: "text",
        text: "\"Publish pack\" downloads one zip with everything you need to hand this book to a retailer: the KDP-clean EPUB, its cover as a plain JPEG, a metadata sheet listing the fields Mentible stores (plus labeled blanks for the ones it doesn't — subtitle, keywords, categories), and a README with step-by-step upload links for Amazon KDP, Draft2Digital, and PublishDrive. There's still no automatic submission — you upload it yourself, but it's one download and a copy-paste instead of hunting down each file.",
      },
      {
        kind: "defs",
        defs: [
          { term: "Where's the button?", def: "On a Library book's Check out panel, next to EPUB3, PDF, and Kindle (KDP): \"Publish pack\"." },
          { term: "Why does it need a released book?", def: "The pack's EPUB is the same KDP-clean export, which refuses a draft book — release it first (clears the \"DRAFT\" watermark)." },
          { term: "What about Apple Books?", def: "Apple's direct upload needs a Mac and their Transporter app, so the README doesn't link it — it points you to Draft2Digital instead, which reaches Apple Books without a Mac." },
        ],
      },
    ],
  },
```

- [ ] **Step 8: Modify `mobile/src/help-content/tree.ts`**

Insert a new leaf right after `leaf-kdp-export`:

```typescript
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
          { id: "leaf-publish-pack", title: "Publish pack (for retailers)", topicId: "publish-pack" },
```

- [ ] **Step 9: Run the Help gates, verify they pass**

Run: `cd mobile && npx jest --testPathPattern=help`
Expected: PASS — `coverage.test.ts` (`publish-pack` has a topic) and `tree.test.ts` (the new leaf resolves + is reachable) both green.

- [ ] **Step 10: Full task verification**

Run:
```bash
cd mobile && npx tsc --noEmit
npx jest --testPathPattern=help
npx jest CheckoutButton
npx eslint src/components/CheckoutButton.tsx src/api/client.ts src/help-content/features.ts src/help-content/topics.ts src/help-content/tree.ts __tests__/components/CheckoutButton.test.tsx
```
Expected: no type errors, all tests pass, no lint errors.

- [ ] **Step 11: Commit**

```bash
git add mobile/src/api/client.ts mobile/src/components/CheckoutButton.tsx mobile/__tests__/components/CheckoutButton.test.tsx mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/src/help-content/tree.ts
git commit -m "feat(mobile): add Publish pack checkout button + Help topic"
```

---

## Manual verification (not automated — noted per the spec's Testing section)

The spec calls out that mocked tests cannot catch a real cover-raster regression (see `reference_svg_raster_zero_width` in project memory — the exact class of bug `buildCoverSvgRaster` exists to prevent). Before shipping, run an in-container `--format pack` probe with the real Node compiler + Chromium (mirrors the existing KDP verify step) and confirm the downloaded zip's `cover.jpg` opens as a real 1600×2560 JPEG and `book.epub` opens in an EPUB reader.
