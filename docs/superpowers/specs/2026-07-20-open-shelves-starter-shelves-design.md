# Open Shelves — Starter Shelves (P0-5, multi-shelf) — Design

**Date:** 2026-07-20
**Status:** Approved
**Branch:** `feat/starter-shelves` (main-track; mergeable)
**Amends:** `docs/superpowers/specs/2026-07-14-open-shelves-starter-list-design.md` (P0-5, "Gutenberg only, one source")
**Spec / ADR:** `docs/specs/open-shelves-spec.md` (P0-5, R5, D3, D3a) · ADR-028

## Goal

A new user opens Shelves and immediately sees real, downloadable books grouped by
topic — no hunting for an OPDS URL. Today the tab is empty until the user pastes a
feed, which almost nobody will do. This seeds a small set of owner-curated
**Project Gutenberg** shelves on first run.

This is the "fix the dead starter feeds" work: there were never committed dead
feeds (`STARTER_SOURCES` has always been `[]`); the fix is to *populate* it with
sources verified live and downloadable.

## What changed since the 2026-07-14 design

That design shipped **one** Gutenberg source after finding every other candidate
dead. Two things are new:

1. **Re-survey 2026-07-20 (below) confirms Gutenberg is still the only live,
   anonymous, OPDS-1.2 source** — and adds evidence that Open Library, though
   live, is unsuitable.
2. Scope decision (2026-07-20): seed **several Gutenberg topical shelves**, not
   one, for better first-run content. Same proven path, more entry points.

### Feed survey (2026-07-20, re-verified live)

| Feed | Result | Verdict |
|---|---|---|
| **Project Gutenberg** `search.opds/?query=…` / `?sort_order=downloads` | 200, Atom, ~25–28 nav entries → per-book feed carries `application/epub+zip` | **USE** (verified drill to EPUB, e.g. #2701 Moby Dick) |
| Standard Ebooks `/feeds/opds` | 401 | dead (auth-gated) |
| Feedbooks `catalog.feedbooks.com/.../public_domain.atom` | 404 | dead |
| ManyBooks `/opds` | 403 | dead |
| Internet Archive `bookserver.archive.org/catalog/` | 000 | dead |
| DOAB `/opds` | 403 | dead |
| Wikisource | 200 but `text/html` | not OPDS |
| **Open Library** `/opds` | 200, **OPDS 2.0 JSON** (`application/opds+json`) | **REJECT** — see below |

**Why Open Library is rejected.** (a) It serves OPDS **2.0 JSON**, which our
`opds12.ts` Atom parser cannot read — a net-new format. (b) More decisively, it is
**borrow-first**: the default catalog queries `ebook_access:[borrowable TO *]`
(Internet Archive controlled-digital-lending, auth-gated); most links are
`application/opds-authentication+json`. Even an open-access-filtered query
(`ebook_access:public + subject:science`) returned 12 books, **only 3 truly
open-access** vs 9 auth-gated, and a plain `ebook_access:public` query returned 0
publications. Surfacing it would greet a new user with a mostly borrow-locked list
whose Download buttons hit auth walls — the exact failure mode the 2026-07-14
design warns against ("a dead/locked starter source is worse than a short list").
Building an OPDS-2.0-JSON parser for that payoff is not justified.

## Decisions

### D-S1: Composition — several Gutenberg topical shelves (amends 2026-07-14 D-S1)

Ship four curated shelves, each a Gutenberg `search.opds` navigation feed that
drills to per-book feeds carrying `application/epub+zip` acquisition links:

| Title | URL |
|---|---|
| Project Gutenberg — Popular | `https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads` |
| Project Gutenberg — Science | `https://www.gutenberg.org/ebooks/search.opds/?query=science` |
| Project Gutenberg — Children's | `https://www.gutenberg.org/ebooks/search.opds/?query=children` |
| Project Gutenberg — History | `https://www.gutenberg.org/ebooks/search.opds/?query=history` |

Use the `www.` host (`m.gutenberg.org` 301-redirects). All four verified 200 with
browsable entries on 2026-07-20; the drill-to-EPUB path is the same one proven for
the single-source design and confirmed again here (#2701 → `2701.epub3.images`).

The exact set is data (A1) and trivially adjustable; four is a reasonable
first-run breadth without padding.

### D-S2: Delivery — bundled constant, seeded on first run (unchanged from 2026-07-14)

The list ships as an in-app constant, seeded into the source store on first run.
No remote-config surface exists in this codebase; building one to steward a few
stable Gutenberg URLs is not justified. Revising the list requires a release
(web redeploys are same-day). Revisit if/when a non-Gutenberg source qualifies.

### D-S3: A removed starter shelf is never resurrected (unchanged)

Seeding is idempotent via a persisted marker (`sbq_seeded_shelves`, the list of
seeded URLs). If the user removes a starter shelf, it **stays removed** — it does
not reappear next launch. Same contract `src/storage/seedLibrary.ts` enforces for
bundled books (reuse the *pattern*, not the code). A **Restore starter sources**
action clears the marker and re-seeds, giving a way back without inventing a
second removal concept.

### D-S4: Seed the record only — no network at startup (unchanged, now load-bearing for 4 rows)

`addSource()` is eager (validate → fetch → parse → persist), so seeding must not
use it: a network call at app start fails on a cold/offline launch and greets a
new user with an error. With **four** shelves this matters more — seeding through
`addSource` would mean up to four Gutenberg round-trips at startup.

Seeding writes each `FeedSource` row directly:
`{ isStarter: true, entryCount: 0, lastRefreshedAt: null, title }`. The feed is
fetched **lazily, on first open** (A3) — so four shelves cost **zero** startup
requests.

### D-S5: Descriptive User-Agent on feed fetches (new)

Gutenberg rate-limits aggressive anonymous polling (504/403 observed in the
2026-07-13 survey). Set a descriptive `User-Agent`
(`Mentible/<version> (+https://mambakkam.net/mentible)`) on outbound feed
requests, in **both** fetch paths:

- **Native** direct fetch (`fetchFeed` / `feedTransport`).
- **Backend proxy** (`backend/src/shelves/feed_fetch.py`) — a UA is not an auth
  header, so it does not violate the "send no auth headers" SSRF rule.

Combined with one-fetch-per-open (A3), this keeps us a well-behaved client.

## Architecture

Reuses the 2026-07-14 units; only the list contents and the UA are new.

### A1: `starterSources.ts` — the list (data)
```ts
export interface StarterSource { url: string; title: string }
export const STARTER_SOURCES: StarterSource[] = [
  { url: "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads", title: "Project Gutenberg — Popular" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=science",       title: "Project Gutenberg — Science" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=children",      title: "Project Gutenberg — Children's" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=history",       title: "Project Gutenberg — History" },
];
```
Pure data; no imports, no behavior. The whole "curation" surface is this array.

### A2: `seedStarterSources.ts` — the seed (idempotent, offline)
- `seedStarterSources(): Promise<SeedResult>` — for each `STARTER_SOURCES` entry
  not in the marker, write a `FeedSource` row (`isStarter: true`,
  `lastRefreshedAt: null`, `entryCount: 0`) and record its URL in the marker.
- Marker: AsyncStorage key `sbq_seeded_shelves` (list of seeded URLs). Persisted,
  so a later removal is respected (D-S3).
- **Makes no network call, ever.** A test asserts this with a `fetchFeed` spy.
- `restoreStarterSources(): Promise<SeedResult>` — re-adds only starter URLs
  **not currently present in the source store**, and re-marks them. It must NOT
  clobber a starter shelf the user kept (re-writing its row would reset that
  shelf's `entryCount`/`lastRefreshedAt` and drop its fetched state). So "restore"
  = "bring back the ones I removed," not "reset all four." (A row-present check,
  not a blind marker-clear + re-seed.)
- Called once at app start, beside the existing library seed.
- Depends on `feedSourcesStore` (`putSource`, `listSources`) + `STARTER_SOURCES`.
  Does **not** depend on `feedStore.addSource` (eager — D-S4).

### A3: Lazy hydration in `useSourceCatalog` — the only new behavior
A seeded source has no stored entries; `useSourceCatalog` reads only stored
entries and never fetches. After load, if a source has `lastRefreshedAt === null`
and no entries, call the existing `refresh()` **once**.
- Ref-guarded against a retry loop: a failed fetch surfaces the existing
  `cat.error` and must not re-trigger (terminal until the user taps Refresh).
  Mutation-checked test — this is the one place a request storm could hide.
- Applies to any never-refreshed source (a property of "seeded but unfetched",
  which only seeding produces today).

## UI
- **Curated badge.** Starter rows show "Curated by Mentible" — first real use of
  `FeedSource.isStarter` (exists on the type, currently always `false`).
- **Restore starter sources.** A link in Shelves calling `restoreStarterSources()`.
- **The add-time curation warning does not fire for starter sources.** The P0-8
  "outside Mentible's curation" confirm lives in the Add-source form; seeding
  writes the store directly and bypasses it by construction. A test pins this.

## Help (Definition of Done — enforced)
Per `CLAUDE.md`, a user-facing feature is not done until its Help topic exists.
Note the current paths (the 2026-07-14 doc predates the refactor):
- Feature key in `mobile/src/help-content/features.ts`; topic in
  `mobile/src/help-content/topics.ts` (NOT the old `constants/helpContent.ts`).
- The Open Shelves topic must now **affirm curated starter libraries** — this is
  *forced* by `mobile/__tests__/help/starter-claim.test.ts`, which fails once
  `STARTER_SOURCES` is non-empty unless a topic matches a `CURATION_CLAIMS`
  phrase (`/starter/i`, `/curated by us/i`, `/we curate/i`). Update the copy to,
  e.g., "A few starter libraries (Project Gutenberg shelves) are included, curated
  by us, so you always have somewhere to start."
- The `coverage.test.ts` gate still requires the feature↔topic mapping.

## Error handling
- **Offline first launch:** seeding does only AsyncStorage I/O → cannot fail on
  network. Shelves appear; opening one shows the normal fetch error + Refresh.
- **Gutenberg down / rate-limiting:** first open surfaces the existing
  `catalog-error`; hydration does not retry (A3). One fetch per open + the UA
  (D-S5) keep us within Gutenberg's tolerance.
- **Seed write failure:** logged and skipped; must never block app start. The
  user can still add sources by hand.

## Testing
| Guarantee | Test |
|---|---|
| Seeds all shelves on a clean install | `seedStarterSources` writes each row, `isStarter: true` |
| Idempotent | second run writes nothing |
| **A removed shelf is not resurrected** | remove → seed again → still absent |
| **No network at startup** | spy `fetchFeed`; assert not called during seeding (esp. with 4 rows) |
| Lazy hydration fetches once per source on first open | never-refreshed → `refresh()` once |
| **A failed hydration does not loop** | fetch rejects → error shown, no second fetch (mutation-checked) |
| Restore works | remove → restore → present; re-seed still idempotent |
| Curation warning not fired by seeding | seeding does not invoke the Add-source confirm path |
| **Help curation claim** | `starter-claim.test.ts` passes with the updated copy (was `[]`-only) |
| User-Agent set | `feedTransport`/`fetchFeed` (native) and `feed_fetch.py` (backend) send the UA |

No test hits a live feed — CI never touches the network (repo rule). Feed liveness
verified manually (this survey); re-verify before ship.

## Out of scope (deliberately)
- **OPDS 2.0 JSON / Open Library** — borrow-gated, net-new format, poor payoff
  (evidence above).
- **Remote config** for the list (D-S2 — revisit with a non-Gutenberg source).
- **Any non-Gutenberg source** — none qualifies today; a fresh survey is its own task.
- **Per-subject dynamic shelves / an owner "featured books" rail** — untouched.

## Doc amendments this design requires
- **This spec amends** the 2026-07-14 starter-list design (one source → four
  Gutenberg shelves) and its D-S1 survey table (add the 2026-07-20 re-verify +
  Open Library rejection).
- **Spec D3 / D3a** already amended by the prior design; this only widens
  composition within the same (Gutenberg) provider.

## Follow-ups
- Re-survey for a *non-Gutenberg* qualifying feed (live, anonymous, HTTPS,
  OPDS-1.2 or worth an OPDS-2.0 parser, reaches open-access acquisition). If one
  lands, revisit D-S2 (remote stewardship starts to earn its cost at 2 providers).
- If users ask, expand or make the topical shelf set configurable.
