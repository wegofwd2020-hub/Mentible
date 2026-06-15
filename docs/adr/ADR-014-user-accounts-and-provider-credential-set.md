# ADR-014 — User accounts & the per-provider credential set (BYOK-first identity)

**Status:** Proposed — 2026-06-11
**Decision-maker:** Sivakumar Mambakkam
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

## Open decisions (for the decision-maker)

- **O1 — IdP vendor.** Auth0 (max reuse of OnDemand know-how) · Clerk (best Expo/RN
  SDK + drop-in UI) · **Supabase** (collapses auth **and** the synced-library Postgres
  **and** per-user RLS into one dependency — and "one user = one isolated library",
  `CLAUDE.md`, is a textbook single-table-RLS case, far simpler than OnDemand's
  `school_id` dance).
- **O2 — Library sync encryption (the crux).** Plaintext (we can read user content;
  simpler; enables server-side/web features) vs client-encrypted **zero-knowledge**
  (true "your content is yours"; harder recovery). Note: zero-knowledge needs a
  user-held secret **regardless of the IdP** — an IdP login alone gives us no key we
  can't read.
- **O3 — Ship key sync (D5) at v1.1, or defer** and start device-local-only?
- **O4 — Recovery story** if we go zero-knowledge: lost passphrase = lost synced data?
- **O5 — DB choice:** `asyncpg` + Alembic (the `CLAUDE.md`-implied path) vs Supabase
  Postgres (bundled with O1).

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

1. IdP integration + backend JWKS verify (D1)
2. First DB + migration `0001` (O5) — account + credential-set tables
3. Credential-set storage + multi-provider Settings UI (D2–D4)
4. Library sync API + encryption stance (O2)
5. Provenance-driven degradation UX (D6)
6. Rate limiting (D9)
