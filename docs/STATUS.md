# Project Status — Mentible (repo `StudyBuddy_SelfLearner`)

> **Last updated:** 2026-06-14
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

**Centre of gravity now:** authoring + artifact quality + multi-provider, not the
original single-app B2C MVP loop. On-device verification of the mobile loop is
still the main thing that hasn't been *proven* end-to-end.

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
  `v0.1.2` in `backend/requirements.txt`) — graduated from the vendored
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
- Tests: **23 files**. **Not in CI** (no mobile job yet); type-checked locally.

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
- *Caveat:* the repo confirms the **config + runbook**; a live public URL / running
  instance isn't verifiable from the repo alone.

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

---

## Not yet done

### In flight (drafted, not yet on `main`)
- **ADR-014 — user accounts + per-provider credential set** (Proposed) lives on an
  unmerged branch. A **Content Trust Manifest** (ADR-015) + trust-badge UI is
  untracked WIP in the tree, not committed.

### Managed identity & billing (ADR-005 pulled these to MVP)
- Accounts/auth (email + Google/Apple), per-user usage metering, plan caps, the
  **managed-key** vault path. Today only the **BYOK** path is built.

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
| 1 | User enters key once, never re-enters | ✅ implemented (now **per provider**) · ⬜ unverified on device |
| 2 | Topic + Level → rendered content on real device | ✅ code complete · ⬜ awaits on-device run |
| 3 | Maths (KaTeX) renders | ✅ app + compiler (MathML) · ⬜ unverified on device |
| 4 | Diagram (Mermaid) renders | ✅ app + compiler (SVG) · ⬜ unverified on device |
| 5 | Backend never logs the key | ✅ enforced + tested in CI (mandatory gate) |
| 6 | Generation < 90 s p95 | ⬜ unmeasured (needs live runs) |

**Bottom line:** code is in place for all six; deployment config now exists, but a
real-device end-to-end run (criteria 2/3/4/6) hasn't been done. Criterion 5 is
proven in CI.

---

## Next up

1. **Stand up a verifiable backend URL** (Fly via `docs/DEPLOY_FLY.md`, or confirm
   the VPS demo) and build the Android APK (`eas build … --profile preview` with
   `EXPO_PUBLIC_API_BASE_URL`).
2. **Run the six criteria on a real device** against live Anthropic + a real key.
3. **Decide the managed-account path** (ADR-014) — accounts/metering gate the
   managed-key business model from ADR-005.
4. **Pramana slice** (when prioritised): the package builder + signing to make
   ADR-011 real (one framework, full receive→approve→publish path).
5. Resolve the open ADRs: **010** (narrative mode), **trademark** clearance for
   **006**, and the **trust-manifest** direction.
