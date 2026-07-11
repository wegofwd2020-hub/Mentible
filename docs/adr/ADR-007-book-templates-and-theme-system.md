# ADR-007 — Book templates / theme system (content vs. presentation)

**Status:** Accepted — 2026-06-03 · **NOT yet built (2026-07-11 currency pass):** the staged plan is unstarted — the compiler still uses the hardcoded theme (`compiler/src/{tokens,cover,pdf,mermaid}.ts`); no `templateId`/`BookTemplate`, no `compiler/src/templates/`, no `mentible-professional@1.0`. Decision stands; implementation deferred.
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-003 (book authoring), ADR-004 (two-product split + artifacts),
`docs/ARTIFACT_PIPELINE.md`. Builds on the house-style work in PRs #48–#53
(design tokens, diagram theme, fonts/airy layout, branded tables/callouts, cover
redesign, per-chapter numbering, Lists of Figures/Tables, glossary).

---

## Context

A large amount of fine-tuning now defines how a Mentible book looks and reads:
a brand palette and design tokens, font stacks, page geometry and pagination
rules, a cover design, a diagram role-theme, a numbering scheme, front-matter
Lists (TOC / List of Figures / List of Tables), a back-matter glossary, heading
casing, and generation directives (voice, diagram role vocabulary).

All of this currently lives as **hardcoded code in the compiler**, applied as a
single global house style to every book:

| Concern | Where it lives today |
|---|---|
| Palette / tokens, Mermaid theme, diagram role colours | `compiler/src/tokens.ts` |
| Cover design (+ embedded logo) | `compiler/src/cover.ts`, `brandLogo.ts` |
| Print CSS, pagination, numbering, Lists, glossary | `compiler/src/pdf.ts` |
| EPUB CSS + front/back matter | `compiler/src/css.ts`, `epub.ts`, `floats.ts` |
| Diagram theme injection | `compiler/src/mermaid.ts` |
| Generation voice + diagram directives | `backend/src/generate/prompt_builder.py` |
| **The book itself** (TOC, content, metadata) | **`book.json`** |

The goal: let authors **reuse this tuning across projects** — "make a copy of
this template for each project." The instinct is correct, but the naive form
("copy the whole style into every project") is a trap: improvements to the style
(like the cover or pagination fixes we just shipped) could never propagate, and
every project would drift.

---

## Decision

### D1 — Separate **content** from **presentation**

- **Content** is the per-project artifact: the `book.json` (TOC, chapter
  content, figures, metadata, table captions, glossary terms). This is what a
  user creates/copies per project.
- **Presentation** is a **`BookTemplate`** — a named, versioned, declarative
  config (tokens, fonts, layout knobs, cover options, front/back-matter toggles,
  numbering scheme, generation directives). It is **shared**, not per-project.

### D2 — A project **references** a template; it does not copy the style

`book.json` gains an optional `templateId` (e.g. `mentible-professional@1.0`) and
an optional `templateOverrides` for small per-book deviations (e.g. an accent
colour). The compiler resolves `template = base(templateId) ⊕ overrides` at
compile time. The style is referenced once — never duplicated into the book.

### D3 — Templates are **versioned**; projects **pin** a version

A book pins `templateId@version`. This gives both:
- **Reproducibility** — re-rendering an old book yields the same look.
- **Upgradeability** — bumping the pin re-renders against an improved template
  (the global fix propagates on opt-in, not silently).

### D4 — Ship the current tuning as the default template

Everything from PRs #48–#53 becomes **`mentible-professional@1.0`** — the default
when `templateId` is absent (so existing books and the current compile path are
unchanged). It is the first entry in a future small library (e.g. Professional
Guide / Textbook / Workbook).

### D5 — "New from template" is a thin scaffolder, not a style copy

Creating a project scaffolds a fresh `book.json` pre-filled with `templateId`
(+ author/title placeholders, optional starter TOC and `generationParams`). The
presentation is inherited by reference.

---

## The `BookTemplate` shape (sketch — to be finalised in implementation)

```ts
interface BookTemplate {
  id: string;            // "mentible-professional"
  version: string;       // "1.0" — pinned as "mentible-professional@1.0"

  tokens: BrandTokens;          // palette, diagram role palette (today: tokens.ts)
  fonts: { serif: string; sans: string; mono: string };
  layout: {                     // print/paged-media geometry (today: pdf.ts)
    pageSize: "A4" | "Letter";
    margin: string; fontSizePt: number; lineHeight: number;
  };
  pagination: { keepHeadingWithNext: boolean; keepFigureWithText: boolean };
  cover: { motif: "constellation" | "tree" | "plain"; showLogo: boolean };
  diagrams: { theme: "branded"; roles: DiagramRoles };  // today: tokens + mermaid.ts
  numbering: { figures: "perChapter" | "global"; tables: "perChapter" | "global" };
  headings: { partLabels: "caps"; sectionCase: "title" };
  frontMatter: { toc: boolean; listOfFigures: boolean; listOfTables: boolean };
  backMatter: { glossary: boolean };
  generation: {                 // feeds prompt_builder.py
    voice: string; depthDefault: "quick" | "standard" | "deep";
    diagramRoleVocabulary: string[];
  };
}
```

And on the content side:

```ts
interface Book {
  // …existing…
  templateId?: string;                       // defaults to "mentible-professional@1.0"
  templateOverrides?: DeepPartial<BookTemplate>;
}
```

---

## What is templatable vs. per-project

- **Template (shared presentation):** palette/tokens, fonts, page geometry,
  pagination rules, cover layout/motif, diagram role-theme, numbering scheme,
  front/back-matter toggles, heading casing, generation voice + diagram vocab.
- **Per-project (content):** title, author, metadata, TOC, chapter prose, the
  specific infographics, glossary terms, table captions, generationParams.

---

## Two-product fit (ADR-004)

The **paid authoring app** lets a user pick a template per project (and tweak
overrides); the **compiler** renders `book.json` against the resolved template;
the **reader app** is unaffected (it consumes the finished artifact). Templates
are an authoring/compile concern, not a reader concern.

---

## Consequences

**Positive**
- Global style improvements propagate to any book that bumps its template pin.
- Reproducible renders (pinned versions).
- A path to multiple looks without forking the compiler.
- Forces the last hardcoded colours/sizes out of `cover.ts`/`css.ts`/`pdf.ts`
  into one declarative place (continues the `tokens.ts` direction).

**Costs / risks**
- Real refactor: thread a resolved `BookTemplate` through `cover.ts`, `css.ts`,
  `pdf.ts`, `mermaid.ts`, and (for generation) `prompt_builder.py`.
- Override merging (`base ⊕ overrides`) needs clear precedence + validation.
- Generation directives in the template must stay in sync with the backend
  prompt builder (vendored-prompts boundary, ADR-002, still applies).
- Versioning policy (what is a breaking template change?) needs definition.

---

## Staged plan (post-acceptance)

1. **Extract** `BookTemplate` type + `mentible-professional@1.0` capturing today's
   hardcoded values (seeded by `tokens.ts`); make the compiler read it, default
   applied when `templateId` is absent (no behaviour change).
2. **Wire** `templateId` + `templateOverrides` into `book.json` and the compile
   entry points; implement `base ⊕ overrides` resolution.
3. **Generation:** feed the template's `generation` block into `prompt_builder.py`.
4. **Scaffolder:** "new book from template" (CLI/app) producing a starter
   `book.json`.
5. **(Later)** a second template to prove the abstraction (e.g. Textbook).

---

## Open questions

- Where do templates live — in-repo (`compiler/src/templates/`) vs. a data file
  an author can author/share? (Start in-repo; revisit if users need custom ones.)
- Granularity of `templateOverrides` — full deep-partial vs. a curated allow-list
  (e.g. accent colour, cover motif, front/back-matter toggles only)?
- Do generation directives belong in the same template as presentation, or a
  separate "authoring profile"? (Leaning: same template, separate sub-block.)
- Template versioning semantics + how a book opts into a newer version.
