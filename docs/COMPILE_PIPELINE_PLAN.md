# Compile pipeline — foundation plan

Implements the first phasing item of **ADR-004** / **`docs/ARTIFACT_PIPELINE.md`**:
turn the canonical `book.json` into a **self-contained, CDN-free EPUB3**. This doc
is the build plan; ADR-004 is the *why*, ARTIFACT_PIPELINE is the *flow*.

## Goal & definition of done

Foundation = the shared, deterministic compile core: **`book.json` → CDN-free XHTML
→ a valid EPUB3.** Done when:

1. A command takes our canonical `book.json` and emits an `.epub`.
2. It **passes `epubcheck`** (the official EPUB3 validator).
3. It **opens in a standard reader** (Apple Books / foliate / Thorium) and shows
   lesson + tutorial + quizzes **with networking OFF** — maths visible (MathML),
   at least one diagram visible (SVG), zero CDN requests.
4. Content **matches the in-app preview** (same source, same structure).
5. Quizzes render as a **static answer key** (the interactive layer is a later
   phase — ADR-004 phasing 3, not this foundation).

## Runtime decision — TypeScript/Node core (locked)

The compiler does three transforms; one is constrained:

| Transform | Choice |
|---|---|
| Markdown → XHTML | `marked` (same as today) |
| LaTeX → **MathML** | KaTeX `renderToString` — the exact engine used at authoring, bundled (no CDN) |
| Mermaid → **SVG** | `@mermaid-js/mermaid-cli` (Node + headless Chromium) |

**Mermaid is browser-only, so Node + headless Chromium is required regardless of
host language.** Given that, a TS/Node core wins: it renders KaTeX→MathML and
Mermaid→SVG natively, and lets us **extract one shared render module from
`mobile/src/components/contentHtml.ts`** used by *both* the in-app preview and the
compiler — a single source of rendering truth (ADR-004 D3). The Python FastAPI
backend shells out to a `compile-epub` CLI (milestone 5).

(Considered and rejected for the core: a Python compiler — it would re-implement
the lesson/quiz assembly that already exists in `contentHtml.ts` (drift risk) and
*still* need a Node+Chromium subprocess for Mermaid.)

## Structure

```
compiler/                         ← new top-level TS package (server-side; NOT in the Expo bundle)
  package.json
  src/
    types.ts                      ← Book / GeneratedTopic — contract shared with mobile/src/types/book.ts
    renderCore.ts                 ← extracted from contentHtml.ts: renderLesson/Tutorial/Quizzes/Experiment
    math.ts                       ← KaTeX → MathML (no CDN)
    diagrams.ts                   ← DiagramRenderer interface; mermaid-cli impl (milestone 4)
    css.ts                        ← shared stylesheet (lifted from contentHtml.ts)
    epub.ts                       ← mimetype + container.xml + OPF manifest + nav.xhtml + chapters + assets
    cli.ts                        ← compile-epub book.json -o out.epub
  __tests__/                      ← jest: per-renderer + full-book → epubcheck
scripts/
  epubcheck.sh                    ← official validator for CI/dev
backend/src/export/{router,tasks,schemas}.py   ← milestone 5: POST /api/v1/export (mirrors /structure)
backend/tests/test_export.py
```

## Milestones (each independently shippable)

| # | Milestone | Heavy dep? | Output |
|---|---|---|---|
| 1 | **Shared render core** *(done)* — `compiler/` TS package: render helpers + CSS in `renderCore.ts`/`css.ts`, markdown→HTML + KaTeX→**MathML** (bundled, no CDN, pinned to the app's `marked@9.1.6`/`katex@0.16.9`), diagrams behind a `DiagramRenderer` interface (passthrough stub). 12 unit tests + verified against the real 17-topic book (MathML present, zero script/link/CDN refs). | no | the shared core |
| 1b | **Mobile preview adoption** *(deferred)* — rewire `contentHtml.ts` to consume the shared core. Split out of M1 so it doesn't destabilise the shipping app; needs the `compiler/`↔`mobile/` types/workspace-sharing decision first. | no | no drift |
| 2 | **EPUB3 packager** *(done)* — `epub.ts`: valid EPUB3 OCF (stored `mimetype` first, `container.xml`, OPF manifest+spine with `dcterms:modified` and per-chapter `properties="mathml"`, `nav.xhtml` TOC grouped by subject, one XHTML per content-bearing topic, shared CSS, inline MathML). Static quizzes. `marked` void elements self-closed for XML. `compile-epub` CLI. | no | a `.epub` |
| 3 | **Validation gate** *(done)* — jest gate reads the zip back and asserts XML well-formedness (every `.xhtml`/`.opf`/`.xml`), OCF structure, manifest hrefs resolve, and zero script/CDN refs — on both a synthetic book and the real 17-topic book (→17 well-formed chapters). `scripts/epubcheck.sh` runs the authoritative epubcheck when Java is available (degrades gracefully otherwise). | no | validated, offline-proven |
| 4 | **Diagrams for real** — wire `@mermaid-js/mermaid-cli` behind `DiagramRenderer`; embed SVG. | Chromium | diagrams |
| 5 | **Backend export endpoint** — `POST /api/v1/export` job (key-free, job/poll UX like `/structure`) → runs the compiler → streams the `.epub`; wire `main.py`; `test_export.py`. | — | backend service |

Milestones 1–3 produce a validated, offline EPUB **with maths** before introducing
the Chromium dependency (M4) or the backend service (M5).

## Risks / watch items

- **Headless Chromium** (mermaid-cli) is a fat backend-image dependency — hence M4,
  isolated behind `DiagramRenderer` so we can later swap a Kroki sidecar or
  pre-render diagrams at authoring time.
- **XHTML well-formedness** — EPUB3 is XML-strict; `marked` HTML must serialize as
  XHTML (self-closing tags, entities). Verified by `epubcheck`, not by eye.
- **Render duplication** — M1 unifies the renderer *first* so the artifact can't
  drift from the preview.
- **Types contract** — `compiler/src/types.ts` must track `mobile/src/types/book.ts`
  (keep aligned, or share via a small workspace later).

## Out of scope (later phases, per ADR-004)

Interactive quiz layer (phasing 3), the textbook-style PDF (phasing 4), the
separate reader app + engine choice (phasing 5), MOBI (phasing 6), and the EPUB
"this book is ours → enable interactivity" contract.
