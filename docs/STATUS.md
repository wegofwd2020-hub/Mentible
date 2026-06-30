# Project Status — Mentible (repo `StudyBuddy_SelfLearner`)

> **Release `v0.2.0` — 2026-06-28** (first tagged release; live prod web build is
> `c2e5821`, the tag adds the 0.2.0 version bump + these notes).
> **What's new since go-live:** account deletion now removes the Supabase identity
> (ADR-022, opt-in/off-by-default), plus web/UX fixes — all live on prod. See
> **"Release v0.2.0 (2026-06-28)"** just below.
> **Last updated:** 2026-06-29 — **docs reconciliation** (PRs #219/#220, docs-only, no
> code/behaviour change): CLAUDE.md + the ADR-020 and ADR-014 follow-up tickets aligned
> with shipped reality; the deferred **zero-knowledge sync build is now scoped**
> (`docs/SYNC_BUILD_PLAN.md`); the **rate-limiting gap** (ADR-014 D9) is tracked (#221).
> Prior: 2026-06-28 (release v0.2.0) / 2026-06-27 (accounts / go-live / trust /
> web-app arc — see **"Shipped since the last refresh"**).
> **Brand:** **Mentible** (rebrand of "StudyBuddy Q" — ADR-006, Accepted; name
> pending trademark clearance). The repo/dir name `StudyBuddy_SelfLearner` is
> unchanged and internal.
> A running record of what's **actually built** on `main`, versus the plan. The
> plan says what we're building; this doc says what's done. CLAUDE.md still carries
> the older "StudyBuddy Q / single-app" framing in places — the ADRs below take
> precedence where they differ.

---

## TL;DR

Mentible is a **paid authoring app** (this repo) that turns a scoped query into a
**multi-topic book** and compiles it to **EPUB3 / PDF** artifacts; a separate free
**reader app** (different repo, not built here) is the eventual companion
(two-product split, ADR-004). Since the last refresh the product moved a long way:

- **Rebrand to Mentible** (ADR-006) across app, web title, brand assets.
- **Books-only** (ADR-009) — the standalone Query single-lesson surface was removed.
- **Multi-provider LLM** (ADR-005/012/013) — generation runs through the shared
  **`wegofwd-llm`** package: Anthropic (tool-use) + OpenAI-compatible (OpenAI,
  Groq, OpenRouter, Gemini), per-provider BYOK, validate→repair, provenance stamped.
- **Node artifact compiler** (`compiler/`) — EPUB3 + PDF (Vivliostyle) + cover +
  colophon + draft/release watermarking + EPUB Accessibility 1.1 + branded diagrams.
- **Backend export endpoint** shells out to the compiler; **gate 3** (format-drift)
  runs on every content surface.
- **Demo backend** deployment config landed (shared VPS + Fly runbook).
- **Pramana B2B compliance** integration is a **defined contract** (ADR-011/013),
  **not yet built** (no package builder/signing).

**Centre of gravity now (2026-06-27):** the product **went live**. The backend is
deployed and identity-enabled; the full web app, demo, and APK are shipped; Google
sign-in and the super-admin console are **verified on production**. Focus shifted from
"build the loop" to "operate + polish what's live."

---

## 🏷 Release v0.2.0 (2026-06-28)

First tagged release (`v0.2.0`, `app.json` 0.2.0; live prod web build `c2e5821`). An
operate-and-polish cycle on top of go-live — all items below **merged, verified, and
live on demo + prod** (`mambakkam.net/app/mentible`), and the **prod backend was
refreshed to `main` (`add2807`)**.

- **Account deletion removes the Supabase identity** (ADR-022, PR #215) — in-app
  "Delete account" + admin "Delete user" can now hard-delete the auth identity (so a
  deleted email re-registers fresh), **opt-in via `SUPABASE_SERVICE_ROLE_KEY`, OFF in
  all envs** — and, per the 2026-06-30 decision, **deliberately kept off in prod**
  (see ADR-022 "Prod posture decision"). In-app delete also clears device state.
  Verified end-to-end via `scripts/reset_test_user.py`.
- **Web Alert fix** (PR #217) — `react-native-web` no-ops `Alert.alert`, so every
  confirmation dialog (admin Delete, Delete account, Remove keys, …) silently did
  nothing on web. Added a cross-platform shim (`src/lib/alert.ts`); swapped 17 call
  sites. Restores destructive actions on the web app.
- **Scroll fixes** (PRs #213/#214) — inverted `ScrollView`/`PageContainer` nesting on
  Account/Usage/admin screens; onboarding "Add an LLM key" popup scroll + width.
- **HelpHint rollout** (SBQ-UI-003, PR #216) — `?` hints on generation params, BYOK
  key storage, and the Account Providers custody toggle.
- **Ops:** prod backend refreshed to `main@add2807`; rollback dirs reclaimed;
  `mentible.com` retired (third-party owned) + its Firebase projects deleted.

Open after v0.2.0: backlog (managed billing, library sync, latency, trademark,
Pramana). _Resolved 2026-06-30:_ ADR-022 **stays OFF in prod** (decision in the ADR —
service-role key's auth-admin blast radius vs. rare real-user deletions; revisit when
deletion volume or hardened secret storage warrants); `vm.overcommit_memory=1` applied
on the host; **ADR-021 Everyone Library build trigger settled** (D8 — a strategic gate
with hard prerequisites: demand for public discovery + legal/DMCA cleared + moderation
ready + money-model fit; stays design-only until then).

---

## ⭐ Shipped since the last refresh (2026-06-14 → 06-27)

The arc: **accounts → go-live → trust → hosted web app + deploy pipeline.**

### Accounts & identity (ADR-014 — now Accepted, built & deployed)
- **Supabase IdP** (O1), verified **statelessly via JWKS** — no local password/refresh
  machinery. Account + **per-provider credential-set** DB (asyncpg), backend-mediated
  app-isolation. Mobile **Account page** (email/password + **Google sign-in**, PKCE),
  profile chip, read-only-until-login gate, account-picker on re-login, per-install
  **device tracking**.
- **Google sign-in verified live on production** (`/app/mentible`): Google → token →
  backend `/account` → account + device provisioned.

### Super-admin operator (ADR-020 — now Accepted, built & verified live)
- `/api/v1/admin/users` (list / get / **suspend / reactivate / delete**) gated by a
  config allowlist (`SUPER_ADMIN_EMAILS`; a *derived* flag, never a token claim) + a
  durable **`admin_audit`** trail; **mobile admin console**. Full
  suspend→audit→reactivate→delete + 403-for-non-admin **verified on prod**.

### Content Trust Manifest (ADR-015/016 — now built)
- **SBQ-TRUST-001** (stamp the manifest on each generation) + **SBQ-TRUST-002**
  (export-time compliance + integrity) merged; **`wegofwd-llm` → v0.2.0** (adds the
  `trust` submodule the new code imports). TrustBadge consumes it.

### Deployment — now LIVE (was "config only / unverifiable")
- **Prod backend** live + identity-enabled at `mambakkam.net/mentible-api` (Hetzner VPS,
  `docker-compose.demo.yml`, behind host nginx). _Running `main`@`add2807` (refreshed
  2026-06-28, incl. ADR-022); no backend delta on `main` since — later commits are
  docs/mobile-web only. Runbook: `Plans/PROD_BACKEND_REFRESH_TO_MAIN.md`._
- **Full web app** at **`mambakkam.net/app/mentible`** (Expo web export — full
  generate/author/accounts) + read-only **demo** at **`/demos/mentible`** (no auth).
- **Android APK** released (GitHub Release on the public `mambakkam-net` repo; landing
  page `mambakkam.net/mentible` links the latest).
- **Deploy pipeline** codified: `docs/DEPLOYMENT_PIPELINE.md` + `scripts/deploy/web-deploy.sh`
  (`{demo|app}` — builds from `origin/main`, force-adds fonts, `--clear`, Supabase only on
  the app, deploys + verifies). **local → demo → production** discipline.

### Mobile features & UX
- **Book metadata window** (#193): tap a book → a non-blocking **right sidebar** with
  Name / Date Released / Model / Level / Depth / Diagram type / Pages / **Reviewed By/On**
  (+ review data seeded on the bundled books).
- **HelpHint** — `?` contextual one-liners (SBQ-UI-003), wired to the Account
  destructive actions.
- Account/auth UX: post-sign-in lands on **Library**; **never-dead-end** back button;
  "Clear device keys" → **"Remove saved API keys"**.
- **Fonts bundled** (Inter + Source Serif 4 + OpenDyslexic via expo-font; dyslexia toggle).
- **Mobile CI** now runs ("Mobile — Typecheck, Lint & Tests").

### Platform packages (ADR-019)
- **`wegofwd-secure`** (key-redaction + BYOK envelope) extracted to a public package;
  backend consumes it via thin shims.

---

## Done (on `main`)

### Brand & product shape
- **Mentible** brand (ADR-006, Accepted): app name, web/PWA title, growing-mind
  mark + Expo icon set, lockups. Trademark sweep flagged a **"Mentable"** conflict
  → attorney review pending before assets/listings lock.
- **Two-product split** (ADR-004, Proposed): paid authoring (this repo) → compiled
  EPUB3/PDF; free reader app is a separate, not-yet-built repo.
- **Books-only** (ADR-009, Accepted): Query tab + single-lesson flow removed; the
  six-dimension scoped-query IP now expresses itself **per topic inside a book**.

### Backend — FastAPI
- Endpoints: `POST /api/v1/generate` + `GET /api/v1/jobs/{id}` (poll), `POST /api/v1/structure`
  (TOC → topic tree, shared polling), `POST /api/v1/export` (book.json → EPUB/PDF, sync, key-free),
  `/healthz` + `/readyz`.
- `src/core/` — `byok_envelope.py` (HKDF per-job envelope), `log_redaction.py`
  (`sk-ant-*` structlog filter), `format_scan.py` (gate 3).
- BYOK discipline (ADR-001): key encrypted in Redis with TTL, used once, shredded;
  **never logged** (incl. a fix to scrub the key from FastAPI 422 echoes).
- `GET /jobs/{id}` returns `status` · `result` · `provenance` (provider/model) ·
  `warnings` (gate 3).
- Tests: **13 files, ~106 passing** (incl. the mandatory `test_no_key_in_logs.py`,
  plus structure / export / multi-provider / gate-3). Mocked Redis + providers; no
  live external calls in CI.

### Multi-provider LLM (ADR-005 hybrid · ADR-012 package · ADR-013)
- Generation routed through the installable **`wegofwd-llm`** seam (pinned
  `v0.2.0` in `backend/requirements.txt` — bumped for the `trust` submodule) — graduated from the vendored
  `pipeline/providers/` (ADR-012). Shared across Mentible / Pramana / OnDemand.
- Providers: **Anthropic** (native tool-use JSON) + OpenAI-compatible **OpenAI,
  Groq, OpenRouter, Gemini** (free tiers wired). Per-provider key-prefix validation.
- **Validate→repair** conformance loop (`generate_validated`, 1 call + 2 repairs)
  replaced blind retries; transient errors fail fast. Per-provider output-token
  clamping (Groq rejected 16384).
- **Provenance** (`provider`/`model`/versions) stamped on the saved unit so the
  client can detect outdated content.
- Note: `/structure` still uses the Anthropic-only legacy caller (deterministic
  TOC output; no multi-provider repair needed yet).

### Node artifact compiler (`compiler/` — ADR-004 / ADR-007 / ADR-008)
- Compiles `book.json` → **EPUB3** (valid OCF/OPF, nav, per-topic XHTML, inline
  **MathML** + **SVG**, offline/CDN-free), **PDF** (Vivliostyle textbook layout:
  page-numbered TOC → chapters → Quizzes → Answers; 17-topic book → ~727pp
  verified), and **PNG cover** thumbnails.
- Editorial **cover** + shared **colophon**; **EPUB Accessibility 1.1** OPF
  metadata; **branded diagram theming** (Mermaid→SVG via one Puppeteer browser,
  role classDefs, design tokens); house-style parity (numbering, lists, glossary,
  Key-Takeaways callout).
- **Release lifecycle + watermark** (ADR-008): DRAFT watermark (PDF) / notice
  (EPUB) until release; edition/version stamped on cover + colophon.
- Built via `npm run build` → `dist/cli.js`; **in CI** ("Compiler — Typecheck &
  tests", **11 test files / ~99 cases**). Backend `export/compiler.py` shells out
  over stdin/stdout (key-free, never logs the book).

### Mobile — React Native + Expo (Books-only)
- Nav: **Library · Studio · Settings · Help · About** (custom `TopNavBar`; `books`
  tab relabelled **Studio**, route unchanged).
- Authoring flow: paste TOC → `POST /structure` → editable **topic-tree editor** →
  **generate-all** (per-topic progress) → in-app **reader** (KaTeX/Mermaid).
- **Per-provider BYOK** keystore + **provider picker** with capability tiers
  (`authoring` = Anthropic; `experimental` = OpenAI/Groq/OpenRouter/Gemini) —
  `src/constants/providers.ts`, `src/secure/keyStore.ts`.
- Book **JSON import/export**, **EPUB import + cover extraction**, **export to
  EPUB/PDF** via the backend, library shelf with delete, responsive (phone grid /
  desktop split-pane).
- **Brand themes** (`theme.ts` — Study dark default; Manuscript/Reading palettes
  staged) + **authoring label vocabulary** (`labels.ts`).
- Tests: **52 suites / ~299 cases**, **now in CI** ("Mobile — Typecheck, Lint & Tests").

### Quality & Compliance Gates — Gate 3 (format-drift) wired (PRs #98–#100)
- Shared `backend/src/core/format_scan.py` (`lesson_warnings` / `book_warnings` /
  `package_warnings`) runs the vendored format-drift validator (previously
  **unwired**) across: the **lesson worker** (warnings on the job status row +
  per-provider log signal), the **whole-book export** (lesson + tutorial +
  experiment; count on `X-Content-Warnings` header), and a **staged Pramana
  pre-sign hook** (ready for one call once a package builder exists). Adapts to the
  validator without editing the vendored file (ADR-002). See `docs/QUALITY_GATES.md`.

### Mobile UI themes + nav vocabulary (PR #101)
- Palette retuned onto the mark (indigo/green/red-orange; retired the yellow
  "For-Dummies-adjacent" tile); filled the previously `undefined` font tokens with
  a `Platform.select` web-stack-vs-native-family split; added `labels.ts` voice
  (ADR-006). Follow-ups: wire FLOW/JOB-STATE verbs + icons, a `ThemeProvider`,
  native font bundling.

### Deployment
- **Fly**: `fly.toml` (app `studybuddyq-backend`, `iad`, scale-to-zero) + a complete
  `docs/DEPLOY_FLY.md` runbook; secrets (`REDIS_URL`, `BYOK_MASTER_KEY`) env-only.
- **Shared VPS demo** (PR #88): `docker-compose.demo.yml` for a **Mentible demo
  backend** behind host nginx at `/mentible-api/` (Redis localhost-only, resource
  limits). Multi-stage `Dockerfile` bundles Node + Chromium + the built compiler.
- **NOW LIVE (2026-06-27):** the backend runs at `mambakkam.net/mentible-api`
  (identity-enabled), the **full web app** at `/app/mentible` + **demo** at
  `/demos/mentible` are hosted, and an **APK** is released. Pipeline:
  `scripts/deploy/web-deploy.sh`. (The Fly path above is superseded by the VPS deploy.)

### Decision ledger (ADRs on `main`)
| ADR | Title | Status |
|---|---|---|
| 001 | BYOK security model (Pattern B) | Accepted (amended → hybrid by 005) |
| 002 | Repo structure & vendoring | Accepted |
| 003 | Book authoring | Proposed |
| 004 | Two-product split + artifacts | Proposed |
| 005 | Multi-provider LLM + hybrid keys | Accepted |
| 006 | Rebrand to Mentible + audience scope | Accepted (name pending TM) |
| 007 | Book templates & theme system | Accepted |
| 008 | Release lifecycle & watermarking | Accepted |
| 009 | Books-only (remove Query) | Accepted |
| 010 | Narrative/animated-character mode | Proposed |
| 011 | Mentible⇄Pramana consumable handoff | Proposed (amended by 013) |
| 012 | Shared `wegofwd-llm` LLM seam | Accepted |
| 013 | Pramana in-process generation | Accepted |
| 014 | User accounts + per-provider credential set | **Accepted — built & deployed** (Supabase/JWKS, account API, mobile Account page, Google sign-in live) |
| 015 | Content Trust Manifest | **Accepted — built** (SBQ-TRUST-001/002; wegofwd-llm v0.2.0) |
| 016 | One provider per content + visible provenance | **Accepted — built** (per-book pin + TrustBadge provenance) |
| 017 | Default shareable library | Accepted — bundled default library ships + seeds on first run |
| 018 | System-owner principal | Accepted — owner secret + `owner_cli {publish,unpublish,verify}` |
| 019 | Common platform libraries | Accepted — `wegofwd-llm` + `wegofwd-secure` extracted |
| 020 | Super-admin operator role | **Accepted — built & verified live** (admin API + audit + mobile console) |
| 021 | Everyone Library (UGC) + moderation | Proposed — design-only (build deferred) |

---

## Not yet done

### ~~Content Trust Manifest~~ → DONE (see "Shipped since")
- The manifest shape + mobile **TrustBadge** (ADR-015/016) plus the backend packager
  (**SBQ-TRUST-001**, generation-time `engine_trust`) and export-time
  `compliance`/`integrity` (**SBQ-TRUST-002**) are all **merged**; `wegofwd-llm` is at
  **v0.2.0**. _Remaining nicety:_ surfacing the registry's current-default model
  client-side for the staleness hint.

### Managed identity & billing (ADR-005 pulled these to MVP)
- **Accounts/auth are DONE** (email + **Google**; ADR-014 — built & deployed, sign-in
  live). **Still not built:** per-user **usage metering Phase 2**, **plan caps**, and
  the **managed-key vault** path (ADR-005 D6 / ADR-020 #6). The **BYOK** path is the
  one in production today.

### Backend hardening
- **Rate limiting** (ADR-014 D9) — designed (per-account, IP fallback for the anonymous
  demo) but **not gated in code**. The backend proxies even BYOK `/generate` and runs
  Chromium for export, so it's an abuse surface regardless of who pays for tokens.
  Tracked: **#221**.

### Pramana B2B compliance (contract only)
- The Consumable Package **builder, manifest, `content_hash`, signing, and push**
  into Pramana's `consumer_library` are **not built** (ADR-011 Proposed). Gate 3's
  `package_warnings` is staged for the eventual pre-sign call.

### Artifact pipeline — later phases
- **Interactive quiz JS layer** (EPUB3) and the **free reader app** (ADR-004
  phasing); **MOBI**; an **async export job** with full diagram rendering.

### Mobile/product follow-ups
- Mobile **CI** (tsc + jest); a `ThemeProvider` switcher + native font bundling;
  FLOW/JOB-STATE labels & sprout→leaf icons; Book Authoring **Phase 2** (flow
  analysis, snapshots/versioning, regenerate-with-reason — ADR-003).
- **Narrative/character mode** (ADR-010, Proposed — awaiting decision).
- **Trademark clearance** on Mentible vs "Mentable" before assets/listings lock.

### Deferred by design
- Cloud sync, FCM push (polling only); French/Spanish; iOS.

---

## MVP success criteria — status

The original six criteria predate the two-product/multi-provider shift, but still
track the core mobile loop:

| # | Criterion | Status |
|---|---|---|
| 1 | User enters key once, never re-enters | ✅ implemented (now **per provider**) · ✅ verified (APK + live web) |
| 2 | Topic + Level → rendered content on real device | ✅ ✅ verified on emulator + live web app |
| 3 | Maths (KaTeX) renders | ✅ app + compiler (MathML) · ✅ verified in the shipped app |
| 4 | Diagram (Mermaid) renders | ✅ app + compiler (SVG) · ✅ verified in the shipped app |
| 5 | Backend never logs the key | ✅ enforced + tested in CI (mandatory gate) |
| 6 | Generation < 90 s p95 | ⬜ **not formally measured** (some runs are slow; poll TTL 600 s) |

**Bottom line (2026-06-27):** the loop is now **exercised end-to-end** — the full APK
was built + smoke-tested on an emulator, the web app is **live** with generation +
**sign-in verified on production**, and KaTeX/Mermaid render in the shipped app.
Criterion 5 is proven in CI. The one still-open metric is **6 (latency)** — not
formally measured (the poll timeout was raised to 600 s for slow generations).

---

## Next up

_(Items 1–2 from the prior refresh — backend URL, APK, on-device run — are **done**.)_

1. **Prod backend is current** — running `main`@`add2807` (refreshed 2026-06-28); no
   backend changes have landed on `main` since (docs/mobile-web only), so no refresh is
   pending. Re-run the root block in `Plans/PROD_BACKEND_REFRESH_TO_MAIN.md` only when an
   actual backend/compiler change ships.
2. **Managed billing (ADR-005)** — usage metering Phase 2, plan caps, and the
   **managed-key vault** (the half of ADR-005/ADR-020 #6 not yet built).
3. **Library sync (ADR-014 O2)** — zero-knowledge cloud sync (device-local only today).
   **Now scoped:** `docs/SYNC_BUILD_PLAN.md` (D10 envelope crypto, Supabase schema/RLS,
   `/api/v1/sync/*`, recovery, 6-phase build); build still deferred past v1.1 (O3).
4. **Everyone Library (ADR-021)** — design-only; decide the build trigger (hosting,
   moderation, ToS/DMCA, the AI-assisted complaint workflow).
5. **Latency** — measure generation against the < 90 s p95 target (criterion 6).
6. **HelpHint rollout (SBQ-UI-003)** — extend the `?` hints beyond the Account screen.
7. **Trademark clearance** on Mentible vs "Mentable" before assets/listings lock.
8. **Pramana slice** (when prioritised): the package builder + signing for ADR-011.
