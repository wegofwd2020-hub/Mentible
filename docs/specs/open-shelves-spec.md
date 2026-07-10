# SPEC — Free Book Repo Feeds ("Open Shelves") — v0.8

**Status:** Promoted — 2026-07-10 (v0.8). All blocking questions resolved; this spec is
now the requirements companion to `docs/adr/ADR-028-open-shelves-free-book-repo-feeds.md`
(Proposed). The changelog below is the decision trail.
**Decision-maker:** Sivakumar Mambakkam
**Suggested ticket:** SBQ-ARC-001 (new series)
**Relates to:** ADR-004 (two-product split — reader-side feature), ADR-015 (Content
Trust Manifest — external provenance), ADR-017 (owner-curated default library),
ADR-021 (Everyone Library deferral — untouched), ADR-014 (local-first; no server-side
book storage), ADR-020 (super-admin — starter-list stewardship), ADR-001 (data/key
discipline — extended here to personal data), ADR-022 (account deletion — anything
collected must be deletable)
**Companion:** `docs/research/personal-data-filter-research.md` (Google sign-in data
availability + industry habit-collection survey — the evidence base for §6b/§7a)

**Changelog v0.1 → v0.2**
- R1: Users can add their own free book repos (feeds) — user-managed sources are now P0.
- R2: Authenticated archive interfaces are out of scope (public/anonymous feeds only).
- R3: **Feed metadata only** is stored on device; book/audio/video content is never
  downloaded — reading is online-only. This resolves v0.1's D1 (federate-never-mirror)
  by construction and retires the import/download machinery entirely.
- R4: Manual feed refresh is a P0 capability.
- R5: Mentible ships a minimum curated starter list of free repos.

**Changelog v0.2 → v0.3**
- Added §6b **Catalog filtering & personalization** — filter dimensions (language,
  topic, media type, maturity) powered by *device-local declared preferences ×
  feed metadata* only, per the companion research's R-F1–R-F3.
- Added privacy posture to Non-Goals: default Google OAuth scopes only (research
  R-G1); no behavioral profiling; no server-side preference profiles.
- Recorded the two honest limitations: Google sign-in is **not** age verification;
  feed maturity metadata is unreliable — filters are preferences, not locks.
- New open questions **D8** (maturity strategy — blocking), **D9** (filters in v1
  vs fast-follow), **D10** (preferences vs future sync).
- New filter-related user stories, technical considerations, and metrics.

**Changelog v0.3 → v0.4**
- **D5 RESOLVED (decision by Siva, 2026-07-10): only published standard feed
  formats are supported** — the OPDS family (OPDS 1.2 at P0; OPDS 2.0 at P1).
  Non-standard or unrecognized feed formats are not parsed; the add-source
  failure path refers the user to **support@mentible.mambakkam.net** so demand
  for additional formats is captured rather than lost. P0-2 acceptance criteria
  and Non-Goals updated accordingly.

**Changelog v0.4 → v0.5**
- **D6 RESOLVED (decision by Siva, 2026-07-10): neutral-conduit model.** Mentible
  provides a curated list of open libraries (the starter list, P0-5). When a user
  adds their own library, the app **posts a warning** at add time; Mentible does
  **not block** user-added sources or their content — no denylist, no content
  inspection. P0-8 updated from "one-time notice" to an add-time warning;
  residual (non-blocking) task: final warning copy + whether the ToS gains a
  matching clause.

**Changelog v0.5 → v0.6**
- **D2 RESOLVED (decision by Siva, 2026-07-10), amending R3 → R3′:**
  **EPUB, PDF, and audio content may be downloaded** to the user's device for
  **offline use**; **video is streaming-only** (never downloaded). Users are
  informed/prompted about **where** their offline content is stored; storage is
  **device-local only** (never synced or uploaded), and managing storage space
  is the **user's responsibility**. Mentible infrastructure still never hosts,
  mirrors, or proxies content — the "catalog, not content" stance now applies to
  the *server side*, while the device side gains user-initiated downloads.
- §2 stance rewritten; the "No content downloads" non-goal replaced with the
  video-only restriction; P0-6 rewritten and new **P0-10 (download & offline
  storage management)** added; user stories, technical considerations, and P2
  updated. Residual **D2a** (non-blocking): which surface renders downloaded
  files — system handler vs in-app renderer.

**Changelog v0.6 → v0.7**
- **D3 RESOLVED (decision by Siva, 2026-07-10): starter list = Internet Archive,
  Project Gutenberg, Feedbooks public-domain** (replacing the proposed Standard
  Ebooks slot with Internet Archive). P0-5 updated with candidate feed URLs.
  Residual **D3a (launch prerequisite, non-blocking for the ADR):** verify each
  feed live — parses as OPDS, served over HTTPS (P0-8 requires it; IA's
  BookServer URL is historically listed as http), and confirm the IA entry-point
  scopes to public-domain/direct-download collections, since IA's
  controlled-digital-lending items require an account and would hit the P0-9
  no-auth guardrail.

**Changelog v0.7 → v0.8**
- **D8 RESOLVED (decision by Siva, 2026-07-10): Option 1 — metadata-flag-only**
  maturity filtering (F-4 mechanics settled; P0-3 schema stores the feed's
  maturity flag where present).
- **New: optional Goodreads ratings layer (per Siva, 2026-07-10)** — beyond
  Option 1, users can optionally use goodreads.com to see book ratings. Shaped
  by a hard external fact: **Goodreads discontinued its public API in Dec 2020**
  (no new keys; tools retired), so in-app Goodreads rating values cannot be
  obtained legitimately. v1 shape: **ER-1**, an opt-in per-entry
  "View ratings on Goodreads" **link-out** (ToS-clean, user-initiated). In-app
  rating *numbers* from a provider with a real public API (Open Library /
  Google Books / Hardcover) parked as **ER-2 / D11** (non-blocking).
- New non-goal: no scraping or unofficial Goodreads APIs.
- **All ADR blockers are now resolved** — spec is promotion-ready.

---

## 1. Problem Statement

Mentible readers have no in-app path to the large world of legally free books
(Project Gutenberg, Standard Ebooks, Open Library, DOAB and many OPDS-speaking
libraries). v0.1 of this spec proposed importing books to the device; the refined
direction is lighter: Mentible becomes a **catalog client**. Users subscribe to free
book repos (feeds), browse rich metadata locally, and read the actual content
online at the source. No content ever touches Mentible infrastructure or, beyond
the feed cache, the device.

## 2. Core Design Stance (R3 as amended by D2 → "R3′")

> **Server side — catalog, not content.** Mentible infrastructure stores only
> **feed information** — source definitions and entry metadata (title, author,
> cover reference, description, license, content links). Mentible never hosts,
> mirrors, or proxies the books, audio, or video themselves.
>
> **Device side — user-initiated downloads, user-owned storage.** The user may
> download **EPUB, PDF, and audio** content to their own device for **offline
> use**. **Video is streaming-only** — never downloaded. Downloads go to a
> storage location the user is informed of (and, where the platform allows,
> chooses); that storage is **device-local only** — never synced, never uploaded,
> never counted against any Mentible-side quota. **A download exists only on the
> device where it was performed**: signing into the same account on another
> device does not carry downloads over — each device downloads independently.
> Managing device storage space
> is the user's responsibility; the app informs, it does not police.

Consequences: zero Mentible storage of third-party content (ADR-021 posture fully
preserved); DMCA/redistribution exposure remains limited to *linking* — content
flows source → user's device directly; the catalog cache stays tiny while
downloaded media size is user-governed; offline reading/listening works for
downloaded items, while video and non-downloaded items require a connection.

**Companion stance (v0.3): preferences, not profiles.** Filtering and any future
personalization operate as a pure function of *(device-local declared preferences
× feed metadata)*. No behavioral collection, no inference, no server-side profile
— see §6b and the companion research document.

## 3. Goals

1. A reader can add a free book repo by URL and be browsing its catalog in under a
   minute, with clear validation feedback if the feed is unusable.
2. Out of the box (no account, no key, no setup), the starter list gives readers
   something real to browse on first launch.
3. Feed refresh is user-controlled, fast, and safe — a refresh never corrupts or
   duplicates the local catalog.
4. Every catalog entry displays its source and license class — provenance-by-
   metadata, the lightweight sibling of the Content Trust Manifest.
5. ≥ 25% of weekly-active readers open at least one repo-sourced book within 60
   days of launch (unchanged from v0.1).
6. *(v0.3)* A reader can narrow the catalog to their languages, topics, and media
   types without Mentible learning anything about them beyond what sits on their
   own device.

## 4. Non-Goals

- *(v0.6, per D2/R3′)* **No video downloads — video is streaming-only.** EPUB,
  PDF, and audio downloads are in scope (P0-6/P0-10); video is never persisted
  to the device, not even as a transient playback cache beyond normal
  player buffering.
- *(v0.6)* **No cloud storage of downloaded content.** Downloads are device-local
  only — never synced, backed up, or uploaded by Mentible; no server-side record
  of *what* a user downloaded beyond aggregate counters (§8's constraint).
- *(v0.6)* **No storage policing.** The app informs about storage location and
  shows usage; it does not enforce quotas or auto-evict — storage management is
  the user's responsibility.
- **No authenticated repos** — no login, API key, or token flows for sources.
  Public/anonymous feeds only (R2). Design must not preclude adding auth later,
  but no auth field ships.
- **No hosting/mirroring/proxying of content** on Mentible infrastructure. If a
  feed is CORS-blocked on web, that source simply doesn't work on web in v1
  (see D4) — we do not proxy content to fix it.
- **No shadow libraries in the starter list.** Starter sources require a clear
  legal basis. *(v0.5, per D6)* User-added sources follow the **neutral-conduit**
  model: warned at add time, the user's responsibility, and **not blocked or
  inspected** by Mentible — no denylist ships.
- **No generation involvement** — no LLM path, no BYOK, no `wegofwd-llm`.
- **Not the Everyone Library** (ADR-021 D8 gate untouched); repo entries are
  inbound external references, not published Mentible content.
- **No ratings/feedback on repo content in v1** — ADR-023 semantics imply our
  catalog; parked as P2.
- **No background/scheduled refresh in v1** — refresh is manual (R4); auto-refresh
  is P1 at most.
- *(v0.4, per D5)* **No non-standard feed formats.** Only published standard feed
  formats (the OPDS family) are parsed. Bespoke JSON APIs, scraping, plain
  RSS/Atom book lists, and any other format are out of scope; the in-app failure
  message directs users to **support@mentible.mambakkam.net** to request support
  for an additional format. This keeps the parser surface small (a security
  property — see §7) and turns format demand into a measurable support signal.
- *(v0.8)* **No scraping or unofficial Goodreads APIs.** Goodreads' public API is
  discontinued; rating values are not scraped, proxied, or fetched via
  third-party scraper services. Goodreads participation is link-out only (ER-1)
  unless/until an official interface exists.
- *(v0.3)* **No extended Google OAuth scopes** (research R-G1). Sign-in stays at
  `openid`/`email`/`profile`; no birthday/gender/People-API scopes, no Google
  verification-review burden, no consent friction. Google identity data (name,
  picture) is display-only and never feeds filtering, analytics, or inference.
- *(v0.3)* **No behavioral or inferred personalization** (research R-F2). No
  observed reading-habit collection (progress, session times, in-catalog search
  history), no derived taste profiles, no "because you read X" — server-side or
  otherwise — in this feature. A future local-first recommendation feature gets
  its own decision.
- *(v0.3)* **No server-side preference storage.** Filter preferences live on the
  device (see D10 for the future-sync question).

## 5. User Stories

- As a **reader**, I want to paste the URL of a free book repo and have Mentible
  recognize it, so that I can browse catalogs I care about.
- As a **new user with nothing configured**, I want a few good free libraries
  already present, so the shelf isn't empty on day one (R5).
- As a **reader**, I want to refresh a repo's feed on demand and see when it was
  last refreshed, so I know the catalog is current (R4).
- As a **reader**, I want to open a book from a repo and read it online, and be
  told plainly when I'm offline that this content needs a connection (R3).
- As a **reader**, I want to remove a repo I added and have its entries disappear
  cleanly from my catalog.
- As a **reader who pasted a bad URL**, I want a specific error (not a feed /
  unreachable / unsupported format) rather than a silent failure.
- As the **owner**, I want to revise the starter list remotely so a problematic
  starter source can be removed without an app release.
- *(v0.6)* As a **commuter**, I want to download a book or audiobook while on
  wifi and use it offline later, so my reading isn't hostage to connectivity.
- *(v0.6)* As a **reader**, I want to be told where my offline content lives on
  my device and see how much space it uses, so I stay in control of my storage.
- *(v0.6)* As a **reader low on space**, I want to delete downloaded items
  individually or all at once, so cleanup is easy — and I understand keeping
  space free is on me.
- *(v0.3)* As a **multilingual reader**, I want to limit the catalog to the
  languages I read, so browsing isn't dominated by languages I don't.
- *(v0.3)* As a **reader with specific interests**, I want to pick topics once and
  have the catalog lean toward them, so discovery feels relevant without an
  account or tracking.
- *(v0.3)* As a **privacy-conscious reader**, I want filtering to work entirely on
  my device, so my reading interests are never transmitted or profiled.
- *(v0.3)* As a **reader**, I want a "hide mature-flagged entries" toggle that is
  on by default, and honest wording about its limits, so I'm neither surprised by
  content nor misled about guarantees.

## 6. Requirements

### P0 — Must have

| # | Requirement | Acceptance criteria (abridged) |
|---|---|---|
| P0-1 | **User-managed sources (R1).** Add repo by URL; list, view details, remove. Removal purges that source's cached entries | Given a valid feed URL is added, when add completes, then the source appears in Sources with entry count and last-refreshed time; given removal, then no entries from it remain |
| P0-2 | **Feed format support: OPDS 1.2 (Atom) as the required baseline**, structured for additional adapters (OPDS 2.0/JSON as first follow-on). One seam: `validate`, `fetch_feed`, `parse_entries`. *(v0.4, per D5)* Only published standard formats are accepted — no bespoke-format adapters | Given an OPDS 1.2 feed, entries parse with title/author/links; given a non-standard or unrecognized feed, add fails with an "unsupported format" message that names the supported standard (OPDS) and refers the user to **support@mentible.mambakkam.net** to request additional format support |
| P0-3 | **Feed-info-only storage (R3).** Local store holds source records + entry metadata (title, author(s), description, cover URL, license/rights string, **language, category/subject terms, media type** *(v0.3 — the filterable fields)*, content links, source ref, fetched-at). **No content payloads persisted** | Code review + storage inspection show no content file paths; app storage growth from a 10k-entry feed stays within the metadata budget (see §7) |
| P0-4 | **Manual refresh (R4)**, per-source and refresh-all. Refresh is idempotent: entries upsert on stable identity (feed entry ID), removed entries are pruned, partial failure leaves the previous good cache intact | Given refresh fails mid-way, then the prior catalog remains; given the same feed refreshed twice, then no duplicates exist |
| P0-5 | **Starter list (R5; composition per D3).** Ships with three owner-curated sources: **Internet Archive** (candidate: the BookServer OPDS catalog, scoped to public-domain/direct-download collections — see D3a), **Project Gutenberg** (candidate: `https://m.gutenberg.org/ebooks.opds/`), and **Feedbooks public-domain** (candidate: the public-domain section of `https://catalog.feedbooks.com/catalog/index.atom`) — delivered via remote config so the list can be revised without release; user can hide starter sources but the list itself is owner-managed | Given a fresh install, the three starter sources are present and browsable; given the remote list changes, clients reflect it on next config fetch; each starter feed passes D3a verification before ship |
| P0-6 | **Content access (R3′, per D2).** EPUB/PDF/audio entries offer **Download** (user-initiated) and open for offline use once downloaded; **video entries stream only** — no download affordance exists for video. Non-downloaded items and all video require a connection; offline state is detected and messaged before attempting | Given a downloaded EPUB and no connection, it opens and is readable; given a video entry, no download control is present and offline attempts show a clear "requires connection" message; nothing hangs |
| P0-7 | **Provenance surfacing.** Entry detail shows source repo, license/rights as provided by the feed, and the canonical source link. *(v0.6)* Downloaded copies remain associated with their provenance record | Every entry detail view renders source + rights; absent rights render as "not stated by source," never invented; a downloaded item's detail view shows the same provenance |
| P0-10 | *(v0.6)* **Download & offline storage management.** Before/at first download the user is **informed (and where the platform allows, prompted) about where offline content is stored** (Android: user-visible storage via the system picker/SAF or a clearly named app folder; web: the browser's standard download location). A Downloads/Offline view lists downloaded items with per-item size and total usage, and supports per-item and bulk **delete**. Downloads show progress, are cancelable, and a failed/partial download never leaves a corrupt item listed as available. Storage is device-local only — **downloads are specific to the device on which they were performed and never transfer via the account**; the app never blocks a download for space reasons — it surfaces usage and lets the user decide | Given a first download, the storage-location message displays; given the Downloads view, sizes and totals render and delete works per-item and in bulk; given a download interrupted at 50%, the item is not marked offline-available and retry completes cleanly |
| P0-8 | **User-added-source safety.** HTTPS-only feed URLs; feed size/entry caps enforced at parse; metadata sanitized before render (feed XML/HTML is untrusted input). *(v0.5, per D6)* Adding a source posts a **warning** stating that user-added libraries are outside Mentible's curation and are the user's responsibility; Mentible does **not** block or inspect user-added sources or their content | Given a user adds a source, the warning displays before the source is saved and the user confirms; given a feed exceeding caps, add/refresh fails cleanly with a limit message; given hostile markup in a feed field, it renders inert |
| P0-9 | **No-auth guardrail (R2).** URLs requiring authentication fail with a specific "authenticated repos aren't supported yet" message | Given a 401/403 feed, the message is the specific one, not a generic error |

### §6b — Catalog filtering & personalization *(v0.3; priority pending D9)*

Filtering is a **pure function of (device-local declared preferences × feed
metadata)** — research R-F1. No Google data beyond sign-in itself, no behavioral
signals, nothing server-side. Whether this block ships in v1 or as the first
fast-follow is D9; the maturity strategy within it is D8 (blocking either way,
because P0-3's stored fields must support it).

| # | Requirement | Acceptance criteria (abridged) |
|---|---|---|
| F-1 | **Language filter.** User-declared preferred language(s), **defaulted from the device/app locale** — never from the Google `locale` claim (removed from ID tokens; unreliable). Matches feed `dc:language` | Given a preferred-language set, when browsing, then entries in other languages are hidden (with a visible "showing N of M — language filter" affordance); entries with no language stated remain visible |
| F-2 | **Topic filter.** User-declared interest picks (onboarding/settings chips) matched locally against feed `category`/subject terms; free-form terms match case-insensitively | Given topic picks exist, browsing offers a "my topics" view; clearing picks restores the full catalog; no topic data leaves the device |
| F-3 | **Media-type filter.** Book / audio / video, driven by acquisition-link MIME type; interacts with D7 (P0 may filter to books outright) | Given media types are known, type badges render and the filter narrows correctly; unknown MIME types classify as "other," never silently hidden |
| F-4 | **Maturity toggle.** "Hide mature-flagged entries," **on by default**, applied where the feed provides a flag. *(v0.8)* Strategy settled per **D8: metadata-flag-only** — no keyword heuristics, no content inspection; P0-3 stores the feed's maturity flag where present. In-product wording is honest: a courtesy filter, not a guarantee (research R-F3) | Given the toggle is on and a feed flags an entry mature, the entry is hidden; unflagged entries always show; settings copy states the metadata-dependent limitation verbatim-reviewed |
| F-5 | **Preference storage.** All filter state is a small, versioned, serializable local preference record — deletable with app data (ADR-022 spirit) and structured to ride zero-knowledge sync later without migration (D10 insurance) | Preferences survive restart; clearing app data removes them; the record round-trips serialize/deserialize in tests |

**Recorded limitations (design inputs, not bugs):** Google sign-in provides no
age data at default scopes and is **not age verification** — the adults-only
posture (README #3) remains a terms/positioning matter, and no filter may be
presented as an age gate. Feed maturity metadata is sparse and inconsistent
across OPDS sources — hence F-4's honest-wording requirement and D8's
flag-only resolution.

### §6c — External ratings *(v0.8, optional layer beyond D8/Option 1)*

Users can optionally use goodreads.com to see a book's ratings. Constraint that
shapes the design: Goodreads **discontinued its public API in December 2020** and
retired its developer tools, so rating values cannot legitimately be fetched
into the app; scraping and unofficial APIs are excluded by non-goal.

| # | Requirement | Acceptance criteria (abridged) |
|---|---|---|
| ER-1 | **"View ratings on Goodreads" link-out (opt-in).** A settings toggle ("Show Goodreads links," **off by default**) adds a per-entry action on book entries that opens Goodreads in the browser — by ISBN search where the feed provides an identifier, else by title+author search. Wholly user-initiated: nothing is sent to Goodreads until the user taps, consistent with the preferences-not-profiles stance | Given the toggle is on and an entry has an ISBN, tapping opens the Goodreads search for that ISBN; given no ISBN, title+author search opens; given the toggle is off (default), no Goodreads affordance appears; no network request to Goodreads ever occurs without a tap |
| ER-2 | *(P2, per D11)* **In-app rating display** from a provider with a genuine public API — candidates: Open Library ratings, Google Books `averageRating`, Hardcover GraphQL. Opt-in, with clear disclosure that enabling it sends book lookups to the chosen third party | Deferred — gated on D11 |

### P1 — Should have

- **OPDS 2.0 (JSON) adapter**; plus per-source in-catalog **search** where the feed
  advertises OPDS search. *(Note (v0.3): in-catalog search queries are executed
  against the local cache or the source; they are never logged or retained as an
  interest signal — consistent with the no-behavioral-collection non-goal.)*
- **§6b filter block, if D9 lands it here rather than v1.**
- **Auto-refresh policy** (staleness-triggered on app open), still user-visible and
  cancelable — manual refresh remains the contract.
- **Owner "featured from the shelves" rail** — curated deep links into starter
  sources via existing default-library mechanics (links only).
- **QR/deep-link share (ADR-024 pattern)** of a *source reference* (repo URL +
  entry ID) — recipient's client resolves against the repo directly.
- **Media-type awareness**: feeds may list audio/video entries (LibriVox etc.);
  P1 renders them with correct type badges. *(v0.6, per R3′)* Audio entries get
  the same download/offline treatment as EPUB/PDF (P0-6/P0-10); **video entries
  stream only, never download** — timing of audio/video entry support remains D7.

### P2 — Future considerations (design headroom only)

- Authenticated repos (library-card / token flows) — R2 says not now; the source
  record schema should carry a nullable auth-descriptor field from day one so the
  store doesn't need migration later.
- ~~Offline caching as an explicit, user-invoked, per-book opt-in~~ — *(v0.6)*
  **realized by D2/R3′** for EPUB/PDF/audio (now P0-6/P0-10); the only remaining
  P2 shape of this item is video-offline, which the D2 decision explicitly
  excludes and which would need its own reversal decision.
- Cross-source unified search; **local-first recommendations** (on-device
  computation over the local catalog + declared preferences only — any move
  beyond that reopens the personalization non-goal and needs its own ADR).
- Ratings/feedback semantics for external entries (v0.1 D5, still parked).

## 7. Technical Considerations

- **Client-only feature.** v1 requires no backend endpoints; the starter list rides
  the existing remote-config surface (P0-5), keeping the FastAPI backend untouched.
  If any backend work does emerge, it follows the house standard: typed exceptions
  mirroring `PublishError`/`CompilerError` (proposed: `FeedSourceError`,
  `FeedParseError`, `FeedRefreshError`), OpenSpec-style structured docstrings, and
  pytest with mock fixtures — canned OPDS 1.2/2.0 documents, an oversized feed, a
  malformed-XML feed, a 401 response, and an entries-removed-between-refreshes
  pair to prove idempotent upsert/prune. No live network in tests.
- *(v0.6)* **Download handling.** Downloads go source → device directly (no
  Mentible relay). Integrity: verify size/completeness before marking an item
  offline-available (partial files quarantined). Platform storage: Android uses
  the system document picker (SAF) or a clearly named user-visible folder — not
  opaque internal app storage, since the user is told where content lives and
  owns cleanup; web uses the browser's native download flow (which also means
  web offline is effectively "the user has the file," not in-app offline — an
  accepted platform asymmetry alongside CORS). Downloaded files from user-added
  sources are untrusted input to whatever renders them: if an in-app renderer is
  chosen (D2a), it must treat EPUB internals (HTML/CSS/JS) as hostile — scripts
  disabled, resources sandboxed; the system-handler path delegates that risk to
  the OS app. Deleting a downloaded item removes the file and the offline flag
  but never the catalog entry.
- *(v0.3)* **Filtering is pure and local.** Filter evaluation takes (preference
  record, entry metadata) → boolean; implemented as side-effect-free functions
  with table-driven tests, mock fixtures covering: multi-language entries, absent
  `dc:language`, free-form vs coded category terms, unknown MIME types, and
  mature-flag present/absent/malformed. Feed-side filterable fields (language,
  categories, media type, maturity flag) are normalized at parse time into P0-3's
  entry record so filtering never re-touches raw feed XML.
- **Parsing is the attack surface.** Feed XML is untrusted: disable external entity
  resolution (XXE), bound parse depth/size, sanitize all rendered strings (P0-8).
  *(v0.3: category/subject terms are rendered as user-visible chips — they pass
  through the same sanitization as all other feed strings.)*
- **Metadata budget**: cap per-source entries (e.g. paginate large catalogs rather
  than slurping Gutenberg's full 75k) and set a per-entry field-size ceiling —
  "feed info only" should mean megabytes, not gigabytes. *(v0.3: the added
  filterable fields are short strings; budget impact is negligible but the
  per-entry ceiling applies to them too.)*
- **Web platform + CORS**: many OPDS feeds lack CORS headers, so some sources may
  work on the APK but not the web app. v1 accepts this asymmetry (per the
  no-content-proxy non-goal); a *metadata-only* proxy is the D4 escape hatch if the
  asymmetry proves unacceptable.
- **`library` discriminator**: proposed value `external-feed` (renamed from v0.1's
  `external-archive` to match the catalog model), distinct from `default`,
  `personal`, and reserved `everyone`. Audit existing library queries for
  discriminator assumptions before it lands.

## 8. Success Metrics

- **Leading**: % of readers who browse a starter source in week 1; user-added
  source count per active reader; refresh failure rate (< 2%); entry-open →
  content-loaded success rate online (> 95%); *(v0.3, if D9 lands filters in v1)*
  % of feed-browsing readers with ≥ 1 declared preference set — measured as an
  aggregate count only, never which preferences.
- **Lagging**: reader WAU retention delta for feed-users vs. non-users at 30/60
  days; share of QR/deep-link inbound resolving to feed entries (P1).
- *(v0.3)* **Measurement constraint:** metrics here must not themselves violate
  the no-behavioral-collection posture — counts and rates in aggregate, no
  per-user reading-interest telemetry.

## 9. Open Questions

| ID | Question | Owner | Blocking? |
|---|---|---|---|
| D1 | ~~Federate-never-mirror~~ — **resolved by R3** (catalog-not-content); recorded for the ADR trail | — | Closed |
| D2 | ~~Online reading surface~~ — **RESOLVED 2026-07-10 (Siva): EPUB/PDF/audio are downloadable for offline use; video is streaming-only.** Storage is device-local, user-informed, user-managed (R3′; P0-6/P0-10). Residual → D2a | Siva | Closed |
| D2a | *(v0.6, residual)* Which surface renders **downloaded** files: system handler (cheapest, delegates rendering risk to the OS) vs in-app EPUB/PDF/audio players (best retention; must sandbox untrusted EPUB internals). Recommendation: system handler at v1, in-app EPUB reader as the flagship P1 upgrade. Video streaming surface: in-app player or source web page, decided with D7 | Siva + spike | No |
| D3 | ~~Starter list composition~~ — **RESOLVED 2026-07-10 (Siva): Internet Archive, Project Gutenberg, Feedbooks public-domain** (three sources). Stewardship: owner-managed via remote config; record in ADR-020's scope | Siva | Closed |
| D3a | *(v0.7, residual — launch prerequisite)* Verify each starter feed live: valid OPDS parse, HTTPS availability (P0-8), and an IA entry-point scoped to public-domain/direct-download collections — IA's lending items require an account (conflicts with R2; would surface P0-9 errors). If IA's BookServer feed proves dead or auth-heavy, fall back candidates: Standard Ebooks OPDS, ManyBooks OPDS — owner's call at that point | Engineering verification | No (for ADR); Yes (for ship) |
| D4 | Is web-platform source asymmetry (CORS) acceptable for v1, or does a metadata-only proxy ship? | Engineering spike | No |
| D5 | ~~Feed formats beyond OPDS?~~ — **RESOLVED 2026-07-10 (Siva): published standard formats only** (OPDS family). Additional-format requests route to support@mentible.mambakkam.net; revisit only if support volume shows real demand for a specific published standard | Siva | Closed |
| D6 | ~~User-added-source liability model~~ — **RESOLVED 2026-07-10 (Siva): neutral conduit.** Curated open-library starter list provided; user-added libraries trigger an add-time warning; Mentible cannot and does not block the content — no denylist, no inspection. Residual (non-blocking): final warning copy + optional matching ToS clause | Siva (residual: copy + legal glance) | Closed |
| D7 | Media entries (audio/video) at P0 or P1? Recommendation: P1 — P0 filters to book media types to keep the reading-surface decision (D2) singular | Siva | No |
| D8 | ~~Maturity filtering strategy~~ — **RESOLVED 2026-07-10 (Siva): Option 1, metadata-flag-only.** Hide only what the feed explicitly flags; no heuristics, no inspection; honest settings copy. P0-3 schema stores the flag | Siva | Closed |
| D9 | *(v0.3)* Do the §6b filters (and their onboarding chips) ship in v1, or does v1 ship filter-less browse with §6b as the first fast-follow? Recommendation: F-1 (language) in v1 — cheap and high-value for non-English readers; F-2/F-3/F-4 fast-follow | Siva | No |
| D10 | *(v0.3)* Do declared preferences ride the future zero-knowledge sync (ADR-014) or stay strictly per-device? F-5's serializable record keeps both doors open; decision needed only when sync builds | Siva (with sync build) | No |
| D11 | *(v0.8)* In-app rating **values** (ER-2): ship at all, and if so from which legitimate API — Open Library (open, free), Google Books (`averageRating`), or Hardcover (public GraphQL)? Each sends per-book lookups to a third party, so it must be opt-in with disclosure. Goodreads itself is not a candidate (API discontinued) | Siva | No |

## 10. Phasing

- **Phase 1 (v1)**: P0-1…P0-10 — OPDS 1.2, user sources, starter list, manual
  refresh, EPUB/PDF download + offline (P0-6/P0-10) with rendering per D2a's
  outcome, behind a remote-config flag. Plus F-1 (language filter) if D9 follows
  the recommendation; P0-3 stores all filterable fields from day one regardless,
  so later filters need no re-parse.
- **Phase 2**: OPDS 2.0, per-source search, remaining §6b filters (F-2/F-3/F-4),
  auto-refresh policy, featured rail, QR/deep-link of source references,
  audio download/offline + video streaming entries (per D7), in-app readers if
  D2a starts on the system handler.
- **Phase 3 (gated)**: authenticated repos (reverses R2 — own decision), video
  offline (reverses D2 — own decision), unified search, local-first
  recommendations (own ADR).

---

*House-style note: **all blocking questions (D1, D2, D3, D5, D6, D8) are now
resolved**, and this spec was promoted on 2026-07-10 to
`docs/adr/ADR-028-open-shelves-free-book-repo-feeds.md` in `Proposed` status, carrying
the non-blocking residuals (D2a, D3a, D4, D6-copy, D7, D9, D10, D11) as documented
open items, per the usual two-commit (Proposed → Accepted) flow.
The companion research document landed beside it at
`docs/research/personal-data-filter-research.md` so the ADR's privacy stance
has its evidence base in-repo.*
