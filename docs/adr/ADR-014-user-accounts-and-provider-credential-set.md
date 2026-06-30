# ADR-014 — User accounts & the per-provider credential set (BYOK-first identity)

**Status:** Accepted — **built & deployed** (updated 2026-06-27). IdP = Supabase
(O1/O5); JWKS verify + account / per-provider credential-set API + mobile Account page
shipped; device tracking added. **Google sign-in verified live on production**
(`mambakkam.net/app/mentible`, 2026-06-27). _Original: Proposed 2026-06-11._
Still deferred: zero-knowledge library **sync** (O2) and usage Phase 2 (device-local only for now).
**Decision-maker:** Sivakumar Mambakkam

> **Decisions made (2026-06-16).** **O1 → Supabase** (bundles auth + the synced-library
> Postgres + per-user RLS — "one user = one isolated library" is a textbook single-table
> RLS case), which also settles **O5 → Supabase Postgres**. The vendor-agnostic backend
> **JWKS verify → `Principal`** (follow-up ticket #1, D1) is built in `backend/src/auth/`
> (config-driven, no DB, identity-optional for the anonymous demo).

> **Decisions made (2026-06-17).** **O2 → zero-knowledge** (library *content* sync is
> client-encrypted under a user-held secret we cannot read — same custody as keys under
> D5; this keeps the "your content is yours" promise intact across the whole product and
> keeps us out of content-liability/GDPR scope). Plaintext was rejected because its only
> real upside (server-side/web rendering + search) is **already deferred by ADR-004**
> (the reader is a separate, offline, client-side app), so plaintext would spend the
> brand promise to buy features we've explicitly chosen not to build. **O3 → defer key +
> content sync past v1.1** (per D7, demo/quality-first): ship **device-local only** now —
> keys re-entered per device, the library is local plus the **exported EPUB/PDF artifact**
> as the cross-device story. The zero-knowledge *stance* is locked regardless, so no
> rework when sync does land. **O4 → recovery direction** follows from zero-knowledge:
> a **one-time recovery key shown at sync setup** (1Password-style) **plus the export
> artifact as the standing fallback** (the synced library is a convenience copy, not the
> only copy) — detailed design deferred with the sync build (ticket #4). The crypto
> model and sharing story these imply are now written down as **D10** (per-user envelope
> encryption: per-user LMK → per-book Data Keys) and **D11** (sharing = export artifact
> first; public-key per-book-DK wrapping only if live shared libraries are requested).
**Resolves:** [#90](https://github.com/wegofwd2020-hub/StudyBuddy_SelfLearner/issues/90)
**Builds on:** **ADR-005** (hybrid managed + BYOK key handling; it pulled
accounts/auth + metering forward to MVP but did not specify _how_ accounts work —
this ADR does). **Extends:** **ADR-001** (BYOK key discipline — generalised from a
single per-request key to a _per-provider credential set_). **Relates:** **ADR-012**
(`PROVIDER_REGISTRY` + result provenance — the credential set is registry-keyed, and
provenance drives the cross-device degradation case below).

---

## Context

Mentible is **anonymous, single-user, single-device** today by design: no auth, no
DB, Redis holds only transient job state, and the BYOK key never leaves the device
except as a shredded per-request envelope (ADR-001). That was correct for the MVP/demo.

Two forces now require an identity primitive:

1. **v1.1 cross-device library sync** (`SCOPE.md` D4) is the first feature that
   genuinely needs a stable user identity to hang data off of. Everything before it
   worked fine accountless.
2. **ADR-005** reframed the product as hybrid (managed-key default + optional BYOK)
   and pulled accounts + metering to MVP — but left the account model unspecified.

Meanwhile **multi-provider is already real** (ADR-012, `wegofwd-llm` registry;
`mobile/src/constants/providers.ts`; per-provider `keyStore.ts`; `provider_id` on
`GenerateRequest`). A user holds **N keys with partial coverage** — maybe only
Anthropic, maybe OpenAI + Groq, maybe none (managed). So the account cannot model
"the user's key"; it must model a **set** of provider credentials, most of which may
be absent on any given device.

The governing constraint: the account must **not** erode the BYOK promise — _"we
never hold your key; your content is yours."_ A conventional account system bolted on
carelessly trades that away for convenience.

## Decision (proposed)

### D1 — Identity via an external IdP; do not build authentication

Use a managed identity provider for login (email + Google + Apple-on-iOS) and verify
its JWT **statelessly via JWKS** on the backend — the same shape the sibling OnDemand
product already runs for its Auth0 track. This removes password storage, reset flows,
OAuth plumbing, and refresh-token rotation from our scope; what remains is signature
verification (no auth DB). The client stores the IdP session token in
`expo-secure-store`, alongside (but categorically separate from) the BYOK keys.

This upholds the existing rule (`CLAUDE.md`): **the session JWT is OUR token; it is
never the user's LLM key.**

> **No local user-account or auth management (directive, 2026-06-15).** This is a
> hard line, not just a lean: we manage **no** user authentication locally — no
> passwords, no credential verification, no OAuth/OIDC plumbing of our own, no
> refresh-token rotation, no auth/credentials DB. The IdP owns all of it; we only
> verify its JWT via JWKS. The **sole** locally-defined principal is the
> **ADR-018 super-admin** (a config-based principal, not an account). The only
> user-side persistence we ever take on is the minimal sync record of **D8**
> (keyed by IdP `sub`, holding **no credentials**) — and that exists only with
> **v1.1+ sync**; MVP is verify-JWT-per-request with no user storage at all.
> Implementation: see issue #121.

> IdP vendor is an open decision — see **O1**.

### D2 — The account owns a _credential set_, not a key

The unit of storage is a **registry-keyed map**, never columns-per-provider — adding
a provider later (DeepSeek, Qwen…) must not require a schema migration. Each entry:

```
credential_set: { <provider_id>: { source, status, last_verified_at } }
  source  ∈ device_local | synced_e2e | managed_vault
  status  ∈ valid | rejected | unverified
```

`provider_id` values come from `PROVIDER_REGISTRY` (ADR-012), the single source of
truth for supported providers and key formats.

### D3 — Custody is per-provider, not per-user

ADR-005's hybrid (managed vs BYOK) generalises from a per-_user_ choice to a
per-_entry_ choice. A normal user is legitimately mixed:

| Provider  | source          | meaning                                           |
| --------- | --------------- | ------------------------------------------------- |
| Anthropic | `device_local`  | BYOK, key never leaves the device                 |
| Groq      | `synced_e2e`    | BYOK, key synced as zero-knowledge ciphertext     |
| OpenAI    | `managed_vault` | uses our key, billed via subscription (ADR-005)   |
| Gemini    | _absent_        | no key; provider not usable                       |

The line that must never blur: **a BYOK key is never silently promoted to a
managed (server-held) key.** Managed is always an explicit, per-provider opt-in.

### D4 — "Usable providers" is derived, and is per-device

Usable set = `PROVIDER_REGISTRY ∩ keys-available-on-this-device`. If keys stay
device-local (D5), the usable set **differs per device** — a key pasted on the laptop
isn't on the phone. The provider picker reflects _this device's_ reality, not a global
account flag.

### D5 — Default custody is device-local; key sync is opt-in and zero-knowledge

Keys stay on-device by default (preserves the BYOK trust contract). We **offer**
optional key sync because per-device re-entry friction scales with the number of
providers (re-pasting 4 keys on every new device kills retention) — but synced keys
are stored only as **ciphertext encrypted under a user-held secret we cannot read**.
If we can read the keys, we have become a multi-provider key vault and broken the
promise outright.

### D6 — Provenance drives graceful degradation across devices

A synced book records which provider/model generated it (ADR-012 provenance). Opened
on a device lacking that provider's key: **view / read / export must work**;
**regenerate / edit-with-AI degrades** with a clear prompt — _"This was made with
OpenAI. Add your OpenAI key in Settings, or switch providers to regenerate."_ This
state only exists once sync exists, and is new UX surface.

### D7 — No silent provider fallback

A fresh generation defaults to the user's **preferred** provider _if_ its key is
present-and-valid on this device, else it prompts. We never silently fall back to a
different provider — that would change the output, the cost, and the user's vendor
relationship without consent.

### D8 — Data minimisation on the account row

The account stores: IdP identity reference (`sub`), credential-set metadata (D2), and
a pointer to the synced library. It stores **nothing about what the user generates**.
Account deletion triggers purge on the documented GDPR schedule.

### D9 — Rate-limit subject

Because the backend proxies even BYOK calls and runs Chromium for exports, abuse is
possible regardless of who pays for tokens. Throttle on **account** (falling back to
IP for the anonymous demo). _Needs confirmation — see O-section._

### D10 — Content is secured per-user via envelope encryption (added 2026-06-17)

The O2 "user-held secret" is **account-level, not device-level** — sync only works if
the same user can decrypt on a new device, so the encryption cannot be bound to a
device. The model is envelope encryption:

```
passphrase / recovery key  ──KDF──▶  KEK
KEK  ──wraps──▶  Library Master Key (LMK — random, per-user, generated once)
LMK  ──wraps──▶  per-book Data Keys (DK)
DK   ──encrypts──▶  book content
```

- The **LMK is per-user**. The server stores only the **wrapped** LMK so any device can
  fetch and unwrap it with the passphrase; the server never sees the unwrapped LMK.
- **New device:** enter passphrase / recovery key → derive KEK → unwrap LMK → decrypt
  library. The device then caches the LMK in `expo-secure-store` so it isn't re-entered
  each launch — **that cached copy is the only per-device artifact**, the same logical
  user key, not a distinct per-device key.
- Deliberate asymmetry with the credential set: **content is per-user; BYOK keys stay
  per-device by default** (D4/D5) unless the user opts into key sync.
- **Content is encrypted under per-book Data Keys, not directly under the LMK.** This
  costs nothing extra and is the precondition for sharing a single book (D11) without
  exposing the rest of the library.

### D11 — Sharing model: artifact-first, public-key wrapping later (added 2026-06-17)

**Near-term (v1.1, recommended): share the exported artifact.** Sharing a book = export
the EPUB/PDF (ADR-004 already makes the artifact the unit of delivery; the free reader
app lights up our books) and send it. Zero new crypto, zero server sharing infra, fully
on the existing rails. It is a **static snapshot** that leaves our envelope once sent —
the user's choice, the same as emailing any file. This keeps sharing **entirely out of
the deferred sync build (O3)**.

**Later (only if live shared/synced books are requested): per-book DK wrapping with
public-key crypto**, preserving zero-knowledge:

1. Each account gets an asymmetric **keypair** at setup. The **public key is published**
   to the server; the **private key is held zero-knowledge** — wrapped under the same
   passphrase that wraps the LMK, so O4's recovery story covers it too.
2. To share book B with Bob, Alice's client fetches **Bob's public key**, computes
   `wrapped_DK_for_Bob = encrypt(DK_B, Bob_pub)`, and uploads `{ciphertext, wrapped_DK_for_Bob}`.
3. Bob unwraps `DK_B` with his private key and decrypts. The server only ever holds
   ciphertext, public keys, and DKs-wrapped-to-recipients — it still cannot read content.

Known limitations of the public-key tier (recorded, not solved now): **key-trust/MITM** —
the server hands out recipients' public keys, so trust-on-first-use is the pragmatic
v1.1+ stance, with Signal-style safety-number verification as later hardening;
**revocation** — once a recipient decrypts they hold plaintext, so revoking *future*
access means rotating the book's DK, re-encrypting, and re-wrapping to remaining
recipients.

## Open decisions (for the decision-maker)

- **O1 — IdP vendor. ✅ RESOLVED 2026-06-16 → Supabase.** (Considered: Auth0 — max reuse
  of OnDemand know-how; Clerk — best Expo/RN SDK + drop-in UI.) Supabase collapses auth
  **and** the synced-library Postgres **and** per-user RLS into one dependency — and "one
  user = one isolated library" (`CLAUDE.md`) is a textbook single-table-RLS case, far
  simpler than OnDemand's `school_id` dance. The backend verify seam is vendor-agnostic
  regardless (config: issuer + audience + JWKS URL).
- **O2 — Library sync encryption (the crux). ✅ RESOLVED 2026-06-17 → zero-knowledge.**
  Library *content* sync is client-encrypted under a user-held secret we cannot read —
  the same custody as keys (D5). Plaintext was rejected: its only real upside
  (server-side/web rendering + search) is already deferred by ADR-004 (the reader is a
  separate offline client-side app), so plaintext would erode "your content is yours"
  to buy features we've chosen not to build. Note: zero-knowledge needs a user-held
  secret **regardless of the IdP** — an IdP login alone gives us no key we can't read.
- **O3 — Ship key sync (D5) at v1.1, or defer? ✅ RESOLVED 2026-06-17 → defer past v1.1.**
  Per D7 (demo/quality-first), ship **device-local only** now: keys re-entered per
  device; the library is local plus the exported EPUB/PDF artifact as the cross-device
  story. The O2 stance is locked regardless, so deferring the build incurs no rework.
- **O4 — Recovery story (zero-knowledge). ✅ RESOLVED 2026-06-17 → recovery key + export
  fallback.** A **one-time recovery key shown at sync setup** (1Password-style) plus the
  **exported artifact as the standing fallback** (the synced library is a convenience
  copy, not the only copy). Detailed design deferred with the sync build (ticket #4).
- **O5 — DB choice. ✅ RESOLVED 2026-06-16 → Supabase Postgres** (follows O1; bundled
  with the IdP + RLS rather than a standalone `asyncpg` + Alembic stack). The first
  migration arrives with follow-up ticket #2, not #1 (D1 verify needs no DB).

## Consequences

**Positive:** authentication build collapses to JWKS verify; BYOK trust preserved by
default (device-local keys, never-promote rule); per-provider granularity matches how
users actually hold keys; registry-driven storage means new providers need no
migration; the **runtime generation path already supports all of this** — net new work
is confined to the account/sync layer.

**Negative / risk:** introduces Mentible's first DB and first hosted-identity
dependency; zero-knowledge encryption adds real recovery complexity (O4); per-device
capability divergence (D4) is new UX surface; per-provider managed billing interacts
with metering (ADR-005) — explicitly **out of scope here**.

**Migration:** strictly additive. Anonymous / device-local remains the zero-account
baseline (and the public demo's mode); an account is an **opt-in** for sync.

## Scope — what this ADR is _not_

Not the metering/billing design (an ADR-005 follow-up), not the sync API wire format,
not prompt/content. It fixes the **identity + credential-custody model**; the items in
the Open Decisions section are deliberately left to the decision-maker.

## Follow-up tickets (split from #90 once a model is chosen)

1. **✅ DONE.** IdP integration + backend JWKS verify (D1). `backend/src/auth/`;
   Google sign-in live on prod 2026-06-27.
2. **✅ DONE.** First DB + migration `0001` (O5) — account + credential-set tables.
   `backend/alembic/versions/0001_account_and_credential_set.py`.
3. **✅ DONE.** Credential-set storage + multi-provider Settings UI (D2–D4).
   `backend/src/accounts/`, `mobile/app/account.tsx`.
4. **⏳ Deferred past v1.1 (O3).** Library sync API + zero-knowledge envelope encryption
   (D10) + recovery-key UX (O2/O4) — device-local-only until then.
   **Scoped:** see [`docs/SYNC_BUILD_PLAN.md`](../SYNC_BUILD_PLAN.md).
5. **⏳ Deferred (depends on #4).** Provenance-driven degradation UX (D6) — only
   meaningful once sync lands. Folded into the plan above (Phase 5).
6. **✅ Built.** Rate limiting (D9) — per-identity fixed-window limiter (authed
   `Principal.sub`, IP fallback for the anonymous demo) gating the expensive endpoints
   (`/generate`, `/structure`, `/export`); Redis-backed, fail-open, 429 + `Retry-After`,
   per-minute + per-day windows, on by default. Shipped **`fbd5aad`** (2026-06-16),
   `backend/src/core/rate_limit.py` + `backend/tests/test_rate_limit.py` (8 tests).
   _(Issue [#221](https://github.com/wegofwd2020-hub/Mentible/issues/221) was filed
   2026-06-29 in error — it post-dated this commit; closed as already-implemented. The
   per-plan-tier limits remain a later ADR-005 refinement.)_
7. **◑ Partial.** Book sharing (D11) — artifact-export path (tier 1) rides ADR-004 and
   is **live**; the public-key per-book-DK tier (tier 2) is a *later* ticket, only if
   live shared libraries land.
