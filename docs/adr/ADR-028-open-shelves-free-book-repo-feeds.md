# ADR-028 — Open Shelves: free book repo feeds as a catalog client

**Status:** Proposed — 2026-07-10
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-004 (two-product split — this is a **reader-side** feature),
ADR-014 (local-first accounts; no server-side book storage — extended here to
downloads and preferences), ADR-015 (content-trust manifest — provenance-by-metadata
sibling), ADR-017 (owner-curated default library — the starter list reuses the
stewardship pattern), ADR-020 (super-admin — starter-list stewardship surface),
ADR-021 (Everyone Library deferral — **untouched**; repo entries are inbound external
references, not hosted content), ADR-022 (account deletion — anything stored must be
deletable), ADR-023 (engagement — external entries excluded from ratings at MVP; **note
the two ADRs use "download" for different events**: ADR-023 D5 counts a server-served
export of *our* published artifact, whereas a D2/D3 download here is the device pulling a
*third-party* file direct from the source. An Open Shelves download is **never** an
ADR-023 download event and must not increment its counter — D3 forbids any server-side
record of what a user downloaded), ADR-024 (QR/deep-link pattern — source-reference
sharing at P1), ADR-001 (data discipline — extended to personal data).
**Companion documents:** `docs/specs/open-shelves-spec.md` (requirements, v0.8) ·
`docs/research/personal-data-filter-research.md` (evidence base for D6/D7).

---

## Context

Mentible's library holds two kinds of content: books the user authored and the
owner-curated bundled books (ADR-017). Readers who want more must leave the app —
while tens of thousands of legally free books sit in OPDS-speaking archives
(Internet Archive, Project Gutenberg, Feedbooks, Standard Ebooks, DOAB…) in exactly
the format our stack already understands.

The naive integrations are both wrong for us. **Mirroring** archive content onto
Mentible infrastructure drags in the hosting/moderation/DMCA machinery that ADR-021
deliberately gates and defers. **Importing** everything to the device bloats
storage and blurs provenance. The refined direction, worked through requirement
versions v0.1 → v0.8 (see companion spec, whose changelog is the decision trail),
is a **catalog client with user-owned downloads**: Mentible stores feed *metadata*,
the user downloads *content* directly from the source to their own device, and
Mentible infrastructure never touches a third-party file.

Two adjacent questions were settled alongside: what **personal data** may power
catalog filtering (companion research: Google sign-in yields no age/interest data
at default scopes, and reading history is quasi-sensitive — so filters run on
declared, device-local preferences only), and how **external ratings** can appear
(Goodreads' public API was discontinued in Dec 2020 — link-out is the only clean
path).

---

## Decision (proposed)

### D1 — Mentible becomes a **catalog client** over **published standard feeds only**

Users subscribe to free book repos; the app fetches, parses, and locally caches
**feed information** (source records + entry metadata: title, authors, description,
cover URL, rights string, language, category terms, media type, content links,
source ref, fetched-at). Supported formats are the **OPDS family only** — OPDS 1.2
(Atom) at MVP, OPDS 2.0 (JSON) as the first follow-on adapter — behind one seam
(`validate` / `fetch_feed` / `parse_entries`). **No bespoke-format adapters, no
scraping.** An unrecognized feed fails with a specific "unsupported format" message
that names OPDS and refers the user to **support@mentible.mambakkam.net**, turning
format demand into a measurable support signal while keeping the parser surface —
our attack surface — small.

### D2 — **Server never touches content; the device may.** EPUB/PDF/audio download; **video streams only**

Mentible infrastructure never hosts, mirrors, or proxies repo content — exposure
stays limited to *linking*, and ADR-021's posture is preserved by construction.
On the device, the user may **download EPUB, PDF, and audio** for **offline use**;
**video is streaming-only**, with no download affordance and no persistence beyond
normal player buffering. Downloads flow **source → device directly**, are
integrity-checked before being marked offline-available, and a partial download is
quarantined, never listed as usable.

### D3 — Downloads are **device-local and per-device**; storage is **user-informed, user-managed**

A download **exists only on the device where it was performed** — signing into the
same account elsewhere does not carry it over; each device downloads independently.
Nothing is synced, backed up, or uploaded by Mentible, and no server-side record
exists of *what* a user downloaded beyond aggregate counters. The user is
**informed (and where the platform allows, prompted) about where** offline content
is stored (Android: SAF picker or a clearly named user-visible folder; web: the
browser's native download flow). A Downloads view shows per-item and total usage
with per-item and bulk delete. The app **informs, it does not police**: no quotas,
no auto-evict — storage headroom is the user's responsibility.

### D4 — User-added sources are a **neutral conduit**: warn at add time, never block

Anyone can add a repo by URL (HTTPS-only). Adding a source posts a **warning** —
user-added libraries sit outside Mentible's curation and are the user's
responsibility — which the user confirms before the source saves. Mentible does
**not** inspect, denylist, or block user-added sources or their content. Public /
anonymous feeds only at MVP: a 401/403 fails with a specific "authenticated repos
aren't supported yet" message (the source schema carries a nullable auth descriptor
so a later auth decision needs no migration). Feed XML is treated as hostile input:
XXE disabled, parse depth/size bounded, entry caps enforced, every rendered string
sanitized.

### D5 — Starter list: **Internet Archive, Project Gutenberg, Feedbooks public-domain**, owner-stewarded via remote config

Three owner-curated sources ship so the shelf is never empty on day one — no
account, no key, no setup. The list rides **remote config** (revisable without an
app release; stewarded from the super-admin surface, extending ADR-020's scope) and
starter sources carry a clear-legal-basis bar that user-added sources (D4) do not.
Users can hide starter sources; the list itself is owner-managed. Launch
prerequisite (Open question 2): live verification of each feed — OPDS parse, HTTPS,
and an Internet Archive entry-point scoped to **public-domain / direct-download**
collections, since IA's controlled-digital-lending items require an account and
would collide with D4's no-auth guardrail.

### D6 — Filtering runs on **preferences, not profiles**; maturity filtering is **metadata-flag-only**

Catalog filters (language, topic, media type, maturity) are a **pure function of
(device-local declared preferences × feed metadata)**. Google sign-in stays at
default scopes (`openid`/`email`/`profile`) — no People-API/sensitive scopes, and
identity data (name, picture) is display-only, never an input to filtering,
analytics, or inference. No behavioral collection, no derived taste profiles, no
server-side preference storage; in-catalog searches are never retained as interest
signals, and success metrics stay aggregate-only. Language defaults from the
**device locale** (never the deprecated Google `locale` claim). The maturity
toggle ("hide mature-flagged entries," on by default) acts **only on flags the
feed explicitly provides** — no keyword heuristics, no content inspection — with
honest settings copy: a courtesy filter dependent on source metadata, **not a
guarantee and not an age gate** (Google sign-in provides no age data; the
adults-only posture remains a terms/positioning matter).

### D7 — External ratings: **Goodreads by link-out only**, opt-in; in-app values deferred to a legitimate API

An **off-by-default** settings toggle adds a per-entry **"View ratings on
Goodreads"** action — ISBN search where the feed provides an identifier, else
title+author search — opening in the browser. Wholly user-initiated: **no request
reaches Goodreads until the user taps** (consistent with D6). Because Goodreads
discontinued its public API in Dec 2020, in-app rating *values* cannot be obtained
legitimately from it; **scraping and unofficial Goodreads APIs are excluded**.
In-app values, if ever, come from a provider with a genuine public API (Open
Library / Google Books / Hardcover) — deferred (Open question 8), opt-in with
disclosure since it sends per-book lookups to a third party.

### D8 — The `library` discriminator gains **`external-feed`**

Repo entries live under a new discriminator value `external-feed`, distinct from
`default`, `personal`, and the reserved `everyone` (ADR-021 pattern). Feed refresh
is **manual and idempotent** at MVP: entries upsert on stable feed-entry identity,
removed entries prune, and a mid-refresh failure leaves the previous good cache
intact. Removing a source purges its entries; deleting a downloaded item removes
the file and offline flag but never the catalog entry. Existing library queries are
audited for discriminator assumptions before the value lands.

---

## Open questions

1. **Rendering surface for downloaded files** — system handler (cheapest; delegates
   rendering risk to the OS) vs in-app EPUB/PDF/audio players (best retention; an
   in-app EPUB renderer must treat EPUB internals as hostile — scripts disabled,
   sandboxed). Leaning: system handler at MVP, in-app EPUB reader as the flagship
   P1 upgrade. Video surface (in-app player vs source page) decided with question 5.
2. **Starter-feed verification (launch prerequisite)** — live check of all three
   D5 feeds: OPDS parse, HTTPS, IA public-domain scoping. Fallback candidates if
   IA's BookServer proves dead or auth-heavy: Standard Ebooks, ManyBooks —
   owner's call at that point.
3. **Web CORS asymmetry** — many OPDS feeds lack CORS headers, so some sources may
   work on the APK but not web. Accepted at MVP (no content proxy, per D2); a
   **metadata-only** proxy is the escape hatch if the asymmetry proves unacceptable.
4. **D4 warning copy** — final wording of the add-source warning; whether the ToS
   gains a matching clause.
5. **Audio/video entry timing** — MVP filters to book media types; audio download
   and video streaming entries land P1. Confirm.
6. **Filter shipping order** — language filter at MVP (cheap, high-value for
   non-English readers); topic/media/maturity as fast-follow. The entry schema
   stores all filterable fields from day one either way, so no re-parse is ever
   needed.
7. **Preferences vs future sync** — declared preferences are serializable (ADR-014
   zero-knowledge sync could carry them later); content downloads stay excluded
   regardless (D3). Decide when sync builds.
8. **In-app rating provider** — ship at all, and if so Open Library vs Google Books
   vs Hardcover (D7).

---

## Scope — what this ADR is *not*

- **Not** the Everyone Library — ADR-021's UGC-hosting gate is untouched; repo
  entries are inbound external references, never Mentible-published content.
- **Not** a content host or proxy — no Mentible storage, mirroring, or relaying of
  third-party files, ever (D2). No video downloads (streaming only).
- **Not** cloud storage of downloads — device-local, per-device only (D3).
- **Not** an authenticated-repos build — public/anonymous feeds only (D4); auth is
  a future decision the schema merely doesn't preclude.
- **Not** a moderation system — neutral conduit for user-added sources (D4); no
  denylist, no content inspection.
- **Not** behavioral personalization — no habit collection, no inferred profiles,
  no extended Google scopes (D6); local-first recommendations would be their own ADR.
- **Not** a Goodreads data integration — link-out only; no scraping (D7).
- **Not** ratings/feedback on external entries (ADR-023 semantics imply our
  catalog) — parked.
- **Not** generation-related — no LLM path, no BYOK, no `wegofwd-llm` involvement.
- **Not** an age-verification or content-safety guarantee (D6's honest-wording rule).

---

## Staged plan (post-acceptance)

1. Feed seam + OPDS 1.2 adapter (`validate`/`fetch_feed`/`parse_entries`) with
   hardened parsing (XXE off, caps, sanitization) and the full filterable entry
   schema (D1, D6, D8).
2. Source management: add/list/remove with HTTPS + no-auth guardrails, add-time
   warning, unsupported-format support referral (D1, D4).
3. Starter list via remote config + super-admin stewardship; run the
   starter-feed verification (D5; Open question 2).
4. Manual refresh — idempotent upsert/prune, failure-safe cache (D8).
5. Catalog browse + entry detail with provenance surfacing; `external-feed`
   discriminator lands after the library-query audit (D8).
6. Download & offline: EPUB/PDF download, integrity check, storage-location
   prompt/notice, Downloads view with sizes + delete; video entries stream-only
   when they land (D2, D3; rendering per Open question 1).
7. Language filter (device-locale default) + preference record (D6; Open
   question 6).
8. Goodreads link-out toggle (D7).
9. *(P1)* OPDS 2.0 adapter, per-source search, audio/video entries, remaining
   filters, featured rail, QR source-reference sharing (ADR-024 pattern),
   auto-refresh policy, in-app EPUB reader if Open question 1 starts on the
   system handler.

---

## Follow-up tickets

- **SBQ-ARC-001** — feed seam + OPDS 1.2 adapter + hardened parse + entry schema
  (D1, D6, D8; staged plan 1).
- **SBQ-ARC-002** — source management: add/remove, guardrails, add-time warning,
  support referral (D1, D4; staged plan 2).
- **SBQ-ARC-003** — starter list remote config + super-admin stewardship +
  starter-feed verification spike (D5; Open question 2).
- **SBQ-ARC-004** — manual refresh: idempotent upsert/prune + failure-safe cache
  (D8; staged plan 4).
- **SBQ-ARC-005** — browse/detail + provenance + `external-feed` discriminator
  audit-and-land (D8; staged plan 5).
- **SBQ-ARC-006** — download & offline storage management: integrity, location
  notice, Downloads view, delete; per-device semantics (D2, D3; staged plan 6).
- **SBQ-ARC-007** — language filter + local preference record (D6; staged plan 7).
- **SBQ-ARC-008** — Goodreads link-out toggle (D7; staged plan 8).
- *(carried)* rendering-surface decision/spike (Open question 1); CORS
  metadata-proxy decision (Open question 3); warning copy + ToS clause (Open
  question 4); P1 wave (staged plan 9).
