# P0-3 — Word/DOCX export + feature-axis Pro gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `docx` output format to the artifact compiler and gate it (plus the existing EPUB/PDF) behind a new per-feature entitlement axis, so a Pro user can download a validated trust master as an editable Word document.

**Architecture:** Three isolated units behind existing seams. (1) The Node compiler gains `compileDocx(book)` built with the npm `docx` library — prose from `marked` tokens, math/diagrams rasterized to PNG via a shared `rasterizeToPng` helper extracted from `coverRaster.ts`. (2) The backend `Plan` gains a `features` set; a new `has_feature()` gate replaces the bare `is_pro` check on export, and `docx` joins the export format sets. (3) Mobile enables Word download buttons in the trust Publish panel, gated per-format by the plan's `features`.

**Tech Stack:** TypeScript (compiler, `docx` + `marked` + `marked-katex-extension` + puppeteer, jest); Python (FastAPI backend, asyncpg, pytest); React Native + Expo (jest + RNTL).

**Spec:** `docs/superpowers/specs/2026-08-16-docx-export-and-feature-entitlements-design.md`

## Global Constraints

- **Backward-compat is load-bearing:** switching the export gate from `is_pro` to `has_feature` must NOT remove EPUB/PDF from any currently-entitled user. Both named plans (`managed_basic`, `managed_unlimited`) carry ALL three export flags; a pytest asserts it.
- **Export feature flag naming (exact):** `export_epub`, `export_pdf`, `export_docx`. The gate for format `fmt` checks `has_feature(acct, "export_" + fmt)`.
- **No DB migration.** Features are code-defined on `Plan`; `entitlement` rows are untouched.
- **Backend:** `asyncpg`; no key/content in a log line, row, or traceback; no RLS / tenant column; 70% coverage gate; the mandatory no-key-in-logs test path stays green. `has_feature` is a pure read over the same tables `is_pro` reads.
- **Compiler:** the stdin→stdout, nothing-to-disk contract holds for `docx`; content never logged. Anything Chromium-dependent (the rasterizer) resolves puppeteer dynamically and throws a clean, specific error if absent — exactly as `coverRaster.ts`/`pdfRender.ts` already do.
- **Mobile:** `useThemedStyles`; no color-literal test asserts; `npx tsc --noEmit` + full `npx jest` + `npx eslint .` all green.
- **Definition of Done (Help gate):** the Word feature needs a `FEATURES` key + a Help topic (or updated existing topic) in the SAME task/PR, or `mobile/__tests__/help/coverage.test.ts` fails.
- **DOCX MIME type (exact):** `application/vnd.openxmlformats-officedocument.wordprocessingml.document`; file extension `docx`.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Compiler (`compiler/src/`):**
- Create `rasterize.ts` — shared headless-Chromium `rasterizeToPng`; the one PNG rasterizer.
- Create `docx.ts` — `compileDocx(book)`; the whole DOCX renderer.
- Modify `coverRaster.ts` — delegate to `rasterize.ts` (no behavior change).
- Modify `cli.ts` — dispatch `--format docx`.
- Modify `package.json` — add `docx` dependency.
- Tests: `compiler/__tests__/rasterize.test.ts`, `compiler/__tests__/docx.test.ts`.

**Backend (`backend/src/`):**
- Modify `billing/plans.py` — `Plan.features` + both plans' flags + `EXPORT_FEATURES`.
- Modify `billing/access.py` — `has_feature`, `account_features`.
- Modify `billing/quota.py` — `PlanStatus.features`, populate in `plan_status`; `feature_required`.
- Modify `accounts/schemas.py` — `PlanStatusView.features`.
- Modify `billing/router.py` — map `features` into `PlanStatusView`.
- Modify `export/router.py` — `_FORMATS`/`_ASYNC_FORMATS` += docx; export gates → `has_feature`.
- Modify `export/compiler.py` — docstring only (`fmt` now epub|pdf|docx; no functional guard here).
- Tests: `backend/tests/test_billing_features.py`, `backend/tests/test_export_docx_gate.py` (or the repo's existing export/billing test files if the reviewer prefers colocating).

**Mobile (`mobile/`):**
- Modify `src/storage/exportStatus.ts` — `ExportFormat` += `"docx"`.
- Modify `src/api/client.ts` — `ExportOptions.format` += `"docx"`; `submitExportJob` fmt union += `"docx"`.
- Modify `src/api/billingClient.ts` — `PlanStatus.features: string[]`.
- Modify `src/components/ExportStatusPills.tsx` — a "Word" label for docx.
- Modify `app/trust/[projectId].tsx` — `PublishPanel` Word buttons + per-format gate; handler fmt unions + docx MIME.
- Modify `src/help-content/features.ts` + `src/help-content/topics.ts` — Word export feature + topic.
- Tests: `mobile/__tests__/screens/TrustPublish.word.test.tsx` (or extend an existing PublishPanel test).

---

## Task 1: Shared Chromium rasterizer (`rasterize.ts`)

Extract the puppeteer screenshot machinery out of `coverRaster.ts` into a reusable helper, so the DOCX renderer (Task 2) can rasterize KaTeX HTML and Mermaid SVG to PNG through the same one path. Pure refactor — the cover must still render byte-for-behavior identically.

**Files:**
- Create: `compiler/src/rasterize.ts`
- Modify: `compiler/src/coverRaster.ts`
- Test: `compiler/__tests__/rasterize.test.ts`

**Interfaces:**
- Produces: `export async function rasterizeToPng(input: { html?: string; svg?: string; width?: number }): Promise<Buffer>` — renders `input.html` (a full HTML body) OR wraps `input.svg` in a minimal HTML shell, screenshots the first element (or the page), returns a PNG `Buffer`. Default `width` 420. Throws `"puppeteer is not installed …"` when puppeteer is absent (same message shape as today).
- Consumes (Task 2): the same function.

- [ ] **Step 1: Write the failing test**

`rasterize.ts` needs puppeteer (absent from committed deps), so the deterministic, CI-safe test asserts the **absent-puppeteer contract** (the same thing `coverRaster` relies on) — not a real screenshot.

```ts
// compiler/__tests__/rasterize.test.ts
import { rasterizeToPng } from "../src/rasterize";

it("throws a clear error when puppeteer is not installed", async () => {
  await expect(rasterizeToPng({ svg: "<svg/>" })).rejects.toThrow(/puppeteer is not installed/i);
});
```

- [ ] **Step 2: Run it — expect FAIL** (module not found / function undefined)

Run: `cd compiler && npx jest rasterize`
Expected: FAIL (cannot find `../src/rasterize`).

- [ ] **Step 3: Implement `rasterize.ts`**

Move the puppeteer launch + screenshot block verbatim out of `coverRaster.ts` and generalize the input. Keep the native dynamic-import shim, the `PUPPETEER_EXECUTABLE_PATH` / `SBQ_NO_SANDBOX` handling, and the interface types.

```ts
// compiler/src/rasterize.ts
// Rasterise HTML or an SVG fragment to a PNG via headless Chromium — the single
// screenshot path shared by the cover thumbnail (coverRaster.ts) and the DOCX
// renderer (docx.ts), so there is ONE puppeteer integration, not two.
const nativeImport = new Function("s", "return import(s)") as (s: string) => Promise<unknown>;

interface PuppeteerPage {
  setViewport(v: { width: number; height: number; deviceScaleFactor?: number }): Promise<void>;
  setContent(html: string): Promise<void>;
  $(sel: string): Promise<PuppeteerEl | null>;
  screenshot(opts: { type: "png"; omitBackground?: boolean }): Promise<Uint8Array>;
}
interface PuppeteerEl {
  screenshot(opts: { type: "png"; omitBackground?: boolean }): Promise<Uint8Array>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

async function launchBrowser(): Promise<PuppeteerBrowser> {
  let puppeteer: { launch: (opts: Record<string, unknown>) => Promise<PuppeteerBrowser> };
  try {
    const mod = (await nativeImport("puppeteer")) as { default?: typeof puppeteer };
    puppeteer = (mod.default ?? (mod as unknown)) as typeof puppeteer;
  } catch {
    throw new Error("puppeteer is not installed — cannot rasterise to PNG.");
  }
  const launch: Record<string, unknown> = { headless: true };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) launch.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  launch.args =
    process.env.SBQ_NO_SANDBOX === "1"
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
      : [];
  return puppeteer.launch(launch);
}

// Render `input.html` (a full body fragment) OR `input.svg` (wrapped in a shell)
// to a PNG Buffer at `width` px. Screenshots the #target element if present, else
// the page. Throws if puppeteer is unavailable.
export async function rasterizeToPng(input: {
  html?: string;
  svg?: string;
  width?: number;
}): Promise<Buffer> {
  const width = input.width ?? 420;
  const inner = input.html ?? `<div id="target">${input.svg ?? ""}</div>`;
  const html =
    `<!DOCTYPE html><html><body style="margin:0">` +
    `<div id="target" style="display:inline-block;max-width:${width}px">` +
    `<style>#target svg{max-width:${width}px;height:auto;display:block}</style>${inner}</div>` +
    `</body></html>`;

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 100, deviceScaleFactor: 2 });
    await page.setContent(html);
    const el = await page.$("#target");
    const buf = el
      ? await el.screenshot({ type: "png", omitBackground: true })
      : await page.screenshot({ type: "png", omitBackground: true });
    return Buffer.from(buf);
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Refactor `coverRaster.ts` to delegate**

Replace the private puppeteer block in `renderCoverPng` with a call to `rasterizeToPng`. The cover is a full SVG at a fixed aspect — pass it as `svg` and keep the 420 default; the `#cover`→`#target` rename is internal. Keep `renderCoverPng`'s exported signature `(svg: string, width = 420) => Promise<Buffer>` unchanged (its callers in `cli.ts` and the backend are untouched).

```ts
// compiler/src/coverRaster.ts  (body becomes a thin wrapper)
import { rasterizeToPng } from "./rasterize";

export async function renderCoverPng(svg: string, width = 420): Promise<Buffer> {
  return rasterizeToPng({ svg, width });
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd compiler && npx jest rasterize cover`
Expected: PASS (`rasterize.test.ts` + the existing `cover.test.ts` still green — the cover refactor changed no behavior). Then `npx tsc --noEmit` in `compiler/`.

- [ ] **Step 6: Commit**

```bash
git add compiler/src/rasterize.ts compiler/src/coverRaster.ts compiler/__tests__/rasterize.test.ts
git commit -m "refactor(compiler): extract shared rasterizeToPng from coverRaster

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: DOCX renderer (`compileDocx`) + CLI dispatch

Build the `.docx` from a `Book` with the npm `docx` library: prose parsed from `marked` tokens into paragraphs/runs, math and Mermaid diagrams rasterized to embedded PNG images, each rasterize failure isolated to a text fallback. Sources needs no special handling — `topicsToBook` already emits it as an ordinary topic (verified in `mobile/src/lib/topicsToBook.ts`), so the renderer just walks every topic's `lesson.sections`.

**Files:**
- Create: `compiler/src/docx.ts`
- Modify: `compiler/src/cli.ts`
- Modify: `compiler/package.json` (add `docx` to `dependencies`)
- Test: `compiler/__tests__/docx.test.ts`

**Interfaces:**
- Consumes: `Book` (`compiler/src/types.ts` — `toc.subjects[].units[]`, `content[topicId].lesson.sections[] {heading, body_markdown}`), `rasterizeToPng` (Task 1).
- Produces: `export async function compileDocx(book: Book): Promise<Buffer>` — a valid `.docx` (OOXML zip). Dispatched from `cli.ts` on `--format docx`.

- [ ] **Step 1: Add the `docx` dependency**

```bash
cd compiler && npm install docx@^9
```
Confirm `compiler/package.json` `dependencies` now lists `docx`. (`docx` is pure JS — a committed dep, unlike puppeteer/vivliostyle.)

- [ ] **Step 2: Write the failing test**

The test compiles a tiny book (no math/diagrams, so no puppeteer needed → CI-safe) and asserts the output is a real .docx carrying the prose. A `.docx` is a zip; assert the zip signature + that `word/document.xml` contains the heading and body text.

```ts
// compiler/__tests__/docx.test.ts
import { compileDocx } from "../src/docx";
import type { Book } from "../src/types";
import JSZip from "jszip"; // already a compiler dep (used by epub); confirm in package.json

const book: Book = {
  id: "b1", title: "Reading Music", createdAt: "", updatedAt: "",
  toc: { subjects: [{ subject_label: "Basics", units: [{ id: "t1", title: "The Staff", subtopics: [], prerequisites: [] }] }] },
  content: {
    t1: {
      topicId: "t1", title: "The Staff", generatedAt: "",
      lesson: {
        topic: "The Staff", level: "", language: "en", synopsis: "",
        learning_objectives: [], key_takeaways: [], further_reading: [],
        sections: [{ heading: "Lines", body_markdown: "The staff has **five** lines." }],
      },
    },
  },
};

it("produces a valid .docx containing the heading and prose", async () => {
  const buf = await compileDocx(book);
  expect(buf.subarray(0, 2).toString("latin1")).toBe("PK"); // zip magic
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("The Staff"); // topic heading
  expect(xml).toContain("Lines");     // section heading
  expect(xml).toContain("five");      // bold run text
});

it("does not throw on a section with math (falls back without puppeteer)", async () => {
  const withMath: Book = structuredClone(book);
  withMath.content!.t1.lesson.sections = [{ heading: "Eq", body_markdown: "Energy $E=mc^2$ is famous." }];
  const buf = await compileDocx(withMath); // puppeteer absent → math falls back to text, whole doc still compiles
  const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string");
  expect(xml).toContain("famous");
});
```

(If `JSZip` is not already a compiler dependency, use the same zip-reading approach `epub.test.ts` uses — check that test first and mirror it.)

- [ ] **Step 3: Run it — expect FAIL** (`compileDocx` undefined)

Run: `cd compiler && npx jest docx`

- [ ] **Step 4: Implement `docx.ts`**

Walk the TOC in reading order; for each topic emit a heading then its sections. Parse each `body_markdown` with `marked`'s lexer (same engine `markdown.ts` uses) into block tokens, map each to `docx` paragraphs/runs. Register `marked-katex-extension` so `$…$`/`$$…$$` surface as katex tokens carrying the raw TeX; render those (and ```mermaid fences) to PNG via `rasterizeToPng`, wrapped in try/catch that falls back to a monospace text run of the source. Never let one bad token fail the document.

```ts
// compiler/src/docx.ts
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } from "docx";
import { Marked, type Token, type Tokens } from "marked";
import markedKatex from "marked-katex-extension";
import { rasterizeToPng } from "./rasterize";
import { PuppeteerMermaidRenderer } from "./mermaid";
import type { Book, GeneratedTopic } from "./types";

// KaTeX HTML → PNG. Renders the expression in a KaTeX-styled shell and
// screenshots it. `katex` is already a compiler dep (see markdown.ts).
async function mathPng(tex: string, display: boolean): Promise<Buffer | null> {
  try {
    const katex = (await import("katex")).default;
    const html = katex.renderToString(tex, { throwOnError: false, displayMode: display, output: "html" });
    // KaTeX needs its stylesheet; inline the minimal metrics via the katex css.
    const css = (await import("katex/dist/katex.min.css")).default ?? "";
    return await rasterizeToPng({ html: `<style>${css}</style><span class="katex-shell">${html}</span>`, width: display ? 480 : 240 });
  } catch {
    return null;
  }
}

async function mermaidPng(source: string): Promise<Buffer | null> {
  try {
    const map = await new PuppeteerMermaidRenderer().renderAll([source]);
    const svg = map.get(source);
    if (!svg) return null;
    return await rasterizeToPng({ svg, width: 560 });
  } catch {
    return null;
  }
}

function runsFromInline(tokens: Token[] | undefined, text: string): TextRun[] {
  // Minimal inline mapping: bold/italic/code/plain. `tokens` is marked's inline
  // token array for a paragraph; fall back to a plain run of `text`.
  if (!tokens) return [new TextRun(text)];
  const out: TextRun[] = [];
  const walk = (t: Token, bold = false, italics = false): void => {
    switch (t.type) {
      case "strong": (t as Tokens.Strong).tokens.forEach((c) => walk(c, true, italics)); break;
      case "em": (t as Tokens.Em).tokens.forEach((c) => walk(c, bold, true)); break;
      case "codespan": out.push(new TextRun({ text: (t as Tokens.Codespan).text, font: "Courier New", bold, italics })); break;
      case "link": (t as Tokens.Link).tokens.forEach((c) => walk(c, bold, italics)); break;
      default: {
        const raw = (t as { text?: string }).text ?? "";
        if (raw) out.push(new TextRun({ text: raw, bold, italics }));
      }
    }
  };
  tokens.forEach((t) => walk(t));
  return out.length ? out : [new TextRun(text)];
}

async function blocksFromMarkdown(md: string): Promise<Paragraph[]> {
  const m = new Marked();
  m.use(markedKatex({ throwOnError: false, strict: false, output: "mathml" }));
  const tokens = m.lexer(md);
  const paras: Paragraph[] = [];

  const imageParagraph = async (
    png: Buffer | null,
    fallback: string,
  ): Promise<Paragraph> =>
    png
      ? new Paragraph({ children: [new ImageRun({ data: png, transformation: { width: 300, height: 120 } })] })
      : new Paragraph({ children: [new TextRun({ text: fallback, font: "Courier New" })] });

  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        paras.push(new Paragraph({ text: (t as Tokens.Heading).text, heading: HeadingLevel.HEADING_3 }));
        break;
      case "paragraph":
        paras.push(new Paragraph({ children: runsFromInline((t as Tokens.Paragraph).tokens, (t as Tokens.Paragraph).text) }));
        break;
      case "list":
        for (const item of (t as Tokens.List).items) {
          paras.push(new Paragraph({ children: runsFromInline(item.tokens, item.text), bullet: { level: 0 } }));
        }
        break;
      case "code": {
        const lang = ((t as Tokens.Code).lang ?? "").trim().split(/\s+/)[0];
        if (lang === "mermaid") paras.push(await imageParagraph(await mermaidPng((t as Tokens.Code).text), "[diagram]"));
        else paras.push(new Paragraph({ children: [new TextRun({ text: (t as Tokens.Code).text, font: "Courier New" })] }));
        break;
      }
      case "blockKatex":
        paras.push(await imageParagraph(await mathPng((t as { text: string }).text, true), `$$${(t as { text: string }).text}$$`));
        break;
      default:
        // inlineKatex arrives inside a paragraph's tokens; plain text/space/hr → skip or plain run.
        if ((t as { text?: string }).text) paras.push(new Paragraph({ children: [new TextRun((t as { text: string }).text)] }));
    }
  }
  return paras;
}

export async function compileDocx(book: Book): Promise<Buffer> {
  const children: Paragraph[] = [new Paragraph({ text: book.title, heading: HeadingLevel.TITLE })];
  for (const subject of book.toc.subjects) {
    for (const unit of subject.units) {
      const topic: GeneratedTopic | undefined = book.content?.[unit.id ?? ""];
      if (!topic) continue;
      children.push(new Paragraph({ text: topic.title, heading: HeadingLevel.HEADING_1 }));
      for (const s of topic.lesson.sections) {
        if (s.heading) children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_2 }));
        children.push(...(await blocksFromMarkdown(s.body_markdown)));
      }
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
```

> Note for the implementer: `marked-katex-extension`'s inline token type name (`inlineKatex`) and how inline math surfaces inside a `paragraph`'s `tokens` should be confirmed against the installed `marked-katex-extension` version — the `runsFromInline` `default` branch already renders unknown inline tokens as their `.text`, so inline math degrades to its rendered/again-source text safely even if not specially imaged. Image sizing (`transformation`) is illustrative; keep images reasonable (≤ page width). If `katex/dist/katex.min.css` cannot be imported as a string under ts-jest, inline a minimal KaTeX style or omit it (the screenshot still renders the HTML math markup) — do not let styling block the build.

- [ ] **Step 5: Dispatch `--format docx` in `cli.ts`**

Add `docx` to the `Format` union and the parse + dispatch. The `--format` parser currently collapses unknowns to `epub`; add a `docx` arm.

```ts
// cli.ts — type
type Format = "epub" | "pdf" | "cover" | "docx";
// cli.ts — parseArgs --format arm
format = f === "pdf" ? "pdf" : f === "cover" ? "cover" : f === "docx" ? "docx" : "epub";
// cli.ts — import
import { compileDocx } from "./docx";
// cli.ts — dispatch (extend the ternary chain)
const out =
  format === "pdf" ? await compilePdf(book, mermaidOpt)
  : format === "cover" ? await renderCoverPng(buildCoverSvgFile(coverInputForBook(book)))
  : format === "docx" ? await compileDocx(book)
  : await compileEpub(book, mermaidOpt);
```

- [ ] **Step 6: Run tests — expect PASS**

Run: `cd compiler && npx jest docx && npx tsc --noEmit`
Expected: PASS. Then the full compiler suite: `npx jest`.

- [ ] **Step 7: Commit**

```bash
git add compiler/src/docx.ts compiler/src/cli.ts compiler/package.json compiler/package-lock.json compiler/__tests__/docx.test.ts
git commit -m "feat(compiler): add DOCX/Word output format (compileDocx)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend feature axis (`Plan.features`, `has_feature`, plan-status)

Add capability flags to `Plan`, a `has_feature` gate mirroring `is_pro`'s active-window + staff logic, and surface the caller's features through `/billing/plan-status`. No behavior change to any gate yet — that is Task 4.

**Files:**
- Modify: `backend/src/billing/plans.py`
- Modify: `backend/src/billing/access.py`
- Modify: `backend/src/billing/quota.py`
- Modify: `backend/src/accounts/schemas.py`
- Modify: `backend/src/billing/router.py`
- Test: `backend/tests/test_billing_features.py`

**Interfaces:**
- Produces:
  - `Plan.features: frozenset[str]` (`plans.py`); `EXPORT_FEATURES = frozenset({"export_epub","export_pdf","export_docx"})`.
  - `async def has_feature(conn, *, account_id: UUID, feature: str) -> bool` (`access.py`).
  - `async def account_features(conn, *, account_id: UUID) -> frozenset[str]` (`access.py`).
  - `PlanStatus.features: tuple[str, ...]` (`quota.py`); `PlanStatusView.features: list[str]` (`accounts/schemas.py`).
  - `def feature_required(feature: str) -> HTTPException` (`quota.py`).
- Consumes (Task 4): `has_feature`, `feature_required`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_billing_features.py
from backend.src.billing import plans
from backend.src.billing.plans import EXPORT_FEATURES

def test_all_named_plans_grant_every_export_feature():
    # Backward-compat invariant: switching the export gate from is_pro to
    # has_feature must not strip EPUB/PDF from any entitled user.
    for pid in plans.plan_ids():
        plan = plans.get_plan(pid)
        assert EXPORT_FEATURES <= plan.features, f"{pid} missing export features"
```

Add an `access.has_feature` test against a fake/entitled account using the repo's existing billing test fixtures (mirror an existing `is_pro` test in `backend/tests/`): entitled account with a plan carrying `export_docx` → `has_feature(..., "export_docx") is True`; a feature the plan lacks → `False`; staff-allowlisted account → `True` for every `EXPORT_FEATURES` member. Reuse whatever DB/fixture harness the nearest existing billing test uses; do not invent a new one.

- [ ] **Step 2: Run it — expect FAIL** (`EXPORT_FEATURES` / `has_feature` undefined)

Run: `cd backend && pytest tests/test_billing_features.py -v`

- [ ] **Step 3: Implement `plans.py`**

```python
# plans.py — module constant
EXPORT_FEATURES = frozenset({"export_epub", "export_pdf", "export_docx"})

# plans.py — dataclass field (add to Plan)
@dataclass(frozen=True)
class Plan:
    id: str
    display: str
    allowance_micros: int
    managed_providers: frozenset[str]
    window_days: int
    features: frozenset[str]  # capability flags this plan grants (e.g. export_*)

# plans.py — both plans gain features=EXPORT_FEATURES
#   managed_basic(...,  features=EXPORT_FEATURES)
#   managed_unlimited(..., features=EXPORT_FEATURES)
```

- [ ] **Step 4: Implement `access.py`**

```python
# access.py — add near is_pro; imports plans, EXPORT_FEATURES already available via plans
async def account_features(conn: asyncpg.Connection, *, account_id: UUID) -> frozenset[str]:
    """The capability flags this account holds: its active plan's features, OR the
    full export set for a staff-allowlisted account, else empty."""
    now = datetime.now(UTC)
    ent = await entitlement_repo.get_entitlement(conn, account_id=account_id)
    if ent is not None and ent.status == "active" and ent.period_start <= now < ent.period_end:
        plan = plans.get_plan(ent.plan_id)
        if plan is not None:
            return plan.features
    account = await accounts_repo.get_account_by_id(conn, account_id=account_id)
    if account is not None and is_staff_allowlisted(sub=account.idp_sub, email=account.email):
        return plans.EXPORT_FEATURES
    return frozenset()

async def has_feature(conn: asyncpg.Connection, *, account_id: UUID, feature: str) -> bool:
    """True iff the account's active plan (or the staff allowlist) grants `feature`."""
    return feature in await account_features(conn, account_id=account_id)
```

- [ ] **Step 5: Implement `quota.py` — `PlanStatus.features`, `feature_required`, populate**

```python
# quota.py — import
from backend.src.billing.access import is_pro, account_features

# quota.py — feature_required helper (beside pro_required)
def feature_required(feature: str) -> HTTPException:
    """A 402 for a capability the caller's plan does not grant (T-P0-3). Names the
    missing feature so the client can show the right upsell."""
    return HTTPException(status_code=402, detail=f"This export format needs Pro ({feature}). Upgrade to Pro to download.")

# quota.py — PlanStatus gains features
@dataclass(frozen=True)
class PlanStatus:
    is_pro: bool
    max_projects: int
    max_generations: int
    gen_window_days: int
    projects: int
    generations: int
    at_project_cap: bool
    at_generation_cap: bool
    features: tuple[str, ...]

# quota.py — plan_status(): fetch + include
    feats = await account_features(conn, account_id=account_id)
    return PlanStatus(
        ...,
        features=tuple(sorted(feats)),
    )
```

- [ ] **Step 6: Implement `accounts/schemas.py` + `billing/router.py`**

```python
# accounts/schemas.py — PlanStatusView gains features
class PlanStatusView(BaseModel):
    is_pro: bool
    caps: PlanCapsView
    usage: PlanUsageView
    at_project_cap: bool
    at_generation_cap: bool
    features: list[str] = []

# billing/router.py — get_plan_status: map it through
    return PlanStatusView(
        is_pro=ps.is_pro,
        caps={...},
        usage={...},
        at_project_cap=ps.at_project_cap,
        at_generation_cap=ps.at_generation_cap,
        features=list(ps.features),
    )
```

- [ ] **Step 7: Run tests — expect PASS**

Run: `cd backend && pytest tests/test_billing_features.py -v` then the billing/quota suites (`pytest tests/ -k "billing or quota or plan"`). Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/billing/plans.py backend/src/billing/access.py backend/src/billing/quota.py backend/src/accounts/schemas.py backend/src/billing/router.py backend/tests/test_billing_features.py
git commit -m "feat(billing): add per-feature entitlement axis (Plan.features, has_feature)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Backend export wiring (docx format + per-feature gate)

Add `docx` to the export format sets and switch the two export Pro-walls from bare `is_pro` to `has_feature(acct, "export_"+fmt)`. Because every Pro plan carries all three export flags (Task 3), existing EPUB/PDF behavior is preserved for entitled users; Word rides the same rails.

**Files:**
- Modify: `backend/src/export/router.py`
- Modify: `backend/src/export/compiler.py` (docstring only)
- Test: `backend/tests/test_export_docx_gate.py`

**Interfaces:**
- Consumes: `has_feature`, `feature_required` (Task 3).

- [ ] **Step 1: Write the failing test**

Mirror the nearest existing export-gate test (`backend/tests/` — find the one covering the epub/pdf 402). Assert: (a) `docx` is an accepted async format (an entitled caller gets 202, not 422); (b) a non-entitled authenticated caller gets 402 on docx; (c) an unknown format still 422; (d) `cover` stays ungated. Reuse the existing export test's app/fixture harness.

```python
# backend/tests/test_export_docx_gate.py  (shape — adapt to the existing export-test fixtures)
async def test_docx_submit_202_for_entitled(client, entitled_headers, tiny_book_bytes):
    r = await client.post("/api/v1/export/jobs?format=docx", content=tiny_book_bytes, headers=entitled_headers)
    assert r.status_code == 202

async def test_docx_submit_402_for_free(client, free_headers, tiny_book_bytes):
    r = await client.post("/api/v1/export/jobs?format=docx", content=tiny_book_bytes, headers=free_headers)
    assert r.status_code == 402

async def test_unknown_format_still_422(client, entitled_headers, tiny_book_bytes):
    r = await client.post("/api/v1/export/jobs?format=rtf", content=tiny_book_bytes, headers=entitled_headers)
    assert r.status_code == 422
```

- [ ] **Step 2: Run it — expect FAIL** (docx → 422 today)

Run: `cd backend && pytest tests/test_export_docx_gate.py -v`

- [ ] **Step 3: Implement `export/router.py`**

```python
# import
from backend.src.billing.access import has_feature
from backend.src.billing.quota import feature_required  # replaces pro_required for export gates

# _FORMATS — add docx
_FORMATS = {
    "epub": ("application/epub+zip", "epub"),
    "pdf": ("application/pdf", "pdf"),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx"),
    "cover": ("image/png", "png"),
}

# _ASYNC_FORMATS — add docx; update the 422 message
_ASYNC_FORMATS = {"epub", "pdf", "docx"}
#   ... "format must be 'epub', 'pdf' or 'docx'." in the 422 body of submit_export

# sync /export gate — was `if fmt in ("epub", "pdf") and principal is not None`
if fmt != "cover" and principal is not None:
    pool = getattr(request.app.state, "db", None)
    if pool is not None:
        async with pool.acquire() as conn:
            account = await accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
            if not await has_feature(conn, account_id=account.id, feature=f"export_{fmt}"):
                raise feature_required(f"export_{fmt}")

# async submit_export gate — was is_pro → has_feature(..., f"export_{fmt}")
if principal is not None:
    pool = getattr(request.app.state, "db", None)
    if pool is not None:
        async with pool.acquire() as conn:
            account = await accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
            if not await has_feature(conn, account_id=account.id, feature=f"export_{fmt}"):
                raise feature_required(f"export_{fmt}")
```

Also extend the trust-manifest attach guard from `if fmt in ("epub", "pdf")` to include `docx` (a Word doc is a content artifact deserving the manifest header), i.e. `if fmt != "cover"`.

- [ ] **Step 4: Update `export/compiler.py` docstring**

Change the `fmt: "epub" | "pdf".` docstring line to `fmt: "epub" | "pdf" | "docx".`. No functional change — `fmt` is already passed straight through to the compiler argv.

- [ ] **Step 5: Run tests — expect PASS**

Run: `cd backend && pytest tests/test_export_docx_gate.py tests/test_billing_features.py -v` then the export suite (`pytest tests/ -k export`). Confirm the no-key-in-logs mandatory test still passes (`pytest tests/ -k "log or redact"`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/export/router.py backend/src/export/compiler.py backend/tests/test_export_docx_gate.py
git commit -m "feat(export): accept docx and gate export per-feature (has_feature)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Mobile Word download + per-format walls + Help

Widen the mobile export type to `docx`, thread the plan's `features` to the Publish panel, add Word download buttons gated per-format, and satisfy the Help Definition-of-Done gate.

**Files:**
- Modify: `mobile/src/storage/exportStatus.ts`, `mobile/src/api/client.ts`, `mobile/src/api/billingClient.ts`, `mobile/src/components/ExportStatusPills.tsx`, `mobile/app/trust/[projectId].tsx`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`
- Test: `mobile/__tests__/screens/TrustPublish.word.test.tsx`

**Interfaces:**
- Consumes: `PlanStatus.features` (Task 3 backend); `format:"docx"` on `/export/jobs` (Task 4).

- [ ] **Step 1: Widen the export type + client unions**

```ts
// src/storage/exportStatus.ts
export type ExportFormat = "epub" | "pdf" | "docx";

// src/api/client.ts — ExportOptions.format and submitExportJob fmt
format?: "epub" | "pdf" | "cover" | "docx";
// submitExportJob signature:
async function submitExportJob(book: Book, format: "epub" | "pdf" | "docx", diagrams: boolean): Promise<string>
```

`exportBook` needs no logic change (docx ≠ cover → it takes the async job path automatically).

- [ ] **Step 2: `PlanStatus.features` + ExportStatusPills label**

```ts
// src/api/billingClient.ts
export interface PlanStatus {
  is_pro: boolean;
  caps: PlanCaps;
  usage: PlanUsage;
  at_project_cap: boolean;
  at_generation_cap: boolean;
  features: string[];
}
```

In `ExportStatusPills.tsx`, wherever a format maps to a display label, add `docx → "Word"` (mirror the existing epub/pdf label map). Run `npx tsc --noEmit` to surface every place the widened `ExportFormat` must be handled and fix each (exhaustive switches, label maps).

- [ ] **Step 3: Write the failing test**

```tsx
// mobile/__tests__/screens/TrustPublish.word.test.tsx  (shape — mirror an existing PublishPanel test's mocks)
// Assert: with plan.features including "export_docx", a "Download Word" button renders;
// with is_pro=false / features=[], the upgrade wall shows and no Word button;
// pressing Download Word calls exportBook/trackedExport with format "docx".
```

Mirror whatever an existing trust Publish test does for the EPUB/PDF buttons (mocks for `useBillingPlan`/`plan`, `exportBook`); assert the `docx` accessibility label ("Download book as Word") renders when entitled and is absent when walled.

- [ ] **Step 4: Add Word buttons + per-format gate in `PublishPanel`**

Introduce a per-format helper and add a Word button beside EPUB/PDF in BOTH the whole-book block and the per-asset long-form block. Widen the handler prop unions to include `"docx"`.

```ts
// helper (module scope in [projectId].tsx or a small util)
function canExport(plan: PlanStatus | null, fmt: "epub" | "pdf" | "docx"): boolean {
  // fail-open: unknown plan (signed out / loading / fetch failed) → allow; server 402 is the real gate.
  return plan == null || plan.features?.includes(`export_${fmt}`) === true;
}

// PublishPanel prop types widen:
onDownloadAsset: (versionId: string, title: string, fmt: "epub" | "pdf" | "docx") => void;
onPublishDownload: (fmt: "epub" | "pdf" | "docx") => void;

// In the non-walled branch of BOTH blocks, after the PDF button, add (guarded):
{canExport(plan, "docx") ? (
  <Button
    variant="primary"
    label="Download Word"
    onPress={() => onPublishDownload("docx")}          /* per-asset: onDownloadAsset(version.id, title, "docx") */
    busy={pubBusy === "book:docx"}                       /* per-asset: `${version.id}:docx` */
    disabled={!bookValidated || pubBusy !== null}        /* per-asset: pubBusy !== null */
    accessibilityLabel="Download book as Word"           /* per-asset: `Download ${title} as Word` */
  />
) : null}
```

Keep the existing `walled` upgrade-CTA behavior (Free users see "Upgrade to Pro to download" for the whole group — unchanged). Replace the stale short-form note `PDF & Word — Pro (coming soon)` (line ~1341) with `PDF & Word available on book & guide assets` (short social assets remain copy-only — they have no file export). Update the `PublishPanel` header comment that still says PDF/Word is a disabled "coming soon" row.

- [ ] **Step 5: Widen the handlers + docx MIME**

```ts
// onDownloadAsset + onPublishDownload: widen fmt param to "epub" | "pdf" | "docx"
// Replace the mime ternary with a map:
const EXPORT_MIME: Record<"epub" | "pdf" | "docx", string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
// download call:
await downloadArtifact(res.artifact, `${slug(title)}.${fmt}`, EXPORT_MIME[fmt]);
```

`trackedExport(book, fmt, { diagrams: true })` now accepts `docx` (via the widened `ExportFormat`); no other handler change.

- [ ] **Step 6: Help Definition-of-Done**

Add a `FEATURES` key (e.g. `word-export`) in `mobile/src/help-content/features.ts` and a Help topic in `mobile/src/help-content/topics.ts` with that `featureKey` explaining Word export is a Pro download of a validated master. Update the existing copy at `topics.ts:468` ("PDF and Word export are coming as a Pro option.") to state Word now ships for Pro. This keeps `mobile/__tests__/help/coverage.test.ts` green.

- [ ] **Step 7: Run the gates**

Run: `cd mobile && npx tsc --noEmit && npx jest && npx eslint .`
Expected: all green (incl. `help/coverage.test.ts` and the new Word test).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/storage/exportStatus.ts mobile/src/api/client.ts mobile/src/api/billingClient.ts mobile/src/components/ExportStatusPills.tsx "mobile/app/trust/[projectId].tsx" mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/__tests__/screens/TrustPublish.word.test.tsx
git commit -m "feat(trust): download a validated master as Word (Pro, per-feature gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Unit A (compiler DOCX) → Tasks 1 (rasterizer) + 2 (compileDocx + CLI). ✓
- Unit B (backend feature axis + format wiring) → Tasks 3 (axis) + 4 (wiring). ✓
- Unit C (mobile) → Task 5. ✓
- Backward-compat invariant → Task 3 Step 1 test + all-plans-carry-all-flags. ✓
- Math/diagrams as PNG + failure fallback → Task 2 `mathPng`/`mermaidPng` + try/catch → text run; Task 2 Step 2 second test asserts no-throw without puppeteer. ✓
- Sources handling → verified as an ordinary topic (`topicsToBook`); no special-casing (spec open-item resolved). ✓
- Help DoD gate → Task 5 Step 6. ✓
- No DB migration → nothing in the plan adds one. ✓

**Placeholder scan:** No "TBD"/"handle errors"; every code step has concrete code. Two implementer notes (marked-katex inline token name; the existing export-test fixture harness) point at exact things to confirm against installed versions rather than leaving logic unspecified — acceptable, and the fallbacks are defined so the build is safe either way.

**Type consistency:** `has_feature(conn, *, account_id, feature)` and `account_features(conn, *, account_id)` used identically in Tasks 3/4. `PlanStatus.features: tuple[str,...]` (backend dataclass) → `PlanStatusView.features: list[str]` → mobile `PlanStatus.features: string[]` — consistent. `ExportFormat = "epub"|"pdf"|"docx"` and the `"export_"+fmt` flag convention line up across Tasks 3/4/5. `_FORMATS` docx tuple MIME matches `EXPORT_MIME.docx` and the spec's exact MIME constant.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-16-docx-export-and-feature-entitlements.md`.

Recommended: **Subagent-Driven** (fresh subagent per task + task review + final whole-branch review), matching how P0-2 shipped. Order T1→T2→T3→T4→T5 (T1 gates T2; T3 gates T4; T5 depends on T3's field + T4's format).
