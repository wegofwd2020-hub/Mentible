# ADR-008 — Release lifecycle & watermarking (draft → release → editions)

**Status:** Accepted — 2026-06-03
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-007 (book templates / theme system), ADR-004 (two-product
split + artifacts), `docs/ARTIFACT_PIPELINE.md`.

---

## Context

A book is a **draft** while it is being authored and reviewed, then becomes a
**release** with a version and edition, and may go through further
versions/editions over time. Two needs follow:

1. **Watermark drafts** — e.g. a diagonal "DRAFT" across the pages — so review
   copies are unmistakable and can't be passed off as final.
2. **A lifecycle** — remove the watermark on release, stamp a **version /
   edition**, and be able to **publish new versions/editions** later.

Today neither exists: every compile produces an unmarked artifact with no notion
of draft vs. release or of versioning.

This is two distinct concerns: a **watermark** (presentation, toggled) and a
**release lifecycle** (per-project *state*). They should be modelled separately.

---

## Decision

### D1 — Lifecycle is per-project **state** in `book.json` metadata

```jsonc
"metadata": {
  "status": "draft",            // "draft" | "release"
  "version": "0.9",              // semver-ish, author-controlled
  "edition": "First Edition",    // human label (optional)
  "releaseDate": null,           // set on release (ISO date)
  "watermark": "DRAFT",          // optional explicit override text
  "revisionHistory": [           // optional changelog
    { "version": "0.9", "date": "2026-06-03", "notes": "Initial draft" }
  ]
}
```

This is **content**, not template: a book's draft/release state and version
travel with the book, not with its look.

### D2 — The compiler watermarks when the book is a draft

- Watermark is rendered when `status === "draft"` (default text **"DRAFT"**) **or**
  when an explicit `watermark` string is set (also enabling "CONFIDENTIAL",
  "REVIEW COPY", "PROOF", …).
- `status: "release"` with no explicit `watermark` → **no watermark**.

### D3 — PDF is the watermark target (Vivliostyle repeats `position: fixed`)

The paged-media engine repeats a `position: fixed` element on every page — exactly
a watermark. One faint, rotated element in the body covers all pages:

```css
.watermark {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%) rotate(-45deg);
  font: 800 120pt "Nimbus Sans", "Liberation Sans", Arial, sans-serif;
  color: rgba(49, 42, 140, 0.08);   /* faint brand indigo — text stays legible */
  pointer-events: none; white-space: nowrap;
}
```

Opacity/size/tiling are tunable (and, per ADR-007, are a **template** concern;
see D5).

### D4 — EPUB gets a draft *notice*, not a fake watermark

Reflowable EPUB has no fixed pages and many readers strip positioning, so a true
per-page watermark is **not reliable**. Instead, a draft EPUB carries a prominent
**"DRAFT — not for distribution"** notice on the title/colophon page (plus a
best-effort faint repeating CSS background some readers honour). We will **not**
claim a watermark the format can't guarantee.

### D5 — Release stamps the edition; the look is template-driven

On `status: "release"`:
- The watermark is removed.
- The **version / edition** is stamped on the **cover** (under the byline, e.g.
  `v1.0 · First Edition`) and on the **colophon** (version, edition, release date,
  optional revision history).
- Per ADR-007, *whether* and *how* the edition is stamped and *how* the watermark
  looks are **template** options; the *state* that triggers them is per-project.

### D6 — Versioned artifacts

Output filenames carry the state/version so drafts and releases don't overwrite
each other, e.g. `product-sense-and-ai-draft.pdf` vs.
`product-sense-and-ai-v1.0.pdf`. Each release is reproducible from its
`book.json` (status + version pinned).

---

## "Publish a new version/edition" — the flow

1. Author edits content; bump `version` (and `edition` if a major edition).
2. Append a `revisionHistory` entry.
3. Set `status: "release"` + `releaseDate` (or keep `draft` while iterating).
4. Recompile → unwatermarked, edition-stamped artifact with a versioned filename.

"Make this a release" is therefore a **one-field flip** (`status: draft →
release`) plus a version/edition — not a separate pipeline.

---

## Consequences

**Positive**
- Review copies are unmistakable; releases are clean and edition-stamped.
- Lifecycle is a few declarative fields — trivial to drive from the authoring app.
- Reproducible, non-clobbering versioned artifacts.
- Clean split: state in `book.json`, styling in the template (ADR-007).

**Costs / risks**
- Watermark fidelity differs by target (strong in PDF, notice-only in EPUB) — must
  be communicated to authors, not hidden.
- Watermark opacity must be tuned so body text + diagrams stay legible.
- Versioning discipline (when to bump version vs. edition) is author policy; the
  system records, it doesn't enforce.
- Cover/colophon stamping touches `cover.ts` / `colophon.ts` (and ideally reads
  from a resolved template once ADR-007 lands).

---

## Staged plan (post-acceptance)

1. Add the metadata fields (typed) to `book.json` / `BookMetadata`.
2. PDF: render the watermark (gated on status/watermark) + edition stamping on
   cover + colophon.
3. EPUB: draft notice on title/colophon (+ best-effort background).
4. Versioned output filenames in the CLI/export path.
5. Fold watermark *styling* + edition-stamping toggles into the `BookTemplate`
   (ADR-007) when that lands.

---

## Open questions

- Watermark style: single large diagonal vs. tiled repeat? (Default: single
  diagonal; tiling as a template option.)
- Should the watermark also cover the cover page, or content pages only?
  (Leaning: content + front/back matter; the cover can show "DRAFT" via the
  edition slot instead.)
- `version` scheme — free-form vs. enforced semver? (Start free-form.)
- Does `status` gate anything else later (e.g. the reader app refusing to “light
  up” a draft, or watermark carried into interactive quizzes)?
