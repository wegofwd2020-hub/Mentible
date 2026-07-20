# Open Shelves — navigation drill-in + client-side preference filter Design

**Status:** Approved (2026-07-13) · **Branch:** `feat/open-shelves` (localhost-only) ·
**Relates to:** ADR-028 (§6b filters, P0-1 browse) · companion of the web-feed-fetch
work (reuses `fetchFeed`/`feedTransport`)

## Problem

Two gaps surfaced while manually testing Open Shelves on 2026-07-13:

1. **Navigation catalogs aren't browsable.** Project Gutenberg — the one reliable
   free repo — serves its *catalog* feeds (`.../ebooks/search.opds/?query=…`) as
   **navigation** feeds: each entry is a `rel="subsection"` link to that book's
   own per-book feed, carrying **no acquisition link**. The parser currently
   *drops* subsection links, so these entries arrive empty and un-downloadable. A
   user browsing a Gutenberg catalog sees titles but no Download button. (Per-book
   feeds like `.../ebooks/2701.opds` *do* inline acquisition links — that's the
   only thing that works today.) See [[project_open_shelves_starter_list_followup]].

2. **No content filter.** A mixed catalog can't be narrowed by language or
   maturity. ADR-028 §6b specifies a **client-side** filter — a pure function of
   *device-local declared preferences × feed metadata*, with **no behavioral
   collection** — but it isn't built.

## Decisions

| | Decision |
|---|---|
| **N1** | Tapping a navigation entry **browses into the sub-feed in place** (an OPDS tree with a back/breadcrumb stack) — not eager pre-resolve, not detail-screen auto-resolve. One fetch per drill, only when the user drills. |
| **N2** | Sub-feed entries are **transient** — rendered from the browse stack, **never written** to the per-source store. The store keeps holding only the top-level catalog (P0-3 unchanged). |
| **N3** | Drill-in reuses `fetchFeed`/`feedTransport` verbatim — so navigation feeds get the same XXE-off / caps / scheme-allowlist hardening, and on web they route through the `/api/v1/shelves/feed` CORS proxy automatically. |
| **F1** | The filter covers **language + maturity** only (subject/media-type deferred). |
| **F2** | The filter is a **pure** `filterEntries(entries, prefs) → FeedEntry[]`. Language: keep when `prefs.language === "all"`, OR the entry's primary subtag matches, OR the entry's language is **null/unknown** (never hide unknown-language books). Maturity: hide when `entry.mature === true && prefs.hideMature`; keep `null`/`false`. |
| **F3** | Preferences are **device-local, declared, persisted** (`{language, hideMature}`). Defaults: `language` = device-locale primary subtag, `hideMature = true`. No behavioral collection; no inference from what the user browses. |
| **F4** | Prefs default's locale source: `navigator.language` on web; `Intl.…().resolvedOptions().locale` on native with an `"en"` fallback — **no new dependency** (`expo-localization` is not installed). |

## Component A — Navigation drill-in

### Data model
- `mobile/src/openshelves/types.ts`: add `navigationUrl: string | null` to
  `FeedEntry`. A **leaf** entry has ≥1 acquisition link; a **navigation** entry has
  `navigationUrl != null` and no acquisition link. (`reconcileEntries` merges by
  `id` and passes entries through unchanged — the new field is additive and safe;
  old stored entries without it read as `undefined`, treated as `null`.)
- `mobile/src/openshelves/opds12.ts` → `parseLinks`: also capture the navigation
  link. A link is navigational when `rel === "subsection"` **or** its `type`
  contains `profile=opds-catalog` (the OPDS catalog content-type) and it is not an
  acquisition link. Store its resolved href as `navigationUrl` (first one wins).
  Acquisition detection is unchanged, so an entry that somehow has both stays a
  leaf (downloadable wins).

### Browsing
- `mobile/src/openshelves/useFeedBrowser.ts` (new): owns the **browse stack** for
  one source. Starts with the stored top-level entries (from `useSourceCatalog`);
  `enter(entry)` fetches `entry.navigationUrl` via `fetchFeed` + `parseOpds`,
  pushes a frame `{ title, entries }`; `back()` pops. Exposes `entries` (current
  frame), `crumbs`, `loading`, `error`, `canGoBack`. A failed sub-feed fetch
  surfaces the same `toMessage(err)` copy and leaves the stack intact.
- `mobile/src/openshelves/EntryRow.tsx`: a navigation entry (no acquisition link,
  `navigationUrl` set) renders a **browse affordance** — a "Browse ›" chevron in
  place of the media-type badge — so the user can tell a shelf from a book.
- `mobile/app/shelves/[sourceId].tsx`: render the current browse frame; tapping a
  navigation entry calls `enter`, a leaf entry pushes the detail route as today. A
  back control appears when `canGoBack`. Breadcrumb shows the frame titles.

## Component B — client-side preference filter

- `mobile/src/openshelves/filterEntries.ts` (new, pure): `ShelfPrefs` =
  `{ language: string; hideMature: boolean }` (`language` is a lowercase primary
  subtag or the literal `"all"`); `filterEntries(entries, prefs)` per F2;
  `primarySubtag(lang)` normalizes `"en-US"` → `"en"`.
- `mobile/src/openshelves/shelfPrefsStore.ts` (new): AsyncStorage key
  `sbq_open_shelves_prefs`. `getPrefs()` (returns defaults if absent/corrupt),
  `putPrefs(prefs)`. `defaultPrefs()` builds from `deviceLocale()`.
- `mobile/src/openshelves/deviceLocale.ts` (new): `deviceLocale(): string` →
  primary subtag per F4.
- `mobile/src/openshelves/ShelfFilterBar.tsx` (new): a language picker (choices =
  the languages present in the *current* entries + "All"; chip pattern reused from
  `LevelPicker.tsx`) and a "Hide mature" toggle, plus an "N of M shown" count.
  Reads/writes prefs through a `useShelfPrefs()` hook; changes re-filter live.
- Wiring: the catalog screen applies `filterEntries(browser.entries, prefs)` to
  whatever frame is showing (top-level **and** drilled-in), so the filter and the
  tree compose.

## Layering (unchanged direction)
```
app/shelves/[sourceId].tsx → useFeedBrowser + useShelfPrefs + ShelfFilterBar + EntryRow
useFeedBrowser  → fetchFeed (→ feedTransport) + opds12 (parse)
filterEntries   → (pure)
shelfPrefsStore → AsyncStorage ; deviceLocale → platform
```

## Error handling
- Sub-feed fetch failure → `toMessage(err)` copy shown on the catalog screen; the
  browse stack is unchanged (user stays on the current frame).
- `filterEntries` is pure and total — no throw. An unknown-language or
  unknown-maturity entry is **kept** (fail-open on visibility; we never hide a book
  because metadata is missing).
- Corrupt prefs blob → `defaultPrefs()`.

## Testing
- **Parser** (`opds12.test.ts`): a `subsection` entry → `navigationUrl` set,
  `links: []`; a per-book entry → acquisition links, `navigationUrl: null`; an
  `opds-catalog` profile link with no `rel` still classified navigational.
- **`filterEntries`** (new test): `"all"` keeps everything; language match keeps,
  mismatch drops, **null language kept**; `hideMature` drops `mature===true`, keeps
  `false`/`null`; language + maturity combined.
- **Prefs store** (new test): absent → defaults; round-trip persist; corrupt blob →
  defaults; `defaultPrefs` uses `deviceLocale`.
- **`useFeedBrowser`** (new test, mocked `fetchFeed`): `enter` a navigation entry →
  frame pushed with parsed sub-entries; `back` pops; leaf entries don't enter; a
  fetch error sets `error` and keeps the stack. (Sub-entries never hit the store —
  assert the store mock is not written.)
- **`ShelfFilterBar`** (new test): toggling language/maturity updates the rendered
  list and the "N of M" count; language choices derive from entries present.
- **`EntryRow`**: a navigation entry shows the "Browse ›" affordance, a leaf shows
  its media badge.
- **Live (localhost, servers already up)**: add
  `https://m.gutenberg.org/ebooks/search.opds/?query=whale` → the catalog shows
  navigation entries with "Browse ›" → drill into one → its per-book editions
  appear → open a leaf → **Download** pulls the EPUB from gutenberg.org (not our
  backend) → set the language filter and watch the list narrow, toggle "Hide
  mature".

## Build order
A (parser + types + `useFeedBrowser` + `EntryRow` + screen) makes the Gutenberg
demo downloadable; B (`filterEntries` + prefs + `deviceLocale` + `ShelfFilterBar`)
is independent (its pure filter needs no drill-in) but its live demo is richest on
a real multi-entry catalog, i.e. after A. So: **A then B**.

## Out of scope
- Subject (F-2) and media-type (F-3) filters; a global Settings-level pref (this is
  a per-catalog inline bar); OPDS 2.0 (JSON) feeds; persisting drilled-in sub-feeds;
  server-side / URL-param filtering (a separate model the user did not choose).
- The starter list (P0-5) still needs its own plan; this makes navigation catalogs
  *usable*, which unblocks seeding Gutenberg catalog feeds there.
