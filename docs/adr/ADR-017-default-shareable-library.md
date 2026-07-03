# ADR-017 — Default shareable library (seeded books in the source tree)

**Status:** Proposed — 2026-06-15
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-003 (book authoring), ADR-004 (two-product split + artifacts),
ADR-009 (Books-only). Amends locked decisions **D4** (local-only at MVP — adds a
*read-only bundled* tier alongside the user's local library) and **D18** (~100-book
fair-use cap — bundled books are excluded from the count).
**Implemented by:** PR _TBD_ — this ADR lands with the `library/` source tree
(`library/manifest.json`, `library/books/`); the mobile seeder is a follow-up PR.

> **See also (2026-07-03):** **ADR-027** (collaborative draft sharing & the release /
> Open-Library permission model) and **ADR-021 D9**. Author-driven *sharing* of drafts
> and publishing RELEASE editions to the public Open Library are **separate tiers** from
> this owner-curated default library (ADR-021 D2); ADR-027 also adds the book `tags`
> field and an author-`description` ingestion path. This ADR is unchanged by them.

---

## Context

Today every book a user has is **local-first on-device** (`bookStore.ts` →
AsyncStorage; ADR-003 D1). There is no notion of *shipped* content: a freshly
installed app is empty until the user authors or imports a book. That hurts the
demo/quality-first goal (D7) — there is nothing to show on first launch — and we
already produce curated, finished books we would like to hand out (e.g. the
"Claude Certified Architect — Foundations" study guide).

Separately, the `.book.json` is already the **portable, shareable unit**:
`importBook(raw)` (`mobile/src/storage/importBook.ts`) parses and persists one,
and the OnDemand Authoring Studio exports the same shape. So a "default library"
is largely a matter of *where curated books live* and *how they seed a device* —
the ingest path exists.

We want a **default library** that:

- ships with the app and seeds a new device on first run,
- is **shareable** (the same files can feed the compiler and the separate reader
  app, ADR-004), and
- is curated and restorable — a user can't accidentally destroy it.

## Decision

Introduce a curated, product-owned **default library** as committed source, and
seed it into each device's local library on first run.

### D1 — Canonical location: repo-root `library/`

The source of truth is a top-level `library/` directory:

```
library/
  manifest.json   ← index: one entry per book (id, file, version, status, sha256)
  README.md
  books/          ← the .book.json files
```

Rationale: it is consumed by **three** surfaces — `mobile/` (bundled + seeded),
`compiler/` (EPUB3/PDF, ADR-004), and the future **reader app** (separate repo,
ADR-004). Placing it under `mobile/assets/` would make it mobile-only and force
the other two to duplicate it. Only `mobile/assets/` ships inside the Expo
bundle, so a build step **copies** `library/` → `mobile/assets/library/` at
build time; `library/` stays the single source of truth.

### D2 — Ship full generated content (once published)

A default-library book carries its **full generated content**, not just the TOC
scaffold. The point of a default library is that users get finished, valuable
books **without spending their own BYOK tokens** (D7 demo/quality-first). The
cost — committed LLM output and larger files (~50 KB+ per book, more once full) —
is accepted; these are curated, reviewed artifacts, not raw dumps, and the count
is small.

`manifest.json` records `sha256` + `bytes` per book so the bundle is verifiable
and accidental edits are caught.

### D3 — Read-only + copy-on-write; excluded from the D18 cap

Seeded books are **read-only defaults**. On the device they are tagged
`source: "bundled"`; the first edit **forks a user-owned copy** (copy-on-write)
and the original remains restorable. Because they are shipped (not user
authored), bundled books **do not count** against the D18 ~100-book fair-use cap.

> Implementation note (follow-up PR): `source` is a new optional field on the
> stored `Book`/`BookMeta`; the seeder sets it, the books-list and the cap check
> read it, and the editor branches to copy-on-write when it is `"bundled"`.

### D4 — `draft` vs `published`; the seeder skips drafts

`metadata.status` gates promotion:

- `draft` — structure only or partial content; **not** seeded as a shipped
  default.
- `published` — full, reviewed content; seeded on first run.

This lets us commit a book's scaffold and iterate on it in-tree before it goes
live to users.

## Status of the first entry

The flagship entry — **Claude Certified Architect — Foundations** (5 domains, 30
units) — is committed as a **`draft` scaffold**: TOC only, `content: {}`,
`pages: 0`. It is the first `library/` book but is **not yet a shipped default**.
Promoting it requires generating its 30 lessons (per `generationParams`:
professional / deep / lesson, Anthropic) and flipping `status` to `published`.
That generation pass is tracked as follow-up work.

## Consequences

- **First-run value.** New installs ship with real books (D7).
- **One source, three consumers.** mobile, compiler, reader share `library/`.
- **Amends D4 / D18.** A read-only bundled tier joins the local library; bundled
  books are cap-exempt. Both noted here and to be reflected in `SCOPE.md` /
  `CLAUDE.md` decision tables when this ADR is Accepted.
- **Committed LLM output.** Generated content lives in git for default books;
  repo grows with the library. Acceptable at the intended small curated size.
- **Follow-up work:** (a) mobile first-run seeder + `source: "bundled"` +
  copy-on-write + cap exclusion; (b) build step `library/` → `mobile/assets/`;
  (c) generate the cert guide's content and promote it to `published`.

### As-built: how the bundled books reach a user (incl. the web app)

> Added 2026-07-03. The seeder that was "follow-up work" above is **built**. This
> note records the shipped provisioning path — the answer to *"when a new user
> signs into the web app, how do the two default books become available?"*

The books reach the user by **bundling + first-run seeding on the client**, with
**no backend endpoint and no sign-in / account dependency**:

- **Bundled into the build.** `mobile/src/storage/bundledLibrary.ts` *statically
  imports* `mobile/assets/library/manifest.json` and each `.book.json`, so Metro
  inlines them into the JS bundle. The web app is the Expo web build of `mobile/`,
  so it ships the same bundle — the books travel offline, not fetched at runtime.
- **Seeded on app mount.** `useSeedDefaultLibrary()` (`mobile/src/hooks/`) runs in
  the root layout (`mobile/app/_layout.tsx`), calling `seedDefaultLibrary()`
  (`mobile/src/storage/seedLibrary.ts`) on every launch. It imports each
  `published` book into the on-device Books store tagged `source: "bundled"`.
  It is **unconditional — it does not depend on authentication**, so the two
  books appear before/without sign-in. Seeding is idempotent per `(id, version)`
  and deletion-safe (a book the user deletes is not resurrected), keyed by the
  AsyncStorage entry `sbq_seeded_library` (which is `localStorage` on web).

**Consequence — device/browser-local, not account-following.** Because seeding
writes to per-browser storage and there is **no server-side, per-account
provisioning**, the books are tied to the device/browser, not the signed-in
account. A user on a fresh browser gets them from the bundle again; they do **not**
sync across devices via the backend. A future account-tied "everyone library" is a
*separate*, Proposed concept (ADR-021) — not this mechanism.

**Operational caveat.** `mobile/assets/library/` is a hand-maintained mirror of the
canonical repo-root `library/` (the build-step follow-up (b) is not yet built), so
the web build's books depend on that asset copy being present and current in the
deployed bundle.

## Alternatives considered

- **`mobile/assets/library/` as canonical.** Simplest (no build copy) but
  mobile-only; the compiler and reader would duplicate the files. Rejected for a
  shared source of truth (D1).
- **Ship TOC scaffolds, regenerate on device.** Keeps the repo lean but the
  default library is empty until the user spends their own tokens — defeats the
  first-run-value purpose. Rejected (D2).
- **Editable seeded books (no copy-on-write).** Simplest seeding, but no
  "restore default" and they consume the D18 cap. Rejected (D3).
