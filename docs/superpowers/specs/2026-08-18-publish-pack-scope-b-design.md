# Publish Pack (P2-6 Scope B) — Design Spec

**Status:** Proposed · **Date:** 2026-08-18 · **Area:** `compiler/`, `backend/src/export/`, `mobile/` · **Builds on:** `docs/specs/kdp-clean-export-profile.md` (Scope A, shipped)

## Why

P2-6's literal "retailer distribution APIs + royalty dashboard" is infeasible (no public book-ingest APIs) and off-strategy ("ride the rail — export *into* the retailers"). Scope A shipped the KDP-clean EPUB. **Scope B** is the next rung of the rail: bundle everything an author needs to hand off to a retailer into one **publish pack** — the EPUB, the cover, a metadata sheet, and a per-retailer upload checklist — so the manual upload is one download + a copy-paste, not a scavenger hunt. Still no API, still author-uploads; we just make the handoff frictionless.

## Decisions (locked with the user)

- **D1 — One artifact: `publish-pack.zip`** containing exactly: `book.epub` (the KDP-clean EPUB), `cover.jpg` (1600×2560 raster), `metadata.txt` (human-readable sheet), `README.html` (upload checklist + retailer links).
- **D2 — Metadata = a human-readable sheet only.** No ONIX, no CSV. It lists the fields we store + labeled blanks for the KDP fields we don't (subtitle, 7 keywords, BISAC categories) so the author fills them into KDP's form.
- **D3 — Retailers in the README: KDP + Draft2Digital + PublishDrive.** Apple Books is *noted* ("needs a Mac + Transporter — no web upload"), not linked as a dead end. IngramSpark omitted (print-first, paid).
- **D4 — Ebook cover only** (the 1600×2560 JPEG we already produce). No paperback print wrap (trim/spine/bleed — deferred, not in the pipeline).
- **D5 — Delivered on `CheckoutButton`** (the Library book Check-out panel), a "Download publish pack" action next to "Kindle (KDP)".

## Architecture

### Compiler — a new `--format pack`

New `compiler/src/pack.ts` exporting `compilePack(book: Book): Promise<Buffer>` that assembles the zip with JSZip (already a dep), reusing the shipped building blocks:
- `book.epub` ← `compileEpub(book, { profile: "kdp" })` (the exact Scope-A output; **inherits the KDP draft guard** — a `status:"draft"` book throws `KdpDraftError`, so pack also refuses drafts).
- `cover.jpg` ← `renderCoverJpeg(buildCoverSvgRaster(coverInputForBook(book)))` (the fixed raster path from commit `4e591a4`, so no "Node has 0 width" regression).
- `metadata.txt` ← a pure `buildMetadataSheet(book)` (see below) — no Chromium.
- `README.html` ← a pure `buildPublishReadme(book)` — a static, self-contained HTML checklist (see below).

`compilePack` launches Chromium once (for the cover) via the existing `renderCoverJpeg`; `compileEpub`'s own math/diagram rasterization (kdp profile) launches as it already does. CLI: add `"pack"` to the `Format` union + the `--format` parse + the dispatch in `cli.ts` (like `epub`/`pdf`); output is the zip bytes to stdout (`-o -`).

**`buildMetadataSheet(book)`** — plain text, from `book.metadata`:
```
Title:        <title>
Author:       <author>            (Sort-as: <authorFileAs>)
Language:     <language|en>       Publication date: <isoDate(date)|—>
ISBN:         <isbn|—>            Translator: <translator|—>

Description:
<description|—>

— Fill these in on the retailer's form (Mentible doesn't store them yet) —
Subtitle:     ____________________
Keywords (up to 7):  ______ , ______ , ______ , ______ , ______ , ______ , ______
Categories (BISAC):  ____________________
```
Reuse the KDP profile's `isoDate` for the date. Never invent keywords/categories/subtitle — they are blanks.

**`buildPublishReadme(book)`** — a small self-contained `README.html`: the pack's file list, then a per-retailer checklist. KDP (`https://kdp.amazon.com` → New Kindle eBook → upload `book.epub` → upload `cover.jpg` → copy fields from `metadata.txt`), Draft2Digital (`https://draft2digital.com` — one upload fans out to Apple/Kobo/B&N/etc.), PublishDrive (`https://www.publishdrive.com`). A note: "Apple Books direct requires a Mac (Transporter); use Draft2Digital to reach Apple without one." Escape all book-derived strings (title) — reuse the compiler's `escapeHtml`.

### Backend — `format=pack`

- `backend/src/export/compiler.py` `compile_book`: allow `"pack"` in the format enum; it shells `--format pack` (no `--profile` needed — pack always emits a kdp EPUB internally). Returns zip bytes.
- `backend/src/export/router.py`: accept `format=pack` on `/export` (+ `/export/jobs` if that path is used); response mime `application/zip`, download name `<slug>-publish-pack.zip`.
- **Guard nuance (important):** Scope A rejects `profile=kdp` with a non-epub format (422). `pack` is a non-epub format that *embeds* a kdp EPUB, so it must be **exempt** — the rule becomes "`profile=kdp` requires format ∈ {`epub`, `pack`}", or (simpler) pack ignores `profile` entirely and never trips the guard. A draft book + `format=pack` surfaces the compiler's `KdpDraftError` as the same clean 422/validation error Scope A maps.
- Subprocess safety unchanged: `create_subprocess_exec(*argv)`, `--format pack` is a fixed literal, no user string in argv.

### Mobile — "Download publish pack"

- `mobile/src/components/CheckoutButton.tsx`: a `checkoutPack` handler mirroring `checkoutKdp` — request `format=pack`, `downloadArtifact(zip, `${slug(book.title)}-publish-pack.zip`, "application/zip")`. New button "Publish pack" next to "Kindle (KDP)". Same working/done/error state machine (no getting stuck).
- Pro gating: match the existing export gating on this panel (if EPUB/KDP export is Pro-gated there, pack is too; otherwise same as KDP). Do not invent a new gate.
- **Help DoD:** a `publish-pack` FEATURES key + a Help topic ("Download a publish pack for retailers") in the same change, and add it to `HELP_TREE` next to `kdp-export` (Projects › Publish subtree / wherever kdp-export sits). Coverage + tree-reachability gates stay green.

## Non-goals

- No live retailer API / auto-submission (none exist).
- No ONIX, no CSV, no royalty dashboard, no ISBN assignment.
- No paperback/print wrap cover (trim/spine/bleed).
- No new metadata fields in the data model (subtitle/keywords/categories stay author-filled blanks).

## Testing

- **Compiler** `pack.test.ts`: `compilePack` returns a zip whose entries are exactly `book.epub`, `cover.jpg`, `metadata.txt`, `README.html`; `book.epub` starts with the EPUB `PK` magic + is a valid kdp EPUB (mock rasterize); `metadata.txt` contains the book's title/author + the three labeled blanks; `README.html` contains `kdp.amazon.com`, `draft2digital.com`, `publishdrive.com` and the Apple note; a `status:"draft"` book throws `KdpDraftError`. Mock rasterize (real tiny JPEG for the cover) — no Chromium in CI.
- **Backend**: `format=pack` routes, returns `application/zip`; `profile=kdp&format=pack` is NOT rejected (the guard exemption) while `profile=kdp&format=pdf` still 422s; draft+pack → clean 422.
- **Mobile**: `checkoutPack` requests `format=pack` + downloads a `.zip`; button re-enables on error; help coverage passes.
- **Manual/real-render**: an in-container `--format pack` probe (like the KDP verify) confirms a real zip with a valid JPEG cover — mocked tests can't catch a cover-raster regression (see `reference_svg_raster_zero_width`).

## Rollout

Compiler + backend + mobile → web via `web-deploy.sh app`, backend via the ROOT refresh (the api image needs the new `--format pack`), and a new APK. No migration.
