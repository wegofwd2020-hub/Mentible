# StudyBuddy Q — CLAUDE.md

> **Brand:** **Mentible** (public rebrand of "StudyBuddy Q" — ADR-006, Accepted; name
> pending trademark clearance). "StudyBuddy Q" / "Q = Query" framing below is historical.
> **Repo:** `StudyBuddy_SelfLearner` *(repo name is internal; brand is public)*
> **Status (updated 2026-06-27):** **In production.** This file's "Pre-MVP / directory
> stubs only" line is long obsolete. Built + deployed: FastAPI backend (generate /
> export / accounts / **super-admin admin API** — live at `mambakkam.net/mentible-api`),
> Expo app (Books-only authoring, reader, BYOK, **accounts via Supabase**), the Node
> **EPUB3/PDF compiler**, the **Content Trust Manifest** (SBQ-TRUST-001/002). Shipped
> surfaces: **full web app** at `mambakkam.net/app/mentible`, read-only **demo** at
> `/demos/mentible`, and an Android **APK** release. Google sign-in + the super-admin
> console are **verified live on production**. **The canonical, current "what's built"
> record is [`docs/STATUS.md`](docs/STATUS.md)** — read it first; the ADRs and STATUS.md
> take precedence over the older framing in this file.

A purpose-built Anthropic client for **self-learners**. Adults paste their own
Anthropic API key (BYOK), describe what they want to learn, and get a beautifully
rendered lesson, explanation, or quiz back. Not a chatbot. Not a course platform.
Not a children's product.

Think *"Claude Code, but for learners instead of coders."* The opinion is the
product — refuse free-form chat, refuse generic markdown rendering, force the
user through the 6 scope dimensions that turn a bare prompt into a real
educational artefact.

> **Product shape (amended 2026-05-27 — see ADR-004).** The product is now **two
> apps**: a **paid authoring app** (this repo — generate content, compile an
> **EPUB3/PDF artifact**, author **BYOK**) and a **separate, free, offline reader
> app** (new repo — opens any EPUB/MOBI/PDF, "lights up" *our* books with
> interactive quizzes + local progress). The single-app, "free download" framing
> in parts of this file and `SCOPE.md` predates the split — **ADR-003** (book
> authoring) and **ADR-004** (two-product split + artifact delivery) take
> precedence where they differ.

> **Books-only (amended 2026-06-05 — see ADR-009).** The standalone **Query**
> single-lesson surface has been removed; the app is now **Books-only** (nav:
> Library · Books · Settings · Help · About). The scoped-query *model* below is
> unchanged and remains the IP — it now expresses itself **per topic inside a
> book** rather than as a one-off lesson. Mentions of a "Query screen", a single
> "Lesson view", or single-lesson output (D13, D16) are historical; **ADR-009**
> takes precedence.

> **Provider-agnostic + hybrid keys + accounts at MVP (amended 2026-05-29 / 2026-06-11
> — see ADR-005 and ADR-014).** Two reframes post-date the BYOK-only, accountless
> framing in this file:
> - **Provider-agnostic, hybrid key handling (ADR-005, Accepted).** The product is no
>   longer an *Anthropic-only* client and BYOK is no longer the *only* key model. Key
>   handling is **hybrid**: a **managed-key vault is the default** ("subscribe and it
>   just works"; we hold provider keys and carry the token cost under a metered plan
>   allowance), with **BYOK as an optional power-user path** (ADR-001 passthrough
>   discipline, now per provider). This **reverses** the "user pays Anthropic / we have
>   no commercial relationship for token usage" statements below for managed users
>   (they still hold for BYOK users). ADR-005 also **pulls accounts/auth + usage
>   metering forward from v1.1+ to MVP**, because managed billing cannot be anonymous.
> - **Account model (ADR-014, Proposed).** Identity is via an **external IdP verified
>   statelessly by JWKS** — we do **not** build password/refresh-token machinery (this
>   supersedes the bcrypt + refresh-token-in-Redis details below). The account owns a
>   **per-provider credential set** (registry-keyed, custody per entry: device-local /
>   synced-e2e / managed-vault), not "the user's key". Keys stay **device-local by
>   default**; sync is opt-in and zero-knowledge. As ADR-014 is *Proposed*, its
>   specifics (IdP vendor, encryption stance, DB choice) are not yet locked.
>
> Where this file's D1 / D4 / D9 / D10 / D17 / D18, the "Authentication (v1.1+)"
> rules, and the compliance/PII notes differ, **ADR-005 (accepted) and ADR-014
> (proposed) take precedence.**

---

## Mental model — "scoped retrieval over the world of knowledge"

Every generation is a **scoped query** against the LLM, parametrised by six dimensions
(inherited from StudyBuddy_OnDemand's IP):

| Scope dimension | What it enforces |
|---|---|
| Topic / subject | What the lesson is about |
| Level (grade-equivalent) | Reading level, conceptual depth |
| Language | en / fr / es (en at MVP) |
| Prior knowledge | What the learner already knows |
| Format | Lesson / Explanation / Quiz / etc. |
| Real-world framing | Optional anchor to something the learner cares about |

**The LLM is the commodity. The scoping layer is the product IP.** When touching
prompts, providers, or the input form, think "I'm tuning a scoped-retrieval
system," not "I'm wrapping ChatGPT."

---

## Document map

Read these in order:

| Doc | Read when |
|---|---|
| `SCOPE.md` | First — full scope decisions, why each was made |
| `docs/MVP_v1.md` | Second — what's actually being built first |
| `docs/adr/ADR-001-byok-security-model.md` | Before touching anything that handles the API key |
| `docs/adr/ADR-002-repo-structure-and-vendoring.md` | Before importing or copying from StudyBuddy_OnDemand |
| `docs/adr/ADR-003-book-authoring.md` | Before touching book authoring (TOC structuring, topic tree, generate-all) |
| `docs/adr/ADR-004-two-product-split-and-artifacts.md` | Before touching artifact export (EPUB3/PDF), the money model, or anything reader-facing |
| `docs/ARTIFACT_PIPELINE.md` | With ADR-004 — the content→EPUB3/PDF compile flow and the interactive-vs-static matrix |
| `docs/adr/ADR-005-multi-provider-llm-support.md` | Before touching key handling, the provider seam, or the money model — BYOK is now one of two paths (managed-key vault is the default); accounts/auth + metering moved to MVP (amends D1/D9, ADR-001, ADR-004 D6) |
| `docs/adr/ADR-009-books-only-remove-query.md` | Before adding any generation surface — the app is Books-only; the Query single-lesson screen was removed (amends D13/D16) |
| `docs/adr/ADR-014-user-accounts-and-provider-credential-set.md` | Before touching accounts/auth or the Settings key UI — identity is an external IdP verified by JWKS (no password machinery); the account owns a per-provider credential set, keys device-local by default (proposed; amends D10 and the Authentication rules) |
| `docs/adr/ADR-018-system-owner-principal.md` | Before touching default-library publishing or the owner signing secret — the system owner is a signing *capability* (`SYSTEM_OWNER_SECRET`), distinct from the super-admin *role*; see also pitfall #7 |
| `docs/adr/ADR-020-super-admin-operator-role.md` | Before touching the admin API, the `SUPER_ADMIN_EMAILS`/`SUPER_ADMIN_SUBS` allowlist, the admin console, or the `admin_audit` trail — a single privileged operator tier, derived from config (never a token claim), nuances "single-tenant / no RLS" (built & live; amends backend rule #4) |

The parent product's docs (`StudyBuddy_OnDemand/CLAUDE.md` and the
`studybuddy-docs` repo) are useful background but **do not apply** to this repo.
This is a separate product with separate compliance, infra, and audience.

---

## Locked decisions (D1–D19, see SCOPE.md §5)

| | Decision |
|---|---|
| D1 | *(amended — ADR-005)* **Hybrid key handling**: managed-key vault is the **default** (we hold provider keys, carry token cost under a metered plan allowance); **BYOK is the optional power-user path** (user pays the vendor directly). BYOK-only "user pays Anthropic" now describes the BYOK path, not the whole product |
| D2 | Async generation + push (FCM) when done; polling at MVP |
| D3 | Android first (iOS later) |
| D4 | *(clarified — ADR-005)* Cloud **library sync** stays v1.1+; library is local-first at MVP. But **accounts/auth move to MVP** (ADR-005 decouples accounts from sync — managed billing needs identity) |
| D5 | New repo `StudyBuddy_SelfLearner`; brand "StudyBuddy Q" |
| D6 | Standalone — no funnel back to school SKU |
| D7 | Demo / quality-first, not scale-first |
| D8 | React Native + Expo |
| D9 | *(amended — ADR-005)* Pattern B (per-request passthrough) is now **one of two** key paths — it is the **BYOK** path; the **managed** path adds a separate at-rest vault regime. Generalised to a **per-provider credential set** (ADR-014) |
| D10 | *(amended — ADR-005/014)* Auth moved to **MVP** (was v1.1+). Methods: email + Google (+ Apple on iOS). **Via an external IdP verified by JWKS — we don't build password/refresh machinery** (ADR-014, proposed) |
| D11 | Hosting: shared infra with StudyBuddy_OnDemand |
| D12 | Latency target: minutes, not seconds-with-stream |
| D13 | *(amended — ADR-009)* Output formats: Lesson / Explanation / Quiz — as **per-topic content within a book**; no standalone single-lesson generator (`lesson` wired at MVP) |
| D14 | v1 visual aids: KaTeX + Mermaid + blockquotes + tables + AI-picks |
| D15 | Refined 7-field input list |
| D16 | *(superseded — ADR-009)* Described the Query screen (removed). Authoring uses New Book → structure → editable topic tree → generate → publish (ADR-003) |
| D17 | *(amended — ADR-004, then ADR-005)* Paid authoring app (subscription/purchase) + free reader app. The fee covers app+upkeep only for **BYOK** users; for **managed** users the subscription **also includes a metered token allowance** (we carry the vendor cost), so pricing is margin-aware with per-plan caps (ADR-005 D4 amends ADR-004 D6) |
| D18 | *(reinterpreted — ADR-005)* ~100-unit fair-use cap — now also a **cost-control lever** for managed token spend, not just a storage limit |
| D19 | Brand "StudyBuddy Q" |

> **Privileged roles (post-MVP additions, not captured as D-decisions).** Two
> operator concepts post-date D1–D19 and are governed by their ADRs, not this
> table: the **system-owner signing capability** (`SYSTEM_OWNER_SECRET`, ADR-018)
> and the **super-admin operator role** (`SUPER_ADMIN_EMAILS`, ADR-020 — built &
> live). They are deliberately *separate*: the owner secret is a crypto capability
> (signs default-library manifests), the super-admin is a human authz role (who may
> *ask*), and a super-admin never holds the owner secret (ADR-020 D4).

---

## Repository layout

```
StudyBuddy_SelfLearner/
  CLAUDE.md            ← this file
  SCOPE.md             ← scope decisions (the why)

  mobile/              ← React Native + Expo (Android-first)
    app/
      screens/         ← Library · Books · Settings (Query/Lesson removed — ADR-009)
      admin.tsx · admin/[sub].tsx  ← super-admin console, gated on is_super_admin (ADR-020; BUILT)
      components/      ← Markdown renderer (KaTeX + Mermaid + tables)
      hooks/           ← useGenerateJob · useLibrary · useAuth
      api/             ← Backend HTTP client · FCM handler · adminClient (ADR-020)
      secure/          ← expo-secure-store wrapper for the BYOK API key

  backend/             ← FastAPI
    main.py
    src/
      auth/            ← IdP JWT verify via JWKS (MVP — ADR-005/014; BUILT) ·
                          admin.py = SUPER_ADMIN allowlist · deps.require_super_admin (ADR-020)
      admin/           ← /api/v1/admin/* user-management API + admin_audit trail (ADR-020; BUILT)
      generate/        ← POST /generate · GET /jobs/{id} · push
      library/         ← v1.1+ — saved lessons
      sync/            ← v1.1+ — cloud sync
      core/            ← Job queue · FCM client · Anthropic call · system_owner.py (ADR-018 signing)

  pipeline/            ← Vendored from StudyBuddy_OnDemand
    prompts.py
    providers/         ← AnthropicProvider
    content_format_validator.py
    VENDORED.md        ← Source SHAs of vendored files (see ADR-002)

  scripts/
    sync-from-ondemand.sh    ← Vendoring sync helper

  tests/

  docs/
    MVP_v1.md
    adr/
      ADR-001-byok-security-model.md
      ADR-002-repo-structure-and-vendoring.md
```

---

## Three runtime contexts

```
1. Mobile App (Android, React Native)
   - Holds API key in expo-secure-store
   - Sends key in request body per /generate call
   - Renders Markdown + KaTeX + Mermaid

2. Backend API (FastAPI)
   - Stateless except for: user accounts (MVP — ADR-005), the durable
     `admin_audit` trail (ADR-020), and library (v1.1+). Accounts verify an
     external-IdP JWT via JWKS; no auth DB for credentials themselves (ADR-014)
   - A config allowlist (`SUPER_ADMIN_EMAILS`) derives a super-admin operator
     tier that may read/act on account *metadata* across users via the explicit,
     audited `/api/v1/admin/*` API — never via RLS or per-tenant isolation (ADR-020)
   - Async job queue (Celery + Redis)
   - Calls the LLM on the user's behalf: BYOK passthrough key, OR our managed
     vault key for managed plans (ADR-005)
   - NEVER logs the key — ours or the user's. Encrypts in Redis with TTL = job
     timeout. Shreds after use

3. LLM provider API (Anthropic + others — ADR-005)
   - BYOK path: billed directly to the user's vendor account; no commercial
     relationship for token usage
   - Managed path (default): billed to us, covered by the plan's metered token
     allowance — this is a commercial relationship with the vendor (ADR-005 D4)
```

---

## Layer rules — dependencies flow downward only

```
mobile/app/screens/    → mobile/app/hooks/ + mobile/app/components/
mobile/app/hooks/      → mobile/app/api/ + mobile/app/secure/
mobile/app/api/        → (external: backend REST)
mobile/app/secure/     → expo-secure-store

backend/src/generate/  → backend/src/core/ + pipeline/ + backend/src/billing/ (managed key source)
backend/src/billing/   → backend/src/core/ + backend/src/auth/  (ADR-005 D6 — managed vault · metering · plans/entitlements; Phases 1–3 BUILT)
backend/src/library/   → backend/src/core/  (v1.1+)
backend/src/sync/      → backend/src/library/  (v1.1+)
backend/src/auth/      → backend/src/core/  (MVP — ADR-005/014; BUILT)
backend/src/admin/     → backend/src/auth/ + backend/src/accounts/ + backend/src/billing/  (ADR-020 + ADR-005 D6 entitlement grant; BUILT)

pipeline/              → Anthropic SDK (no backend imports — keep portable)
```

---

## Backend non-negotiable rules

1. **The API key never touches a log line, a database row, or an exception traceback.** See ADR-001 for the full discipline. `structlog` filter, exception-scrubber middleware, and a `key_redacted_logger` wrapper are mandatory.
2. **The key lives in Redis only** between request submission and worker pickup, encrypted with a per-job ephemeral key, TTL = job timeout (default 120 s). Worker reads, uses, deletes. No persistence to disk.
3. **No proxy layer for Anthropic responses.** The backend returns the lesson JSON directly to the client; no caching, no CDN, no shared content store at MVP.
4. **Single-tenant by user, no RLS.** This product has no multi-tenancy. One user account = one isolated library. Avoid the OnDemand `app.current_school_id` dance entirely. **One nuance (ADR-020):** a single config-derived **super-admin operator tier** may read/act on account *metadata* across users (list/suspend/reactivate/delete) through the explicit, audited `/api/v1/admin/*` API. That is *not* multi-tenancy and *not* RLS — it is one privileged human role gated by `require_super_admin`, never per-tenant row isolation, and it never touches user *content*. Don't reintroduce RLS or a tenant column to serve it.
5. **No Celery beat / scheduled tasks at MVP.** All work is request-driven.
6. **`asyncpg` for Postgres, `aioredis` for Redis, `httpx.AsyncClient` for outbound HTTP.** Never block the event loop.
7. **No cross-product imports.** Backend never imports from `StudyBuddy_OnDemand`. Code reuse is exclusively via the `pipeline/` vendored copy. See ADR-002.

---

## Backend non-negotiable security rules

- **All secrets from env vars; no hardcoded defaults.** `pydantic-settings`. Fail fast at startup.
- **TLS-only.** No plaintext HTTP for `/generate` or any endpoint that touches the key.
- **No key in URL params, query strings, or `Authorization` headers we own.** The user's BYOK key goes in the request body of `/generate`. The `Authorization` header carries the IdP session JWT (MVP — ADR-005/014), never the BYOK key.
- **CSP / referrer policy** on any web admin surface. (A super-admin console now exists — ADR-020 — served as part of the web app; it gates on `is_super_admin` and calls the audited `/api/v1/admin/*` API.)
- **Adult-only product.** No COPPA / FERPA logic. Sign-up requires self-attestation of age ≥ 18 (v1.1+).

---

## Pipeline rules (vendored from StudyBuddy_OnDemand)

- **Pin Claude model ID** in `pipeline/config.py`. Same `claude-sonnet-4-6` default as the parent product.
- **`max_tokens=16384`** — same rationale as parent (Epic 11 prompts regularly exceed 8192).
- **Validate every Claude response against the JSON schema** before returning to the client. Retry up to 3× on `ValidationError`; then fail the job.
- **No idempotency / content-store layer at MVP.** Each `/generate` call is a fresh Anthropic call. Caching/idempotency is v1.2+ (and may never be added — generations are inherently one-off in solo mode).
- **Updating vendored files is a manual, deliberate act.** See ADR-002. Run `scripts/sync-from-ondemand.sh`, review the diff, commit with a `chore(vendor): sync prompts.py from OnDemand@<sha>` message.

---

## Key conventions

### Configuration
- `pydantic-settings`; env vars only. `config.py` is the single import point.
- Required at startup: `REDIS_URL`, `ANTHROPIC_DEFAULT_MODEL`, `ENCRYPTION_KEY` (for per-job key encryption envelope).
- Optional: `SUPER_ADMIN_EMAILS` / `SUPER_ADMIN_SUBS` — the super-admin allowlist (ADR-020). Empty = **no** admins (safe default); the flag is *derived* from this config, never read from a token claim.

### Authentication (MVP — ADR-005; model per ADR-014, proposed)
- **External IdP, verified statelessly via JWKS.** We do NOT build password
  storage, reset flows, OAuth plumbing, or refresh-token rotation — the IdP owns
  them (ADR-014 D1). The bcrypt + Redis-refresh-token design previously described
  here is superseded.
- Methods: email + Google (+ Apple on iOS). IdP vendor is an open decision
  (ADR-014 O1).
- IdP session JWT in `Authorization: Bearer <token>`; backend verifies the
  signature against the IdP's JWKS (no auth DB for it).
- **Session JWT is OUR/the IdP's token.** It is NEVER the user's LLM key — the
  BYOK key still travels only in the `/generate` request body (ADR-001).
- The account owns a **per-provider credential set** (registry-keyed; custody
  per entry: device-local / synced-e2e / managed-vault), not "the user's key"
  (ADR-014 D2–D5).

### Logging
- `structlog` JSON output.
- **Mandatory key-redaction filter** applied at the structlog processor chain. Any log entry containing `api_key`, `anthropic_key`, or a value matching the `sk-ant-*` regex is dropped or redacted.
- Never `print()`. Never `logger.info(f"key={key}")`.

### Mobile state
- `expo-secure-store` for the BYOK key (Android Keystore-backed).
- `AsyncStorage` for last-generated lesson (MVP).
- Migration to `expo-sqlite` when library lands (v1.1+).

---

## Testing

```
Backend: pytest + httpx.AsyncClient
         Mocked Redis (fakeredis), mocked Anthropic SDK
         **Mandatory test:** assert no log line in any code path contains the test API key
         70% minimum coverage in CI

Mobile:  Jest + React Native Testing Library for components
         Manual end-to-end on real device for the BYOK loop
         (no live Anthropic in CI — mock the backend)

Pipeline: pytest with mocked Anthropic SDK
          Schema validation tests, retry behaviour, max_tokens regression
```

**Never** hit a live Anthropic, live Redis, or any external API in CI.

---

## Top pitfalls

1. **Logging the API key.** The single most damaging mistake possible in this codebase. Read ADR-001 before writing any code that touches the request body.
2. **Storing the key in Postgres / on disk.** The key lives only in Redis with TTL, then in the worker process memory during the Anthropic call. Anywhere else is a bug.
3. **Importing from `StudyBuddy_OnDemand`** instead of vendoring. Couples release cycles. See ADR-002.
4. **Forgetting `expo-secure-store` is async.** Mobile UX must handle the async key-fetch on Settings load.
5. **Treating this as "another StudyBuddy".** It isn't. No multi-tenancy. No RLS. No FERPA. No school anything. If you find yourself porting a school concept, stop. (The lone privileged role is the ADR-020 super-admin operator tier — config allowlist + audited admin API, *not* RLS or per-tenant isolation; see backend rule #4.)
6. **Skipping the trademark check.** Before alpha release, search USPTO TESS, Google Play, App Store for "StudyBuddy Q" and watch for **Amazon Q** trademark issues. Never collapse to bare "Q" in marketing.
7. **Signing the default library with a real owner secret.** Publishing a default-library book (`owner_cli publish <id>`, ADR-018) HMAC-signs its manifest entry with `SYSTEM_OWNER_SECRET`. In the repo and CI that secret is the **dev constant `"1"×64`** — hardcoded in `.github/workflows/ci.yml` and `backend/tests/conftest.py`, and the `Backend — Tests` gate (`test_committed_default_library_manifest_is_valid`) verifies every *published* book's signature against it. So you **must** publish/re-sign with `SYSTEM_OWNER_SECRET=$(printf '1%.0s' {1..64})`, **not** a real `.env` secret — signing with anything else makes the committed signatures fail verification and turns `main` red. The committed signature is therefore **tamper-evidence within the repo only** (the constant is public); real anti-forgery signing with a true out-of-band owner secret is deferred to the #112 release-build step. Also re-sign the mirrored `mobile/assets/library/manifest.json` to match.

---

## Running things

```bash
# Backend (after MVP scaffolding lands)
cd backend && uvicorn main:app --reload

# Pipeline test (after vendor sync)
cd pipeline && pytest

# Mobile (after Expo init)
cd mobile && npx expo start --android
```

(Concrete `dev_start.sh` and Docker Compose set-up come with the first PR that
populates the directories.)

---

## Compliance

- **Adults only.** No COPPA. No FERPA.
- **Minimal PII at MVP (amended — ADR-005/014).** Accounts arrive at MVP (ADR-005), so an **IdP identity reference** (`sub`, email) is collected at MVP. The account row stores only that, credential-set metadata, and a pointer to the synced library — **nothing about what the user generates** (ADR-014 D8). The anonymous / device-local mode remains the zero-account baseline (and the public demo's mode).
- **The user's LLM API key is the user's property.** BYOK keys are device-local by default; we touch a BYOK key transiently per request, never persist it, and never display it (settings shows prefix + last-4 only). **Managed** keys are *ours*, held in a vault (ADR-005) — a BYOK key is never silently promoted to managed (ADR-014 D3).
- **The user's lessons are the user's property.** Cloud library at v1.1+ — store with same care as PII; optional sync is opt-in and zero-knowledge by default (ADR-014 D5); user can wipe their library at any time.
- **GDPR posture:** account deletion purges on the documented schedule (within 30 days; library purged immediately on request) (ADR-014 D8).
