# Default Library

Canonical, product-owned source for the **default shareable library** — the
curated set of books that ship with the app and seed a new device's local
library on first run.

See **[ADR-017](../docs/adr/ADR-017-default-shareable-library.md)** for the why
and the full decision (location, full-content policy, read-only / copy-on-write
semantics, D18 cap exclusion).

## Layout

```
library/
  manifest.json   ← the index: one entry per book (id, file, version, status, checksum)
  README.md       ← this file
  books/          ← the book.json files, full content committed
```

## Why this lives at the repo root (not in `mobile/`)

This directory is the **single source of truth**. It is consumed by:

- **mobile/** — a build step copies it into `mobile/assets/library/` so Expo
  bundles it; the first-run seeder imports each book via `importBook`.
- **compiler/** — the EPUB3/PDF pipeline (ADR-004) can compile these books
  directly.
- the **reader app** (separate repo, ADR-004) — same shareable `.book.json`.

Putting it under `mobile/assets/` would make it mobile-only and force the
compiler and reader to duplicate it.

## Book file format

Each file is a standard `.book.json` — the same shape `importBook`
(`mobile/src/storage/importBook.ts`) ingests and the OnDemand Authoring Studio
exports: `{ id, title, toc, createdAt, updatedAt, content?, generationParams?,
metadata? }`.

`metadata.status` is meaningful here:

- `draft` — structure only (or partial content). **Not promoted to a shipped
  default** until lessons are generated. The seeder may skip drafts.
- `published` — full content, reviewed, safe to seed as a default.

## Adding or updating a book

1. Drop the `.book.json` into `books/`.
2. Add/update its entry in `manifest.json`, including the `sha256` and `bytes`:

   ```bash
   shasum -a 256 library/books/<file>.book.json
   wc -c < library/books/<file>.book.json
   ```

3. Default-library books carry **full generated content** (ADR-017) once
   `published` — ship the finished book so users get value without spending
   their own BYOK tokens.

## Current contents

| Book | Status | Units | Content |
|---|---|---|---|
| Claude Certified Architect — Foundations | `draft` | 30 | scaffold only — lessons not yet generated |

> The cert guide is committed as a **draft scaffold** (TOC only). It is the
> first library entry but must have its 30 lessons generated before it is
> promoted to a shipped default. See ADR-017 §Status.
