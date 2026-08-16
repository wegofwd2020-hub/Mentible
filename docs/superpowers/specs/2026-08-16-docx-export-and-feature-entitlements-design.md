# P0-3 — Word/DOCX export + feature-axis Pro gate — Design

**Status:** Approved (brainstorming, 2026-08-16). Implements
[`PRIORITIZED_SHORTLIST.md`](../../competitive-analysis/PRIORITIZED_SHORTLIST.md) P0-3
("export the validated master → PDF / Word (Pro)"). Activates the feature-entitlement axis of
[ADR-031 D4](../../adr/ADR-031-operator-granted-managed-access.md) (proposed → built here for the
export capability).

## Context (verified against the code, not the shortlist)

The shortlist's "publish = copy text/MD only" line is **stale**. The real state:

- **EPUB + PDF export from a validated master already ships, Pro-gated, end-to-end.** The Trust
  Publish tab assembles validated versions into a canonical `book.json` and downloads a compiled
  EPUB/PDF:
  - Mobile: `mobile/app/trust/[projectId].tsx` `PublishPanel` (~`:1136`) → whole-book `assembleBook()`
    (`:1820`) / per-asset `onDownloadAsset` (`:1800`) → `mobile/src/lib/topicsToBook.ts` `topicsToBook()`
    maps each validated `DraftSection[]` → `LessonOutput.sections {heading, body_markdown}` + a synthesized
    **Sources** chapter → `mobile/src/lib/trackedExport.ts` `buildCompilePayload` → `exportBook(payload,
    {format, diagrams:true})` (`mobile/src/api/client.ts`).
  - Backend: `backend/src/export/router.py` `POST /export/jobs` (async, `:156`) → `export/tasks.py`
    `run_export` → `export/compiler.py` `compile_book(raw_book, fmt, diagrams)` (`:66`) spawns the Node
    compiler over stdin/stdout. Poll `GET /export/jobs/{id}` + download `…/artifact`.
- **The compiler** (`compiler/`, package `@studybuddyq/compiler`) takes a single `book.json` on stdin,
  writes an artifact to stdout. CLI `compiler/src/cli.ts` `--format epub|pdf|cover` (`:57-62`). EPUB =
  `epub.ts`, PDF = `pdfRender.ts` (**Vivliostyle** CSS-Paged-Media via `@vivliostyle/cli` subprocess, NOT
  puppeteer) with its own print stylesheet `pdf.ts` (`PDF_CSS`). Cover PNG = `coverRaster.ts`
  `renderCoverPng()` (puppeteer screenshot of a `#cover` div).
- **DOCX/Word does not exist anywhere.** No renderer, no npm lib, no backend `fmt="docx"`. `_FORMATS` /
  `_ASYNC_FORMATS` (`export/router.py:45-52,153`) accept only `epub|pdf|cover`. Only "coming soon" UI copy:
  `mobile/src/help-content/topics.ts:468`, `trust/[projectId].tsx:1129`.
- **No feature-axis entitlement exists.** Gating is one binary `is_pro(conn, account_id)`
  (`backend/src/billing/access.py:71-88`) = active `entitlement` row covering now **OR** staff allowlist
  (`eligibility.is_staff_allowlisted`). `Plan` (`billing/plans.py:19-26`) carries only `allowance_micros` +
  `managed_providers` + `window_days` — no capability flags. Export enforces `is_pro` at
  `export/router.py:85-96` (sync) and `:202-213` (async); false → `pro_required()` HTTP 402. `cover` is
  never gated; anonymous / no-DB demo passes through ungated.
- **The trust→book mapping is intentionally lean:** a validated master carries `{heading, body, source_ids}`
  per section + a synthesized Sources chapter; `level/synopsis/objectives/takeaways/further_reading` are
  emitted empty. This is the same shape a DOCX exporter consumes — **no mapping change in scope** (that is
  a separate, deferred improvement; see Out of scope).

## Decisions (brainstorming 2026-08-16)

1. **Scope = add Word/DOCX export + build the feature-entitlement axis** (ADR-031 D4). EPUB/PDF are already
   done; do not rebuild them.
2. **DOCX engine = the npm `docx` library**, building the document programmatically from `DraftSection`s.
   Prose stays **editable text**; **math and diagrams are embedded as PNG images** (KaTeX/Mermaid → SVG/HTML
   → PNG via a headless-Chromium rasterizer generalized from `coverRaster.ts`). No OMML, no pandoc.
3. **Feature axis = capability flags on `Plan`, all Pro plans get all three export flags at launch.** Both
   `managed_basic` and `managed_unlimited` carry `{export_epub, export_pdf, export_docx}`. No differentiation
   turned on now (YAGNI); the per-feature *mechanism* is what ships, ready for future "Word-yes/PDF-no" plans.
   **Backward-compat is non-negotiable:** switching the export gate from `is_pro` to per-feature must not
   remove EPUB/PDF from any currently-entitled user.

## Architecture — three isolated units

```
mobile PublishPanel ──"docx"──► POST /export/jobs ──► compiler CLI --format docx
   (enable Word row,            (feature-gated:            (NEW compileDocx:
    feature-aware wall)          has_feature)               book.json → .docx)
        ▲                            │
        └── GET /billing/plan-status ┘   (NEW: returns `features`)
```

Each unit is reachable only through an existing seam (the compiler CLI's stdin/stdout contract, the
`/export/jobs` HTTP job, the `plan-status` endpoint). No caller of the compiler changes; no new HTTP surface.

---

## Unit A — Compiler: DOCX renderer

**Files:**
- Create: `compiler/src/docx.ts` — `compileDocx(book: Book): Promise<Buffer>`.
- Create: `compiler/src/rasterize.ts` — shared `rasterizeToPng(input: {html?: string; svg?: string; width?: number}): Promise<Buffer>` (headless Chromium; generalizes the puppeteer path currently inside `coverRaster.ts`).
- Modify: `compiler/src/cli.ts` — dispatch `--format docx` → `compileDocx`.
- Modify: `compiler/package.json` — add `docx` to dependencies; `@vivliostyle/cli`-style runtime-optional convention for anything Chromium-dependent (puppeteer already present for cover).
- Refactor: `compiler/src/coverRaster.ts` — call the shared `rasterize.ts` instead of its private puppeteer block (no behavior change; one rasterizer).
- Test: `compiler/test/docx.test.ts` (or the repo's compiler test location/pattern).

**Interfaces:**
- Consumes: `Book` (`compiler/src/types.ts:155-163`) exactly as EPUB/PDF do — `toc.subjects[].units[]` +
  `content[topicId].lesson.sections[] {heading, body_markdown}` + synthesized Sources content.
- Produces: a `.docx` byte `Buffer` on stdout, identical delivery contract to `compileEpub`/`compilePdf`.

**Behavior:**
- Build with `docx`: `Document` → per subject/topic a `HeadingLevel` heading, each `LessonOutput.section`'s
  `body_markdown` parsed into paragraphs/runs. Support the markdown the drafts actually emit: headings,
  **bold**/*italic*, inline `code`, fenced code blocks, unordered/ordered lists, links (as text + href).
  Reuse an existing markdown parse if the compiler already has one (check `epub.ts`/`css.ts` render path);
  otherwise a small, tested inline+block tokenizer scoped to those constructs.
- **Math** (`$…$`, `$$…$$`): render via KaTeX to HTML, `rasterizeToPng({html})`, embed as `ImageRun`
  (inline for `$…$`, block-centered for `$$…$$`). **Diagrams** (` ```mermaid `): reuse the compiler's
  existing Mermaid→SVG step, `rasterizeToPng({svg})`, embed as a block `ImageRun`.
- **Failure isolation:** a rasterize error for one equation/diagram falls back to a fenced text run of the
  source (LaTeX/mermaid source), logged, **never fails the whole document**.
- **Sources chapter:** mirror `topicsToBook`'s synthesized Sources — a final "Sources" heading + a numbered
  list of cited sources. (The `book.json` the mobile bridge sends already contains this as a topic/section;
  confirm whether Sources arrives as content or must be re-synthesized in the compiler — if it arrives as a
  normal section, no special-casing is needed.)
- **Styling:** headings/body use the `STUDIO`/`BRAND` palette + type choices that `pdf.ts` already encodes,
  so DOCX reads as the same product (title, then body). No cover page, no paged TOC, no Quizzes/Answers
  sections (a validated trust master carries no quizzes — simpler than the PDF textbook layout).

**Runtime-optional dep convention:** `docx` is a normal committed dependency (pure JS, no native binary).
The **rasterizer** depends on puppeteer + Chromium, already the cover's convention — resolve dynamically,
throw a clean, specific error if absent, so DOCX degrades exactly like PDF/cover already do in a bare env.

---

## Unit B — Backend: feature entitlements + format wiring

**Files:**
- Modify: `backend/src/billing/plans.py` — `Plan` gains `features: frozenset[str]`; both named plans carry
  `frozenset({"export_epub","export_pdf","export_docx"})`.
- Modify: `backend/src/billing/access.py` — add `has_feature(conn, account_id, feature: str) -> bool`.
- Modify: `backend/src/billing/router.py` — `PlanStatusView` gains `features: list[str]`; `plan-status`
  populates it from the entitled plan (staff allowlist → all known export features).
- Modify: `backend/src/export/router.py` — `_FORMATS` + `_ASYNC_FORMATS` add `docx`; the two export gates
  switch `is_pro(...)` → `has_feature(..., f"export_{fmt}")`; `pro_required` → a `feature_required(feature)`
  402 that names the missing capability.
- Modify: `backend/src/export/compiler.py` — extend the allowed-format guard to include `docx` (the spawn
  is already format-generic; it passes `fmt` straight to the CLI).
- Test: `backend/tests/` — `has_feature` truth table; export docx 202/402; format guard.

**Interfaces:**
- `has_feature(conn, account_id, feature)`: `True` iff (an active entitlement row covering now whose `Plan`
  includes `feature`) OR `is_staff_allowlisted(account)`. Mirrors `is_pro`'s active-window + staff logic;
  `is_pro` stays for every non-export gate (unchanged).
- `PlanStatusView.features: list[str]` — the sorted capability flags the caller's plan grants (staff → the
  full export set). Anonymous / no-DB demo path is unchanged (export passes through ungated there, as today).

**Gate semantics:**
- Export of format `fmt` requires `has_feature(acct, "export_"+fmt)`. With all Pro plans carrying all three
  export flags, **every currently-entitled user keeps EPUB/PDF and gains DOCX** — the switch from `is_pro`
  is behavior-preserving for existing formats.
- `cover` stays ungated (`export/router.py:77-84`). The anonymous/no-DB demo passthrough is preserved.

---

## Unit C — Mobile: Word download + feature-aware walls

**Files:**
- Modify: `mobile/src/api/billingClient.ts` — `PlanStatus` gains `features: string[]` (default `[]`).
- Modify: `mobile/src/hooks/useBillingPlan.ts` — pass `features` through.
- Modify: `mobile/app/trust/[projectId].tsx` `PublishPanel` — replace the hardcoded disabled
  "PDF/Word — Pro, coming soon" row (`~:1129`) with real **Download Word** actions (per-asset + whole-book),
  calling `exportBook(payload, {format:"docx", diagrams:true})` — identical to the EPUB/PDF handlers
  (`onDownloadAsset :1800`, `onPublishDownload :1864`). Per-format wall: show a format's button iff
  `plan == null || plan.features.includes("export_"+fmt)`; else the existing upgrade wall. Fail-open
  preserved (unknown plan → allow; server 402 is the real gate).
- Modify: `mobile/src/help-content/topics.ts:468` — update copy (Word now ships).
- Test: `mobile/__tests__/…` — Word button renders when `features` includes `export_docx`, walled when not;
  docx handler calls `exportBook` with `{format:"docx"}`.

**Interfaces:**
- Consumes: `PlanStatus.features` from Unit B.
- Produces: no new public surface; reuses `exportBook`/`downloadArtifact`.

**Definition of Done (Help gate):** the Word feature must have a `FEATURES` key + a Help topic (or an
updated existing one) in the same PR, or `mobile/__tests__/help/coverage.test.ts` fails.

---

## Cross-cutting / global constraints

- **Backward-compat is the load-bearing invariant:** no currently-entitled user may lose EPUB/PDF when the
  export gate moves from `is_pro` to `has_feature`. Enforced by every Pro plan carrying all three export
  flags + a pytest asserting `has_feature(entitled_user, "export_pdf") is True` for both named plans.
- **No DB migration.** Features are code-defined on `Plan`; `entitlement` rows are untouched.
- **Backend rules:** `asyncpg`; no key/content in logs (the export path already streams book.json without
  logging it — unchanged); no RLS/tenant column; 70% coverage gate; mandatory no-key-in-logs test path
  untouched. `has_feature` is a pure read over the same tables `is_pro` reads.
- **Compiler:** the stdin→stdout, nothing-to-disk contract holds for `docx`; content never logged.
- **Mobile:** `useThemedStyles`; no color-literal test asserts; `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .` green. Compiler + backend + mobile all green in CI.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decomposition (SDD)

- **T1 — Compiler rasterizer refactor:** extract `rasterize.ts` from `coverRaster.ts`; cover still renders
  identically (regression test). No new feature yet — pure seam.
- **T2 — Compiler DOCX renderer:** `compileDocx` (prose + headings + lists + Sources) + `cli.ts` dispatch +
  `docx` dep. Math/diagram image embedding + failure fallback. Tests (unzip → structure asserts).
- **T3 — Backend feature axis:** `Plan.features` + both plans' flags + `has_feature` + `PlanStatusView.features`
  + `plan-status` population. Tests (truth table, backward-compat assert).
- **T4 — Backend export wiring:** `_FORMATS`/`_ASYNC_FORMATS` += docx; export gates → `has_feature`;
  `feature_required` 402; `compile_book` format guard. Tests (docx 202/402, unknown-format reject).
- **T5 — Mobile enablement:** `PlanStatus.features` + hook; PublishPanel Word buttons + per-format walls;
  Help copy/topic. Tests (render/wall/handler).

(T1→T2 ordered: T2 needs the shared rasterizer. T3→T4 ordered: T4 gates on T3's `has_feature`. T5 depends on
T3's `features` field + T4's docx format. T2 and T3 are independent and can interleave.)

## Rollout

Web deploy + APK (mobile) + a backend refresh that includes the compiler runtime image carrying the `docx`
npm dep. No DB migration, no data backfill. DOCX rasterization needs puppeteer + Chromium in the compiler
image (already required for cover). In any env missing those, DOCX errors cleanly — exactly as PDF/cover do
today.

## Out of scope

- **Richer trust→book mapping** (carrying objectives/takeaways/citations detail into exports) — a separate
  quality improvement affecting all formats; deferred.
- **OMML native equations / pandoc** — rejected in favor of image-embedded math.
- **Export differentiation between plans** (Word-yes/PDF-no) — the *mechanism* ships; no differentiated plan
  is turned on. Add a named plan later if wanted.
- **Self-serve purchase of Pro / the payment rail** — deferred by ADR-039 (services-led; operator-granted
  entitlements). "Pro" here means an operator-granted entitlement, as today.
- **MOBI, enhanced/media EPUB, KDP print-cover pipeline** — untouched.

## Open (non-blocking)

- Whether Sources arrives in the compiler's `book.json` as an ordinary section (then DOCX needs no special
  Sources-casing) or must be re-synthesized — resolved by reading `topicsToBook.ts` during T2.
- Markdown coverage: if the compiler already has a shared markdown→AST used by EPUB, reuse it for DOCX rather
  than a second parser — decided in T2 by inspecting `epub.ts`.
