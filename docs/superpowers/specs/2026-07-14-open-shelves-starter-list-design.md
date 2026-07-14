# Open Shelves — Starter List (P0-5) — Design

**Date:** 2026-07-14
**Status:** Proposed
**Branch:** `feat/open-shelves` (localhost-only; not merged to main)
**Spec:** `docs/specs/open-shelves-spec.md` (P0-5, R5, D3, D3a)
**ADR:** ADR-028 (Open Shelves — free book repo feeds)

## Goal

A new user opens Shelves and sees real books without hunting for an OPDS URL.
Today the tab is empty until the user pastes a feed URL from somewhere — which
almost nobody will do. This ships one owner-curated source, seeded on first run.

## Why now

P0-5 was blocked on a real gap: Project Gutenberg's catalog feeds are
*navigation* feeds — their entries are `subsection` links to per-book feeds and
carry **no acquisition links**. Seeding one would have produced a
browsable-but-undownloadable list. The navigation drill-in landed on
2026-07-14 (`useFeedBrowser`, commits `1ded43d..bd92319`), so a Gutenberg
catalog now walks through to a real, downloadable book. This design depends on
that and does not work without it.

## Decisions

### D-S1: Composition — Gutenberg only (amends spec D3)

Spec D3 (resolved 2026-07-10) named **Internet Archive + Project Gutenberg +
Feedbooks public-domain**. Re-verified 2026-07-14, two of the three are gone and
both named fallbacks are gated:

| Feed | Status (2026-07-14) |
|---|---|
| Internet Archive — `bookserver.archive.org/catalog/` | `000` — dead |
| Feedbooks public-domain — `catalog.feedbooks.com/catalog/public_domain.atom` | `404` |
| Standard Ebooks — `standardebooks.org/feeds/opds` (D3a fallback) | `401` — auth-gated |
| ManyBooks — `manybooks.net/opds` (D3a fallback) | `403` |
| **Project Gutenberg** — `https://www.gutenberg.org/ebooks.opds/` | **`200` — live, anonymous** |

**The starter list ships one source: Project Gutenberg.** Its root is itself a
navigation feed (shelves: *Popular*, *Latest*, *Random*), so a single entry
gives a real browsing tree, ~75k public-domain books, no account, no key.

A dead starter source is worse than a short list: it greets a new user with an
error on the one screen meant to prove the feature works. We ship what is
verified live and revisit composition when a second qualifying feed exists.

Note: use the `www.` host. `m.gutenberg.org` 301-redirects.

### D-S2: Delivery — bundled constant, seeded on first run (amends spec P0-5)

P0-5 says the list is "delivered via remote config so the list can be revised
without release." **No remote-config surface exists** in this codebase (no
client fetcher, no backend endpoint). That is unbuilt work, not a free ride.

The list ships as a **constant in the app**, seeded into the source store on
first run. Revising it requires a release.

Deferred, with reasons: the "revise remotely" requirement exists so a
*problematic* starter source can be pulled without an app release. With one
long-lived, institutionally-stable source (Gutenberg has run since 1971), that
risk is small; web redeploys are same-day; and the user can remove the source
themselves. Building a config surface, a device cache, a fallback path, and
their tests to steward a single URL is not justified yet. Revisit when a second
source lands (see Follow-ups).

### D-S3: A removed starter source is never resurrected

Seeding is idempotent via a persisted marker. If the user removes the starter
source, it **stays removed** — it does not reappear on the next launch. A
source that resurrects itself after a deliberate delete is a bug, not a feature.

This is the exact contract `src/storage/seedLibrary.ts` already enforces for
bundled books ("If the user later deletes a seeded book, it is NOT
resurrected"). We reuse the pattern, not the code — different domain, same rule.

To keep removal from being a one-way door, Shelves gets a **Restore starter
sources** action: it clears the marker and re-seeds. This satisfies the spec's
"user can hide starter sources" intent without inventing a second removal
concept alongside the existing Remove.

### D-S4: Seed the record only — no network at startup

`addSource()` is eager by construction: validate → fetch → parse → *then*
persist (so a bad add leaves the catalog untouched, per P0-1). Seeding must not
use it: a network call at app start fails on a cold offline launch and would
greet a brand-new user with an error.

Seeding writes the `FeedSource` row directly:
`{ isStarter: true, entryCount: 0, lastRefreshedAt: null, title: "Project Gutenberg" }`.

The feed is fetched **lazily, on first open** (see A3).

## Architecture

Three units. Only one carries new logic.

### A1: `starterSources.ts` — the list (data)

```ts
export interface StarterSource { url: string; title: string }
export const STARTER_SOURCES: StarterSource[] = [
  { url: "https://www.gutenberg.org/ebooks.opds/", title: "Project Gutenberg" },
];
```

Pure data. No imports, no behavior. The whole "curation" surface is this array.

### A2: `seedStarterSources.ts` — the seed (idempotent, offline)

- `seedStarterSources(): Promise<SeedResult>` — for each entry in
  `STARTER_SOURCES` not already in the marker, write a `FeedSource` row
  (`isStarter: true`, `lastRefreshedAt: null`, `entryCount: 0`) and record its
  url in the marker.
- Marker: AsyncStorage key `sbq_seeded_shelves`, holding the list of seeded urls.
  Persisted, so a later removal is respected (D-S3).
- **Makes no network call.** Ever. Tests assert this with a spy on `fetchFeed`.
- `restoreStarterSources(): Promise<SeedResult>` — clears the marker and
  re-seeds. Backs the Restore action.
- Called once at app start, alongside the existing library seed.

Depends on: `feedSourcesStore` (`putSource`, `listSources`), `STARTER_SOURCES`.
Does **not** depend on `feedStore.addSource` (that path is eager — D-S4).

### A3: Lazy hydration in `useSourceCatalog` — the only new behavior

A seeded source has no stored entries, and `useSourceCatalog` reads only stored
entries — it never fetches. Opening one today would show "No items in this
catalog," which is a poor first impression of the whole feature.

Add: after load, if the source has `lastRefreshedAt === null` **and** no
entries, call the existing `refresh()` once.

- **Guarded against a retry loop.** A failed fetch surfaces the existing
  `cat.error` and must not re-trigger. A ref (not state) records that hydration
  was attempted for this source, so a failure is terminal until the user taps
  Refresh. This is the one place a request storm could hide against a rate-
  limiting host, so it gets a mutation-checked test.
- Applies to any never-refreshed source, not just starter ones — it is a
  property of "seeded but unfetched," which only seeding can currently produce.

## UI

- **Curated badge.** A starter row shows a "Curated by Mentible" marker,
  distinguishing an owner-vouched source from a pasted URL. First real use of
  `FeedSource.isStarter`, which already exists on the type and is currently
  always `false`.
- **Restore starter sources.** A link in Shelves, calling
  `restoreStarterSources()`.
- **The add-time curation warning does not fire for starter sources.** The
  P0-8 "outside Mentible's curation — your responsibility" confirm lives in the
  Add-source form (`app/(tabs)/shelves.tsx`). Seeding writes the store directly
  and never touches that form, so it is bypassed by construction — Gutenberg
  *is* our curation. A test pins this so a future refactor cannot route seeding
  through the warning path.

## Error handling

- **Offline first launch:** seeding does no I/O beyond AsyncStorage, so it
  cannot fail on network. The source appears; opening it shows the normal
  fetch error and a Refresh.
- **Gutenberg down / rate-limiting:** first open surfaces the existing
  `catalog-error`; hydration does not retry (A3). Gutenberg rate-limits
  aggressive polling (`504`/`403` observed during the survey) — one fetch per
  open, never a loop.
- **Seed write failure:** logged and skipped; a failed seed must never block app
  start. The user can still add sources by hand.

## Testing

| Guarantee | Test |
|---|---|
| Seeds on a clean install | `seedStarterSources` writes the Gutenberg row, `isStarter: true` |
| Idempotent | second run writes nothing |
| **A removed source is not resurrected** | remove → seed again → still absent (the rule that matters most) |
| **No network at startup** | spy `fetchFeed`; assert not called during seeding |
| Lazy hydration fetches once on first open | never-refreshed source → `refresh()` called once |
| **A failed hydration does not loop** | fetch rejects → error shown, no second fetch (mutation-checked) |
| Restore works | remove → restore → present; re-seed still idempotent |
| The curation warning is not fired by seeding | seeding does not invoke the Add-source confirm path |

No test hits a live feed — CI never touches the network (repo rule). Feed
liveness is verified manually, as D3a requires.

## Definition of Done

Per `CLAUDE.md`: a user-facing feature is not done until its Help topic exists —
add the feature key to `FEATURES` in `mobile/src/constants/helpContent.ts` and a
Help topic with that key, in the same PR. The coverage gate
(`mobile/__tests__/help/coverage.test.ts`) fails otherwise.

## Doc amendments this design requires

- **Spec D3** — composition amended (three sources → Gutenberg only), with the
  dead-feed evidence recorded. This reverses a resolved decision, so it is
  written down, not silently dropped.
- **Spec P0-5** — "delivered via remote config" → "bundled constant, seeded on
  first run"; the revise-without-release requirement explicitly deferred (D-S2).
- **Spec D3a** — satisfied: the starter feed is verified live *and* verified to
  reach acquisition links (which requires the drill-in).

## Out of scope (deliberately)

- **Remote config** for the starter list (D-S2 — revisit with a second source).
- **A second/third source** — none qualifies today; a survey is its own task.
- **Hide-vs-remove** as distinct concepts — Remove + Restore covers it.
- **Curated Gutenberg subject shelves** (science, fiction, …) — padding one
  operator into several rows; revisit if users ask for topical entry points.
- **An owner "featured books" rail** (spec, Later) — untouched.

## Follow-ups

- Re-survey for a second qualifying feed (live, anonymous, HTTPS, reaches
  acquisition links). Candidates not yet probed: Open Library, Wikisource,
  Gallica, DOAB, Runeberg. If one lands, revisit D-S2 — two sources is where
  remote stewardship starts to earn its cost.
- Set a descriptive `User-Agent` on feed fetches (Gutenberg rate-limits
  aggressive anonymous polling; observed `504`/`403` during the survey).
