# EPUB 2 Export Profile (ADR-041 Initiative A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third compiler profile, `"epub2"`, alongside the existing `"default"` (rich EPUB3) and `"kdp"` (Kindle-clean EPUB3) profiles — a strict, validation-clean **EPUB 2.0.1** artifact for readers that reject an EPUB3 package outright. Threaded end-to-end: compiler (`compiler/src/epub.ts`/`xhtml.ts`/`cli.ts`) → backend (`backend/src/export/compiler.py`/`router.py`) → mobile (`CheckoutButton`, `client.ts`, `compilePayload.ts`, Help).

**Architecture:** `epub2` reuses the KDP profile's raster machinery verbatim (math → PNG via `mathRaster.ts`, Mermaid diagrams → PNG via `diagramRaster.ts`) by generalizing the existing `profile === "kdp"` branches in `compiler/src/epub.ts` to `profile !== "default"` — no second rasterizer. On top of that shared raster layer, `epub2` gets its own net-new packaging deltas, all gated on `profile === "epub2"`: OPF `version="2.0"`, no `nav.xhtml`/no `properties="nav"` manifest item (NCX is already emitted for every profile and becomes primary), EPUB2-only metadata syntax (drop `dcterms:modified` + the `schema:*` a11y block), XHTML 1.1 content documents (no `xmlns:epub`/`epub:type`), and a defensive `<audio>` strip (EPUB3-only) with no `packAudio`. Mobile compensates for the audio loss by emitting the clip's `transcript` as prose instead, and adds a fourth "EPUB 2 (max compatibility)" `CheckoutButton` action mirroring the existing `checkoutKdp` pattern. The real validation gate is `epubcheck` run against the `epub2`-profile output (it auto-detects the OPF version, so it validates the artifact *as EPUB 2*), mirroring `kdpEpubcheck.test.ts`.

**Tech Stack:** TypeScript (compiler, Node/JSZip/Jest), Python (FastAPI backend, pytest), TypeScript/React Native (mobile, Jest + React Native Testing Library).

**Spec:** `docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md` (implements ADR-041 Initiative A, `docs/adr/ADR-041-portability-first-epub-exports-and-standalone-viewer.md`; reuses `docs/specs/kdp-clean-export-profile.md`'s raster machinery).

## Global Constraints

- **D1 (spec):** `--profile epub2` on `--format epub`/`pack` only (same guard family as `kdp`) — extend the profile enum `"default" | "kdp"` → `"default" | "kdp" | "epub2"`, threaded cli → backend `/export` + `/export/jobs` → mobile.
- **D2 (spec):** `epub2` reuses the exact same `rasterizeMath`/`replaceMathWithImages` + `PrerenderedRasterDiagramRenderer`/`rasterizeDiagramPngs` KDP uses. Generalize the shared `profile === "kdp"` branches (raster math + raster diagrams) to `profile !== "default"`; keep KDP-only branches (font-drop/KDP stylesheet, JPEG cover, `dc:date` ISO, the draft guard) gated on `=== "kdp"`.
- **D3 (spec):** EPUB2 packaging, all gated on `=== "epub2"`: OPF `version="2.0"`; NCX is primary nav (no `nav.xhtml` write, no `properties="nav"` manifest item, spine keeps `toc="ncx"` — already present for every profile); EPUB2 metadata syntax (drop `dcterms:modified` + `schema:accessMode…`, keep `dc:*` + the existing `<meta name="cover" content="cover-image"/>` convention); XHTML 1.1 content docs (XHTML 1.1 DOCTYPE, no `xmlns:epub`, no `epub:type` attributes); EPUB2 core media types only (no `audio/mpeg`).
- **D4 (spec):** Audio — compiler defensively strips `<audio>…</audio>` from chapter XHTML for `epub2` and skips `packAudio` (no `OEBPS/audio/` resource, no manifest item). Mobile emits `TopicAudio.transcript` as prose ("Narration (transcript)") instead of `<audio>` for the epub2 target, so the narration's words survive.
- **D5 (spec):** A distinct **"EPUB 2 (max compatibility)"** `CheckoutButton` action (not a checkbox); mobile threads `profile: "epub2"`. Backend `/export` + `/export/jobs` accept `profile=epub2`, exempt it from the kdp+non-epub 422 guard the same way (epub2 requires an epub-family format), gated via the existing `export_epub` feature (no new billing feature — same as `pack`). Help DoD: an `epub2-export` `FEATURES` key + topic + `HELP_TREE` leaf, same PR.
- **D6 (spec):** Validation gate — `epubcheck` (java-gated, mirrors `kdpEpubcheck.test.ts`/`audioEpubcheck.test.ts`) run against a fixture with math + a diagram + an audio clip, compiled `--profile epub2`, must pass `0 fatals / 0 errors` — this is what actually proves EPUB2 validity, not the mocked structural unit tests.
- **Non-goals (spec):** no MOBI/AZW; no audio/animation/interactivity in the epub2 output (the whole point of the tier); no standalone viewer (ADR-041 Initiative B, separate); no change to the EPUB3 default or KDP profiles' bytes.
- **Byte-identity requirement:** default AND kdp outputs MUST stay byte-unchanged. Every epub2 behavior gated on `=== "epub2"`; the shared-raster generalization (`!== "default"`) must leave `default` untouched (no raster) and `kdp` identical (still `!== "default"` is true for `"kdp"`, so its behavior doesn't change). Regression tests pin both.
- **Backend:** `asyncio.create_subprocess_exec(*argv)` never `shell=True`; `--profile epub2` is a hardcoded literal selected by an `if`/`elif` branch (never interpolate the raw `profile` string into argv); `profile=epub2` requires an epub-family format (422 otherwise, same guard family as kdp); reuse the `export_epub` gate (no new billing feature); no `backend/__init__.py`; run `ruff format` on every changed `.py` file.
- **Mobile:** the transcript fallback keeps the narration's words for epub2; the new "EPUB 2 (max compatibility)" export action requires a Help feature key + topic + tree leaf in the **same** task (the coverage gate `mobile/__tests__/help/coverage.test.ts` and the reachability gate `mobile/__tests__/help/tree.test.ts` both fail otherwise). Mirror `checkoutKdp`'s error-state/state-machine pattern exactly — no new download or alert helper.
- **Real gate:** epubcheck auto-detects the OPF version — running the existing epubcheck harness on the `epub2`-profile output validates it *as EPUB 2*. This is what actually catches an EPUB2-invalid construct (a stray HTML5 element, an EPUB3-only meta/attribute); the mocked structural unit tests only prove the wiring.

---

## Task 1: compiler — profile enum + shared raster generalization

**Files:**
- Modify: `compiler/src/epub.ts:62-73` (`CompileOptions.profile`), `:202-219` (`compileEpub` — diagram + math raster selection), `:247` (per-chapter math substitution)
- Test: `compiler/__tests__/epub.test.ts` (append inside the existing `describe("compileEpub — structure & well-formedness (M2/M3)", ...)` block, after the KDP mermaid-fallback test, before `it("produces a valid EPUB3 OCF structure", ...)`)

**Interfaces:**
- Consumes: nothing new — `PrerenderedRasterDiagramRenderer` (`compiler/src/diagramRaster.ts`), `rasterizeDiagramPngs` (same file), `rasterizeMath`/`replaceMathWithImages`/`collectMathHtml` (`compiler/src/mathRaster.ts`) are already imported at the top of `epub.ts`.
- Produces: `CompileOptions.profile?: "default" | "kdp" | "epub2"` — every later task (2–5) depends on this exact three-member union string type, spelled `"epub2"` (never `"epub-2"`/`"EPUB2"`).

- [ ] **Step 1: Write the failing tests**

Open `compiler/__tests__/epub.test.ts`. Find this existing test (ends at line 157):

```ts
  it("profile 'kdp' + mermaid: a diagram that fails to rasterize falls back to the inline-SVG/placeholder figure while the rest become <img> (partial-failure fallback)", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    const book = bookWithMermaidDiagram();
    book.content!.u1.lesson!.sections.push({
      heading: "Flow 2",
      body_markdown: "```mermaid\nsequenceDiagram; X->>Y: hi;\n```",
    });
    const svgFor = (s: string) => `<svg xmlns="http://www.w3.org/2000/svg" data-src="${s}"><rect width="1" height="1"/></svg>`;
    const fakeMermaid = {
      renderAll: async (sources: readonly string[]) => new Map(sources.map((s) => [s, svgFor(s)])),
    };
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((svg: string) => (svg.includes("sequenceDiagram") ? null : Buffer.from("ok"))),
    );
    const zip = await unzip(await compileEpub(book, { mermaid: fakeMermaid, profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toMatch(/<figure class="diagram"[^>]*><img src="\.\.\/images\/img-\d+\.png"/); // rasterized
    expect(chapter).toContain("sequenceDiagram"); // failed diagram — falls back to placeholder text, not <img>
    expect(chapter).toContain('class="diagram diagram--placeholder"'); // fallback is the text placeholder, not the raw inline SVG
    expect(chapter).not.toContain("<svg"); // never leaks the raw pre-rasterized SVG either
  });
```

Insert these four new tests directly after it (still inside the same `describe` block, before `it("produces a valid EPUB3 OCF structure", ...)`):

```ts
  it("profile 'epub2' rasterizes math to <img>, dropping <math> from the chapter (same raster path as kdp)", async () => {
    const book = syntheticBook(); // LESSON's Velocity section has $v=\frac{\Delta x}{\Delta t}$
    const zip = await unzip(await compileEpub(book, { profile: "epub2" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).not.toContain("<math");
    expect(chapter).toMatch(/<img class="math math-(inline|block)" alt="[^"]*"/);
  });

  it("profile 'epub2' + mermaid rasterizes diagrams to <img>, not inline <svg> (same raster path as kdp)", async () => {
    const book = bookWithMermaidDiagram();
    const fakeMermaid = { renderAll: async (sources: readonly string[]) => new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'])) };
    const zip = await unzip(await compileEpub(book, { mermaid: fakeMermaid, profile: "epub2" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toMatch(/<figure class="diagram"[^>]*><img src="\.\.\/images\/img-\d+\.png"/);
    expect(chapter).not.toContain("<svg");
  });

  it("profile 'default' still emits MathML (no raster) after generalizing the kdp branch to 'profile !== default'", async () => {
    const zip = await unzip(await compileEpub(syntheticBook()));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toContain("<math");
    expect(chapter).not.toMatch(/<img class="math/);
  });

  it("profile 'kdp' still rasterizes math to <img> after generalizing the branch to 'profile !== default' (regression)", async () => {
    const book = syntheticBook();
    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).not.toContain("<math");
    expect(chapter).toMatch(/<img class="math math-(inline|block)" alt="[^"]*"/);
  });
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd compiler && npx jest epub.test.ts -t "epub2"`
Expected: FAIL — TypeScript will not even compile yet (`profile: "epub2"` isn't assignable to `CompileOptions.profile`'s current `"default" | "kdp"` union), so the whole file errors out rather than a clean per-test failure. That TS error is the expected RED state.

- [ ] **Step 3: Widen `CompileOptions.profile`**

In `compiler/src/epub.ts`, replace lines 62-73:

```ts
export interface CompileOptions {
  // Override the diagram renderer directly (defaults to the passthrough stub).
  diagrams?: DiagramRenderer;
  // When set, diagrams are pre-rendered to inline SVG with this renderer before
  // compiling (async). Takes precedence over `diagrams`. See mermaid.ts.
  mermaid?: MermaidRenderer;
  // Distribution-target profile (D1, docs/specs/kdp-clean-export-profile.md).
  // "default" (or omitted) is today's output, byte-for-byte. "kdp" rasters
  // math/diagrams/cover and drops the embedded body font so the artifact
  // ingests cleanly on Amazon KDP — see epub.ts's per-profile branches.
  profile?: "default" | "kdp";
}
```

with:

```ts
export interface CompileOptions {
  // Override the diagram renderer directly (defaults to the passthrough stub).
  diagrams?: DiagramRenderer;
  // When set, diagrams are pre-rendered to inline SVG with this renderer before
  // compiling (async). Takes precedence over `diagrams`. See mermaid.ts.
  mermaid?: MermaidRenderer;
  // Distribution-target profile. "default" (or omitted) is today's output,
  // byte-for-byte. "kdp" (docs/specs/kdp-clean-export-profile.md) rasters
  // math/diagrams/cover and drops the embedded body font so the artifact
  // ingests cleanly on Amazon KDP. "epub2"
  // (docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md, ADR-041
  // Initiative A) rasters math/diagrams the same way (D2 — see the `profile
  // !== "default"` branches below) but packages a strict, validation-clean
  // EPUB 2.0.1 instead of EPUB3 (D3) and strips <audio> (D4) — see epub.ts's
  // per-profile branches.
  profile?: "default" | "kdp" | "epub2";
}
```

- [ ] **Step 4: Generalize the raster-selection branches from `=== "kdp"` to `!== "default"`**

Still in `compiler/src/epub.ts`, inside `compileEpub`, replace lines 202-219:

```ts
  // Diagram strategy: a Mermaid renderer (pre-render to SVG) wins, else an
  // explicit override, else the passthrough placeholder. kdp profile takes
  // the pre-rendered SVGs one step further and rasterizes them to PNG
  // (diagramRaster.ts, D4, docs/specs/kdp-clean-export-profile.md) — Kindle's
  // SVG support is limited. default keeps emitting inline SVG.
  let diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  if (opts.mermaid) {
    const svgBySource = await prerenderDiagrams(book, opts.mermaid);
    diagrams =
      profile === "kdp"
        ? new PrerenderedRasterDiagramRenderer(await rasterizeDiagramPngs(svgBySource))
        : new PrerenderedDiagramRenderer(svgBySource);
  }
  // Math-raster pass (D3, docs/specs/kdp-clean-export-profile.md): kdp only,
  // book-wide, before the per-topic loop — one Chromium browser for every
  // equation in the book (mathRaster.ts mirrors mermaid.ts's collect→batch→
  // embed pattern). No-op for the default profile, which keeps emitting MathML.
  const mathPngs = profile === "kdp" ? await rasterizeMath(collectMathHtml(book)) : new Map<string, string>();
```

with:

```ts
  // Diagram strategy: a Mermaid renderer (pre-render to SVG) wins, else an
  // explicit override, else the passthrough placeholder. Any non-default
  // profile (kdp, epub2 — D2, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md)
  // takes the pre-rendered SVGs one step further and rasterizes them to PNG
  // (diagramRaster.ts) — Kindle's SVG support is limited, and EPUB2 has no
  // SMIL-in-content story for animated SVG at all. default keeps emitting
  // inline SVG.
  let diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  if (opts.mermaid) {
    const svgBySource = await prerenderDiagrams(book, opts.mermaid);
    diagrams =
      profile !== "default"
        ? new PrerenderedRasterDiagramRenderer(await rasterizeDiagramPngs(svgBySource))
        : new PrerenderedDiagramRenderer(svgBySource);
  }
  // Math-raster pass (D3, docs/specs/kdp-clean-export-profile.md; reused
  // verbatim by epub2 per D2): any non-default profile, book-wide, before the
  // per-topic loop — one Chromium browser for every equation in the book
  // (mathRaster.ts mirrors mermaid.ts's collect→batch→embed pattern). No-op
  // for the default profile, which keeps emitting MathML.
  const mathPngs = profile !== "default" ? await rasterizeMath(collectMathHtml(book)) : new Map<string, string>();
```

- [ ] **Step 5: Generalize the per-chapter math-substitution branch**

Still in `compileEpub`, find line 247:

```ts
      if (profile === "kdp") body = replaceMathWithImages(body, mathPngs);
```

Replace with:

```ts
      if (profile !== "default") body = replaceMathWithImages(body, mathPngs);
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `cd compiler && npx jest epub.test.ts`
Expected: PASS — all pre-existing tests in the file (including every `profile: "kdp"` one) still pass unchanged, plus the four new ones.

- [ ] **Step 7: Typecheck**

Run: `cd compiler && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add compiler/src/epub.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): epub2 profile — generalize math/diagram raster to profile !== default"
```

---

## Task 2: compiler — EPUB2 packaging (OPF v2.0, NCX-primary, XHTML 1.1)

**Files:**
- Modify: `compiler/src/xhtml.ts` (full rewrite — thread `profile` into `xhtmlDocument`)
- Modify: `compiler/src/epub.ts:281-310` (`compileEpub` — title/colophon/aux/zip-write block), `:246-253` (the per-chapter `xhtmlDocument`/`packAudio` call site, same function), `:376-378` (`buildColophon`), `:383-392` (`floatListDoc`), `:394-400` (`glossaryDoc`), `:468-569` (`buildOpf` — version, nav manifest item, metadata, `properties` attributes)
- Test: `compiler/__tests__/epub.test.ts` (new `describe` block, inserted between the existing `describe("compileEpub — structure & well-formedness (M2/M3)", ...)` block, which closes at line 223, and `describe("compileEpub — bibliographic metadata → OPF + colophon", ...)`, which opens at line 225)

**Interfaces:**
- Consumes: `CompileOptions.profile?: "default" | "kdp" | "epub2"` (Task 1).
- Produces: `xhtmlDocument(title: string, body: string, cssHref: string, lang?: string, profile?: "default" | "kdp" | "epub2"): string` (new 5th param, default `"default"`) — Task 3 does not call `xhtmlDocument` directly but shares the same `compileEpub` function body this task edits, so it must apply its diff on top of this task's result, not the original file. `buildOpf(..., profile: "default" | "kdp" | "epub2" = "default")` — unchanged call sites elsewhere in the codebase (`compileEpub` is `buildOpf`'s only caller).

- [ ] **Step 1: Write the failing tests**

In `compiler/__tests__/epub.test.ts`, insert this new `describe` block between line 223 (`});` closing the M2/M3 describe) and line 225 (`describe("compileEpub — bibliographic metadata → OPF + colophon", () => {`):

```ts
describe("compileEpub — epub2 packaging (D3, OPF v2.0 / NCX-primary / XHTML 1.1)", () => {
  it("emits OPF version=\"2.0\" (default/kdp stay 3.0)", async () => {
    const defaultOpf = await (await unzip(await compileEpub(syntheticBook()))).file("OEBPS/content.opf")!.async("string");
    const kdpOpf = await (await unzip(await compileEpub(syntheticBook(), { profile: "kdp" }))).file("OEBPS/content.opf")!.async("string");
    const epub2Opf = await (await unzip(await compileEpub(syntheticBook(), { profile: "epub2" }))).file("OEBPS/content.opf")!.async("string");
    expect(defaultOpf).toContain('version="3.0"');
    expect(kdpOpf).toContain('version="3.0"');
    expect(epub2Opf).toContain('version="2.0"');
  });

  it("drops nav.xhtml and the properties=\"nav\" manifest item; NCX stays the primary nav", async () => {
    const zip = await unzip(await compileEpub(syntheticBook(), { profile: "epub2" }));
    expect(zip.file("OEBPS/nav.xhtml")).toBeNull();
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain('properties="nav"');
    expect(opf).not.toContain('id="nav"');
    expect(opf).toContain('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
    expect(opf).toContain('<spine toc="ncx">');
    expect(zip.file("OEBPS/toc.ncx")).not.toBeNull();
  });

  it("drops dcterms:modified and the schema:accessMode a11y block (EPUB3-only property syntax)", async () => {
    const opf = await (await unzip(await compileEpub(syntheticBook(), { profile: "epub2" }))).file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain("dcterms:modified");
    expect(opf).not.toContain("schema:accessMode");
    expect(opf).not.toContain("schema:accessibility");
  });

  it("emits an XHTML 1.1 doctype with no xmlns:epub or epub:type, for chapters and the title page", async () => {
    const zip = await unzip(await compileEpub(syntheticBook(), { profile: "epub2" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toContain('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"');
    expect(chapter).not.toContain("<!DOCTYPE html>\n");
    expect(chapter).not.toContain("xmlns:epub");
    const title = await zip.file("OEBPS/title.xhtml")!.async("string");
    expect(title).not.toContain("xmlns:epub");
    expect(title).not.toContain("epub:type");
  });

  it("still registers cover-image via the EPUB2 <meta name=\"cover\"> convention, with no properties attribute on any manifest item", async () => {
    const opf = await (await unzip(await compileEpub(syntheticBook(), { profile: "epub2" }))).file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    expect(opf).not.toMatch(/properties="/);
  });

  it("kdp keeps nav.xhtml + properties=\"nav\" + version=\"3.0\" (unaffected by the epub2 nav-skip, regression)", async () => {
    const zip = await unzip(await compileEpub(syntheticBook(), { profile: "kdp" }));
    expect(zip.file("OEBPS/nav.xhtml")).not.toBeNull();
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('properties="nav"');
    expect(opf).toContain('version="3.0"');
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd compiler && npx jest epub.test.ts -t "epub2 packaging"`
Expected: FAIL — `buildOpf` still emits `version="3.0"` unconditionally, `nav.xhtml` is always written, `dcterms:modified`/`schema:*` are always emitted, and `xhtmlDocument` has no XHTML1.1 branch.

- [ ] **Step 3: Rewrite `compiler/src/xhtml.ts` to thread `profile`**

Replace the entire file:

```ts
import { escapeHtml } from "./html";

// Wrap a rendered body fragment in a complete EPUB content document.
//
// default/kdp (EPUB3): XML declaration + html5 doctype + the XHTML and EPUB
// ops namespaces. MathML (from the render core) is valid inline here.
//
// epub2 (D3, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md,
// ADR-041 Initiative A): EPUB 2 content is XHTML 1.1, not HTML5 — the XHTML
// 1.1 DOCTYPE replaces the html5 one, and there is no xmlns:epub namespace
// (EPUB3's "ops" vocabulary doesn't exist in EPUB2). Callers (titleXhtml,
// colophonSection, glossaryDoc) build one shared body fragment for every
// profile and that fragment carries `epub:type="…"` attributes — rather than
// forking each caller, xhtmlDocument strips any `epub:type="…"` attribute out
// of the body here, in the one place all of them funnel through.
export function xhtmlDocument(
  title: string,
  body: string,
  cssHref: string,
  lang = "en",
  profile: "default" | "kdp" | "epub2" = "default",
): string {
  const l = escapeHtml(lang);
  if (profile === "epub2") {
    const stripped = body.replace(/\sepub:type="[^"]*"/g, "");
    return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${l}" lang="${l}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="${escapeHtml(cssHref)}"/>
</head>
<body>
${stripped}
</body>
</html>
`;
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${l}" lang="${l}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="${escapeHtml(cssHref)}"/>
</head>
<body>
${body}
</body>
</html>
`;
}
```

(The default/kdp branch is byte-identical to the pre-existing function body — profile-default callers see no change.)

- [ ] **Step 4: Thread `profile` through `compileEpub`'s `xhtmlDocument`/helper-function call sites**

In `compiler/src/epub.ts`, replace lines 281-320 (the title page through the media-packing loop end):

```ts
  const titleXhtml = xhtmlDocument(
    book.title,
    `<section epub:type="titlepage"><h1>${escapeHtml(book.title)}</h1></section>`,
    "css/style.css",
    lang,
  );
  const colophonXhtml = buildColophon(book, lang);

  // Front matter: List of Figures / List of Tables. Reflowable EPUB has no fixed
  // pages, so these are link lists (no page numbers), unlike the PDF. Back
  // matter: a Glossary from book.metadata.glossary.
  const auxFront: AuxDoc[] = [];
  if (allFigs.length)
    auxFront.push({ id: "lof", href: "lof.xhtml", title: "List of Figures", xhtml: floatListDoc("List of Figures", "Figure", allFigs, lang) });
  if (allTbls.length)
    auxFront.push({ id: "lot", href: "lot.xhtml", title: "List of Tables", xhtml: floatListDoc("List of Tables", "Table", allTbls, lang) });
  const auxBack: AuxDoc[] = [];
  const glossary = (book.metadata as { glossary?: { term: string; definition: string }[] } | undefined)?.glossary;
  if (glossary && glossary.length)
    auxBack.push({ id: "glossary", href: "glossary.xhtml", title: "Glossary", xhtml: glossaryDoc(glossary, lang) });

  const zip = new JSZip();
  // mimetype MUST be the first entry and stored uncompressed (EPUB OCF rule).
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", buildOpf(book, chapters, images, audios, auxFront, auxBack, profile));
  zip.file("OEBPS/nav.xhtml", buildNav(navSubjects, lang, auxFront, auxBack));
  // EPUB2 NCX navigation alongside the EPUB3 nav — older/"traditional" readers
  // require it and render blank pages without it.
  zip.file("OEBPS/toc.ncx", buildNcx(book, chapters));
```

with:

```ts
  const titleXhtml = xhtmlDocument(
    book.title,
    `<section epub:type="titlepage"><h1>${escapeHtml(book.title)}</h1></section>`,
    "css/style.css",
    lang,
    profile,
  );
  const colophonXhtml = buildColophon(book, lang, profile);

  // Front matter: List of Figures / List of Tables. Reflowable EPUB has no fixed
  // pages, so these are link lists (no page numbers), unlike the PDF. Back
  // matter: a Glossary from book.metadata.glossary.
  const auxFront: AuxDoc[] = [];
  if (allFigs.length)
    auxFront.push({ id: "lof", href: "lof.xhtml", title: "List of Figures", xhtml: floatListDoc("List of Figures", "Figure", allFigs, lang, profile) });
  if (allTbls.length)
    auxFront.push({ id: "lot", href: "lot.xhtml", title: "List of Tables", xhtml: floatListDoc("List of Tables", "Table", allTbls, lang, profile) });
  const auxBack: AuxDoc[] = [];
  const glossary = (book.metadata as { glossary?: { term: string; definition: string }[] } | undefined)?.glossary;
  if (glossary && glossary.length)
    auxBack.push({ id: "glossary", href: "glossary.xhtml", title: "Glossary", xhtml: glossaryDoc(glossary, lang, profile) });

  const zip = new JSZip();
  // mimetype MUST be the first entry and stored uncompressed (EPUB OCF rule).
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER_XML);
  zip.file("OEBPS/content.opf", buildOpf(book, chapters, images, audios, auxFront, auxBack, profile));
  // EPUB2 (D3, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md):
  // NCX is the PRIMARY nav for epub2 — no nav.xhtml at all (its manifest item
  // is dropped in buildOpf below). default/kdp keep the EPUB3 nav.xhtml.
  if (profile !== "epub2") zip.file("OEBPS/nav.xhtml", buildNav(navSubjects, lang, auxFront, auxBack));
  // EPUB2 NCX navigation — emitted for every profile (older/"traditional"
  // readers require it and render blank pages without it; epub2 relies on it
  // as the ONLY nav).
  zip.file("OEBPS/toc.ncx", buildNcx(book, chapters));
```

Then find the per-chapter loop (still in `compileEpub`), lines 246-253:

```ts
      let body = numberFloats(renderTopicBody(topic, diagrams), n, cf, ct, tableCaps);
      if (profile !== "default") body = replaceMathWithImages(body, mathPngs);
      const packedImages = packImages(
        xhtmlDocument(title, body, "../css/style.css", lang),
        images,
        seenImages,
      );
      const xhtml = packAudio(packedImages, audios, seenAudio);
```

Replace with:

```ts
      let body = numberFloats(renderTopicBody(topic, diagrams), n, cf, ct, tableCaps);
      if (profile !== "default") body = replaceMathWithImages(body, mathPngs);
      const packedImages = packImages(
        xhtmlDocument(title, body, "../css/style.css", lang, profile),
        images,
        seenImages,
      );
      const xhtml = packAudio(packedImages, audios, seenAudio);
```

(Note: this Step leaves the `packAudio(...)` call itself unconditional — Task 3 changes that line specifically. Apply Task 3's diff against this exact resulting text, not the original.)

- [ ] **Step 5: Thread `profile` through `buildColophon`, `floatListDoc`, `glossaryDoc`**

Replace lines 376-378:

```ts
function buildColophon(book: Book, lang: string): string {
  return xhtmlDocument(book.title, colophonSection(book), "css/style.css", lang);
}
```

with:

```ts
function buildColophon(book: Book, lang: string, profile: "default" | "kdp" | "epub2" = "default"): string {
  return xhtmlDocument(book.title, colophonSection(book), "css/style.css", lang, profile);
}
```

Replace lines 383-392:

```ts
function floatListDoc(title: string, kind: string, items: CrossFloat[], lang: string): string {
  const lis = items
    .map(
      (x) =>
        `<li><a href="${escapeHtml(x.href)}#${escapeHtml(x.id)}"><span class="fnum">${kind} ${escapeHtml(x.num)}</span> ${escapeHtml(x.caption)}</a></li>`,
    )
    .join("");
  const body = `<section class="floatlist"><h1>${escapeHtml(title)}</h1><ol>${lis}</ol></section>`;
  return xhtmlDocument(title, body, "css/style.css", lang);
}
```

with:

```ts
function floatListDoc(
  title: string,
  kind: string,
  items: CrossFloat[],
  lang: string,
  profile: "default" | "kdp" | "epub2" = "default",
): string {
  const lis = items
    .map(
      (x) =>
        `<li><a href="${escapeHtml(x.href)}#${escapeHtml(x.id)}"><span class="fnum">${kind} ${escapeHtml(x.num)}</span> ${escapeHtml(x.caption)}</a></li>`,
    )
    .join("");
  const body = `<section class="floatlist"><h1>${escapeHtml(title)}</h1><ol>${lis}</ol></section>`;
  return xhtmlDocument(title, body, "css/style.css", lang, profile);
}
```

Replace lines 394-400:

```ts
function glossaryDoc(glossary: { term: string; definition: string }[], lang: string): string {
  const dl = glossary
    .map((g) => `<dt>${escapeHtml(g.term)}</dt><dd>${escapeHtml(g.definition)}</dd>`)
    .join("");
  const body = `<section class="glossary" epub:type="glossary"><h1>Glossary</h1><dl>${dl}</dl></section>`;
  return xhtmlDocument("Glossary", body, "css/style.css", lang);
}
```

with:

```ts
function glossaryDoc(
  glossary: { term: string; definition: string }[],
  lang: string,
  profile: "default" | "kdp" | "epub2" = "default",
): string {
  const dl = glossary
    .map((g) => `<dt>${escapeHtml(g.term)}</dt><dd>${escapeHtml(g.definition)}</dd>`)
    .join("");
  const body = `<section class="glossary" epub:type="glossary"><h1>Glossary</h1><dl>${dl}</dl></section>`;
  return xhtmlDocument("Glossary", body, "css/style.css", lang, profile);
}
```

- [ ] **Step 6: Rewrite `buildOpf` — version, nav item, EPUB2 metadata, `properties` stripping**

Replace lines 468-569 (the entire `buildOpf` function) with:

```ts
function buildOpf(
  book: Book,
  chapters: Chapter[],
  images: ImageRes[] = [],
  audios: ImageRes[] = [],
  auxFront: AuxDoc[] = [],
  auxBack: AuxDoc[] = [],
  profile: "default" | "kdp" | "epub2" = "default",
): string {
  const isEpub2 = profile === "epub2";
  const manifest = [
    // EPUB2 (D3): no nav.xhtml at all for epub2 — NCX is the only/primary
    // nav, and "properties" is an OPF3-only attribute with no meaning under
    // an OPF2 (version="2.0") package.
    ...(isEpub2
      ? []
      : ['<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>']),
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="css/style.css" media-type="text/css"/>',
    // Cover: default profile registers the vector SVG as the EPUB3 cover-image
    // (cover.xhtml embeds it inline, hence properties="svg"); the kdp profile
    // (D5, docs/specs/kdp-clean-export-profile.md) registers a raster JPEG
    // instead. epub2 does NOT raster the cover (out of scope for this
    // profile — only math/diagrams/audio are touched) but, like every other
    // manifest item under epub2, drops the OPF3-only "properties" attribute;
    // the cover is still correctly registered via the EPUB2
    // <meta name="cover" content="cover-image"/> convention below.
    ...(profile === "kdp"
      ? [
          '<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
          '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
        ]
      : isEpub2
        ? [
            '<item id="cover-image" href="cover.svg" media-type="image/svg+xml"/>',
            '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
          ]
        : [
            '<item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>',
            '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>',
          ]),
    '<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>',
    ...images.map(
      (img) => `<item id="${img.id}" href="${escapeHtml(img.href)}" media-type="${img.mediaType}"/>`,
    ),
    ...audios.map(
      (aud) => `<item id="${aud.id}" href="${escapeHtml(aud.href)}" media-type="${aud.mediaType}"/>`,
    ),
    ...[...auxFront, ...auxBack].map(
      (d) => `<item id="${d.id}" href="${escapeHtml(d.href)}" media-type="application/xhtml+xml"/>`,
    ),
    ...chapters.map((ch) => {
      if (isEpub2) return `<item id="${ch.id}" href="${escapeHtml(ch.href)}" media-type="application/xhtml+xml"/>`;
      const props = [ch.hasMath ? "mathml" : "", ch.hasSvg ? "svg" : ""].filter(Boolean).join(" ");
      const attr = props ? ` properties="${props}"` : "";
      return `<item id="${ch.id}" href="${escapeHtml(ch.href)}" media-type="application/xhtml+xml"${attr}/>`;
    }),
  ];
  const spine = [
    '<itemref idref="cover"/>',
    '<itemref idref="titlepage"/>',
    '<itemref idref="colophon"/>',
    ...auxFront.map((d) => `<itemref idref="${d.id}"/>`),
    ...chapters.map((ch) => `<itemref idref="${ch.id}"/>`),
    ...auxBack.map((d) => `<itemref idref="${d.id}"/>`),
  ];

  const m = book.metadata ?? {};
  const lang = m.language || "en";
  const identifier = m.identifier || book.id;
  const meta: string[] = [
    `<dc:identifier id="bookid">${escapeHtml(identifier)}</dc:identifier>`,
    `<dc:title>${escapeHtml(book.title)}</dc:title>`,
    `<dc:language>${escapeHtml(lang)}</dc:language>`,
  ];
  if (m.author) {
    meta.push(`<dc:creator id="creator">${escapeHtml(m.author)}</dc:creator>`);
    meta.push(`<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>`);
    meta.push(`<meta refines="#creator" property="file-as">${escapeHtml(m.authorFileAs || m.author)}</meta>`);
  }
  if (m.publisher) meta.push(`<dc:publisher>${escapeHtml(m.publisher)}</dc:publisher>`);
  if (m.date) meta.push(`<dc:date>${escapeHtml(profile === "kdp" ? isoDate(m.date) : m.date)}</dc:date>`);
  if (m.description) meta.push(`<dc:description>${escapeHtml(m.description)}</dc:description>`);
  for (const s of m.subjects ?? []) meta.push(`<dc:subject>${escapeHtml(s)}</dc:subject>`);
  if (m.rights) meta.push(`<dc:rights>${escapeHtml(m.rights)}</dc:rights>`);
  if (m.series) {
    meta.push(`<meta property="belongs-to-collection" id="series">${escapeHtml(m.series)}</meta>`);
    meta.push(`<meta refines="#series" property="collection-type">series</meta>`);
    if (m.seriesIndex != null)
      meta.push(`<meta refines="#series" property="group-position">${escapeHtml(String(m.seriesIndex))}</meta>`);
  }
  if (profile === "kdp" && m.translator) {
    meta.push(`<dc:contributor id="translator">${escapeHtml(m.translator)}</dc:contributor>`);
    meta.push(`<meta refines="#translator" property="role" scheme="marc:relators">trl</meta>`);
  }
  if (profile === "kdp" && m.isbn) {
    meta.push(`<dc:identifier id="isbn">${escapeHtml(m.isbn)}</dc:identifier>`);
    meta.push(`<meta refines="#isbn" property="identifier-type" scheme="onix:codelist5">15</meta>`);
  }
  // EPUB2 (D3): drop the EPUB3-only accessibility a11y block (schema:*
  // property syntax) and dcterms:modified (an EPUB3-required OPF3 property).
  // EPUB2 uses only dc:* elements + <meta name=.. content=..>, both of which
  // are unaffected and stay emitted above/below unconditionally.
  if (!isEpub2) meta.push(...accessibilityMeta(book, chapters, images));
  meta.push(`<meta name="cover" content="cover-image"/>`);
  if (!isEpub2) meta.push(`<meta property="dcterms:modified">${modifiedTimestamp(book.updatedAt)}</meta>`);

  const opfVersion = isEpub2 ? "2.0" : "3.0";
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${opfVersion}" unique-identifier="bookid" xml:lang="${escapeHtml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${meta.join("\n")}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine.join("\n")}
</spine>
</package>
`;
}
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `cd compiler && npx jest epub.test.ts`
Expected: PASS — every pre-existing test (default/kdp, including the exact-byte-match test at line 88-92 and every metadata/accessibility test) still passes, plus the six new epub2-packaging tests and Task 1's four raster tests.

- [ ] **Step 8: Typecheck**

Run: `cd compiler && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add compiler/src/epub.ts compiler/src/xhtml.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): epub2 EPUB 2.0.1 packaging (OPF v2.0, NCX-primary, XHTML 1.1)"
```

---

## Task 3: compiler — audio strip + epubcheck EPUB2 gate

**Files:**
- Modify: `compiler/src/epub.ts:149-156` (add `stripAudioElements`, sibling to `packAudio`), `compiler/src/epub.ts` (the `xhtml = packAudio(...)` line inside the per-chapter loop — see Task 2 Step 4's resulting text)
- Modify: `compiler/__tests__/epubAudio.test.ts` (append a new `describe` block)
- Create: `compiler/__tests__/epub2Epubcheck.test.ts`

**Interfaces:**
- Consumes: `compileEpub(book, { profile: "epub2", mermaid? })` (Tasks 1–2). No new exported symbols from other files.
- Produces: `stripAudioElements(xhtml: string): string` — private to `epub.ts`, not exported (no other task needs it).

- [ ] **Step 1: Write the failing structural test**

Open `compiler/__tests__/epubAudio.test.ts`. It already exports a `bookWithAudio(clips: string[])` helper and an `MP3_B64` constant near the top (lines 8-45) and ends with a `describe("compileEpub — no-audio regression", ...)` block (lines 131-161). Append this new `describe` block at the end of the file, after that block's closing `});`:

```ts

describe("compileEpub — epub2 strips <audio> (D4, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md)", () => {
  it("strips <audio> from the chapter and emits no OEBPS/audio/ resource or manifest item", async () => {
    const bytes = await compileEpub(bookWithAudio([MP3_B64]), { profile: "epub2" });
    const zip = await JSZip.loadAsync(bytes);

    const audFiles = Object.keys(zip.files).filter((f) => f.startsWith("OEBPS/audio/"));
    expect(audFiles).toHaveLength(0);

    const ch = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(ch).not.toContain("<audio");
    expect(ch).not.toContain("data:audio");
    // the wrapping figure survives — just the <audio> clip itself is gone.
    expect(ch).toContain("<figcaption>Intro</figcaption>");

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain("audio/mpeg");
  });

  it("default and kdp profiles are unaffected by the epub2 strip (regression)", async () => {
    const defaultBytes = await compileEpub(bookWithAudio([MP3_B64]));
    const defaultZip = await JSZip.loadAsync(defaultBytes);
    expect(
      Object.keys(defaultZip.files).some((f) => /^OEBPS\/audio\/aud-001\.mp3$/.test(f)),
    ).toBe(true);

    const kdpBytes = await compileEpub(bookWithAudio([MP3_B64]), { profile: "kdp" });
    const kdpZip = await JSZip.loadAsync(kdpBytes);
    expect(
      Object.keys(kdpZip.files).some((f) => /^OEBPS\/audio\/aud-001\.mp3$/.test(f)),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd compiler && npx jest epubAudio.test.ts -t "epub2 strips"`
Expected: FAIL — `packAudio` still runs unconditionally for every profile, so the epub2 output still has `OEBPS/audio/aud-001.mp3` and the `<audio>` element.

- [ ] **Step 3: Add `stripAudioElements`, sibling to `packAudio`**

In `compiler/src/epub.ts`, find `packAudio` (lines 149-156):

```ts
// Sibling to packImages, one media type wider (ADR-040 rung 2). `audios` and
// `seen` are separate accumulators from packImages's — audio and image
// resources number independently (aud-001 vs img-001). Fallback extension
// "bin" for an unmapped audio mime type (packAudio has no legacy behavior to
// preserve, so "bin" is a deliberate, intentional choice — locked by test).
function packAudio(xhtml: string, audios: ImageRes[], seen: Map<string, string>): string {
  return packMedia(xhtml, "audio", "audio", "aud", "bin", audios, seen);
}
```

Add this new function directly after it (still before the `CONTAINER_XML` constant):

```ts
// EPUB2 packaging (D4, docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md,
// ADR-041 Initiative A): <audio> is EPUB3-only. Strip it defensively from
// chapter XHTML before packaging — sibling to packMedia, but this profile
// drops the element entirely rather than packaging it (no OEBPS/audio/
// resource, no manifest item; the compileEpub caller also skips calling
// packAudio for epub2 entirely). A stray topic-audio wrapper <figure>
// survives with just its <figcaption> — the narration's WORDS travel
// separately via the mobile-side transcript-prose fallback
// (buildCompilePayload / renderAudioTranscriptHtml in mobile/src/lib/).
// Non-greedy: <audio> elements never nest, so this can't over-match across
// two separate clips in the same chapter.
function stripAudioElements(xhtml: string): string {
  return xhtml.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, "");
}
```

- [ ] **Step 4: Route the per-chapter audio line through the strip for epub2**

Still in `compiler/src/epub.ts`, inside the per-topic loop (this is the text Task 2 Step 4 left in place — find the exact line):

```ts
      const xhtml = packAudio(packedImages, audios, seenAudio);
```

Replace with:

```ts
      const xhtml =
        profile === "epub2" ? stripAudioElements(packedImages) : packAudio(packedImages, audios, seenAudio);
```

- [ ] **Step 5: Run the structural test, verify it passes**

Run: `cd compiler && npx jest epubAudio.test.ts`
Expected: PASS — the new epub2 tests plus every pre-existing audio test (dedup, fallback extension, no-audio regression) still pass.

- [ ] **Step 6: Write the epubcheck real-gate test (D6)**

Create `compiler/__tests__/epub2Epubcheck.test.ts`:

```ts
// The D6 gate (docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md):
// the epub2-profile output must pass epubcheck AS EPUB 2 (epubcheck
// auto-detects the OPF version from content.opf) with zero fatals/errors.
// This fixture carries math, a Mermaid diagram, AND narration audio — all
// three of the profile's lossy-downgrade paths (D2 raster math/diagrams, D4
// strip audio) in one book, so a regression in any of them (a stray <math>,
// an un-rastered <svg>, a surviving <audio> element — none of which are
// valid in strict XHTML 1.1) fails this gate. Needs Java (to run
// epubcheck.jar) — auto-skips locally without it, mirroring
// kdpEpubcheck.test.ts's `gated` pattern.
//
// rasterize.ts is mocked (real Puppeteer/Chromium is not required to prove
// EPUB2 packaging validity) but returns a REAL, decodable 1x1 PNG — unlike
// kdpEpubcheck.test.ts's fixture (deliberately "no math, no diagrams"), this
// fixture's math+diagram sections DO reach the mocked rasterizer, so
// (mirroring kdpEpubcheck.test.ts's real-JPEG comment and
// audioEpubcheck.test.ts's real-MP3 comment) the bytes must be genuine,
// decodable image bytes, not arbitrary ones.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileEpub } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

// A real, tiny (1x1, transparent) decodable PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPngResilient: jest.fn(async (items: string[]) =>
    items.map(() => Buffer.from(PNG_B64, "base64")),
  ),
}));

function javaAvailable(): boolean {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const EPUBCHECK_JAR = require("epubcheck-assets") as string;
const gated = javaAvailable() ? describe : describe.skip;

// The exact shape mobile/src/lib/figuresHtml.ts renderAudioHtml() produces —
// see audioEpubcheck.test.ts. A genuine, tiny (~2KB), decodable MP3. This
// clip is expected to be STRIPPED by the epub2 profile before packaging, so
// its content never actually reaches epubcheck's media validation — using
// real bytes anyway is defense-in-depth: if the strip regresses, epubcheck
// hits a real (still invalid-for-XHTML1.1) <audio> element, not a
// false-negative from an unreachable fake payload.
const MP3_B64 =
  "//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAIKAAcHBwcHBwcHBwcHDg4ODg4ODg4ODg4VVVVVVVVVVVVVVVxcXFxcXFxcXFxcY6Ojo6Ojo6Ojo6OqqqqqqqqqqqqqqrHx8fHx8fHx8fHx+Pj4+Pj4+Pj4+Pj//////////////8AAAA5TEFNRTMuMTAwAaUAAAAALf4AABRAJAPMQgAAQAAACCiPUdGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEXYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

function audioHtml(): string {
  return `<figure class="topic-audio"><audio controls="controls" src="data:audio/mpeg;base64,${MP3_B64}"></audio><figcaption>Intro</figcaption></figure>`;
}

const LESSON: LessonOutput = {
  topic: "EPUB2 Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the epub2 epubcheck gate: math, a diagram, and narration audio.",
  learning_objectives: ["Understand the gate"],
  sections: [
    { heading: "Motion", body_markdown: "Velocity is $v = d/t$." },
    { heading: "Flow", body_markdown: "```mermaid\ngraph TD; A-->B;\n```" },
    { heading: "Narration", body_markdown: audioHtml() },
  ],
  key_takeaways: ["It validates"],
  further_reading: [],
};

function fixtureBook(): Book {
  return {
    id: "66666666-6666-6666-6666-666666666666",
    title: "EPUB2 Epubcheck Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    metadata: { author: "Fixture Author" },
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-18T00:00:00.000Z" } },
  };
}

const fakeMermaid = {
  renderAll: async (sources: readonly string[]) =>
    new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'])),
};

gated("epub2-profile EPUB — epubcheck gate (D6)", () => {
  it("passes epubcheck AS EPUB 2 with zero fatals/errors (math rastered, diagram rastered, audio stripped)", async () => {
    const bytes = await compileEpub(fixtureBook(), { mermaid: fakeMermaid, profile: "epub2" });
    const tmp = path.join(os.tmpdir(), `epub2-epubcheck-${Date.now()}.epub`);
    fs.writeFileSync(tmp, bytes);
    let output = "";
    try {
      output = execFileSync("java", ["-jar", EPUBCHECK_JAR, tmp], { encoding: "utf8" });
    } catch (err) {
      // epubcheck exits non-zero on errors; stdout/stderr still carries the report.
      const e = err as { stdout?: string; message: string };
      output = e.stdout ?? e.message;
    } finally {
      fs.unlinkSync(tmp);
    }
    expect(output).toMatch(/0 fatals \/ 0 errors \//);
  }, 60_000);
});
```

- [ ] **Step 7: Run the epubcheck test**

Run: `cd compiler && npx jest epub2Epubcheck.test.ts`
Expected (if `java -version` succeeds on this machine): PASS. If Java is unavailable, the suite auto-skips (`describe.skip`) — treat that as inconclusive, not green; confirm the underlying logic via Step 5's already-passing structural test, and flag in the task's PR description that the epubcheck gate needs a Java-enabled CI run to confirm. **If it runs and fails**, read the specific epubcheck error code from `output` (e.g. an `OPF-...`/`RSC-...` code) before changing anything — a failure here means an EPUB2-invalid construct slipped through Task 2's packaging (most likely a leftover `properties` attribute or an un-stripped `epub:type`), not a bug in this task's audio strip.

- [ ] **Step 8: Run the full compiler suite**

Run: `cd compiler && npx jest`
Expected: PASS (all suites, including Tasks 1–2's tests).

- [ ] **Step 9: Commit**

```bash
git add compiler/src/epub.ts compiler/__tests__/epubAudio.test.ts compiler/__tests__/epub2Epubcheck.test.ts
git commit -m "feat(compiler): epub2 strips <audio>; epubcheck EPUB2 validation gate (D6)"
```

---

## Task 4: backend + cli — thread `--profile epub2` end-to-end

**Files:**
- Modify: `compiler/src/cli.ts:32-73` (`Format`/`parseArgs`)
- Modify: `compiler/__tests__/cli.test.ts` (append tests)
- Modify: `backend/src/export/compiler.py:65-114` (`compile_book` — profile validation + argv)
- Modify: `backend/src/export/router.py:79-105`, `:194-224` (`export_book`/`submit_export` — profile validation + guard)
- Modify: `backend/tests/test_export_kdp_profile.py` (append tests)

**Interfaces:**
- Consumes: `compileEpub`'s `profile` param already accepts `"epub2"` (Tasks 1–3); this task only widens the CLI/HTTP plumbing that reaches it.
- Produces: `compiler/dist/cli.js --profile epub2` (built artifact, exercised by `compiler.compile_book(raw, profile="epub2")`); `POST /api/v1/export?profile=epub2` and `POST /api/v1/export/jobs?profile=epub2` — Task 5 (mobile `client.ts`) depends on these two query-param-accepting endpoints and on `compiler.compile_book`'s `profile` argument accepting the literal string `"epub2"`.

- [ ] **Step 1: Write the failing cli.ts test**

Open `compiler/__tests__/cli.test.ts`. It currently reads:

```ts
import { parseArgs } from "../src/cli";

describe("parseArgs — --profile", () => {
  it("defaults to profile 'default' when --profile is omitted", () => {
    expect(parseArgs(["book.json"]).profile).toBe("default");
  });

  it("parses --profile kdp", () => {
    expect(parseArgs(["book.json", "--profile", "kdp"]).profile).toBe("kdp");
  });

  it("falls back to 'default' for an unrecognized --profile value", () => {
    expect(parseArgs(["book.json", "--profile", "bogus"]).profile).toBe("default");
  });

  it("still parses --format and --mermaid alongside --profile", () => {
    const args = parseArgs(["book.json", "--format", "epub", "--mermaid", "--profile", "kdp"]);
    expect(args).toMatchObject({ format: "epub", mermaid: true, profile: "kdp" });
  });
});
```

Add a new test after `"parses --profile kdp"`:

```ts
  it("parses --profile epub2", () => {
    expect(parseArgs(["book.json", "--profile", "epub2"]).profile).toBe("epub2");
  });
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd compiler && npx jest cli.test.ts -t "epub2"`
Expected: FAIL — `parseArgs` returns `"default"` for `--profile epub2` today (only `"kdp"` is recognized).

- [ ] **Step 3: Widen `parseArgs` in `compiler/src/cli.ts`**

Replace lines 34-49:

```ts
export function parseArgs(argv: string[]): {
  input?: string;
  output?: string;
  mermaid: boolean;
  format: Format;
  profile: "default" | "kdp";
} {
  let input: string | undefined;
  let output: string | undefined;
  let mermaid = false;
  let format: Format = "epub";
  let profile: "default" | "kdp" = "default";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mermaid") mermaid = true;
    else if (a === "--profile") profile = argv[++i] === "kdp" ? "kdp" : "default";
    else if (a === "--format") {
```

with:

```ts
export function parseArgs(argv: string[]): {
  input?: string;
  output?: string;
  mermaid: boolean;
  format: Format;
  profile: "default" | "kdp" | "epub2";
} {
  let input: string | undefined;
  let output: string | undefined;
  let mermaid = false;
  let format: Format = "epub";
  let profile: "default" | "kdp" | "epub2" = "default";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mermaid") mermaid = true;
    else if (a === "--profile") {
      const p = argv[++i];
      profile = p === "kdp" ? "kdp" : p === "epub2" ? "epub2" : "default";
    } else if (a === "--format") {
```

- [ ] **Step 4: Run cli.ts tests, verify pass**

Run: `cd compiler && npx jest cli.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Build the compiler (backend shells out to the built `dist/cli.js`)**

Run: `cd compiler && npm run build`
Expected: succeeds with no TS errors.

- [ ] **Step 6: Write the failing backend tests**

Open `backend/tests/test_export_kdp_profile.py`. Find `test_compile_book_appends_profile_kdp_to_argv` (lines 36-51) and insert a new test directly after it:

```python
async def test_compile_book_appends_profile_epub2_to_argv():
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(return_value=(b"EPUBBYTES", b""))
    mock_proc.returncode = 0
    with patch(
        "backend.src.export.compiler.asyncio.create_subprocess_exec",
        AsyncMock(return_value=mock_proc),
    ) as create_exec:
        await compiler.compile_book(
            b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
            profile="epub2",
        )
    argv = create_exec.call_args.args
    assert "--profile" in argv
    assert argv[argv.index("--profile") + 1] == "epub2"
```

Then find the block of HTTP-layer tests that begins with `test_sync_export_rejects_kdp_profile_for_pdf` (lines 98-124). Insert these new tests directly after `test_sync_export_rejects_unknown_profile_value` (which ends at line 124, right before the `# ── Publish Pack ...` comment on line 127):

```python
async def test_sync_export_rejects_epub2_profile_for_pdf(client):
    resp = await client.post("/api/v1/export?format=pdf&profile=epub2", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "epub2" in resp.json()["detail"].lower()
    assert "epub" in resp.json()["detail"].lower()


async def test_async_export_rejects_epub2_profile_for_pdf(client):
    resp = await client.post(
        "/api/v1/export/jobs?format=pdf&profile=epub2", content=json.dumps(_BOOK)
    )
    assert resp.status_code == 422
    assert "epub2" in resp.json()["detail"].lower()
    assert "epub" in resp.json()["detail"].lower()


async def test_sync_export_allows_epub2_profile_for_epub(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False, profile="default"):
        return compiler.ExportResult(data=b"EPUBBYTES", title="Physics & Friends", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export?format=epub&profile=epub2", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/epub+zip")


async def test_sync_export_allows_format_pack_with_epub2_profile(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False, profile="default"):
        return compiler.ExportResult(
            data=b"PK\x03\x04zipbytes", title="Physics & Friends", warnings=[]
        )

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export?format=pack&profile=epub2", content=json.dumps(_BOOK))
    assert resp.status_code == 200
```

- [ ] **Step 7: Run the backend tests, verify they fail**

Run: `python -m pytest backend/tests/test_export_kdp_profile.py -q`
Expected: FAIL — `compile_book` raises `ExportValidationError("profile must be 'default' or 'kdp'.")` for `profile="epub2"`, and the router 422s every `profile=epub2` request the same way.

- [ ] **Step 8: Widen validation + argv in `backend/src/export/compiler.py`**

Replace lines 65-114 (the full `compile_book` function) with:

```python
async def compile_book(
    raw_book: bytes,
    *,
    fmt: str = "epub",
    diagrams: bool = False,
    profile: str = "default",
) -> ExportResult:
    """Compile raw book.json bytes into an artifact (EPUB, PDF, DOCX, or a zip
    Publish Pack) via the Node compiler.

    fmt:      "epub" | "pdf" | "docx" | "pack" ("pack" bundles a KDP-clean
    EPUB + cover + metadata sheet + retailer README — see
    docs/superpowers/specs/2026-08-18-publish-pack-scope-b-design.md; it
    always emits a kdp-profile EPUB internally, so it needs no `profile=kdp`
    from the caller). diagrams: render Mermaid → SVG (needs Chromium; much
    slower, so it gets the longer diagram timeout). profile: "default" |
    "kdp" | "epub2" ("kdp" — docs/specs/kdp-clean-export-profile.md; "epub2" —
    docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md, ADR-041
    Initiative A — both epub-only). Raises ExportValidationError for bad
    input, CompilerError otherwise.
    """
    book = validate_book(raw_book)
    if profile not in ("default", "kdp", "epub2"):
        raise ExportValidationError("profile must be 'default', 'kdp' or 'epub2'.")

    # Gate 3 — format-drift scan over the whole book's generated content (lesson +
    # tutorial + experiment). Non-fatal: never blocks a compile. This is the only
    # place tutorial/experiment content meets gate 3 (native generation emits only
    # lessons, already checked by the worker). See docs/QUALITY_GATES.md §1 gate 3.
    warnings = book_warnings(book)
    if warnings:
        log.warning(
            "format_warnings",
            surface="export",
            count=len(warnings),
            rules=sorted({w.get("rule", "") for w in warnings}),
            topics=len({w.get("topic_id") for w in warnings}),
        )

    if fmt == "pack":
        diagrams = True  # pack's README promises rasterized diagrams — enforce at the format, not the caller

    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", fmt]
    if diagrams:
        argv.append("--mermaid")
    if profile == "kdp":
        argv.extend(["--profile", "kdp"])
    elif profile == "epub2":
        argv.extend(["--profile", "epub2"])
    # Diagram rendering (108 Chromium passes) is minutes-long; give it room.
    timeout = (
        settings.export_diagram_timeout_seconds if diagrams else settings.export_timeout_seconds
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        log.error("compiler_unavailable", node_bin=settings.node_bin)
        raise CompilerError("Compiler runtime is unavailable.") from exc

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=raw_book),
            timeout=timeout,
        )
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise CompilerError("Compilation timed out.") from exc

    if proc.returncode != 0:
        detail = stderr.decode("utf-8", "replace").strip()
        # The compiler prints this for a book with no generated content — that's
        # a user-input problem (422), not a server fault.
        if "no generated content" in detail.lower():
            raise ExportValidationError("Book has no generated content to compile.")
        # The kdp profile refuses to compile a draft book (epub.ts's
        # KdpDraftError) — also a user-input problem, not a server fault.
        # substring must match KdpDraftError.message in compiler/src/epub.ts
        if "kdp export profile requires a released book" in detail.lower():
            raise ExportValidationError(
                "The KDP export profile requires a released book "
                '(set metadata.status to something other than "draft").'
            )
        log.error("compiler_failed", fmt=fmt, returncode=proc.returncode, detail=detail[:500])
        raise CompilerError("Compilation failed.")

    log.info(
        "export_ok",
        fmt=fmt,
        diagrams=diagrams,
        title_len=len(book["title"]),
        subjects=len(book["toc"]["subjects"]),
        out_bytes=len(stdout),
        warnings=len(warnings),
    )
    return ExportResult(data=stdout, title=book["title"], warnings=warnings)
```

- [ ] **Step 9: Widen validation + guard in `backend/src/export/router.py`**

Replace lines 79-105 (`export_book`'s validation preamble) with:

```python
@router.post("/export", dependencies=[Depends(enforce_rate_limit)])
async def export_book(
    request: Request,
    format: str = "epub",
    diagrams: bool = False,
    profile: str = "default",
    principal: Principal | None = Depends(optional_user),
) -> Response:
    """Compile a book to an artifact. `format`=epub|pdf|docx; `diagrams`=true renders
    Mermaid → SVG (Chromium; much slower); `profile`=default|kdp|epub2 (kdp/epub2
    are epub-only — docs/specs/kdp-clean-export-profile.md,
    docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md)."""
    fmt = format.lower()
    if fmt not in _FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub', 'pdf', 'docx' or 'pack'."},
        )
    if profile not in ("default", "kdp", "epub2"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "profile must be 'default', 'kdp' or 'epub2'."},
        )
    if profile in ("kdp", "epub2") and fmt not in ("epub", "pack"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": f"the {profile} profile is only supported for format=epub or format=pack."},
        )
    media_type, ext = _FORMATS[fmt]
```

Then replace lines 194-224 (`submit_export`'s validation preamble) with:

```python
@router.post(
    "/export/jobs",
    response_model=ExportSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_export(
    request: Request,
    background: BackgroundTasks,
    format: str = "epub",
    diagrams: bool = False,
    profile: str = "default",
    r: redis.Redis = Depends(get_redis),
    principal: Principal | None = Depends(optional_user),
) -> ExportSubmitResponse:
    """Submit a book for async compilation. Returns 202 + job_id; poll
    GET /export/jobs/{id} then download /export/jobs/{id}/artifact.

    Validation that is cheap and definitive (format, size, obvious bad JSON) runs
    synchronously so the client still gets an immediate 4xx; the slow compile is
    deferred to the background task."""
    fmt = format.lower()
    if fmt not in _ASYNC_FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub', 'pdf', 'docx' or 'pack'."},
        )
    if profile not in ("default", "kdp", "epub2"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "profile must be 'default', 'kdp' or 'epub2'."},
        )
    if profile in ("kdp", "epub2") and fmt not in ("epub", "pack"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": f"the {profile} profile is only supported for format=epub or format=pack."},
        )
```

- [ ] **Step 10: Run the backend tests, verify they pass**

Run: `python -m pytest backend/tests/test_export_kdp_profile.py -q`
Expected: PASS — including the pre-existing `test_sync_export_rejects_kdp_profile_for_pdf` etc. (the `f"the {profile} profile is..."` message still contains `"kdp"` for kdp requests, so those assertions are unaffected).

- [ ] **Step 11: Run the full export test slice + ruff**

Run: `python -m pytest backend/tests -q -k "export"`
Expected: PASS.

Run: `ruff format backend/src/export/compiler.py backend/src/export/router.py backend/tests/test_export_kdp_profile.py && ruff check backend/src/export/compiler.py backend/src/export/router.py backend/tests/test_export_kdp_profile.py`
Expected: no diff, no lint errors.

- [ ] **Step 12: Commit**

```bash
git add compiler/src/cli.ts compiler/__tests__/cli.test.ts backend/src/export/compiler.py backend/src/export/router.py backend/tests/test_export_kdp_profile.py
git commit -m "feat: thread --profile epub2 through the compiler CLI and backend export API"
```

---

## Task 5: mobile — "EPUB 2 (max compatibility)" export + transcript fallback + Help

**Files:**
- Modify: `mobile/src/lib/figuresHtml.ts` (add `renderAudioTranscriptHtml`)
- Modify: `mobile/__tests__/lib/figuresHtml.test.ts` (append tests)
- Modify: `mobile/src/lib/compilePayload.ts:1-78` (`CompileFormat`, `isEpubFamily`, audio branch)
- Modify: `mobile/__tests__/lib/compilePayload.test.ts` (append tests)
- Modify: `mobile/src/api/client.ts:164-175` (`ExportOptions.profile`), `:255-262` (`submitExportJob`'s `profile` param)
- Modify: `mobile/src/components/CheckoutButton.tsx` (add `checkoutEpub2` + button)
- Modify: `mobile/__tests__/components/CheckoutButton.test.tsx` (append tests)
- Modify: `mobile/src/help-content/features.ts:27-28` (add `epub2-export`)
- Modify: `mobile/src/help-content/topics.ts:434-435` (add the `epub2-export` topic)
- Modify: `mobile/src/help-content/tree.ts:65-66` (add the tree leaf)

**Interfaces:**
- Consumes: `exportBook(book: Book, opts: ExportOptions): Promise<ExportedArtifact>` (`@/api/client`, unchanged call shape, widened `profile` type); `TopicAudio.transcript?: string` (`@/types/book`, already exists).
- Produces: `renderAudioTranscriptHtml(audio: TopicAudio[]): string` (exported from `@/lib/figuresHtml`); `CompileFormat = "epub" | "epub2" | "pdf" | "docx" | "pack"` (exported from `@/lib/compilePayload`) — both are used only within this task (`compilePayload.ts` imports the former; `CheckoutButton.tsx` imports `buildCompilePayload`, not `CompileFormat`, directly).

- [ ] **Step 1: Write the failing `renderAudioTranscriptHtml` unit tests**

Open `mobile/__tests__/lib/figuresHtml.test.ts`. It currently ends (line 73) with the `renderAudioHtml` describe block. Update the import at the top (line 1):

```ts
import { countBookFigures, renderAudioHtml, renderFiguresHtml } from "@/lib/figuresHtml";
```

to:

```ts
import { countBookFigures, renderAudioHtml, renderAudioTranscriptHtml, renderFiguresHtml } from "@/lib/figuresHtml";
```

Then append this new `describe` block at the end of the file:

```ts

const audT = (id: string, transcript?: string, title?: string): TopicAudio => ({
  id, file: `media/b/${id}.mp3`, mime: "audio/mpeg", title, transcript,
});

describe("renderAudioTranscriptHtml", () => {
  it("returns empty string for no clips, a clip with no transcript, or a whitespace-only transcript", () => {
    expect(renderAudioTranscriptHtml([])).toBe("");
    expect(renderAudioTranscriptHtml([audT("a")])).toBe("");
    expect(renderAudioTranscriptHtml([audT("a", "   ")])).toBe("");
  });
  it("emits a figure per clip with a transcript, as escaped prose with no <audio>", () => {
    const html = renderAudioTranscriptHtml([audT("a", "Hello <b>there</b>.", "Intro")]);
    expect(html).toContain('<figure class="topic-audio-transcript">');
    expect(html).toContain("<p>Hello &lt;b&gt;there&lt;/b&gt;.</p>");
    expect(html).toContain("<figcaption>Intro</figcaption>");
    expect(html).not.toContain("<audio");
  });
  it("falls back to 'Narration' when the clip has no title", () => {
    const html = renderAudioTranscriptHtml([audT("a", "Hello.")]);
    expect(html).toContain("<figcaption>Narration</figcaption>");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd mobile && npx jest figuresHtml`
Expected: FAIL — `renderAudioTranscriptHtml` doesn't exist yet (`figuresHtml.ts` has no such export).

- [ ] **Step 3: Add `renderAudioTranscriptHtml` to `mobile/src/lib/figuresHtml.ts`**

Find the end of the file (after `renderAudioHtml`, lines 81-97):

```ts
export function renderAudioHtml(audio: TopicAudio[], dataUrls: Map<string, string>): string {
  return (audio ?? [])
    .map((a) => {
      const src = dataUrls.get(a.id);
      if (!src) return "";
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      // `controls="controls"` — NOT the bare boolean `controls`. This module's
      // markup is embedded as raw HTML inside a compiled EPUB3 chapter, which
      // gets parsed as XML; a bare boolean attribute is a FATAL well-formedness
      // error there (epubcheck RSC-016). Same convention as the checkbox
      // renderer in `compiler/src/markdown.ts` (`checked="checked"
      // disabled="disabled"`), for the same XHTML/XML reason.
      return `<figure class="topic-audio"><audio controls="controls" src="${esc(src)}"></audio>${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
}
```

Append this new function directly after it:

```ts

/**
 * Audio clips for a topic as prose "Narration (transcript)" markup — the
 * EPUB 2 / max-compatibility fallback (ADR-041 Initiative A D4,
 * docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md). EPUB 2
 * is XHTML 1.1 and can't carry `<audio>`, so the narration's WORDS survive as
 * a paragraph per clip instead of the clip itself. A clip with no transcript
 * is skipped (nothing to show). Unlike renderAudioHtml this needs no resolved
 * data: URL — transcript text has no bytes to resolve, so this function is
 * synchronous and takes no dataUrls map.
 */
export function renderAudioTranscriptHtml(audio: TopicAudio[]): string {
  return (audio ?? [])
    .map((a) => {
      const text = a.transcript?.trim();
      if (!text) return "";
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      return `<figure class="topic-audio-transcript"><p>${esc(text)}</p>${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `cd mobile && npx jest figuresHtml`
Expected: PASS.

- [ ] **Step 5: Write the failing `buildCompilePayload` epub2 tests**

Open `mobile/__tests__/lib/compilePayload.test.ts`. Append this new `describe` block at the end of the file:

```ts

describe("buildCompilePayload — epub2 transcript fallback (ADR-041 Initiative A D4)", () => {
  function bookWithAudioTranscript(): Book {
    return bookWithTopic({
      content: {
        t1: {
          topicId: "t1", title: "U", generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hello there." }],
        },
      },
    });
  }

  it("an epub2-target payload emits the transcript as prose, not <audio>", async () => {
    const payload = await buildCompilePayload(bookWithAudioTranscript(), "epub2");
    const secs = payload.content!.t1.lesson.sections;
    expect(secs.at(-1)!.heading).toBe("Narration (transcript)");
    expect(secs.at(-1)!.body_markdown).toContain("Hello there.");
    expect(secs.at(-1)!.body_markdown).not.toContain("<audio");
  });

  it("an epub2-target payload does NOT call resolveAudioDataUrls (no data: URL needed for prose)", async () => {
    const { resolveAudioDataUrls } = jest.requireMock("@/storage/mediaStore");
    (resolveAudioDataUrls as jest.Mock).mockClear();
    await buildCompilePayload(bookWithAudioTranscript(), "epub2");
    expect(resolveAudioDataUrls).not.toHaveBeenCalled();
  });

  it("a clip with no transcript gets no Narration section on the epub2 target", async () => {
    const book = bookWithTopic({
      content: {
        t1: {
          topicId: "t1", title: "U", generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg" }], // no transcript
        },
      },
    });
    const payload = await buildCompilePayload(book, "epub2");
    const headings = payload.content!.t1.lesson.sections.map((s) => s.heading);
    expect(headings).not.toContain("Narration (transcript)");
  });

  it("escapes special characters in the transcript text", async () => {
    const book = bookWithTopic({
      content: {
        t1: {
          topicId: "t1", title: "U", generatedAt: "x",
          lesson: {
            topic: "U", synopsis: "s", learning_objectives: [],
            sections: [{ heading: "H", body_markdown: "b" }],
            key_takeaways: [],
          } as any,
          audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", transcript: "A <b> & C" }],
        },
      },
    });
    const payload = await buildCompilePayload(book, "epub2");
    const md = payload.content!.t1.lesson.sections.at(-1)!.body_markdown;
    expect(md).toContain("A &lt;b&gt; &amp; C");
  });
});
```

- [ ] **Step 6: Run the test, verify it fails**

Run: `cd mobile && npx jest compilePayload`
Expected: FAIL — `buildCompilePayload(book, "epub2")` isn't a valid `CompileFormat` value today (TS error), and even ignoring types, `isEpubFamily("epub2")` returns `false` so no Narration section is added at all.

- [ ] **Step 7: Widen `CompileFormat` and the audio branch in `mobile/src/lib/compilePayload.ts`**

Replace lines 1-53 (imports through the start of the `for` loop body's audio branch) with:

```ts
import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls, resolveAudioDataUrls } from "@/storage/mediaStore";
import { figureAltText, renderAudioHtml, renderAudioTranscriptHtml } from "@/lib/figuresHtml";

function mdEsc(s: string): string {
  return s.replace(/([[\]()\\])/g, "\\$1");
}

// Every export target buildCompilePayload feeds: EPUB and its EPUB-based
// derivatives (kdp profile, the publish pack) can carry narration audio (the
// compiler's packAudio embeds it as a real EPUB resource) — EXCEPT epub2,
// which strips <audio> entirely (EPUB 2 is XHTML 1.1, no HTML5 media) and
// instead gets the narration's TRANSCRIPT as prose (ADR-041 Initiative A D4,
// docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md). PDF and
// DOCX cannot carry audio at all — audio has nowhere to render there, so
// injecting it would only ship a dead, non-functional base64 blob (spec
// non-goal: "No PDF/DOCX audio (EPUB only)"). "pack" is included here (not
// just "epub") because the Publish Pack's KDP-EPUB is itself EPUB-based.
export type CompileFormat = "epub" | "epub2" | "pdf" | "docx" | "pack";

function isEpubFamily(format: CompileFormat): boolean {
  return format === "epub" || format === "epub2" || format === "pack";
}

// The remote compiler is a stateless HTTP service — the app POSTs the whole
// Book JSON and there is no separate media channel. So an attached image can
// only reach the compiler as a base64 data: URI already inline in a topic's
// markdown; the compiler's existing packImages() extracts those into EPUB
// resources (the PDF path renders the same inline <img>).
//
// Deep-copy the book and, for each topic with attached images, append a
// synthetic "Figures" lesson section whose markdown embeds each resolved
// image in author order. The stored book is never mutated — callers must use
// the returned copy for the compile POST, not the original.
//
// `format` gates the Narration/audio section — omitted defaults to "pdf" (no
// audio), the safe choice for a call site that doesn't know its target yet;
// callers that DO compile to an EPUB-family target must say so explicitly to
// get narration audio (or, for epub2, the transcript) at all.
export async function buildCompilePayload(book: Book, format: CompileFormat = "pdf"): Promise<Book> {
  const copy: Book = JSON.parse(JSON.stringify(book));
  const withAudio = isEpubFamily(format);
  for (const gen of Object.values(copy.content ?? {})) {
    const topic = gen as GeneratedTopic;

    if (withAudio && topic.audio?.length) {
      if (format === "epub2") {
        // EPUB 2 can't carry <audio> — emit the transcript as prose instead
        // so the narration's words survive. No data: URL resolution needed;
        // the transcript is already plain text on the ref.
        const html = renderAudioTranscriptHtml(topic.audio);
        if (html) {
          const section: LessonSection = { heading: "Narration (transcript)", body_markdown: html };
          topic.lesson.sections = [...(topic.lesson.sections ?? []), section];
        }
      } else {
        const audioUrls = await resolveAudioDataUrls(topic);
        if (audioUrls.size) {
          const html = renderAudioHtml(topic.audio, audioUrls);
          if (html) {
            const section: LessonSection = { heading: "Narration", body_markdown: html };
            topic.lesson.sections = [...(topic.lesson.sections ?? []), section];
          }
        }
      }
    }
```

The remainder of the function (the `if (!topic.images?.length) continue;` block through the end) is unchanged — leave it in place exactly as it is.

- [ ] **Step 8: Run the test, verify it passes**

Run: `cd mobile && npx jest compilePayload`
Expected: PASS — the four new epub2 tests plus every pre-existing test (default/pdf/docx/epub/pack audio-gate tests, figures tests) still pass.

- [ ] **Step 9: Widen `ExportOptions.profile` and `submitExportJob` in `mobile/src/api/client.ts`**

Replace lines 164-175:

```ts
export interface ExportOptions {
  format?: "epub" | "pdf" | "cover" | "docx" | "pack"; // "cover" → a PNG thumbnail of the cover; "pack" → a zip Publish Pack (P2-6 Scope B)
  diagrams?: boolean;
  // KDP-clean export profile (docs/specs/kdp-clean-export-profile.md) — epub
  // only. Rasters math/diagrams/cover and drops the embedded body font so the
  // artifact ingests cleanly on Amazon KDP. Omitted/"default" is today's export.
  profile?: "default" | "kdp";
  // Called with the async job id right after submit (epub/pdf only), before the
  // compile finishes — lets a caller persist a "generating" status that a list
  // can reconcile later. Not called for the synchronous `cover` path.
  onSubmitted?: (jobId: string) => void;
}
```

with:

```ts
export interface ExportOptions {
  format?: "epub" | "pdf" | "cover" | "docx" | "pack"; // "cover" → a PNG thumbnail of the cover; "pack" → a zip Publish Pack (P2-6 Scope B)
  diagrams?: boolean;
  // Distribution-target profile — epub-family only. "kdp"
  // (docs/specs/kdp-clean-export-profile.md) rasters math/diagrams/cover and
  // drops the embedded body font so the artifact ingests cleanly on Amazon
  // KDP. "epub2" (docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md,
  // ADR-041 Initiative A) rasters math/diagrams too but packages a strict
  // EPUB 2.0.1 (OPF version="2.0", NCX-primary nav, no <audio>) for readers
  // that reject EPUB3 outright. Omitted/"default" is today's export.
  profile?: "default" | "kdp" | "epub2";
  // Called with the async job id right after submit (epub/pdf only), before the
  // compile finishes — lets a caller persist a "generating" status that a list
  // can reconcile later. Not called for the synchronous `cover` path.
  onSubmitted?: (jobId: string) => void;
}
```

Replace lines 255-262:

```ts
async function submitExportJob(
  book: Book,
  format: "epub" | "pdf" | "docx" | "pack",
  diagrams: boolean,
  profile?: "default" | "kdp",
): Promise<string> {
  const params = new URLSearchParams({ format, diagrams: String(diagrams) });
  if (profile) params.set("profile", profile);
```

with:

```ts
async function submitExportJob(
  book: Book,
  format: "epub" | "pdf" | "docx" | "pack",
  diagrams: boolean,
  profile?: "default" | "kdp" | "epub2",
): Promise<string> {
  const params = new URLSearchParams({ format, diagrams: String(diagrams) });
  if (profile) params.set("profile", profile);
```

- [ ] **Step 10: Typecheck**

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Write the failing `CheckoutButton` tests**

Open `mobile/__tests__/components/CheckoutButton.test.tsx`. Find the `bookWithAudio` fixture (lines 36-51):

```tsx
const bookWithAudio = {
  ...book,
  content: {
    t1: {
      topicId: "t1",
      title: "U",
      generatedAt: "x",
      lesson: {
        topic: "U", synopsis: "s", learning_objectives: [],
        sections: [{ heading: "H", body_markdown: "b" }],
        key_takeaways: [],
      },
      audio: [{ id: "a1", file: "media/b1/a1.mp3", mime: "audio/mpeg", title: "Intro" }],
    },
  },
} as unknown as Book;
```

Add a new fixture directly after it (this one carries a `transcript`, which `bookWithAudio` deliberately does not — the epub2 transcript test needs a transcript to render, and `bookWithAudio`'s omission is itself covered by the "no transcript → no section" test below):

```tsx

// Like bookWithAudio, but the clip carries a transcript — used by the epub2
// transcript-fallback test below. bookWithAudio has no transcript, which the
// epub2 path correctly treats as "nothing to show" (see the no-transcript
// test below), so this needs its own fixture.
const bookWithAudioTranscript = {
  ...book,
  content: {
    t1: {
      topicId: "t1",
      title: "U",
      generatedAt: "x",
      lesson: {
        topic: "U", synopsis: "s", learning_objectives: [],
        sections: [{ heading: "H", body_markdown: "b" }],
        key_takeaways: [],
      },
      audio: [{ id: "a1", file: "media/b1/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hello there." }],
    },
  },
} as unknown as Book;
```

Then append these tests at the end of the file (after the last `it(...)` block, which currently ends at line 208):

```tsx

it("renders the EPUB 2 (max compatibility) button", () => {
  render(<CheckoutButton book={book} />);
  expect(
    screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }),
  ).toBeTruthy();
});

it("EPUB 2 (max compatibility) checks out a distinct, profile=epub2 EPUB", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/EPUB 2 \(max compatibility\) downloaded|Saved:/)).toBeTruthy());
  expect(mockExport).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ format: "epub", diagrams: true, profile: "epub2" }),
  );
  expect(mockDownload).toHaveBeenCalledWith(
    expect.anything(),
    "physics-epub2.epub",
    "application/epub+zip",
  );
});

it("EPUB 2 (max compatibility) button re-enables after a failed export", async () => {
  mockExport.mockRejectedValue(new Error("network fetch failed"));
  render(<CheckoutButton book={book} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/Couldn’t reach the server/)).toBeTruthy());
  const button = screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" });
  expect(button.props.accessibilityState?.disabled).toBe(false);
});

it("EPUB 2 (max compatibility) posts a payload with the narration TRANSCRIPT, not <audio>", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudioTranscript} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/EPUB 2 \(max compatibility\) downloaded|Saved:/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const secs = postedBook.content!.t1.lesson.sections;
  expect(secs.at(-1)!.heading).toBe("Narration (transcript)");
  expect(secs.at(-1)!.body_markdown).toContain("Hello there.");
  expect(secs.at(-1)!.body_markdown).not.toContain("<audio");
});

it("EPUB 2 (max compatibility) with a clip that has no transcript gets no Narration section", async () => {
  mockExport.mockResolvedValue({ artifact: new ArrayBuffer(8), trust: undefined });
  render(<CheckoutButton book={bookWithAudio} />);

  fireEvent.press(screen.getByRole("button", { name: "Export an EPUB 2 for maximum compatibility" }));

  await waitFor(() => expect(screen.getByText(/EPUB 2 \(max compatibility\) downloaded|Saved:/)).toBeTruthy());
  const postedBook = mockExport.mock.calls[0][0] as Book;
  const headings = postedBook.content!.t1.lesson.sections.map((s) => s.heading);
  expect(headings).not.toContain("Narration (transcript)");
});
```

- [ ] **Step 12: Run the test, verify it fails**

Run: `cd mobile && npx jest CheckoutButton`
Expected: FAIL — no "Export an EPUB 2 for maximum compatibility" button exists yet on `CheckoutButton`.

- [ ] **Step 13: Add `checkoutEpub2` + its button to `mobile/src/components/CheckoutButton.tsx`**

Find the `checkoutPack` function and the closing of its block (through `const working = state.kind === "working";`), currently:

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
      // "pack" — the Publish Pack's KDP-EPUB is EPUB-based, so narration audio belongs.
      const payload = await buildCompilePayload(book, "pack");
      const { artifact, trust } = await exportBook(payload, { format: "pack", diagrams: true });
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

  const working = state.kind === "working";
```

Replace with (adding `checkoutEpub2` between `checkoutPack` and `working`):

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
      // "pack" — the Publish Pack's KDP-EPUB is EPUB-based, so narration audio belongs.
      const payload = await buildCompilePayload(book, "pack");
      const { artifact, trust } = await exportBook(payload, { format: "pack", diagrams: true });
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

  // EPUB 2 (max compatibility) export (ADR-041 Initiative A,
  // docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md) — a
  // distinct action, not a checkbox, since it produces a DIFFERENT artifact
  // (strict EPUB 2.0.1: rasterized math/diagrams, no audio — narration
  // survives as transcript prose instead). Mirrors checkoutKdp exactly:
  // bypasses trackedExport's exportStatus tracking (keyed by format
  // "epub"/"pdf"/"docx" — a concurrent plain-EPUB export would collide with
  // this one under the same "epub" key).
  const checkoutEpub2 = async () => {
    setState({ kind: "working", fmt: "epub" });
    try {
      // "epub2" — buildCompilePayload emits transcript prose instead of
      // <audio> for this target (EPUB 2 can't carry <audio>).
      const payload = await buildCompilePayload(book, "epub2");
      const { artifact, trust } = await exportBook(payload, {
        format: "epub",
        diagrams: true,
        profile: "epub2",
      });
      const res = await downloadArtifact(
        artifact,
        `${slug(book.title)}-epub2.epub`,
        "application/epub+zip",
      );
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "EPUB 2 (max compatibility) downloaded.",
        trust,
      });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };

  const working = state.kind === "working";
```

Then find the button row (inside the returned JSX):

```tsx
        <Button
          variant="ghost"
          label="Publish pack"
          onPress={checkoutPack}
          disabled={working}
          accessibilityLabel="Download a publish pack for retailers"
          style={styles.btn}
        />
      </View>
```

Replace with:

```tsx
        <Button
          variant="ghost"
          label="Publish pack"
          onPress={checkoutPack}
          disabled={working}
          accessibilityLabel="Download a publish pack for retailers"
          style={styles.btn}
        />
        <Button
          variant="ghost"
          label="EPUB 2 (max compatibility)"
          onPress={checkoutEpub2}
          disabled={working}
          accessibilityLabel="Export an EPUB 2 for maximum compatibility"
          style={styles.btn}
        />
      </View>
```

- [ ] **Step 14: Run the test, verify it passes**

Run: `cd mobile && npx jest CheckoutButton`
Expected: PASS — the five new epub2 tests plus every pre-existing CheckoutButton test.

- [ ] **Step 15: Add the Help feature key**

In `mobile/src/help-content/features.ts`, replace line 27-28:

```ts
  { key: "kdp-export", label: "Export for Kindle (KDP)" },
  { key: "publish-pack", label: "Download a publish pack for retailers" },
```

with:

```ts
  { key: "kdp-export", label: "Export for Kindle (KDP)" },
  { key: "publish-pack", label: "Download a publish pack for retailers" },
  { key: "epub2-export", label: "EPUB 2 export (max compatibility)" },
```

- [ ] **Step 16: Add the Help topic**

In `mobile/src/help-content/topics.ts`, replace lines 416-435 (the full `publish-pack` topic block, keeping it and adding a new block after it):

```ts
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

with:

```ts
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
  {
    id: "epub2-export",
    title: "Export an EPUB 2 for maximum compatibility",
    featureKey: "epub2-export",
    keywords: ["epub2", "epub 2", "compatibility", "old reader", "export", "epubcheck"],
    blocks: [
      {
        kind: "text",
        text: "\"EPUB 2 (max compatibility)\" produces a separate EPUB tuned for older reading apps and devices that reject the modern EPUB3 files Mentible normally exports. Math and diagrams are rendered as images (same as the Kindle export), and narrated audio can't travel in EPUB 2 at all — instead, the narration's transcript is included as a plain \"Narration (transcript)\" section, so the words survive even though the clip can't. It's a different, more limited file from your regular EPUB3/PDF checkout, not a setting on it — reach for it only if a specific reader or device won't open the regular EPUB.",
      },
      {
        kind: "defs",
        defs: [
          { term: "Where's the button?", def: "On a Library book's Check out panel, next to EPUB3, PDF, Kindle (KDP), and Publish pack: \"EPUB 2 (max compatibility)\"." },
          { term: "What do I lose compared to the regular EPUB?", def: "Rich math/diagram rendering becomes static images, and narrated audio clips are dropped (their transcript replaces them as text). Everything else — chapters, figures, the table of contents — carries over." },
          { term: "Does it change what's published?", def: "No — it's a separate, read-only export for one compatibility need. Your regular EPUB3/PDF checkout is unaffected." },
        ],
      },
    ],
  },
```

- [ ] **Step 17: Add the `HELP_TREE` leaf**

In `mobile/src/help-content/tree.ts`, replace lines 59-69 (the `projects-publish` branch):

```ts
      {
        id: "projects-publish",
        title: "Publish",
        children: [
          { id: "leaf-project-publish", title: "Exporting & sharing validated work", topicId: "project-publish" },
          { id: "leaf-word-export", title: "Word (.docx) export", topicId: "word-export" },
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
          { id: "leaf-publish-pack", title: "Publish pack (for retailers)", topicId: "publish-pack" },
          { id: "leaf-project-rights", title: "Rights & attribution", topicId: "project-rights" },
        ],
      },
```

with:

```ts
      {
        id: "projects-publish",
        title: "Publish",
        children: [
          { id: "leaf-project-publish", title: "Exporting & sharing validated work", topicId: "project-publish" },
          { id: "leaf-word-export", title: "Word (.docx) export", topicId: "word-export" },
          { id: "leaf-kdp-export", title: "Kindle (KDP) export", topicId: "kdp-export" },
          { id: "leaf-publish-pack", title: "Publish pack (for retailers)", topicId: "publish-pack" },
          { id: "leaf-epub2-export", title: "EPUB 2 (max compatibility)", topicId: "epub2-export" },
          { id: "leaf-project-rights", title: "Rights & attribution", topicId: "project-rights" },
        ],
      },
```

- [ ] **Step 18: Run the Help gates**

Run: `cd mobile && npx jest --testPathPattern=help`
Expected: PASS — `coverage.test.ts` confirms `epub2-export` has a topic; `tree.test.ts` confirms the topic is reachable as a tree leaf.

- [ ] **Step 19: Run the full mobile suite for the touched area**

Run: `cd mobile && npx jest figuresHtml compilePayload CheckoutButton help`
Expected: PASS.

Run: `cd mobile && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 20: Commit**

```bash
git add mobile/src/lib/figuresHtml.ts mobile/__tests__/lib/figuresHtml.test.ts mobile/src/lib/compilePayload.ts mobile/__tests__/lib/compilePayload.test.ts mobile/src/api/client.ts mobile/src/components/CheckoutButton.tsx mobile/__tests__/components/CheckoutButton.test.tsx mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/src/help-content/tree.ts
git commit -m "feat(mobile): EPUB 2 (max compatibility) export, transcript fallback, Help"
```

---

## Post-implementation checklist

- [ ] Full compiler suite green: `cd compiler && npx jest && npx tsc --noEmit`
- [ ] Full export-slice backend suite green: `python -m pytest backend/tests -q -k "export"`, plus `ruff format` / `ruff check` clean on every touched `.py` file
- [ ] Full mobile suite green (at minimum the touched files) + `npx tsc --noEmit`
- [ ] `epub2Epubcheck.test.ts` confirmed passing on a Java-enabled machine/CI runner (it auto-skips without Java — a skip is not a pass; this is the real D6 gate and must be exercised at least once before calling the feature done)
- [ ] Manual smoke: compile a real book with `node compiler/dist/cli.js book.json -o out.epub --format epub --profile epub2 --mermaid`, unzip it, and eyeball `content.opf` (`version="2.0"`, no `properties=` anywhere, no `dcterms:modified`), confirm `OEBPS/nav.xhtml` is absent, and confirm a chapter's DOCTYPE is the XHTML 1.1 one — mirrors the KDP/pack/audio "real-render bar" discipline called out in the spec's Testing section, since mocked tests can't fully prove the packaged artifact.
