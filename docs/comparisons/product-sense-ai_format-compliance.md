# "Product Sense & AI" — format-compliance check

Checked the compiled **v1.0** artifact (`artifacts/product-sense-and-ai.{pdf,epub}`,
51-page A4 PDF) against the author's guidelines in `doc format.xlsx`.

**Verdict:** 11 of 13 parameters comply. **2 differences** (1 quantitative, 1 structural) + 2 minor notes. No book changes made — this is a read-only report.

## Compliance summary

| ID | Parameter | Guideline | Book (measured) | Status |
|---|---|---|---|---|
| A1 | Page Size | A4 | A4 (595×842 pt) | ✅ |
| A2 | Page Count | ~50 content pages (excl. cover/TOC/ack/refs), up to 55 | **45 content pages** (15 ch × 3 pp); 51 incl. front/back matter | ⚠️ **Under target** |
| A3 | Visual Count | 20–30 | **24** (15 figures + 9 tables) + worked scenarios | ✅ |
| A4 | Visual/Text Balance | Prose-with-Figures | Prose + 1 figure/chapter + comparison tables | ✅ |
| B1 | Target Reader & Voice | Professional, conversational, executive-friendly, low jargon | `level=professional`; conversational, named scenarios | ✅ |
| B2 | Chapter Length | 3–5 pages | Exactly **3 pages** every chapter | ✅ (low end) |
| B3 | Examples | Real-world enterprise / realistic scenarios | Named scenarios (Maya), real tools (Claude, Copilot) | ✅ |
| B4 | Chapter Structure | Concept → Visual → **Example** → Key Takeaways | Concept (examples woven into prose) → Visual → Key Takeaways → Further reading | ⚠️ **Partial** |
| B5 | Glossary | First-use definitions + glossary at end | Glossary at end (p51) ✓; in-text first-use defs not systematic | ✅ (see note) |
| C1 | Visual Style | Brand-coloured diagrams | Bespoke brand-coloured SVG infographics | ✅ |
| C2 | Diagram Style | Corporate illustrations, layered frameworks, lifecycle, comparison matrices | Comparison panels, hub-and-spoke, quadrants, funnels + tables | ✅ |
| C3 | Cover Style | Modern thought-leadership (not "For Dummies") | Constellation thought-leadership cover | ✅ |
| C4 | Typography | Sans-serif headers + highly readable body | Sans headers (Nimbus Sans) + serif body (Liberation Serif) | ✅ (see note) |

## Differences (the gaps)

### 1. A2 — Page count is below the 50-page target ⚠️
- **Guideline:** ~50 content pages, expandable to ~55.
- **Actual:** **45 content pages** — 15 chapters at exactly 3 pages each (PDF p6–p50). Total file is 51 pages including cover, colophon, TOC, List of Figures, List of Tables, and the glossary.
- **Gap:** ~5 pages short of target. Body prose totals ≈ 9,150 words (≈ 610 words/chapter). Reaching 50 would need roughly +1 page (≈ +350–450 words, or an extra example/figure) in ~5 chapters, or a modest lift across all 15.

### 2. B4 — "Example" is not a distinct structural step ⚠️
- **Guideline:** a consistent **Concept → Visual → Example → Key Takeaways** pattern per chapter.
- **Actual:** chapters run **Concept (3 prose sections) → Visual (1 figure/table) → Key Takeaways (4) → Further reading**. Examples exist but are **woven into the concept prose** (e.g. "Maya, a backend engineer with eighteen years…") rather than appearing as a labelled, consistently-placed Example block. There is also an extra **Further reading** element not in the prescribed four-step pattern.
- **Gap:** the four-part rhythm is present in substance for Concept/Visual/Takeaways, but the **Example** step is not a discrete, predictable element across all chapters.

## Minor notes (compliant, worth flagging)

- **B5 — first-use definitions:** the end-of-book glossary is present and correct. The guideline also asks for **first-use definitions in-text**; the book does not systematically bold/define each acronym on first use (acronyms are largely deferred to the glossary). Low-impact.
- **C4 — body typeface:** headers are sans-serif as specified; the **body is serif** (Liberation Serif). The guideline only mandates sans-serif *headers* + "highly readable body," so this complies — noted because some readers expect an all-sans executive look.

## Measurement basis

- Page size/count: `pdfinfo` + per-page text map of `artifacts/product-sense-and-ai.pdf`.
- Figures (15) / Tables (9): the artifact's List of Figures (p4) and List of Tables (p5).
- Chapters, sections, word counts, takeaways: parsed from `artifacts/product-sense-and-ai.book.json`.

---

## v2.0 update (gaps resolved)

v2.0 is now the production artifact (v1.0 backed up as `…-v1.0.*`). It addresses the two gaps + the minor note:

| Item | v1.0 | v2.0 | Status |
|---|---|---|---|
| **A2** Page count | 45 content pp | **50 content pp** (58 total) — per-chapter Examples + editorial spacing | ✅ meets ~50 target |
| **B4** Concept→Visual→**Example**→Key Takeaways | examples woven into prose | **15/15 chapters** gain a discrete "In practice" Example (new named enterprise scenarios) | ✅ |
| **B5** First-use definitions | glossary only | first-use acronym expansions added in-prose (+ glossary intact) | ✅ |
| **C-series** design | passing | also tuned toward Anthropic-minimal — warm ground, more air, softer accents (see [design-style doc](product-sense-ai_design-style.md), PR #64) | ✅ enhanced |

All 15 bespoke SVG figures preserved. v2.0 is stamped `version 2.0 · Second Edition` (ADR-008). The content additions were generated via the LLM pipeline and grafted onto the existing prose; the design tuning is compiler-side.
