# RESEARCH — Personal Data Inputs for Feed Filter Patterns

**Status:** Research / input document — 2026-07-10
**Feeds into:** `docs/specs/open-shelves-spec.md` (v0.8) → `docs/adr/ADR-028-open-shelves-free-book-repo-feeds.md` (Proposed) — the evidence base for its D6 and D7
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-014 (accounts; Supabase Google sign-in), ADR-001 (key & data
discipline), ADR-021 (moderation posture), README constraint #3 (adults-only),
ADR-022 (account deletion — whatever we collect, we must be able to delete)

**Purpose.** Two questions, answered so we can decide which filter dimensions the
Open Shelves feature can legitimately power, and from what data:
(Q1) what personal information is actually obtainable from a user's Google login;
(Q2) what personal information platforms typically collect about reading /
listening / watching habits. Section 3 maps both onto concrete filter patterns.

---

## 1. What Google Sign-In actually provides

### 1.1 Default sign-in (scopes: `openid`, `email`, `profile`) — what Mentible gets today

This is what a standard "Sign in with Google" (including Supabase's Google
provider, which is what Mentible runs) yields, with no extra consent screens:

| Claim | Content | Reliability |
|---|---|---|
| `sub` | Stable, unique Google account ID | Always present; the correct primary key (email can change) |
| `email` + `email_verified` | Primary email; whether Google verified it | Present with `email` scope; `email_verified` is effectively always true for Google-issued tokens |
| `name`, `given_name`, `family_name` | Display name parts | Usually present with `profile` scope, **not guaranteed** — Google marks profile claims as never guaranteed |
| `picture` | Avatar URL | Usually present, not guaranteed |
| `hd` | Hosted domain, for Google Workspace accounts only | Only for Workspace users; absence means consumer account |
| `locale` | UI language hint | **Do not rely on it.** Google announced its removal from ID tokens in 2023; documentation examples are inconsistent. Derive language from the device/app locale instead |

That is the complete list. **Notably absent by default: age, birthday, gender,
country, interests, and anything about behavior.**

### 1.2 What *could* be requested with extended scopes — and why we shouldn't

Google's People API can expose birthday, gender, addresses, phone numbers, and
organization info — but each requires an additional **sensitive scope**, an
explicit extra consent screen, and (for published apps) Google's **OAuth app
verification review**, with ongoing policy obligations. Even then, users can
simply withhold those profile fields, so availability is not guaranteed.
Restricted scopes (Gmail content, Drive, YouTube history) sit behind an even
heavier review and are categorically out of Mentible's lane.

**Recommendation R-G1: stay at default scopes, permanently-until-decided-otherwise.**
The extended data buys us almost nothing for filtering (see §3) and costs consent
friction, a Google review process, and a privacy story that contradicts the
brand's local-first, minimal-collection posture (ADR-001 discipline, ADR-014).

### 1.3 Two honest limitations to record

- **Google sign-in is not age verification.** No default claim carries age. The
  adults-only constraint (README #3) is currently enforced by positioning and
  terms, not by data — requesting `birthday` via a sensitive scope would not fix
  this (self-declared, withholdable) and would create a data liability. Filter
  design must therefore not depend on *knowing* the user's age.
- **Name/picture are display sugar, not data assets.** They should never feed
  filtering, analytics, or inference. (Inferring demographics from names is both
  unreliable and the kind of practice the brand should be able to truthfully say
  it doesn't do.)

---

## 2. What platforms typically collect about reading / listening / watching habits

Surveying the standard practice across ebook platforms (Kindle, Kobo, Google Play
Books), audio (Audible, Spotify), video (Netflix, YouTube), and social reading
(Goodreads, StoryGraph), collection falls into three tiers:

### 2.1 Declared data (the user tells you)

- Age / birth year or an age-band checkbox (often for content gating)
- Preferred language(s) for content
- Genre / topic / subject preferences (onboarding "pick 3+ genres" flows)
- Content-maturity preference (explicit-content toggles, kids-profile switches)
- Reading goals (books per year), format preference (ebook vs audio)

### 2.2 Observed behavioral data (the platform watches)

- Titles opened, searched for, sampled, wishlisted, purchased/borrowed
- **Progress and completion** — furthest position, percent complete, abandonment
  point (Kindle's page-level sync is the canonical example)
- Session patterns — reading time per day, time-of-day, streaks, device used
- Interaction detail — highlights, notes, dictionary lookups (ebooks); skips,
  replays, playback speed (audio); pauses, rewinds, autoplay-continues (video)
- Search queries inside the catalog (a strong interest signal on its own)

### 2.3 Derived / inferred data (the platform computes)

- Topic-affinity profiles ("readers like you"), taste clusters
- Reading level / difficulty tolerance, preferred length
- Churn-risk and engagement scores; recommendation embeddings

### 2.4 The caution that matters for Mentible

Reading history is **quasi-sensitive by proxy**: what a person reads can reveal
religion, politics, health concerns, and sexuality — categories that privacy
regimes like the GDPR treat as special, and that library ethics (the librarian's
long-standing confidentiality norm) treat as protected regardless of law. The
industry-standard collection list above is what *surveillance-funded* platforms
do; it is not a floor Mentible must match. Given the brand's local-first stance,
the differentiating move is to keep tier 2.2/2.3 data **on-device or nonexistent**,
and collect tier 2.1 only as local preferences. Whatever is stored must also be
coverable by ADR-022's deletion story.

---

## 3. Mapping to Open Shelves filter patterns

### 3.1 What the feed side can actually be filtered on

OPDS/Atom entries commonly carry: **language** (`dc:language`), **subject/category**
(Atom `category` terms — sometimes BISAC/Dewey-coded, often free-form),
**media type** (MIME type on acquisition links: EPUB / audio / video), **published
date**, **publisher/author**, **rights/license string**, and **summary text**.
They **rarely carry reliable maturity/content ratings** — that gap drives D8 below.

### 3.2 Recommended filter dimensions (v1)

| Filter | Powered by | Google data needed? |
|---|---|---|
| **Language** | User-declared preferred language(s), defaulted from **device locale** — not the Google `locale` claim (§1.1) | No |
| **Topic / subject** | User-declared interest picks (onboarding chips) matched against feed `category` terms, locally | No |
| **Media type** | Acquisition-link MIME type; ties to Spec D7 (books at P0, audio/video P1) | No |
| **Content maturity** | App-level "hide mature-flagged entries" toggle, applied *where the feed provides a flag*; default-on. Honest limitation: coverage is only as good as feed metadata (→ D8) | No |
| **Length / date** | Feed metadata where present | No |

**Recommendation R-F1: all filter state is device-local user preference.** Nothing
in §3.2 requires Google data beyond sign-in itself, and none of it requires
behavioral collection. Filtering is a *pure function of (local preferences ×
feed metadata)* — no server-side profile exists to breach, subpoena, or delete.

**Recommendation R-F2: no inferred personalization in v1.** No "because you read
X" built from observed behavior. If recommendation-style features come later,
the local-first version (on-device computation over the local catalog) is the
one consistent with the brand, and it gets its own decision.

**Recommendation R-F3: filters are preferences, not locks.** Since we cannot
verify age (§1.3) and feed maturity metadata is unreliable (§3.1), the maturity
filter is a courtesy default, not a safety guarantee — and the product should
never claim otherwise. The real gate remains the adults-only product posture
plus starter-list curation (Spec P0-5) and the user-responsibility notice for
user-added sources (Spec D6).

### 3.3 New / amended open questions for the Spec

| ID | Question | Blocking? |
|---|---|---|
| D8 | Maturity filtering when feeds carry no rating: metadata-flag-only (recommended for v1) vs. keyword heuristics over titles/summaries (false-positive-prone) vs. per-source "curated = assumed general audience" assumption | Yes — decides P0 filter scope |
| D9 | Onboarding: do topic/language preference chips ship with Open Shelves v1, or does v1 ship filter-less browse with filters as fast-follow? | No |
| D10 | Do declared preferences ride the future zero-knowledge sync (ADR-014) or stay strictly per-device? (Schema should serialize cleanly either way — cheap insurance) | No |

---

## 4. Summary position

Google login gives Mentible an identity anchor (`sub`), a verified email, and a
display name — and essentially nothing useful for content filtering. That is a
feature, not a gap: the filter patterns that Open Shelves needs (language, topic,
media type, maturity) are best powered by a handful of **explicitly declared,
locally stored preferences** matched against **feed metadata**, requiring zero
extended Google scopes and zero behavioral surveillance. The industry-standard
habit-collection list (§2) is documented here as a map of the territory — and as
a list of things Mentible can truthfully say it does not do.

---

## Sources (primary)

- Google Identity — OpenID Connect reference & ID-token claims:
  https://developers.google.com/identity/openid-connect/openid-connect ·
  https://developers.google.com/identity/openid-connect/reference
- Google Identity — backend token verification (claim availability, `hd`,
  profile-claims caveats): https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
- Google People API scope/consent model (sensitive vs. restricted scopes) —
  developers.google.com/people
- Platform privacy disclosures reviewed for §2: Amazon/Kindle, Rakuten Kobo,
  Audible, Spotify, Netflix, Goodreads privacy policies (patterns summarized,
  not quoted)
