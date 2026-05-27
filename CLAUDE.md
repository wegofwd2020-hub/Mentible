# StudyBuddy Q — CLAUDE.md

> **Brand:** StudyBuddy Q  *(Q = Query — references the scoped-query model that is the engineering IP)*
> **Repo:** `StudyBuddy_SelfLearner` *(repo name is internal; brand is public)*
> **Status:** Pre-MVP — directory stubs only, no application code yet.

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

The parent product's docs (`StudyBuddy_OnDemand/CLAUDE.md` and the
`studybuddy-docs` repo) are useful background but **do not apply** to this repo.
This is a separate product with separate compliance, infra, and audience.

---

## Locked decisions (D1–D19, see SCOPE.md §5)

| | Decision |
|---|---|
| D1 | BYOK — user pays Anthropic directly |
| D2 | Async generation + push (FCM) when done; polling at MVP |
| D3 | Android first (iOS later) |
| D4 | Cloud sync at v1.1+; local-only at MVP |
| D5 | New repo `StudyBuddy_SelfLearner`; brand "StudyBuddy Q" |
| D6 | Standalone — no funnel back to school SKU |
| D7 | Demo / quality-first, not scale-first |
| D8 | React Native + Expo |
| D9 | Key handling Pattern B — per-request passthrough |
| D10 | Auth: email+password AND Sign in with Google |
| D11 | Hosting: shared infra with StudyBuddy_OnDemand |
| D12 | Latency target: minutes, not seconds-with-stream |
| D13 | v1 output formats: Lesson / Explanation / Quiz |
| D14 | v1 visual aids: KaTeX + Mermaid + blockquotes + tables + AI-picks |
| D15 | Refined 7-field input list |
| D16 | Single canvas + collapsible side panel (no wizard) |
| D17 | *(amended — ADR-004)* Paid authoring app (subscription/purchase, covers app+upkeep only) + free reader app; author still BYOK |
| D18 | v1 storage: ~100-lesson fair-use cap |
| D19 | Brand "StudyBuddy Q" |

---

## Repository layout

```
StudyBuddy_SelfLearner/
  CLAUDE.md            ← this file
  SCOPE.md             ← scope decisions (the why)

  mobile/              ← React Native + Expo (Android-first)
    app/
      screens/         ← Query · Library · Settings · Lesson view
      components/      ← Markdown renderer (KaTeX + Mermaid + tables)
      hooks/           ← useGenerateJob · useLibrary · useAuth
      api/             ← Backend HTTP client · FCM handler
      secure/          ← expo-secure-store wrapper for the BYOK API key

  backend/             ← FastAPI
    main.py
    src/
      auth/            ← Account creation · sign in · refresh (v1.1+)
      generate/        ← POST /generate · GET /jobs/{id} · push
      library/         ← v1.1+ — saved lessons
      sync/            ← v1.1+ — cloud sync
      core/            ← Job queue · FCM client · Anthropic call

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
   - Stateless except for: user accounts (v1.1+) and library (v1.1+)
   - Async job queue (Celery + Redis)
   - Calls Anthropic on user's behalf with passthrough key
   - NEVER logs the key. Encrypts in Redis with TTL = job timeout. Shreds after use

3. Anthropic API
   - Billed directly to user's account (BYOK)
   - We have no commercial relationship for token usage
```

---

## Layer rules — dependencies flow downward only

```
mobile/app/screens/    → mobile/app/hooks/ + mobile/app/components/
mobile/app/hooks/      → mobile/app/api/ + mobile/app/secure/
mobile/app/api/        → (external: backend REST)
mobile/app/secure/     → expo-secure-store

backend/src/generate/  → backend/src/core/ + pipeline/
backend/src/library/   → backend/src/core/  (v1.1+)
backend/src/sync/      → backend/src/library/  (v1.1+)
backend/src/auth/      → backend/src/core/  (v1.1+)

pipeline/              → Anthropic SDK (no backend imports — keep portable)
```

---

## Backend non-negotiable rules

1. **The API key never touches a log line, a database row, or an exception traceback.** See ADR-001 for the full discipline. `structlog` filter, exception-scrubber middleware, and a `key_redacted_logger` wrapper are mandatory.
2. **The key lives in Redis only** between request submission and worker pickup, encrypted with a per-job ephemeral key, TTL = job timeout (default 120 s). Worker reads, uses, deletes. No persistence to disk.
3. **No proxy layer for Anthropic responses.** The backend returns the lesson JSON directly to the client; no caching, no CDN, no shared content store at MVP.
4. **Single-tenant by user, no RLS.** This product has no multi-tenancy. One user account = one isolated library. Avoid the OnDemand `app.current_school_id` dance entirely.
5. **No Celery beat / scheduled tasks at MVP.** All work is request-driven.
6. **`asyncpg` for Postgres, `aioredis` for Redis, `httpx.AsyncClient` for outbound HTTP.** Never block the event loop.
7. **No cross-product imports.** Backend never imports from `StudyBuddy_OnDemand`. Code reuse is exclusively via the `pipeline/` vendored copy. See ADR-002.

---

## Backend non-negotiable security rules

- **All secrets from env vars; no hardcoded defaults.** `pydantic-settings`. Fail fast at startup.
- **TLS-only.** No plaintext HTTP for `/generate` or any endpoint that touches the key.
- **No key in URL params, query strings, or `Authorization` headers we own.** The user's Anthropic key goes in the request body of `/generate`. The `Authorization` header carries our session JWT (v1.1+), never the BYOK key.
- **CSP / referrer policy** on any web admin surface (none planned at MVP, but if it materialises).
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

### Authentication (v1.1+)
- Email+password (bcrypt) + Sign in with Google.
- JWT in `Authorization: Bearer <token>`.
- Refresh tokens in Redis, 30-day TTL.
- **Session JWT is OUR token.** It is NOT the user's Anthropic key.

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
5. **Treating this as "another StudyBuddy".** It isn't. No multi-tenancy. No RLS. No FERPA. No school anything. If you find yourself porting a school concept, stop.
6. **Skipping the trademark check.** Before alpha release, search USPTO TESS, Google Play, App Store for "StudyBuddy Q" and watch for **Amazon Q** trademark issues. Never collapse to bare "Q" in marketing.

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
- **No PII collected at MVP.** Only an email address (v1.1+ when accounts arrive).
- **The user's Anthropic API key is the user's property.** We touch it transiently per request, never persist it, and never display it (settings shows last-4 only).
- **The user's lessons are the user's property.** Cloud library at v1.1+ — store with same care as PII; user can wipe their library at any time.
- **GDPR posture (v1.1+):** account deletion within 30 days; library purged immediately on request.
