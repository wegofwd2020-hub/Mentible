# Native web reader — security regression tests

## `run-mermaid-xss-security.mjs` — hostile-```mermaid-source test

**What it guards.** The native web reader (`src/reader/`) renders a book topic into the
app's own DOM — it is the reader on web. There is no sandboxed iframe boundary, so a
hostile ```mermaid source that escaped sanitization would execute with access to
`localStorage` — where the Supabase session and the BYOK LLM key live.

**The gap it covers.** `sanitize.ts` (DOMPurify) is the one boundary for reader content,
but Mermaid renders its `<svg>` **after** that pass, straight into the live DOM
(`enhance.ts` → `renderDiagrams`). So our sanitizer never inspects Mermaid's output —
the only thing standing between a malicious diagram source and code execution is
Mermaid's **own** internal DOMPurify, gated by `securityLevel: "strict"`. A re-sanitize
of Mermaid's output is not an option: it blanks the xhtml `<foreignObject>` label text
and breaks the diagram.

**Why a real browser.** jsdom cannot host this — Mermaid measures SVG layout (`getBBox`),
which jsdom lacks, so `mermaid.run()` never settles. The test drives real headless Chrome
over the **real** reader pipeline (`renderTopicToSafeHtml` → `innerHTML` → `renderDiagrams`,
exactly as `NativeTopicReader.web.tsx` does) via `mermaid-xss.harness.ts`, esbuild-bundled
with real Mermaid.

**What makes it pass/fail.** Nine hostile diagram sources (img/onerror, `<script>`,
`javascript:` anchors, `click … href`, `click … call`, iframe label, faux-tag-break,
flowchart-node img, markdown-string label). The test **fails** if any payload executes
(a proof-of-execution sentinel `window.__xssExecuted`) or if an `onerror=`/`javascript:`
URL survives in the rendered SVG. It also refuses to pass vacuously if Mermaid rendered
zero diagrams. Proven non-vacuous: setting `securityLevel` to `"loose"` in `enhance.ts`
turns it red (the `click … href` `javascript:` URL leaks through).

## Running

```bash
npm run test:mermaid-security          # needs Chrome/Chromium on PATH
CHROME_PATH=/path/to/chrome npm run test:mermaid-security
```

Runs in CI as the `mobile-mermaid-xss` job. **Re-run it after any Mermaid version bump** —
`securityLevel:"strict"` is Mermaid's contract, not ours, and a future release could change
what it means.
