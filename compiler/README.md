# compiler

Server-side artifact compiler: `book.json` → EPUB3 (PDF later). See
`docs/COMPILE_PIPELINE_PLAN.md` for the pipeline design.

```bash
npm install
npm run typecheck
npm test
npm run build
node dist/cli.js book.json -o book.epub --format epub
```

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
