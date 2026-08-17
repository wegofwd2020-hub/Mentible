# KDP-Clean EPUB Export Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `profile: "kdp"` export mode to the EPUB compiler (and thread it through the backend + mobile export surfaces) that produces an EPUB3 which ingests cleanly on Amazon KDP and passes `epubcheck` validation — reading-system body typography, rasterized math/diagrams, a raster JPEG cover, and KDP-safe metadata — while the existing default profile stays byte-for-byte unchanged.

**Architecture:** A compile-time `profile` option (`"default" | "kdp"`, default `"default"`) threaded through the proven `--mermaid`/`diagrams` seam: `compiler/src/cli.ts` → `compileEpub(book, opts)` → `backend/src/export/compiler.py` subprocess argv → `POST /export` / `POST /export/jobs` → `mobile/src/api/client.ts`. Every KDP behavior change is gated on `profile === "kdp"` inside `compiler/src/epub.ts`; nothing else in the pipeline branches on it. Math and diagrams are rasterized to PNG via the existing single-headless-Chromium batch helper (`compiler/src/rasterize.ts`'s `rasterizeManyToPng`), mirroring the two-pass "collect sources → batch render → embed" pattern `compiler/src/mermaid.ts` already established for Mermaid diagrams. The cover gets a new JPEG raster path built on the same `rasterizeToPng`/`launchBrowser` primitives (widened to also support JPEG screenshots). A distinct "Export for Kindle (KDP)" mobile action (not a checkbox on the existing export) calls the same async export-job machinery with `profile=kdp`.

**Tech Stack:** TypeScript (compiler, Node 20, Jest + ts-jest), Python 3 / FastAPI (backend, `asyncpg`/`aioredis`/`httpx.AsyncClient` conventions), React Native + Expo (mobile), Puppeteer (headless Chromium, dynamically imported, never a committed `dependencies` entry), `epubcheck-assets` (bundles EPUBCheck 5.1.0's jar, verified real npm package), Java (via `actions/setup-java` in CI, needed only to run `epubcheck.jar`).

**Spec:** `docs/specs/kdp-clean-export-profile.md` (Accepted, 2026-08-17 amendment) — deltas D1–D6 + validation gate V. This plan implements D1 (profile plumbing), D2 (KDP stylesheet), D3 (math → raster), D4 (diagrams → raster), D5 (cover → raster JPEG), D6 (metadata completeness), and V (epubcheck CI gate + Kindle Previewer note).

## Global Constraints

- **Backend subprocess safety:** `create_subprocess_exec(*argv)` only — never `shell=True`. `--profile` is appended only from a value already validated against a fixed enum (`{"default", "kdp"}`) at the router layer — never a raw user string passed through. No `backend/__init__.py`. Run `ruff format` on every changed backend `.py` file before committing.
- **Compiler reuse, no second rasterizer:** every raster step (math, diagrams, cover) funnels through `compiler/src/rasterize.ts`'s existing `rasterizeManyToPng`/`rasterizeToPng`/(new) `rasterizeToJpeg` — one Puppeteer integration, one browser launch per book. Do not add a second headless-Chromium code path.
- **Default output MUST be byte-unchanged.** Every KDP behavior is gated on `profile === "kdp"`; a compile with no `profile` option (or `profile: "default"`) must produce output identical to before this plan, verified by tests in Task 2.
- **Non-goal:** no auto-submission / retailer API integration (KDP/Apple/IngramSpark/Draft2Digital expose no public book-ingest API — this profile produces a validation-clean artifact the author uploads themselves).
- **Mobile Help DoD:** the new "Export for Kindle (KDP)" action is a new user-facing feature — its `FEATURES` key and Help topic (`mobile/src/help-content/features.ts` + `topics.ts`) ship in the same task as the button, or the coverage gate (`mobile/__tests__/help/coverage.test.ts`) fails CI.
- **eBook only:** the `kdp` profile applies to `format=epub` only. PDF/DOCX paths are untouched; the backend rejects `profile=kdp` combined with a non-epub format with a 422.

---

## Task 1: `rasterize.ts` — widen `screenshot()` to accept JPEG

**Files:**
- Modify: `compiler/src/rasterize.ts:7-22` (the `PuppeteerPage`/`PuppeteerEl` interfaces), and add a new exported function after `rasterizeToPng` (currently ends at line 80)
- Test: `compiler/__tests__/rasterize.test.ts`

**Interfaces:**
- Consumes: nothing new (internal to `rasterize.ts`; reuses the existing `launchBrowser()`, `shellHtml()`)
- Produces: `export async function rasterizeToJpeg(input: { html?: string; svg?: string; width?: number; quality?: number }): Promise<Buffer>` — used by Task 6 (`coverRaster.ts`'s `renderCoverJpeg`)

- [ ] **Step 1: Write the failing test**

Add to `compiler/__tests__/rasterize.test.ts` (which currently only has the PNG "not installed" test):

```ts
import { rasterizeToPng, rasterizeToJpeg } from "../src/rasterize";

it("throws a clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToPng({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});

it("rasterizeToJpeg throws the same clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToJpeg({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});
```

Note: puppeteer is deliberately not a `compiler/package.json` dependency (it's installed only in the deploy image — see `backend/Dockerfile`'s `npm install --no-save puppeteer@25.3.0`), and the `compiler-test` CI job never installs it either. So — matching the existing PNG test exactly — this is the correct, CI-safe assertion for `rasterizeToJpeg`'s error contract. Real JPEG-byte-level verification of the *wiring* (that a real image gets produced with the right magic bytes) happens in Task 6 via a mocked `rasterize` module, which controls the exact bytes returned and can assert on them directly without needing real Chromium.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd compiler && npx jest rasterize.test.ts`
Expected: FAIL — `rasterizeToJpeg` is not exported from `../src/rasterize`.

- [ ] **Step 3: Write the implementation**

In `compiler/src/rasterize.ts`, replace the two interfaces at lines 7-22:

```ts
type ScreenshotOpts = { type: "png"; omitBackground?: boolean } | { type: "jpeg"; quality?: number };

interface PuppeteerPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  $(sel: string): Promise<PuppeteerEl | null>;
  screenshot(opts: ScreenshotOpts): Promise<Uint8Array>;
  evaluate<T>(fn: string | ((...a: unknown[]) => T), ...args: unknown[]): Promise<T>;
  emulateMediaFeatures?(features: { name: string; value: string }[]): Promise<void>;
  close(): Promise<void>;
}
interface PuppeteerEl {
  screenshot(opts: ScreenshotOpts): Promise<Uint8Array>;
}
```

Then, immediately after the existing `rasterizeToPng` function (after its closing `}` — currently line 80), add:

```ts
async function shotJpeg(page: PuppeteerPage, svg: string, width: number, quality: number): Promise<Buffer> {
  await page.setViewport({ width, height: 2000, deviceScaleFactor: 2 });
  await page.setContent(shellHtml(svg, width));
  const el = await page.$("#target");
  const buf = el ? await el.screenshot({ type: "jpeg", quality }) : await page.screenshot({ type: "jpeg", quality });
  return Buffer.from(buf);
}

// Render `input.html`/`input.svg` to a JPEG Buffer at `width` px. JPEG has no
// alpha channel (unlike rasterizeToPng's omitBackground option), so callers
// that need a transparent background must use rasterizeToPng instead. Used by
// the kdp cover profile (D5, docs/specs/kdp-clean-export-profile.md) — KDP
// wants a raster JPEG cover-image, not the app's vector SVG. Throws if
// puppeteer is unavailable (same contract as rasterizeToPng).
export async function rasterizeToJpeg(input: {
  html?: string;
  svg?: string;
  width?: number;
  quality?: number;
}): Promise<Buffer> {
  const width = input.width ?? 420;
  const quality = input.quality ?? 90;
  const inner = input.html ?? input.svg ?? "";

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    return await shotJpeg(page, inner, width, quality);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd compiler && npx jest rasterize.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Typecheck**

Run: `cd compiler && npm run typecheck`
Expected: no errors (the widened `ScreenshotOpts` union is a superset of the old `{type:"png",...}` shape, so `rasterizeToPng`'s existing calls to `.screenshot({type:"png",...})` still typecheck).

- [ ] **Step 6: Commit**

```bash
git add compiler/src/rasterize.ts compiler/__tests__/rasterize.test.ts
git commit -m "feat(compiler): add rasterizeToJpeg alongside rasterizeToPng"
```

---

## Task 2: D1 — profile plumbing in the compiler (`CompileOptions` + `--profile`)

**Files:**
- Modify: `compiler/src/epub.ts:41-47` (`CompileOptions`)
- Modify: `compiler/src/cli.ts` (arg parsing + export `parseArgs` for testability)
- Test: `compiler/__tests__/cli.test.ts` (new), `compiler/__tests__/epub.test.ts` (add one assertion)

**Interfaces:**
- Consumes: nothing new
- Produces: `CompileOptions.profile?: "default" | "kdp"` (consumed by Tasks 3–6 inside `compileEpub`); `parseArgs(argv: string[]): { input?: string; output?: string; mermaid: boolean; format: Format; profile: "default" | "kdp" }` (compiler-internal, exported only for the test)

- [ ] **Step 1: Write the failing tests**

Create `compiler/__tests__/cli.test.ts`:

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

Add to `compiler/__tests__/epub.test.ts` (inside the existing `describe("compileEpub — structure & well-formedness (M2/M3)"` block, alongside the other `it`s):

```ts
  it("profile 'default' (explicit) compiles to the exact same bytes as omitting profile", async () => {
    const withoutOpt = await compileEpub(syntheticBook());
    const withDefault = await compileEpub(syntheticBook(), { profile: "default" });
    expect(Buffer.from(withDefault)).toEqual(Buffer.from(withoutOpt));
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npx jest cli.test.ts epub.test.ts`
Expected: `cli.test.ts` fails to import (`parseArgs` isn't exported yet, and `cli.ts` currently runs `main()` at module load, which would hang on stdin). The new `epub.test.ts` assertion passes trivially today (harmless — it becomes a real regression guard once Tasks 3–6 land) but the suite still fails on the `cli.test.ts` import error.

- [ ] **Step 3: Implement — `cli.ts`**

Replace the `parseArgs` function signature and body (currently lines 30-64 of `compiler/src/cli.ts`):

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
                    : "epub";
    } else if (a === "--pdf") format = "pdf";
    else if (a === "-o") output = argv[++i];
    else if (!input) input = a;
  }
  return { input, output, mermaid, format, profile };
}
```

Update `main()`'s destructure and the epub-compile branch (currently `async function main(): Promise<void> { const { input, output, mermaid, format } = parseArgs(...)` and, further down, `: await compileEpub(book, mermaidOpt);`):

```ts
async function main(): Promise<void> {
  const { input, output, mermaid, format, profile } = parseArgs(process.argv.slice(2));
```

```ts
  const mermaidOpt = mermaid ? { mermaid: new PuppeteerMermaidRenderer() } : {};
  const out =
    format === "pdf"
      ? await compilePdf(book, mermaidOpt)
      : format === "cover"
        ? await renderCoverPng(buildCoverSvgFile(coverInputForBook(book)))
        : format === "docx"
          ? await compileDocx(book)
          : await compileEpub(book, { ...mermaidOpt, profile });
```

Finally, replace the bottom-of-file unconditional `main().catch(...)` call with a `require.main` guard so the module can be safely `import`ed by the test without running `main()` (which would otherwise try to read stdin):

```ts
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Implement — `epub.ts` `CompileOptions`**

In `compiler/src/epub.ts`, replace the interface at lines 41-47:

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd compiler && npx jest cli.test.ts epub.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck + full suite**

Run: `cd compiler && npm run typecheck && npm test`
Expected: no errors, all existing tests still pass (the `require.main` guard doesn't change `main()`'s behavior when the file is run as a script).

- [ ] **Step 7: Commit**

```bash
git add compiler/src/epub.ts compiler/src/cli.ts compiler/__tests__/cli.test.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): add profile plumbing (CompileOptions.profile, --profile)"
```

---

## Task 3: D2 — KDP body stylesheet

**Files:**
- Modify: `compiler/src/css.ts` (add `KDP_STYLESHEET` export; `STYLESHEET` itself is untouched — byte-unchanged constraint)
- Modify: `compiler/src/epub.ts:210` (select the stylesheet by profile)
- Test: `compiler/__tests__/css.test.ts`

**Interfaces:**
- Consumes: `CompileOptions.profile` (Task 2)
- Produces: `export const KDP_STYLESHEET: string` (consumed only inside `epub.ts`'s `compileEpub`)

- [ ] **Step 1: Write the failing test**

Add to `compiler/__tests__/css.test.ts`:

```ts
import { STYLESHEET, KDP_STYLESHEET } from "../src/css";

describe("KDP_STYLESHEET (D2, docs/specs/kdp-clean-export-profile.md)", () => {
  it("drops the embedded @font-face rules", () => {
    expect(STYLESHEET).toContain("@font-face"); // sanity: the default DOES embed fonts
    expect(KDP_STYLESHEET).not.toContain("@font-face");
  });

  it("drops font-family and line-height on the bare body selector", () => {
    const bodyRule = KDP_STYLESHEET.match(/(?<!\.diagram|\.floatlist)\bbody\s*\{[^}]*\}/);
    expect(bodyRule).not.toBeNull();
    expect(bodyRule![0]).not.toMatch(/font-family/);
    expect(bodyRule![0]).not.toMatch(/line-height/);
    // still keeps the non-typography body rules
    expect(bodyRule![0]).toContain("background: #faf8f3");
    expect(bodyRule![0]).toContain("counter-reset: figure table");
  });

  it("keeps heading, table, figure and quiz styles", () => {
    expect(KDP_STYLESHEET).toContain("Playfair Display"); // h1..h6 still declare it (falls back if not embedded)
    expect(KDP_STYLESHEET).toMatch(/table\s*\{/);
    expect(KDP_STYLESHEET).toMatch(/\.diagram\s*\{/);
    expect(KDP_STYLESHEET).toMatch(/\.quiz-q\s*\{/);
  });

  it("styles rasterized math images distinctly from block diagram/cover images", () => {
    expect(KDP_STYLESHEET).toMatch(/img\.math-inline\s*\{[^}]*display:\s*inline-block/);
    expect(KDP_STYLESHEET).toMatch(/img\.math-block\s*\{[^}]*display:\s*block/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd compiler && npx jest css.test.ts`
Expected: FAIL — `KDP_STYLESHEET` is not exported from `../src/css`.

- [ ] **Step 3: Implement**

In `compiler/src/css.ts`, add the new export after the existing `STYLESHEET` const (after its closing `` ` ``  and `;`, i.e. after line 134):

```ts
// KDP profile (D2, docs/specs/kdp-clean-export-profile.md): the reflowable
// body reading system controls body typography (no embedded font, no forced
// line-height) — KDP disallows forcing the body font. Deliberately a SEPARATE
// literal (not derived from STYLESHEET) so the default export's bytes can
// never drift from a KDP-only edit: every rule below except the two dropped
// @font-face injections and the body font-family/line-height is identical to
// STYLESHEET, including every non-body selector (headings/tables/figures/quiz
// are allowed and encouraged to keep their styling per D2).
export const KDP_STYLESHEET = `
  * { box-sizing: border-box; }
  body {
    color: #1a1a1a;
    background: #faf8f3; /* warm ivory ground (Anthropic-leaning, calmer than pure white) */
    margin: 0;
    padding: 1em;
    counter-reset: figure table;
  }
  /* Only 400 + 500 weights are embedded (playfairFont.ts) — font-synthesis:none
     stops readers from faux-bolding Playfair against the UA's default bold,
     which reads as ugly, distorted type (the P3 lesson). Not embedded for kdp
     (no @font-face above), so this is a graceful-fallback declaration: readers
     that happen to carry Playfair use it, everyone else falls through to the
     listed serif fallbacks. */
  h1, h2, h3, h4, h5, h6 { font-family: ${DISPLAY}; font-weight: 500; font-synthesis: none; }
  h1 { font-size: 1.6em; margin: 0 0 0.3em; }
  h2 { font-size: 1.3em; margin: 1.2em 0 0.4em; }
  h3 { font-size: 1.1em; margin: 1em 0 0.3em; color: ${STUDIO.ink}; }
  h4 { font-size: 1em; margin: 0.8em 0 0.2em; }
  p { margin: 0.6em 0; }
  ul, ol { padding-left: 1.4em; margin: 0.5em 0; }
  li { margin: 0.25em 0; }
  a { color: ${STUDIO.gold}; }
  code {
    font-family: "Courier New", monospace;
    font-size: 0.9em;
    background: #f2f2f2;
    padding: 0.1em 0.3em;
    border-radius: 3px;
  }
  pre {
    background: #f6f6f6;
    border: 1px solid #ddd;
    border-radius: 6px;
    padding: 0.8em;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 3px solid ${STUDIO.gold};
    padding: 0.4em 0.9em;
    margin: 0.8em 0;
    color: #444;
    font-style: italic;
  }
  table { width: 100%; border-collapse: collapse; margin: 0.8em 0; font-size: 0.95em; counter-increment: table; }
  th { background: ${STUDIO.gold}; color: #fff; font-weight: 700; font-family: ${SANS}; padding: 0.5em 0.8em; border: 1px solid ${STUDIO.gold}; text-align: left; }
  td { padding: 0.45em 0.8em; border: 1px solid #e6e0d4; }
  tbody tr:nth-child(even) td { background: #f4f1ea; }
  caption { caption-side: top; text-align: left; font-family: ${SANS}; font-size: 0.85em; color: #666; margin-bottom: 0.3em; }
  hr.section-divider { border: none; border-top: 1px solid #ddd; margin: 1.4em 0; }
  .synopsis {
    color: #444; padding: 0.8em; margin: 0.8em 0 1.2em;
    background: #f6f8fa; border-left: 3px solid ${STUDIO.gold}; border-radius: 4px;
  }
  .objectives, .takeaways, .further, .mistakes, .examples, .materials, .safety {
    background: #f6f8fa; border-radius: 4px; padding: 0.8em 1em; margin: 1em 0;
  }
  .objectives { border-left: 3px solid ${STUDIO.gold}; }
  .further    { border-left: 3px solid ${BRAND.green}; }
  .mistakes   { border-left: 3px solid #ef6c00; }
  .safety     { border-left: 3px solid #ef6c00; }
  /* Key Takeaways: Studio navy callout panel (matches the PDF). */
  .takeaways {
    background: ${STUDIO.navy}; color: #eceaf6; border: none;
    border-radius: 8px; padding: 0.9em 1.1em; margin: 1em 0;
  }
  .takeaways h3 { color: ${STUDIO.goldBright}; text-transform: uppercase; letter-spacing: 0.08em; font-size: 0.82em; margin: 0 0 0.45em; }
  .takeaways strong { color: #fff; }
  .takeaways a { color: #9fd8ff; }
  .practice {
    background: #fff8e1; border-left: 3px solid #ef6c00;
    padding: 0.5em 0.8em; border-radius: 4px; margin: 0.7em 0;
  }
  .quiz-q {
    background: #fafafa; border: 1px solid #e0e0e0;
    border-radius: 6px; padding: 0.8em 1em; margin: 0.8em 0;
  }
  .quiz-qtext, .quiz-qtext p { font-family: ${SANS}; font-weight: 600; }
  .quiz-options { list-style: none; padding-left: 0; margin: 0.5em 0; }
  .quiz-options li { padding: 0.2em 0; font-family: ${SERIF}; font-size: 0.9em; }
  .quiz-options li.correct { color: #2e7d32; font-weight: 600; }
  .quiz-answer { margin-top: 0.5em; color: #2e7d32; font-size: 0.92em; }
  .quiz-expl { color: #444; font-size: 0.92em; }
  .difficulty { margin-top: 0.4em; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.04em; color: #888; }
  .step .obs { color: #555; font-style: italic; font-size: 0.95em; }
  .diagram {
    margin: 1.4em 0; counter-increment: figure; text-align: center;
    background: ${STUDIO.panel}; border: 1px solid ${STUDIO.goldSoft};
    border-radius: 10px; padding: 1.1em 1em 0.8em; break-inside: avoid;
  }
  .diagram svg { max-width: 100%; height: auto; }
  .diagram img { max-width: 100%; height: auto; }
  .diagram--placeholder { background: #f6f6f6; border-color: #e3e3e3; }
  .diagram--placeholder pre { white-space: pre-wrap; text-align: left; }
  .diagram figcaption { font-family: ${SANS}; font-size: 0.85em; color: ${STUDIO.gold}; margin-top: 0.5em; }
  .fnum { font-weight: 700; color: ${STUDIO.gold}; }
  .floatlist ol { list-style: none; padding-left: 0; }
  .floatlist li { margin: 0.4em 0; }
  .floatlist a { text-decoration: none; color: #1a1a1a; }
  .floatlist .fnum { display: inline-block; min-width: 5em; }
  .glossary dt { font-family: ${SANS}; font-weight: 700; color: ${STUDIO.navy}; margin-top: 0.7em; }
  .glossary dd { margin: 0.1em 0 0.5em; color: #333; }
  .colophon .draft-notice { color: #b91c1c; font-weight: 700; }
  .colophon .edition { color: ${BRAND.green}; font-weight: 700; }
  .colophon .revisions ul { padding-left: 1.2em; font-size: 0.9em; color: #555; }
  /* Rasterized math (D3): inline equations stay inline with surrounding text;
     block/display equations center on their own line like the default's MathML. */
  img.math-inline { display: inline-block; max-width: 100%; height: auto; vertical-align: middle; margin: 0 0.12em; }
  img.math-block { display: block; max-width: 100%; height: auto; margin: 0.9em auto; }
  img { max-width: 100%; height: auto; display: block; margin: 0.9em auto; }
`;
```

- [ ] **Step 4: Select the stylesheet in `epub.ts`**

In `compiler/src/epub.ts`, add the import (alongside the existing `import { STYLESHEET } from "./css";` at line 10):

```ts
import { STYLESHEET, KDP_STYLESHEET } from "./css";
```

At the very top of `compileEpub` (currently line 122, `export async function compileEpub(book: Book, opts: CompileOptions = {}): Promise<Uint8Array> {`), add the first line of the function body:

```ts
export async function compileEpub(book: Book, opts: CompileOptions = {}): Promise<Uint8Array> {
  const profile = opts.profile ?? "default";
```

Then replace the stylesheet write (currently line 210):

```ts
  zip.file("OEBPS/css/style.css", profile === "kdp" ? KDP_STYLESHEET : STYLESHEET);
```

- [ ] **Step 5: Write + run an epub.ts-level integration test**

Add to `compiler/__tests__/epub.test.ts`:

```ts
  it("profile 'kdp' writes KDP_STYLESHEET instead of STYLESHEET", async () => {
    const zip = await unzip(await compileEpub(syntheticBook(), { profile: "kdp" }));
    const css = await zip.file("OEBPS/css/style.css")!.async("string");
    expect(css).not.toContain("@font-face");
    expect(css).toMatch(/table\s*\{/); // headings/tables kept
  });
```

Run: `cd compiler && npx jest css.test.ts epub.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck**

Run: `cd compiler && npm run typecheck`

- [ ] **Step 7: Commit**

```bash
git add compiler/src/css.ts compiler/src/epub.ts compiler/__tests__/css.test.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): add KDP_STYLESHEET, select by profile (D2)"
```

---

## Task 4: D3 — math → raster

**Files:**
- Create: `compiler/src/mathRaster.ts`
- Modify: `compiler/src/epub.ts` (wire the math-raster pass into `compileEpub`'s per-topic loop)
- Test: `compiler/__tests__/mathRaster.test.ts` (new)

**Interfaces:**
- Consumes: `compiler/src/renderCore.ts`'s `renderTopicBody(topic, diagrams): string` (unchanged), `compiler/src/diagrams.ts`'s `PassthroughDiagramRenderer` (unchanged), `compiler/src/rasterize.ts`'s `rasterizeManyToPng(svgs: string[], width: number, omitBackground?: boolean): Promise<Buffer[]>` (unchanged)
- Produces: `collectMathHtml(book: Book): string[]`, `rasterizeMath(mathmlList: readonly string[]): Promise<Map<string, string>>`, `replaceMathWithImages(bodyHtml: string, pngByMathml: Map<string, string>): string` — all consumed by `epub.ts`'s `compileEpub`

**Key fact this task relies on (verified against the installed `katex` package):** `markdown.ts`'s `renderMarkdown` renders math via `marked-katex-extension` with `output: "mathml"`, which wraps every equation as `<span class="katex"><math ...>...<annotation encoding="application/x-tex">LATEX</annotation>...</math></span>` — KaTeX's MathML output embeds the original LaTeX source itself (already XML/HTML-attribute-escaped by KaTeX), so no separate LaTeX-capture plumbing through `renderCore.ts`/`markdown.ts` is needed; `mathRaster.ts` extracts it straight from the rendered HTML.

- [ ] **Step 1: Write the failing test**

Create `compiler/__tests__/mathRaster.test.ts`:

```ts
import {
  collectMathHtml,
  rasterizeMath,
  replaceMathWithImages,
} from "../src/mathRaster";
import type { Book, LessonOutput } from "../src/types";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[]) => svgs.map((_, i) => Buffer.from(`png-${i}`))),
}));

const KATEX_INLINE =
  '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>v</mi></mrow>' +
  '<annotation encoding="application/x-tex">v=d/t</annotation></semantics></math></span>';
const KATEX_BLOCK =
  '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>E</mi></mrow>' +
  '<annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span>';

function lessonWithMath(...bodies: string[]): LessonOutput {
  return {
    topic: "Math",
    level: "intro",
    language: "en",
    synopsis: "Has math.",
    learning_objectives: ["See math"],
    sections: bodies.map((b, i) => ({ heading: `S${i}`, body_markdown: b })),
    key_takeaways: ["Math helps"],
    further_reading: [],
  };
}
function bookWithLesson(lesson: LessonOutput): Book {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Math Book",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    content: { u1: { topicId: "u1", title: "T", lesson, generatedAt: "2026-08-17T00:00:00.000Z" } },
  };
}

describe("collectMathHtml", () => {
  it("extracts every rendered KaTeX MathML span, in order", () => {
    const html = `<p>before</p>${KATEX_INLINE}<p>mid</p>${KATEX_BLOCK}`;
    const lesson = lessonWithMath(html);
    const found = collectMathHtml(bookWithLesson(lesson));
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("v=d/t");
    expect(found[1]).toContain("E=mc^2");
  });
});

describe("rasterizeMath", () => {
  it("batches unique MathML fragments and returns a data-URI PNG per fragment", async () => {
    const map = await rasterizeMath([KATEX_INLINE, KATEX_INLINE, KATEX_BLOCK]);
    expect(map.size).toBe(2); // deduped
    expect(map.get(KATEX_INLINE)).toMatch(/^data:image\/png;base64,/);
  });

  it("returns an empty map without rasterizing when there is no math", async () => {
    const { rasterizeManyToPng } = require("../src/rasterize");
    (rasterizeManyToPng as jest.Mock).mockClear();
    const map = await rasterizeMath([]);
    expect(map.size).toBe(0);
    expect(rasterizeManyToPng).not.toHaveBeenCalled();
  });
});

describe("replaceMathWithImages", () => {
  it("replaces a matched fragment with an <img> carrying the LaTeX as alt, tagged inline vs block", () => {
    const pngByMathml = new Map([
      [KATEX_INLINE, "data:image/png;base64,AAA="],
      [KATEX_BLOCK, "data:image/png;base64,BBB="],
    ]);
    const out = replaceMathWithImages(`<p>${KATEX_INLINE}</p><p>${KATEX_BLOCK}</p>`, pngByMathml);
    expect(out).toContain('<img class="math math-inline" alt="v=d/t" src="data:image/png;base64,AAA="/>');
    expect(out).toContain('<img class="math math-block" alt="E=mc^2" src="data:image/png;base64,BBB="/>');
    expect(out).not.toContain("<math");
  });

  it("leaves a fragment unchanged (never breaks the compile) on a raster miss", () => {
    const out = replaceMathWithImages(`<p>${KATEX_INLINE}</p>`, new Map());
    expect(out).toContain("<math");
    expect(out).not.toContain("<img");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd compiler && npx jest mathRaster.test.ts`
Expected: FAIL — `../src/mathRaster` doesn't exist.

- [ ] **Step 3: Implement `compiler/src/mathRaster.ts`**

```ts
// Rasterize rendered KaTeX MathML to PNG for the kdp export profile (D3,
// docs/specs/kdp-clean-export-profile.md) — Kindle's MathML support is
// partial/inconsistent, so equations are replaced with an <img class="math">
// whose alt text is the original LaTeX (accessibility: a textual alternative
// replaces the MathML semantics for this profile — see epub.ts's
// accessibilityMeta() call).
//
// markdown.ts's renderMarkdown renders math via marked-katex-extension with
// output:"mathml", which emits:
//   <span class="katex"><math ...>...<annotation encoding="application/x-tex">
//     LATEX</annotation></math></span>
// KaTeX embeds the original LaTeX source itself (already XML/HTML-attribute-
// escaped), so this module reads it straight out of the rendered HTML — no
// separate LaTeX-capture plumbing through renderCore.ts/markdown.ts needed.
//
// Mirrors mermaid.ts's two-pass pattern (collectMermaidSources → batch render
// → embed): collect every unique fragment book-wide, rasterize once in one
// browser (rasterize.ts), then substitute per chapter.

import { renderTopicBody } from "./renderCore";
import { PassthroughDiagramRenderer } from "./diagrams";
import { rasterizeManyToPng } from "./rasterize";
import type { Book, GeneratedTopic } from "./types";

const KATEX_SPAN = /<span class="katex">(<math[^]*?<\/math>)<\/span>/g;
const ANNOTATION = /<annotation encoding="application\/x-tex">([^]*?)<\/annotation>/;

function latexOf(mathml: string): string {
  return ANNOTATION.exec(mathml)?.[1] ?? "";
}

// Pull every rendered KaTeX MathML span out of a body-HTML string, in order.
export function extractMathHtml(bodyHtml: string): string[] {
  return [...bodyHtml.matchAll(KATEX_SPAN)].map((m) => m[1]);
}

// Collect every MathML fragment across all content-bearing topics, in reading
// order — a throwaway render pass (output discarded) with a passthrough
// diagram renderer, walking the same topic tree compileEpub walks for real.
export function collectMathHtml(book: Book): string[] {
  const content = book.content ?? {};
  const diagrams = new PassthroughDiagramRenderer();
  const out: string[] = [];
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const topic: GeneratedTopic | undefined = unit.id ? content[unit.id] : undefined;
      if (topic) out.push(...extractMathHtml(renderTopicBody(topic, diagrams)));
    }
  }
  return out;
}

// Rasterize every unique MathML fragment to a PNG data URI in one batch (one
// headless-Chromium browser — rasterize.ts). Keyed by the exact MathML string
// so replaceMathWithImages can look each one up per chapter. Returns an empty
// map (no browser launch) when there is nothing to rasterize.
export async function rasterizeMath(mathmlList: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(mathmlList)];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const pngs = await rasterizeManyToPng(unique, 500, true);
  unique.forEach((m, i) => out.set(m, `data:image/png;base64,${pngs[i].toString("base64")}`));
  return out;
}

// Replace every KaTeX MathML span in a chapter's body HTML with a rasterized
// <img class="math math-inline|math-block" alt="<LaTeX>">, using the batch
// built by rasterizeMath. A fragment with no matching PNG (a raster failure)
// is left as MathML — a single bad equation never breaks the compile.
export function replaceMathWithImages(bodyHtml: string, pngByMathml: Map<string, string>): string {
  return bodyHtml.replace(KATEX_SPAN, (full, mathml: string) => {
    const src = pngByMathml.get(mathml);
    if (!src) return full;
    const block = /<math[^>]*\bdisplay="block"/.test(mathml);
    const cls = block ? "math math-block" : "math math-inline";
    return `<img class="${cls}" alt="${latexOf(mathml)}" src="${src}"/>`;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd compiler && npx jest mathRaster.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `epub.ts`**

Add the import (alongside the other `./`-relative imports near the top of `compiler/src/epub.ts`):

```ts
import { collectMathHtml, rasterizeMath, replaceMathWithImages } from "./mathRaster";
```

Immediately after the diagram-selection block (currently lines 125-128: `let diagrams = opts.diagrams ?? new PassthroughDiagramRenderer(); if (opts.mermaid) { ... }`), add the math-raster pass (runs once, book-wide, before the per-topic loop):

```ts
  const mathPngs = profile === "kdp" ? await rasterizeMath(collectMathHtml(book)) : new Map<string, string>();
```

In the per-topic loop, replace the body-construction lines (currently):

```ts
      const tableCaps = (topic.lesson as { table_captions?: string[] }).table_captions ?? [];
      const body = numberFloats(renderTopicBody(topic, diagrams), n, cf, ct, tableCaps);
      const xhtml = packImages(
```

with:

```ts
      const tableCaps = (topic.lesson as { table_captions?: string[] }).table_captions ?? [];
      let body = numberFloats(renderTopicBody(topic, diagrams), n, cf, ct, tableCaps);
      if (profile === "kdp") body = replaceMathWithImages(body, mathPngs);
      const xhtml = packImages(
```

(`packImages`, already unconditional, hoists the `data:image/png;base64,...` srcs the substitution just introduced into `OEBPS/images/` — no packaging changes needed, per the spec's "packaging is free" note.)

- [ ] **Step 6: Write + run an epub.ts-level integration test (mocked rasterize, no real Chromium)**

Add to `compiler/__tests__/epub.test.ts`, near the top (after the existing imports), a mock and a math-bearing fixture:

```ts
jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[], _w: number, _omit?: boolean) =>
    svgs.map((_, i) => Buffer.from(`fake-png-${i}`)),
  ),
  rasterizeToPng: jest.fn(async () => Buffer.from("fake-png-cover")),
  rasterizeToJpeg: jest.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0x00])), // real JPEG magic number
}));
```

and, inside `describe("compileEpub — structure & well-formedness (M2/M3)"`:

```ts
  it("profile 'kdp' rasterizes math to <img>, dropping <math> from the chapter", async () => {
    const book = syntheticBook(); // LESSON's Velocity section has $v=\frac{\Delta x}{\Delta t}$
    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).not.toContain("<math");
    expect(chapter).toMatch(/<img class="math math-(inline|block)" alt="[^"]*"/);
  });
```

Run: `cd compiler && npx jest epub.test.ts`
Expected: PASS. (This mock also stands in for Task 6's cover-JPEG call, which will otherwise be exercised unconditionally once Task 6 lands — the mock is written now so Task 6 doesn't need to touch this file's mock setup again.)

- [ ] **Step 7: Typecheck**

Run: `cd compiler && npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add compiler/src/mathRaster.ts compiler/src/epub.ts compiler/__tests__/mathRaster.test.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): rasterize KaTeX MathML to <img> for the kdp profile (D3)"
```

---

## Task 5: D4 — diagrams → raster

**Files:**
- Create: `compiler/src/diagramRaster.ts`
- Modify: `compiler/src/epub.ts` (select `PrerenderedRasterDiagramRenderer` when `profile === "kdp"`)
- Test: `compiler/__tests__/diagramRaster.test.ts` (new)

**Interfaces:**
- Consumes: `compiler/src/diagrams.ts`'s `DiagramRenderer` interface and `PassthroughDiagramRenderer` (unchanged), `compiler/src/rasterize.ts`'s `rasterizeManyToPng` (unchanged), `compiler/src/mermaid.ts`'s `prerenderDiagrams(book, renderer): Promise<Map<string,string>>` (unchanged — already produces the `svgBySource` map this task rasterizes)
- Produces: `rasterizeDiagramPngs(svgBySource: Map<string, string>): Promise<Map<string, string>>`, `class PrerenderedRasterDiagramRenderer implements DiagramRenderer` — both consumed by `epub.ts`'s `compileEpub`

- [ ] **Step 1: Write the failing test**

Create `compiler/__tests__/diagramRaster.test.ts`:

```ts
import { rasterizeDiagramPngs, PrerenderedRasterDiagramRenderer } from "../src/diagramRaster";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[]) => svgs.map((_, i) => Buffer.from(`png-${i}`))),
}));

describe("rasterizeDiagramPngs", () => {
  it("batches every SVG and keys the result by the ORIGINAL mermaid source", async () => {
    const svgBySource = new Map([
      ["graph TD; A-->B;", "<svg>A</svg>"],
      ["sequenceDiagram; X->>Y: hi;", "<svg>B</svg>"],
    ]);
    const map = await rasterizeDiagramPngs(svgBySource);
    expect(map.size).toBe(2);
    expect(map.get("graph TD; A-->B;")).toMatch(/^data:image\/png;base64,/);
  });

  it("returns an empty map without rasterizing when there are no diagrams", async () => {
    const { rasterizeManyToPng } = require("../src/rasterize");
    (rasterizeManyToPng as jest.Mock).mockClear();
    const map = await rasterizeDiagramPngs(new Map());
    expect(map.size).toBe(0);
    expect(rasterizeManyToPng).not.toHaveBeenCalled();
  });
});

describe("PrerenderedRasterDiagramRenderer", () => {
  it("emits an <img>-based figure for a rasterized source", () => {
    const renderer = new PrerenderedRasterDiagramRenderer(new Map([["src", "data:image/png;base64,AA=="]]));
    const html = renderer.render("src");
    expect(html).toContain('<figure class="diagram">');
    expect(html).toContain('<img src="data:image/png;base64,AA=="');
    expect(html).not.toContain("<svg");
  });

  it("falls back to the text placeholder for a raster miss", () => {
    const renderer = new PrerenderedRasterDiagramRenderer(new Map());
    expect(renderer.render("missing")).toContain("diagram--placeholder");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd compiler && npx jest diagramRaster.test.ts`
Expected: FAIL — `../src/diagramRaster` doesn't exist.

- [ ] **Step 3: Implement `compiler/src/diagramRaster.ts`**

```ts
// KDP profile diagram rendering (D4, docs/specs/kdp-clean-export-profile.md):
// Kindle's SVG support is limited/no-scripting, so a pre-rendered Mermaid SVG
// (mermaid.ts's prerenderDiagrams) is rasterized to PNG instead of inlined.
// Reuses the same one-browser batch helper as mathRaster.ts/coverRaster.ts —
// no second Puppeteer integration.

import { rasterizeManyToPng } from "./rasterize";
import { PassthroughDiagramRenderer, type DiagramRenderer } from "./diagrams";

// Batch-rasterize every pre-rendered Mermaid SVG to a PNG data URI in one
// browser pass. Keyed by the ORIGINAL Mermaid source, matching the SVG map it
// consumes (mermaid.ts's prerenderDiagrams output).
export async function rasterizeDiagramPngs(svgBySource: Map<string, string>): Promise<Map<string, string>> {
  const sources = [...svgBySource.keys()];
  const out = new Map<string, string>();
  if (sources.length === 0) return out;
  const svgs = sources.map((s) => svgBySource.get(s)!);
  const pngs = await rasterizeManyToPng(svgs, 800, true);
  sources.forEach((s, i) => out.set(s, `data:image/png;base64,${pngs[i].toString("base64")}`));
  return out;
}

function imgFigure(dataUri: string): string {
  return `<figure class="diagram"><img src="${dataUri}" alt="Diagram"/><figcaption></figcaption></figure>`;
}

// KDP variant of diagrams.ts's PrerenderedDiagramRenderer: emits a raster
// <img> instead of an inline <svg>. Falls back to the shared text placeholder
// on a raster miss (e.g. a diagram that failed to render), same as the SVG
// renderer — a single bad diagram never breaks the compile.
export class PrerenderedRasterDiagramRenderer implements DiagramRenderer {
  private readonly fallback = new PassthroughDiagramRenderer();
  constructor(private readonly pngBySource: Map<string, string>) {}
  render(mermaidSource: string): string {
    const dataUri = this.pngBySource.get(mermaidSource);
    return dataUri ? imgFigure(dataUri) : this.fallback.render(mermaidSource);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd compiler && npx jest diagramRaster.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `epub.ts`**

Add the import:

```ts
import { rasterizeDiagramPngs, PrerenderedRasterDiagramRenderer } from "./diagramRaster";
```

Replace the diagram-selection block from Task 4's Step 5 (currently):

```ts
  let diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  if (opts.mermaid) {
    diagrams = new PrerenderedDiagramRenderer(await prerenderDiagrams(book, opts.mermaid));
  }
```

with:

```ts
  let diagrams = opts.diagrams ?? new PassthroughDiagramRenderer();
  if (opts.mermaid) {
    const svgBySource = await prerenderDiagrams(book, opts.mermaid);
    diagrams =
      profile === "kdp"
        ? new PrerenderedRasterDiagramRenderer(await rasterizeDiagramPngs(svgBySource))
        : new PrerenderedDiagramRenderer(svgBySource);
  }
```

- [ ] **Step 6: Write + run an epub.ts-level integration test**

Add to `compiler/__tests__/epub.test.ts` (the `jest.mock("../src/rasterize", ...)` from Task 4 Step 6 already covers this file — no new mock needed):

```ts
  it("profile 'kdp' + mermaid rasterizes diagrams to <img>, not inline <svg>", async () => {
    const book = bookWithMermaidDiagram(); // see helper below
    const fakeMermaid = { renderAll: async (sources: readonly string[]) => new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'])) };
    const zip = await unzip(await compileEpub(book, { mermaid: fakeMermaid, profile: "kdp" }));
    const chapter = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(chapter).toMatch(/<figure class="diagram"><img src="data:image\/png;base64,/);
    expect(chapter).not.toContain("<svg");
  });
```

Add the small helper (near `syntheticBook()` at the top of the file):

```ts
function bookWithMermaidDiagram(): Book {
  const book = syntheticBook();
  book.content.u1.lesson.sections.push({
    heading: "Flow",
    body_markdown: "```mermaid\ngraph TD; A-->B;\n```",
  });
  return book;
}
```

Run: `cd compiler && npx jest epub.test.ts`
Expected: PASS

- [ ] **Step 7: Typecheck**

Run: `cd compiler && npm run typecheck`

- [ ] **Step 8: Commit**

```bash
git add compiler/src/diagramRaster.ts compiler/src/epub.ts compiler/__tests__/diagramRaster.test.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): rasterize Mermaid diagrams to <img> for the kdp profile (D4)"
```

---

## Task 6: D5 — cover → raster JPEG, D6 — metadata completeness, release guard

**Files:**
- Modify: `compiler/src/coverRaster.ts` (add `renderCoverJpeg`)
- Modify: `compiler/src/cover.ts` (add `buildCoverXhtmlRaster`)
- Modify: `compiler/src/epub.ts` (cover selection, `EmptyBookError`-sibling `KdpDraftError`, `buildOpf`/`accessibilityMeta` profile-awareness, ISO date, translator, isbn)
- Modify: `compiler/src/types.ts:116-138` (`BookMetadata`: add `translator?`, `isbn?`)
- Create: `compiler/__tests__/coverRaster.test.ts` (does not exist yet — `coverRaster.ts` currently has no dedicated test file)
- Test: `compiler/__tests__/epub.test.ts` (extend)

**Interfaces:**
- Consumes: `rasterizeToJpeg` (Task 1), `CompileOptions.profile` (Task 2), `mathPngs.size` (Task 4, threaded into `accessibilityMeta`/`buildOpf` as `hadMath`)
- Produces: `renderCoverJpeg(svg: string, width?: number, quality?: number): Promise<Buffer>`, `buildCoverXhtmlRaster(title: string, imgHref: string): string`, `class KdpDraftError extends Error` (thrown by `compileEpub`, caught by the backend in Task 7)

- [ ] **Step 1: Write the failing tests**

Create `compiler/__tests__/coverRaster.test.ts` (there is no existing test file for `coverRaster.ts` — `cover.test.ts`, which exists, covers `cover.ts` instead):

```ts
import { renderCoverJpeg } from "../src/coverRaster";

it("renderCoverJpeg throws a clear error when puppeteer is not installed", async () => {
  await expect(renderCoverJpeg("<svg/>")).rejects.toThrow(/puppeteer is not installed/i);
});
```

Add to `compiler/__tests__/epub.test.ts`:

```ts
Add these inside the existing `describe("compileEpub — bibliographic metadata → OPF + colophon"` block (it already defines a `withMeta(metadata: BookMetadata): Book { return { ...syntheticBook(), metadata }; }` helper — reuse it rather than mutating `syntheticBook()`'s own definition, which the sibling test `"defaults language to en and synthesises a rights line when metadata is absent"` (line ~186) relies on staying `metadata`-free):

```ts
  it("profile 'kdp' registers a JPEG cover-image and drops the vector cover.svg", async () => {
    const book = withMeta({ author: "A", status: "release" });
    const zip = await unzip(await compileEpub(book, { profile: "kdp" }));
    expect(zip.file("OEBPS/cover.svg")).toBeNull();
    const coverJpg = await zip.file("OEBPS/cover.jpg")!.async("nodebuffer");
    expect(coverJpg[0]).toBe(0xff); // JPEG magic number, from the mocked rasterizeToJpeg
    expect(coverJpg[1]).toBe(0xd8);
    expect(coverJpg[2]).toBe(0xff);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>');
    const coverXhtml = await zip.file("OEBPS/cover.xhtml")!.async("string");
    expect(coverXhtml).toContain('<img src="cover.jpg"');
  });

  it("profile 'kdp' normalizes dc:date to ISO-8601 and leaves the default profile's date untouched", async () => {
    const book = withMeta({ author: "A", status: "release", date: "June 1, 2026" });
    const kdpOpf = await (await unzip(await compileEpub(book, { profile: "kdp" }))).file("OEBPS/content.opf")!.async("string");
    expect(kdpOpf).toContain("<dc:date>2026-06-01</dc:date>");
    const defaultOpf = await (await unzip(await compileEpub(book))).file("OEBPS/content.opf")!.async("string");
    expect(defaultOpf).toContain("<dc:date>June 1, 2026</dc:date>");
  });

  it("profile 'kdp' emits a translator contributor and an ISBN identifier when present", async () => {
    const book = withMeta({ author: "A", status: "release", translator: "T. Ranslator", isbn: "9780000000000" });
    const opf = await (await unzip(await compileEpub(book, { profile: "kdp" }))).file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('<dc:contributor id="translator">T. Ranslator</dc:contributor>');
    expect(opf).toContain('scheme="marc:relators">trl</meta>');
    expect(opf).toContain('<dc:identifier id="isbn">9780000000000</dc:identifier>');
  });

  it("profile 'kdp' refuses to compile a draft book with a clear error", async () => {
    const book = withMeta({ author: "A", status: "draft" });
    await expect(compileEpub(book, { profile: "kdp" })).rejects.toThrow(/kdp export profile requires a released book/i);
  });

  it("profile 'default' still compiles a draft book (no guard)", async () => {
    const book = withMeta({ author: "A", status: "draft" });
    await expect(compileEpub(book)).resolves.toBeInstanceOf(Uint8Array);
  });
```

Add this inside the existing `describe("compileEpub — accessibility metadata (EPUB Accessibility 1.1)"` block, alongside its sibling tests (it relies on `syntheticBook()` alone — no metadata needed — same as the existing `"auto-derives a11y metadata..."` test right above it, which asserts the DEFAULT profile keeps `"MathML"`; this one asserts the kdp profile flips it):

```ts
  it("profile 'kdp' flips the accessibility MathML feature to alternativeText when math was rasterized", async () => {
    const opf = await (await unzip(await compileEpub(syntheticBook(), { profile: "kdp" }))).file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('schema:accessibilityFeature">alternativeText<');
    expect(opf).not.toContain('schema:accessibilityFeature">MathML<');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd compiler && npx jest coverRaster.test.ts epub.test.ts`
Expected: FAIL — `renderCoverJpeg`, `buildCoverXhtmlRaster`, `KdpDraftError`, `translator`/`isbn` fields, and the profile-aware `buildOpf`/`accessibilityMeta` behavior don't exist yet.

- [ ] **Step 3: Implement `coverRaster.ts`**

In `compiler/src/coverRaster.ts`, update the import and add the new export:

```ts
import { rasterizeToPng, rasterizeToJpeg } from "./rasterize";

// Render `svg` (a full cover SVG) to a PNG Buffer at `width` px (cover aspect
// preserved). 420px is plenty for a Library thumbnail and keeps the payload
// small. Throws if puppeteer isn't installed.
export async function renderCoverPng(svg: string, width = 420): Promise<Buffer> {
  return rasterizeToPng({ svg, width });
}

// KDP profile (D5, docs/specs/kdp-clean-export-profile.md): a raster JPEG
// cover at KDP's full recommended size — 1600×2560 matches cover.ts's own
// viewBox and KDP's ideal 1.6:1 portrait ratio. Amazon wants a raster
// cover-image, not the app's vector SVG. Throws if puppeteer isn't installed.
export async function renderCoverJpeg(svg: string, width = 1600, quality = 90): Promise<Buffer> {
  return rasterizeToJpeg({ svg, width, quality });
}
```

- [ ] **Step 4: Implement `cover.ts`'s raster cover page**

In `compiler/src/cover.ts`, add after `buildCoverXhtml` (after its closing `` ` `` / `;`, before `coverInputForBook`):

```ts
// KDP profile raster cover page (D5, docs/specs/kdp-clean-export-profile.md):
// unlike buildCoverXhtml, this page shows the RASTER cover (a plain <img>) —
// no inline SVG, so no embedded @font-face is needed here either.
export function buildCoverXhtmlRaster(title: string, imgHref: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;padding:0;height:100%}.cv{width:100%;height:100vh}.cv img{width:100%;height:100%;object-fit:contain;display:block}</style>
</head>
<body>
<section epub:type="cover" class="cv">
<img src="${escapeHtml(imgHref)}" alt="${escapeHtml(title)}"/>
</section>
</body>
</html>
`;
}
```

- [ ] **Step 5: Implement `types.ts` metadata fields**

In `compiler/src/types.ts`, in the `BookMetadata` interface (lines 116-138), add after the `identifier?: string;` line:

```ts
  translator?: string; // dc:contributor (marc:relators "trl"), kdp profile only — for translated books
  isbn?: string; // dc:identifier (secondary, ISBN-13), kdp profile only — KDP assigns its own ASIN; ISBN is optional
```

- [ ] **Step 6: Implement `epub.ts` — draft guard, cover selection, buildOpf/accessibilityMeta profile-awareness**

Add the import (alongside the existing `import { colophonSection } from "./colophon";`):

```ts
import { isDraft } from "./release";
import { buildCoverSvgFile, buildCoverXhtml, buildCoverSvg, buildCoverXhtmlRaster, coverInputForBook } from "./cover";
import { renderCoverJpeg } from "./coverRaster";
```

(Note: `buildCoverSvgFile`, `buildCoverXhtml`, `coverInputForBook` are already imported from `./cover` at the current top of the file — this replaces that existing import line with the widened one, adding `buildCoverSvg` and `buildCoverXhtmlRaster`.)

Add a new error class alongside `EmptyBookError` (after its closing `}`, currently line 39):

```ts
export class KdpDraftError extends Error {
  constructor() {
    super(
      'The KDP export profile requires a released book (metadata.status must not be "draft").',
    );
    this.name = "KdpDraftError";
  }
}
```

At the top of `compileEpub` (right after the `const profile = opts.profile ?? "default";` line added in Task 3), add the release guard:

```ts
  const profile = opts.profile ?? "default";
  if (profile === "kdp" && isDraft(book.metadata)) {
    throw new KdpDraftError();
  }
```

Add the ISO-date helper near `modifiedTimestamp` (after its closing `}`, currently line 120):

```ts
// Normalize dc:date to an ISO-8601 calendar date (YYYY-MM-DD) for the kdp
// profile — epubcheck (V, docs/specs/kdp-clean-export-profile.md) warns on a
// non-ISO dc:date. Falls back to the raw string on an unparseable date (never
// throws over a metadata quirk); the default profile leaves dc:date untouched.
function isoDate(raw: string): string {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toISOString().slice(0, 10);
}
```

Replace the cover-building block (currently lines 176-178):

```ts
  const coverInput = coverInputForBook(book);
  const coverXhtml = buildCoverXhtml(coverInput);
  const coverSvg = buildCoverSvgFile(coverInput);
```

with:

```ts
  const coverInput = coverInputForBook(book);
  let coverXhtml = buildCoverXhtml(coverInput);
  let coverSvg: string | undefined = buildCoverSvgFile(coverInput);
  let coverJpeg: Buffer | undefined;
  if (profile === "kdp") {
    coverJpeg = await renderCoverJpeg(buildCoverSvg(coverInput));
    coverXhtml = buildCoverXhtmlRaster(book.title, "cover.jpg");
    coverSvg = undefined;
  }
```

Replace the zip-assembly cover lines (currently, among the `zip.file(...)` calls):

```ts
  zip.file("OEBPS/cover.xhtml", coverXhtml);
  zip.file("OEBPS/cover.svg", coverSvg);
```

with:

```ts
  zip.file("OEBPS/cover.xhtml", coverXhtml);
  if (coverSvg !== undefined) zip.file("OEBPS/cover.svg", coverSvg);
  if (coverJpeg !== undefined) zip.file("OEBPS/cover.jpg", coverJpeg);
```

Update the `buildOpf(...)` call site (currently `zip.file("OEBPS/content.opf", buildOpf(book, chapters, images, auxFront, auxBack));`):

```ts
  zip.file("OEBPS/content.opf", buildOpf(book, chapters, images, auxFront, auxBack, profile, mathPngs.size > 0));
```

Update `accessibilityMeta`'s signature and body (currently lines 307-336):

```ts
function accessibilityMeta(
  book: Book,
  chapters: Chapter[],
  images: ImageRes[],
  profile: "default" | "kdp" = "default",
  hadMath = false,
): string[] {
  const a = book.metadata?.accessibility ?? {};
  const hasVisual = images.length > 0 || chapters.some((c) => c.hasSvg);
  const hasMath = hadMath || chapters.some((c) => c.hasMath);

  const accessModes = a.accessModes ?? ["textual", ...(hasVisual ? ["visual"] : [])];
  const accessModeSufficient = a.accessModeSufficient ?? [hasVisual ? "textual,visual" : "textual"];

  const autoFeatures = ["tableOfContents", "readingOrder", "structuralNavigation", "displayTransformability"];
  if (hasMath) autoFeatures.push(profile === "kdp" ? "alternativeText" : "MathML");
  const features = [...new Set([...autoFeatures, ...(a.features ?? [])])];

  const hazards = a.hazards ?? ["none"];
  const summary =
    a.summary ??
    ("Reflowable EPUB with structural navigation, a table of contents, and resizable text." +
      (hasMath
        ? profile === "kdp"
          ? " Mathematics is provided as images with text alternatives."
          : " Mathematics is encoded as MathML."
        : "") +
      (hasVisual ? " The publication contains diagrams and images." : ""));

  const out: string[] = [];
  for (const m of accessModes) out.push(`<meta property="schema:accessMode">${escapeHtml(m)}</meta>`);
  for (const s of accessModeSufficient)
    out.push(`<meta property="schema:accessModeSufficient">${escapeHtml(s)}</meta>`);
  for (const f of features) out.push(`<meta property="schema:accessibilityFeature">${escapeHtml(f)}</meta>`);
  for (const h of hazards) out.push(`<meta property="schema:accessibilityHazard">${escapeHtml(h)}</meta>`);
  out.push(`<meta property="schema:accessibilitySummary">${escapeHtml(summary)}</meta>`);
  if (a.conformsTo) out.push(`<link rel="dcterms:conformsTo" href="${escapeHtml(a.conformsTo)}"/>`);
  if (a.certifiedBy) out.push(`<meta property="a11y:certifiedBy">${escapeHtml(a.certifiedBy)}</meta>`);
  return out;
}
```

Update `buildOpf`'s signature (currently lines 338-344):

```ts
function buildOpf(
  book: Book,
  chapters: Chapter[],
  images: ImageRes[] = [],
  auxFront: AuxDoc[] = [],
  auxBack: AuxDoc[] = [],
  profile: "default" | "kdp" = "default",
  hadMath = false,
): string {
```

Update the manifest's cover items (currently, inside the `manifest` array literal):

```ts
    // Cover: the SVG is the EPUB3 cover-image; cover.xhtml is the rendered page
    // (inline SVG → needs the svg property).
    '<item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>',
    '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>',
```

with:

```ts
    // Cover: default profile registers the vector SVG as the EPUB3 cover-image
    // (cover.xhtml embeds it inline, hence properties="svg"); the kdp profile
    // (D5) registers a raster JPEG instead, and cover.xhtml points at it via a
    // plain <img> (no "svg" property).
    ...(profile === "kdp"
      ? [
          '<item id="cover-image" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>',
          '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
        ]
      : [
          '<item id="cover-image" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/>',
          '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml" properties="svg"/>',
        ]),
```

Update the `dc:date` line (currently `if (m.date) meta.push(\`<dc:date>${escapeHtml(m.date)}</dc:date>\`);`):

```ts
  if (m.date) meta.push(`<dc:date>${escapeHtml(profile === "kdp" ? isoDate(m.date) : m.date)}</dc:date>`);
```

Add the translator + isbn blocks after the existing `m.series` block and before the `meta.push(...accessibilityMeta(...))` line:

```ts
  if (profile === "kdp" && m.translator) {
    meta.push(`<dc:contributor id="translator">${escapeHtml(m.translator)}</dc:contributor>`);
    meta.push(`<meta refines="#translator" property="role" scheme="marc:relators">trl</meta>`);
  }
  if (profile === "kdp" && m.isbn) {
    meta.push(`<dc:identifier id="isbn">${escapeHtml(m.isbn)}</dc:identifier>`);
    meta.push(`<meta refines="#isbn" property="identifier-type" scheme="onix:codelist5">15</meta>`);
  }
```

Update the `accessibilityMeta` call (currently `meta.push(...accessibilityMeta(book, chapters, images));`):

```ts
  meta.push(...accessibilityMeta(book, chapters, images, profile, hadMath));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd compiler && npx jest coverRaster.test.ts epub.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck + full suite**

Run: `cd compiler && npm run typecheck && npm test`
Expected: no errors, all tests pass (default-profile output remains byte-unchanged per Task 2's regression test).

- [ ] **Step 9: Commit**

```bash
git add compiler/src/coverRaster.ts compiler/src/cover.ts compiler/src/epub.ts compiler/src/types.ts compiler/__tests__/coverRaster.test.ts compiler/__tests__/epub.test.ts
git commit -m "feat(compiler): raster JPEG cover, KDP metadata completeness + draft guard (D5/D6)"
```

**Note (out of scope for this task, documented per the spec):** D6 also flags that `dc:creator`/the colophon byline only render when `metadata.author` is populated, and that the mobile Book Editor (`mobile/src/components/BookEditor.tsx`) currently exposes no visible author field. The spec itself marks this "may be a mobile-side change, outside `compiler/`" — it is not implemented by this plan and is left as a follow-up.

---

## Task 7: Backend + mobile plumbing (rest of D1)

**Files:**
- Modify: `backend/src/export/compiler.py:65-141`
- Modify: `backend/src/export/router.py` (`export_book`, `submit_export`)
- Modify: `backend/src/export/tasks.py:79-183` (`run_export`)
- Modify: `mobile/src/api/client.ts` (`ExportOptions`, `submitExportJob`, `exportBook`)
- Modify: `mobile/src/components/CheckoutButton.tsx` (new "Kindle (KDP)" action)
- Modify: `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`
- Test: `backend/tests/` (new/extended export tests — see Step 1), `mobile/__tests__/help/coverage.test.ts` (already passes once the topic is added — no code change to the test itself)

**Interfaces:**
- Consumes: `compiler.compile_book`'s existing signature (Task 6's `--profile kdp` CLI flag, already wired through `compileEpub`)
- Produces: `compiler.compile_book(raw_book, *, fmt="epub", diagrams=False, profile="default")`; `POST /export` and `POST /export/jobs` accept an optional `profile` query param (`"default"|"kdp"`, default `"default"`); `mobile/src/api/client.ts`'s `ExportOptions.profile?: "default" | "kdp"`

- [ ] **Step 1: Write the failing backend tests**

Find the existing export test file (it lives under `backend/tests/` — search for `test_export` or `compile_book` to find the exact path used by this repo's existing coverage, e.g. `backend/tests/test_export.py` or similar; if none exists yet for this router, create `backend/tests/export/test_kdp_profile.py`). Add:

```python
import pytest
from unittest.mock import AsyncMock, patch

from backend.src.export import compiler


@pytest.mark.asyncio
async def test_compile_book_rejects_unknown_profile():
    with pytest.raises(compiler.ExportValidationError):
        await compiler.compile_book(b'{"title":"t","toc":{"subjects":[]}}', profile="bogus")


@pytest.mark.asyncio
async def test_compile_book_appends_profile_kdp_to_argv():
    fake_proc = AsyncMock()
    fake_proc.communicate = AsyncMock(return_value=(b"EPUBBYTES", b""))
    fake_proc.returncode = 0
    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)) as create_exec:
        await compiler.compile_book(
            b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
            profile="kdp",
        )
    argv = create_exec.call_args.args
    assert "--profile" in argv
    assert argv[argv.index("--profile") + 1] == "kdp"


@pytest.mark.asyncio
async def test_compile_book_default_profile_omits_the_flag():
    fake_proc = AsyncMock()
    fake_proc.communicate = AsyncMock(return_value=(b"EPUBBYTES", b""))
    fake_proc.returncode = 0
    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)) as create_exec:
        await compiler.compile_book(
            b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
        )
    argv = create_exec.call_args.args
    assert "--profile" not in argv


@pytest.mark.asyncio
async def test_compile_book_maps_kdp_draft_error_to_validation_error():
    fake_proc = AsyncMock()
    fake_proc.communicate = AsyncMock(
        return_value=(b"", b'The KDP export profile requires a released book (metadata.status must not be "draft").')
    )
    fake_proc.returncode = 1
    with patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)):
        with pytest.raises(compiler.ExportValidationError, match="released book"):
            await compiler.compile_book(
                b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
                profile="kdp",
            )
```

Check this repo's existing async test conventions first (`pytest.ini`/`pyproject.toml` for `asyncio_mode`, and how other `backend/tests/` files mock `asyncio.create_subprocess_exec` for `compile_book` — there is very likely an existing test doing exactly this for the `diagrams`/`fmt` flags; match its exact mocking style instead of inventing a new one if it differs from the sketch above).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest tests/ -k kdp_profile -v` (adjust path to match Step 1's actual file)
Expected: FAIL — `compile_book` doesn't accept `profile` yet.

- [ ] **Step 3: Implement `backend/src/export/compiler.py`**

Update the signature (currently lines 65-70):

```python
async def compile_book(
    raw_book: bytes,
    *,
    fmt: str = "epub",
    diagrams: bool = False,
    profile: str = "default",
) -> ExportResult:
    """Compile raw book.json bytes into an artifact (EPUB, PDF, or DOCX) via the
    Node compiler.

    fmt:      "epub" | "pdf" | "docx". diagrams: render Mermaid → SVG (needs
    Chromium; much slower, so it gets the longer diagram timeout). profile:
    "default" | "kdp" (KDP-clean export profile, epub-only — see
    docs/specs/kdp-clean-export-profile.md). Raises ExportValidationError for
    bad input, CompilerError otherwise.
    """
    book = validate_book(raw_book)
    if profile not in ("default", "kdp"):
        raise ExportValidationError("profile must be 'default' or 'kdp'.")
```

Update the argv build (currently `argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", fmt]` followed by `if diagrams: argv.append("--mermaid")`):

```python
    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", fmt]
    if diagrams:
        argv.append("--mermaid")
    if profile == "kdp":
        argv.extend(["--profile", "kdp"])
```

Update the failure-detail mapping (currently, inside `if proc.returncode != 0:`):

```python
    if proc.returncode != 0:
        detail = stderr.decode("utf-8", "replace").strip()
        # The compiler prints this for a book with no generated content — that's
        # a user-input problem (422), not a server fault.
        if "no generated content" in detail.lower():
            raise ExportValidationError("Book has no generated content to compile.")
        # The kdp profile refuses to compile a draft book (epub.ts's
        # KdpDraftError) — also a user-input problem, not a server fault.
        if "kdp export profile requires a released book" in detail.lower():
            raise ExportValidationError(
                'The KDP export profile requires a released book '
                '(set metadata.status to something other than "draft").'
            )
        log.error("compiler_failed", fmt=fmt, returncode=proc.returncode, detail=detail[:500])
        raise CompilerError("Compilation failed.")
```

- [ ] **Step 4: Implement `backend/src/export/router.py`**

Update `export_book`'s signature (currently lines 64-70):

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
    Mermaid → SVG (Chromium; much slower); `profile`=default|kdp (kdp is epub-only —
    docs/specs/kdp-clean-export-profile.md)."""
    fmt = format.lower()
    if fmt not in _FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub', 'pdf' or 'docx'."},
        )
    if profile not in ("default", "kdp"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "profile must be 'default' or 'kdp'."},
        )
    if profile == "kdp" and fmt != "epub":
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "the kdp profile is only supported for format=epub."},
        )
    media_type, ext = _FORMATS[fmt]
```

Update the compile call (currently `result = await compiler.compile_book(raw, fmt=fmt, diagrams=diagrams)`):

```python
        result = await compiler.compile_book(raw, fmt=fmt, diagrams=diagrams, profile=profile)
```

Update `submit_export`'s signature (currently lines 163-170):

```python
async def submit_export(
    request: Request,
    background: BackgroundTasks,
    format: str = "epub",
    diagrams: bool = False,
    profile: str = "default",
    r: redis.Redis = Depends(get_redis),
    principal: Principal | None = Depends(optional_user),
) -> ExportSubmitResponse:
```

Add validation right after the existing `_ASYNC_FORMATS` check (currently `if fmt not in _ASYNC_FORMATS: return JSONResponse(...)`):

```python
    if profile not in ("default", "kdp"):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "profile must be 'default' or 'kdp'."},
        )
    if profile == "kdp" and fmt != "epub":
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "the kdp profile is only supported for format=epub."},
        )
```

Update the `background.add_task(...)` call (currently passing `job_id=job_id, raw_book=raw, fmt=fmt, diagrams=diagrams, redis_client=r`):

```python
    background.add_task(
        export_tasks.run_export,
        job_id=job_id,
        raw_book=raw,
        fmt=fmt,
        diagrams=diagrams,
        profile=profile,
        redis_client=r,
    )
```

- [ ] **Step 5: Implement `backend/src/export/tasks.py`**

Update `run_export`'s signature (currently lines 79-89):

```python
async def run_export(
    *,
    job_id: uuid.UUID,
    raw_book: bytes,
    fmt: str,
    diagrams: bool,
    redis_client: redis.Redis,
    profile: str = "default",
    publish_book_id: str | None = None,
    published_by_sub: str | None = None,
    db_pool: asyncpg.Pool | None = None,
) -> None:
```

Update the compile call (currently `result = await compiler.compile_book(raw_book, fmt=fmt, diagrams=diagrams)`):

```python
        result = await compiler.compile_book(raw_book, fmt=fmt, diagrams=diagrams, profile=profile)
```

(No other change needed in `tasks.py` — the existing `except compiler.ExportValidationError as exc: await _write_status(r, job_id, {"status": "failed", "error": str(exc)}); return` already surfaces the new "released book" message to the client generically.)

- [ ] **Step 6: Run backend tests + format**

Run: `cd backend && python -m pytest tests/ -k kdp_profile -v && ruff format backend/src/export/compiler.py backend/src/export/router.py backend/src/export/tasks.py`
Expected: PASS, `ruff format` reports the files already formatted (or applies formatting — re-run the tests after).

- [ ] **Step 7: Implement `mobile/src/api/client.ts`**

Update `ExportOptions` (currently lines 164-171):

```ts
export interface ExportOptions {
  format?: "epub" | "pdf" | "cover" | "docx"; // "cover" → a PNG thumbnail of the cover
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

Update `submitExportJob` (currently lines 251-268):

```ts
async function submitExportJob(
  book: Book,
  format: "epub" | "pdf" | "docx",
  diagrams: boolean,
  profile?: "default" | "kdp",
): Promise<string> {
  const params = new URLSearchParams({ format, diagrams: String(diagrams) });
  if (profile) params.set("profile", profile);
  const res = await fetch(`${BASE_URL}/api/v1/export/jobs?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(book),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body, retryAfterSeconds(res));
  }
  const { job_id } = (await res.json()) as { job_id: string };
  return job_id;
}
```

Update `exportBook`'s submit call (currently `const jobId = await submitExportJob(book, format, opts.diagrams ?? false);`):

```ts
  const jobId = await submitExportJob(book, format, opts.diagrams ?? false, opts.profile);
```

- [ ] **Step 8: Write a mobile client test**

Check `mobile/__tests__/` for an existing `api/client` test file (e.g. `mobile/__tests__/api/client.test.ts`) covering `submitExportJob`/`exportBook`'s URL construction. If one exists, add:

```ts
it("submitExportJob includes profile=kdp in the query string when set", async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ job_id: "job-1" }),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  await exportBook(minimalBook(), { format: "epub", profile: "kdp", diagrams: true });
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toContain("profile=kdp");
});
```

(Match the file's existing `minimalBook()`/fetch-mocking helpers exactly — don't invent new ones if equivalents already exist in that file.) If no such test file exists yet, skip this step (the E2E coverage below, plus the backend tests in Step 1, are sufficient — do not create a new mobile test file solely for a query-string assertion when none of the sibling client functions have one).

- [ ] **Step 9: Implement the mobile "Export for Kindle (KDP)" action**

In `mobile/src/components/CheckoutButton.tsx`, add imports (alongside the existing ones):

```ts
import { exportBook } from "@/api/client";
import { buildCompilePayload } from "@/lib/compilePayload";
```

Add a new handler (alongside `checkout`, before the `return (`):

```tsx
  // KDP-clean export (docs/specs/kdp-clean-export-profile.md) — a distinct
  // action, not a checkbox on the existing export, since it produces a
  // DIFFERENT artifact (rasterized math/diagrams, JPEG cover, no embedded
  // body font). Bypasses trackedExport's exportStatus tracking (which is
  // keyed by format "epub"/"pdf"/"docx" — a concurrent plain-EPUB export
  // would collide with this one under the same "epub" key), same as the
  // cover thumbnail's raw exportBook call in SaveToLibraryButton.
  const checkoutKdp = async () => {
    setState({ kind: "working", fmt: "epub" });
    try {
      const payload = await buildCompilePayload(book);
      const { artifact, trust } = await exportBook(payload, {
        format: "epub",
        diagrams: true,
        profile: "kdp",
      });
      const res = await downloadArtifact(artifact, `${slug(book.title)}-kdp.epub`, "application/epub+zip");
      setState({
        kind: "done",
        msg: res.savedPath ? `Saved: ${res.savedPath}` : "KDP-clean EPUB downloaded.",
        trust,
      });
    } catch (err) {
      setState({ kind: "error", msg: messageFor(err) });
    }
  };
```

Add a third button inside the existing `<View style={styles.row}>` (after the "PDF" `<Button>`):

```tsx
        <Button
          variant="ghost"
          label="Kindle (KDP)"
          onPress={checkoutKdp}
          disabled={working}
          accessibilityLabel="Export a KDP-clean EPUB for Kindle"
          style={styles.btn}
        />
```

- [ ] **Step 10: Add the Help feature + topic (DoD — coverage gate)**

In `mobile/src/help-content/features.ts`, add to the `FEATURES` array (alongside the existing `"export"`/`"word-export"` entries):

```ts
  { key: "kdp-export", label: "Export for Kindle (KDP)" },
```

In `mobile/src/help-content/topics.ts`, add a new topic to `HELP_TOPICS` (modeled on the existing `word-export` topic — insert it near that one):

```ts
  {
    id: "kdp-export",
    title: "Export a KDP-clean EPUB for Kindle",
    featureKey: "kdp-export",
    keywords: ["kdp", "kindle", "amazon", "export", "epub", "epubcheck", "publish"],
    blocks: [
      {
        kind: "text",
        text: "\"Kindle (KDP)\" produces a separate, distribution-ready EPUB tuned for Amazon KDP: math and diagrams are rendered as images instead of MathML/SVG (Kindle's support for both is inconsistent), the cover is a raster JPEG instead of the app's vector cover, and the body no longer forces our house font — Kindle's reading system controls that. It's a different file from your regular EPUB/PDF checkout, not a setting on it.",
      },
      {
        kind: "defs",
        defs: [
          { term: "Where's the button?", def: "On a Library book's Check out panel, next to EPUB3 and PDF: \"Kindle (KDP)\"." },
          { term: "Why does it need a released book?", def: "KDP exports refuse a draft book — release it first (clears the \"DRAFT\" watermark) so what you upload to KDP is the finished edition." },
          { term: "Does it change what's published?", def: "No — it's a separate, read-only export tuned for one destination. Your regular EPUB/PDF checkout is unaffected." },
        ],
      },
    ],
  },
```

- [ ] **Step 11: Run the mobile test suite**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts CheckoutButton`
Expected: PASS — the coverage gate passes because `kdp-export` now has both a `FEATURES` entry and a topic with that `featureKey`.

- [ ] **Step 12: Typecheck mobile**

Run: `cd mobile && npx tsc --noEmit` (or the project's existing typecheck script if different — check `mobile/package.json`'s `scripts` first)
Expected: no errors.

- [ ] **Step 13: Commit**

```bash
git add backend/src/export/compiler.py backend/src/export/router.py backend/src/export/tasks.py backend/tests/ mobile/src/api/client.ts mobile/src/components/CheckoutButton.tsx mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "feat(export): thread the kdp profile through backend + add a distinct mobile Kindle export action"
```

---

## Task 8: V — epubcheck CI gate + Kindle Previewer note

**Files:**
- Modify: `compiler/package.json` (add `epubcheck-assets` devDependency)
- Create: `compiler/__tests__/kdpEpubcheck.test.ts`
- Modify: `.github/workflows/ci.yml:87-121` (`compiler-test` job — add a Java setup step)
- Modify: `compiler/README.md` (or create it if it doesn't exist — check first) — a documented manual Kindle Previewer pre-ship step

**Interfaces:**
- Consumes: `compileEpub` with `{ profile: "kdp" }` (Task 6), the `epubcheck-assets` npm package (verified real: `require("epubcheck-assets")` resolves to its bundled `epubcheck.jar` path)
- Produces: a CI-enforced structural validation gate for the kdp-profile output; no new runtime exports

**Design note (why this test needs no real Puppeteer/Chromium in CI):** the fixture book below has no math and no Mermaid diagrams, so `collectMathHtml`/`rasterizeDiagramPngs` never fire (both short-circuit to an empty map before calling `rasterizeManyToPng` — see Tasks 4/5). The only raster call a `profile: "kdp"` compile always makes is the cover (Task 6), which this test mocks via `jest.mock("../src/rasterize", ...)`, returning a verified-real, tiny, valid JPEG (so `epubcheck`'s image-content validation — it decodes JPEG/PNG bytes, not just checks the extension — actually passes) rather than arbitrary bytes. This keeps the gate fully deterministic and CI-safe with only a Java install, no Chromium/system-fonts flakiness. `compiler/package.json` still deliberately does **not** gain a `puppeteer` devDependency (matches the existing "puppeteer is a deploy-only concern" architecture — see `backend/Dockerfile`'s `npm install --no-save puppeteer@25.3.0` and `rasterize.test.ts`'s "not installed" tests from Task 1).

- [ ] **Step 1: Add the `epubcheck-assets` devDependency**

Run (this updates `compiler/package.json` and `compiler/package-lock.json` together, which `npm ci` in CI requires to be in sync):

```bash
cd compiler && npm install --save-dev epubcheck-assets@5.1.0
```

Verify it resolves (this is real, verified behavior — `epubcheck-assets`'s `index.js` is `module.exports = path.join(__dirname, 'assets/epubcheck-5.1.0/epubcheck.jar')`):

```bash
node -e "console.log(require('epubcheck-assets'))"
```

Expected output: an absolute path ending in `epubcheck-assets/assets/epubcheck-5.1.0/epubcheck.jar`, and the file exists at that path.

- [ ] **Step 2: Write the failing test**

Create `compiler/__tests__/kdpEpubcheck.test.ts`:

```ts
// The V gate (docs/specs/kdp-clean-export-profile.md): the kdp-profile output
// must pass epubcheck with zero fatals/errors. Needs Java (to run
// epubcheck.jar) — auto-skips locally without it, mirroring epub.test.ts's
// `realDescribe` pattern for the real-book gate. Does NOT need Puppeteer/
// Chromium — see the task's design note in the plan for why.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileEpub } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[]) => svgs.map(() => Buffer.from("unused"))),
  rasterizeToPng: jest.fn(async () => Buffer.from("unused")),
  // A real, verified-valid tiny (2x2) JPEG — epubcheck decodes image bytes, so
  // this must be a genuine JPEG, not arbitrary bytes.
  rasterizeToJpeg: jest.fn(async () =>
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=",
      "base64",
    ),
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

const LESSON: LessonOutput = {
  topic: "KDP Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the epubcheck gate — no math, no diagrams.",
  learning_objectives: ["Understand the gate"],
  sections: [{ heading: "Section", body_markdown: "Plain prose, no math or diagrams." }],
  key_takeaways: ["It validates"],
  further_reading: [],
};

function fixtureBook(): Book {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    title: "KDP Epubcheck Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    metadata: { author: "Fixture Author", status: "release" },
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-17T00:00:00.000Z" } },
  };
}

gated("kdp-profile EPUB — epubcheck gate (V)", () => {
  it("passes epubcheck with zero fatals/errors", async () => {
    const bytes = await compileEpub(fixtureBook(), { profile: "kdp" });
    const tmp = path.join(os.tmpdir(), `kdp-epubcheck-${Date.now()}.epub`);
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

- [ ] **Step 3: Run test to verify it fails (or is correctly skipped)**

Run: `cd compiler && npx jest kdpEpubcheck.test.ts`
Expected locally: if this machine has no `java` on PATH, the suite reports the `gated` block as **skipped** (not failed) — confirm with `java -version` first; if Java IS available locally, the test runs for real and should PASS immediately (since Tasks 2–6 are already implemented) — if it fails, that's a real regression to fix before continuing, not an expected TDD-red state to work through.

- [ ] **Step 4: Add Java to CI**

In `.github/workflows/ci.yml`, inside the `compiler-test` job (currently starting at line 87), add a new step after "Set up Node 20" (currently lines 92-97) and before "Install compiler deps" (currently line 99):

```yaml
      - name: Set up Java (epubcheck — V gate, docs/specs/kdp-clean-export-profile.md)
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: "21"
```

- [ ] **Step 5: Run the full compiler suite once more (final check)**

Run: `cd compiler && npm run typecheck && npm test`
Expected: PASS. (In CI, once Step 4's Java step lands, the `kdpEpubcheck.test.ts` gate runs for real on every PR instead of auto-skipping.)

- [ ] **Step 6: Document the manual Kindle Previewer pre-ship step**

Check whether `compiler/README.md` exists (`ls compiler/README.md`). If it exists, add a new section near the end; if it doesn't, create it with at minimum this section:

```markdown
## KDP export profile — pre-ship check

The `kdp` export profile (`--profile kdp`, or `profile: "kdp"` in `CompileOptions`)
is validated in CI by `epubcheck` (`compiler/__tests__/kdpEpubcheck.test.ts`) —
that catches OPF/nav/manifest/structural errors, but it is not Kindle-specific.

Before relying on the profile for a real KDP upload, run the compiled artifact
through **Kindle Previewer** (Amazon's own, GUI/proprietary tool — not
scriptable in CI) at least once:

1. Compile: `node dist/cli.js book.json -o book.epub --format epub --profile kdp --mermaid`
2. Download Kindle Previewer from Amazon KDP's tools page and open `book.epub`.
3. Check: cover renders, math/diagrams render as images with reasonable size,
   body text uses the device's own font (not a forced serif), and the TOC/nav
   works.

This is a one-time-per-significant-change manual step, not a per-book gate.
```

- [ ] **Step 7: Commit**

```bash
git add compiler/package.json compiler/package-lock.json compiler/__tests__/kdpEpubcheck.test.ts .github/workflows/ci.yml compiler/README.md
git commit -m "test(compiler): add the epubcheck CI gate for the kdp profile + Kindle Previewer note (V)"
```

---

## Self-review notes (writing-plans skill)

- **Spec coverage:** D1 → Tasks 2, 7. D2 → Task 3. D3 → Task 4. D4 → Task 5. D5 → Task 6 (+ Task 1 enabler). D6 → Task 6 (ISO date, translator, isbn, release guard; the `author`-capture mobile-side gap is explicitly called out as out-of-scope, matching the spec's own hedge). V → Task 8 (epubcheck CI gate + Kindle Previewer README note). The spec's "Already satisfied — NO work" section (logical TOC, front matter, no headers/footers, cover aspect ratio) correctly has no task — verified against `epub.ts`/`cover.ts` during research and confirmed already true.
- **Placeholder scan:** every code step above contains complete, real code (no `TODO`/`TBD`/"add appropriate handling"). Task 7's Step 1 backend test file path is the one deliberately-open item (the plan instructs finding the repo's actual existing export-test file/convention rather than guessing a path that might collide or violate existing conventions) — this is a real, actionable instruction with a concrete fallback path, not a vague placeholder.
- **Type/name consistency:** `profile?: "default" | "kdp"` is spelled identically across `CompileOptions` (Task 2), `cli.ts`'s `parseArgs` return type (Task 2), `accessibilityMeta`/`buildOpf` (Task 6), `compiler.compile_book`/router query params (Task 7, as the Python `str` with the same two literal values), and `mobile/src/api/client.ts`'s `ExportOptions` (Task 7). `KdpDraftError` (Task 6) is thrown with the exact message string that `backend/src/export/compiler.py` (Task 7) substring-matches (`"kdp export profile requires a released book"`, lowercased) — verified both sides use the same phrase. `renderCoverJpeg`/`rasterizeToJpeg` signatures match between Task 1 (produces) and Task 6 (consumes). `rasterizeMath`/`rasterizeDiagramPngs`/`replaceMathWithImages` names and signatures in Task 4/5's Interfaces blocks match their Step-3 implementations exactly.

## Spec requirements not mapped to a task

None. Every delta (D1–D6) and the validation gate (V) has a task; the one explicitly-deferred item (author-capture in the mobile Book Editor) is the spec's own stated hedge ("may be a mobile-side change, outside `compiler/`"), not an omission from this plan's scope (P2-6 Scope A is the `compiler/`-centered export profile).
