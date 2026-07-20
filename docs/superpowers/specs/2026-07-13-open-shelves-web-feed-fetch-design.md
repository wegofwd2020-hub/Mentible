# Open Shelves — web feed fetch (CORS escape hatch) Design

**Status:** Approved (2026-07-13) · **Branch:** `feat/open-shelves` (localhost-only) ·
**Amends:** ADR-028 (resolves Open Question 3 / Risk 3)

## Problem

Open Shelves is unusable on the web app. Adding any source in a browser fails with
`Could not reach the feed: Failed to fetch`. The cause is not a bug in our code:

```
Access to fetch at 'https://m.gutenberg.org/ebooks/2701.opds' from origin 'http://localhost:8082'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
```

ADR-028's premise — *the device fetches direct from the source* — is exactly what a
browser forbids cross-origin unless the **source** opts in. OPDS servers generally do
not: Project Gutenberg sends no CORS headers. Native Android has no such restriction,
which is why the identical code works there (verified on-device, 2026-07-13: real EPUB
downloaded from a live Gutenberg feed).

Two of the three feeds named for the P0-5 starter list are also already unusable —
**Standard Ebooks' OPDS feed returns 401** (auth-gated) and **Feedbooks' public-domain
URL returns 404** — so "just pick CORS-friendly feeds" is not a viable escape.

ADR-028 anticipated this: Risk 3 states a **metadata-only proxy** is the escape hatch
"if the asymmetry proves unacceptable." It has proven unacceptable. This design takes
that hatch.

## The line this design must not cross

**Fetching metadata is not proxying content.** The server may fetch a *feed document*
(OPDS XML) on the browser's behalf. It must never fetch, store, mirror, cache, or relay
a *book file*. Book bytes go source → device, always. On web that means the browser's
own download (an anchor `download` click, already verified working: clicking Download on
the web app produced `pg2701.epub` from gutenberg.org, with our infra not in the path).

That line is what preserves the hosting/DMCA posture of ADR-021 and ADR-028 D2.

## Decisions

| | Decision | Why |
|---|---|---|
| **W1** | **Web only.** Native keeps fetching feeds device → source. | The APK *can* fetch direct, so it should. Keeps ADR-028's model intact where it works, and keeps our server out of the path for the majority of traffic. |
| **W2** | **Anonymous, hardened, rate-limited.** No auth required. | Open Shelves is deliberately account-free (and the public demo runs signed-out). Requiring a JWT to browse a free-book catalog contradicts the feature. The rate limit — not an auth wall — is what stops abuse. |
| **W3** | **Return raw feed XML, unparsed.** | The existing client parser (XXE off, entity caps, `sanitize.ts`) stays the **one** place hostile feed XML is handled. A second parser in Python would duplicate that hardening, add an XXE surface on the server, and let web/native drift apart. |
| **W4** | **No caching. Stateless.** | A cache parks third-party bytes on our infra — precisely what D2 forbids. Cost: every web refresh hits the upstream feed. Accepted. Also removes any cache-poisoning surface. |
| **W5** | **Fail-closed rate limiting** for this endpoint. | `core/rate_limit.py` is fail-open by design (a Redis outage must not take down `/generate`, which needs Redis anyway). Fail-open here is wrong: it would turn a Redis outage into an *unlimited open fetcher*. Web Open Shelves is a convenience; refusing service beats becoming an abuse relay. |

## Backend — `backend/src/shelves/`

`GET /api/v1/shelves/feed?url=<encoded>` → `200` with the raw upstream body, or a
structured error. Parses nothing. Stores nothing. Caches nothing.

Layer rule: `backend/src/shelves/ → backend/src/core/` (no auth dependency — W2).

### Guards, in order

1. **https only.** Anything else rejected. (`http:`, `file:`, `gopher:`, …)
2. **Resolve-then-check.** Resolve the hostname; reject if **any** resolved address is
   loopback / private / link-local / unique-local, including `169.254.169.254` (cloud
   metadata). This closes the DNS-rebinding hole that `fetchFeed.ts` documents as
   unfixable on-device (browser `fetch` never exposes the resolved IP). Server-side we
   can see it, so we must check it. **This is the single most important guard: on a
   device an SSRF's blast radius is the user's own LAN; on our VPS it is our internal
   network and the cloud metadata endpoint.**
3. **Manual redirects, max 3 hops**, re-running guards 1–2 on **every** hop. Never let
   httpx auto-follow: `https://public.example/x` → `302` → `http://127.0.0.1:6379/` is
   the canonical SSRF bypass.
4. **Never forward credentials.** No client cookies, no `Authorization`, no auth of any
   kind sent upstream (carries ADR-028's no-auth guardrail server-side). Upstream
   `401`/`403` → the existing `authRequired` error ("Authenticated repos aren't
   supported yet.").
5. **Content-type allowlist:** `application/atom+xml`, `application/xml`, `text/xml`
   (ignoring parameters such as `;charset=` and the OPDS catalog `profile=`). An HTML
   error page is rejected rather than handed to the parser — this alone would have
   caught the Feedbooks 404-as-a-feed case.
6. **8 MiB streamed cap** (matches the client's `MAX_FEED_BYTES`) — abort as soon as the
   cap is crossed, so a body with no `content-length` cannot exhaust memory —
   and a **10s timeout**.
7. **Per-IP fixed-window rate limit** in Redis, **fail-closed** (W5).

### Errors

Map to the client's existing error vocabulary so web and native surface identical copy:

| Condition | Client error |
|---|---|
| bad/non-https URL, blocked host | `FeedSourceError` — "That host isn't allowed." / "Feed URLs must use https." |
| upstream 401/403 | `FeedSourceError{authRequired}` — "Authenticated repos aren't supported yet." |
| upstream non-2xx | `FeedSourceError` — "The feed responded with an error (HTTP n)." |
| over cap | `FeedParseError` — "That feed is too large to add." |
| wrong content-type | `FeedSourceError` — "That URL doesn't look like an OPDS catalog." *(new copy)* |
| rate limited | `FeedSourceError` — "Too many feed requests. Try again in a minute." *(new copy)* |

## Mobile — one seam, not two fetchers

`fetchFeed()` keeps a single body. A small `feedTransport` seam decides only the
**request URL**:

- native → the feed URL itself (unchanged)
- web → `${API_BASE}/api/v1/shelves/feed?url=${encodeURIComponent(feedUrl)}`

`validateFeedUrl()` still runs client-side so bad input fails fast with the same message
on both platforms. The server re-validates everything regardless — **a client-side check
is not a security control**, it is a UX affordance.

## Testing

No live network in CI, on either side.

**Backend** (pytest + mocked transport):
- non-https rejected
- hostname resolving to a private IP rejected (the rebinding case — resolve is mocked)
- redirect *into* private space rejected (public → 302 → 127.0.0.1)
- oversize body aborted mid-stream
- `text/html` content-type rejected
- upstream 401 → `authRequired`
- rate limit trips; **and Redis-down → 503, not an unlimited fetch** (W5)
- happy path returns the upstream bytes **byte-for-byte unchanged**
- no client `Authorization`/cookie header is ever forwarded upstream

**Mobile** (jest):
- web branch builds the proxied URL; native branch fetches direct
- error mapping preserved across the seam (incl. `authRequired`)
- the existing hardened parser is still the only parser (unchanged)

## ADR-028 amendment

Resolve Open Question 3 and Risk 3. Amend D2 with the explicit clause:

> The server may **fetch feed metadata** on behalf of a client that cannot (the browser,
> blocked by CORS). It must never fetch, host, mirror, cache, or relay repo **content**.
> Metadata-fetch ≠ content-proxy.

Record the web-only scope (W1), the anonymous+rate-limited stance (W2), and the
no-caching constraint (W4), which is what keeps the amendment inside D2 rather than a
reversal of it.

## Out of scope

- Caching / conditional GET (`ETag`, `If-Modified-Since`) — W4. Revisit only with an
  ADR-028 amendment, since it means storing third-party bytes.
- Server-side OPDS parsing — W3.
- Downloading book files through the backend — **never** (the line, above).
- The starter list (P0-5) and language filter (F-1) — separate plans, though P0-5's feed
  survey should now assume "no CORS" is the norm and re-verify liveness (Standard Ebooks
  401, Feedbooks 404).
