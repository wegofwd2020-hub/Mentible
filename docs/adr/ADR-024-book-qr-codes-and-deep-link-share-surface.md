# ADR-024 — Book QR codes & deep-link / share surface

**Status:** Proposed — 2026-06-28
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-023 (reader engagement — scan is a sibling engagement signal),
ADR-021 (Everyone Library — the public web book page is gated here), ADR-008
(release lifecycle — the QR is stamped at release, version-pinned), ADR-015
(content-trust manifest), ADR-018 (system-owner signing), ADR-017 (default
library), ADR-004 (artifacts / email-PDF share, SBQ-EXP-001).

---

## Context

We want a **QR code on each book that goes to public release** — scan it to get to
the book.

The QR itself is trivial (a few lines of Python). The scope is **not the code, it's
the destination**: a QR encodes a URL, so it only means something if there is a
**durable public destination** for the book. Today there isn't a per-book web page —
default-library books are *bundled* (ADR-017), and the public per-book landing page
is exactly what **ADR-021 deferred** (its Open decisions 1–3: hosting, discovery,
ToS). So the most literal reading — scan → public web book page → read/rate/download
— is **gated on ADR-021** and must not be allowed to quietly drag the whole Everyone
Library forward.

But the destination has forks, and **two are buildable now** without ADR-021:

1. **App deep-link** — scan → open the book in the Mentible reader (or the store if
   the app isn't installed). For default-library books this needs **no web hosting**;
   it rides on already-public content (ADR-023 D1).
2. **Provenance / verify** — scan → attest "this is the authentic published edition."
   The machinery already exists: ADR-018 HMAC signing + ADR-015 content-trust
   manifest + per-book `sha256`/`signature` in the manifest. A *different axis*
   (trust, not distribution), buildable now.

This ADR records the **destination decision**, claims the buildable-now slices, and
**parks the web-page-dependent slice on ADR-021**. It is kept separate from ADR-023
so that ADR stays a clean engagement-*data* ADR.

---

## Decision (proposed)

### D1 — The QR resolves to a **resolver URL we own**, not a baked-in final URL

Every public-release QR encodes **one canonical URL on a Mentible-owned domain** that
points at a lightweight **resolver** (a route on the existing backend — *not* a new
hosting build), e.g.:

```
https://<mentible-domain>/b/{book_id}?v={version}&s={short_hash}
```

The resolver does **platform-aware routing** and **destination selection**:

| Context at scan | Resolver behaviour | Built |
|---|---|---|
| App installed (universal link / app link) | Deep-link **into the book in the app** | **Now** (D1a) |
| App not installed | Send to the **app store**, carry `book_id` for first-open hand-off | **Now** (D1a) |
| "Is this genuine?" | **Provenance attestation** for `{book_id, version, sha256}` (D1b) | **Now** |
| Read-on-web | **Public web book page** | **Deferred → ADR-021** |

- **D1a — App deep-link** uses universal links (iOS) / app links (Android) so a scan
  opens the reader directly; the resolver is the fallback web target the OS hits when
  the app can't handle it. No per-book web page required.
- **D1b — Provenance** is an attestation, **not** a content page: the resolver
  confirms `{book_id, version, sha256}` matches an entry in the **owner-signed
  published manifest** (ADR-017/018). The deep HMAC check stays **server-side where
  the owner secret lives** (ADR-018: the app never holds it); the reader-facing
  result is a boolean/attestation ("genuine published Mentible edition · v1.2"),
  never the secret and never a recomputation on-device.

Because the **final destination is chosen by the resolver, not encoded in the QR**,
we can light up the web-page route **later** (when ADR-021 builds) **without
reprinting a single QR**.

### D2 — Dynamic QR (repointable) → every scan is a **trackable engagement signal**

We use **dynamic** QRs: the QR points at the D1 resolver, which redirects. The
alternative — baking the final URL into a **static** QR — is simpler but dumb (not
repointable, not measurable).

A dynamic QR makes **every scan an event**, slotting straight into ADR-023's
telemetry (D8) as a **sibling of `book_download_event`**:

```text
book_scan_event                      -- append-only, privacy-minimal (mirrors D5/D4 of ADR-023)
  id            bigserial primary key
  library       text   not null      -- default | everyone
  book_id       text   not null
  version       text                 -- which edition's QR was scanned (ADR-008)
  resolved_to   text                 -- app_deeplink | store | provenance | web (future)
  occurred_at   timestamptz not null
  -- NO ip, NO account_id, NO device id by default
```

`scan_count` becomes another field on `book_engagement` (ADR-023 D4), and the
resolver is the single writer (consistent with ADR-023 D8: one engagement module).
A scan is **not** a download — they are separate events with separate meaning.

### D3 — The QR is **stamped at release time**, version-pinned (ADR-008)

Generating the QR belongs in the **release path** (ADR-008), not at read time:

- A QR is produced **only when** a book reaches **public release** — `status =
  release` (ADR-008) **and** the book is a **published** manifest entry (ADR-017).
  **Drafts get no public QR** (a draft is watermarked and not for distribution).
- The QR is **stamped into the artifact** alongside the edition/version stamp the
  compiler already applies — natural homes are the **cover** and/or **colophon**
  (`cover.ts` / `colophon.ts`), and the back-matter of the PDF/EPUB.
- Because the resolver URL carries `{book_id, version, short_hash}`, the stamped QR is
  **edition-specific and reproducible** from `book.json` — re-releasing a new version
  yields a new QR that resolves to that edition.

### D4 — Generation & format

- A small Python helper (e.g. `segno`/`qrcode`) renders the QR as **SVG** (vector,
  matches the existing cover/diagram pipeline) with a quiet zone and error-correction
  level **M** (room for a small centered brand mark without breaking scannability).
- The resolver URL is **short and stable** so the QR stays low-density and reliably
  scannable at print sizes.
- No PII, no secret, and no content is encoded — only the public identity tuple.

### D5 — Relationship to existing ADRs

- **ADR-021:** the **web book page** route (D1, "read-on-web") is **its** scope and
  stays deferred; this ADR does **not** trigger UGC hosting. When ADR-021 builds, the
  resolver simply gains the `web` destination — **no QR reprint** (D1).
- **ADR-023:** scan is a **non-private engagement signal** (ADR-023 D2), written by
  the same engagement module (D8), stored privacy-minimally like
  `book_download_event` (D2 here).
- **ADR-008:** the QR is a **release-time, version-pinned** stamp (D3); drafts get
  none.
- **ADR-015 / ADR-018:** provenance (D1b) reuses the content-trust manifest + owner
  signature; the secret stays server-side, the app never holds it.
- **ADR-004 / SBQ-EXP-001:** an emailed-PDF share can carry the same QR; the resolver
  handles a no-app, no-web-page scan via provenance + store hand-off.

### D6 — Implementation conventions

Python, typed, structured (OpenSpec-style) docstrings, explicit exception types
(mirroring `PublishError` / `CompilerError`), `pytest` with **mock fixtures** for
manifests, resolver requests, and scan events. The resolver is a thin route on the
existing API; no new hosting, no key-custody change.

---

## Consequences

**Positive**
- Ships a real "scan → get to the book" feature for public releases **now**, via app
  deep-link + provenance, with **no dependency on ADR-021**.
- **Repointable:** the web-page route lights up later with **zero QR reprints** (D1).
- **Measurable:** scans become a first-class engagement signal alongside downloads
  (D2), reusing ADR-023's telemetry.
- **Trustworthy:** provenance reuses existing signing/trust infra (ADR-015/018).
- **Reproducible & edition-correct:** QR is stamped at release, version-pinned (D3).

**Costs / risks**
- Requires a **stable owned domain + resolver route** and universal-link / app-link
  configuration (some platform setup).
- A **dynamic** QR means the resolver is now on the critical path for "scan works" —
  needs uptime + a sane fallback when the book/edition is unknown.
- Scan analytics add another privacy-minimal event class to operate (retention,
  rollup) — small, but real.
- Until ADR-021 builds, a no-app scan lands on provenance/store, **not** a readable
  web page — must be communicated so the QR isn't oversold as "read on the web."

---

## Open questions

1. **Centered brand mark** in the QR — yes (level-M ECC allows it) or keep it plain
   for max robustness? (Leaning: small mark, test scannability at print size.)
2. **Short-hash in the URL** — include `s={short_hash}` for at-a-glance edition
   pinning, or keep the URL minimal and resolve version server-side?
3. **Cover vs colophon vs back-matter** placement (D3) — one, or all three?
4. **Scan-count exposure** — public ("scanned 1k+ times") or admin-only? (Leaning:
   admin-only first; revisit with ADR-023 Open question 4 on banded counts.)
5. **Per-recipient QR** on emailed PDFs (SBQ-EXP-001) — distinct codes per share for
   finer attribution, or one code per edition? (Leaning: one per edition now.)

---

## Scope — what this ADR is *not*

- **Not** the public web book page or any UGC hosting/discovery — that stays
  **ADR-021** (this ADR only adds a `web` destination slot the resolver fills later).
- **Not** a change to the default library (ADR-017/018) or to the release lifecycle
  semantics (ADR-008) — it **uses** them.
- **Not** monetization, paid-copy DRM, or per-buyer watermarking.
- **Not** a new engagement *data class* — it extends ADR-023's (scan = sibling of
  download).

---

## Staged plan (post-acceptance)

1. Resolver route on the existing backend: `/b/{book_id}` → platform-aware redirect
   (app deep-link / store) + `book_scan_event` write (D1a, D2).
2. Provenance attestation endpoint reusing the signed manifest (D1b, ADR-015/018).
3. Universal-link / app-link config in mobile so a scan opens the book (D1a).
4. Python QR helper (SVG, level-M) + stamp into cover/colophon at release, gated on
   `status = release` + published manifest (D3, D4, ADR-008).
5. `scan_count` on `book_engagement` + telemetry event (D2, ADR-023 D8).
6. *(when ADR-021 builds)* resolver gains the `web` destination — no QR reprint.

---

## Follow-up tickets

- **SBQ-QR-001** — resolver route + `book_scan_event` + platform-aware deep-link/store
  redirect (D1a, D2).
- **SBQ-QR-002** — provenance attestation endpoint over the signed manifest (D1b).
- **SBQ-QR-003** — release-time QR stamping into cover/colophon, version-pinned (D3,
  D4; extends ADR-008 compiler path).
- **SBQ-UI-004** — mobile universal-link / app-link handling (scan opens the book).
- *(carried, ADR-021)* `web` read-on-web destination — gated on ADR-021 Open
  decisions 1–3; resolver slots it in with no QR reprint.
