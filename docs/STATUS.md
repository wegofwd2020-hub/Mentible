# Project Status — StudyBuddy Q

> **Last updated:** 2026-05-26
> **Branch:** `feat/mobile-skeleton`
> A running record of what's actually built, versus the plan in `MVP_v1.md`.
> The plan says what we're building first; this doc says what's done.

---

## TL;DR

The full MVP end-to-end **loop is implemented in code** across all three runtime
contexts (mobile · backend · pipeline) and exercised by automated tests. What
remains before the six MVP success criteria can be *verified* is **deployment**:
the backend has no public URL, so the Android APK can't yet be built and run on a
real device against the real Anthropic API.

**Next task:** deploy the backend to a public URL (see `project_next_task` memory
and "Next up" below).

---

## Done

### Design & docs (commit `8f30ac6`)
- `SCOPE.md` — 19 locked decisions (D1–D19) with rationale.
- `CLAUDE.md` — repo conventions, layer rules, non-negotiable security rules.
- `docs/MVP_v1.md` — first-slice scope + six success criteria.
- `docs/adr/ADR-001` — BYOK security model (Pattern B, per-request passthrough).
- `docs/adr/ADR-002` — repo structure & vendoring strategy.
- `docs/PARAMETERS.md` — Power-Mode custom params + §5 safety boundaries.
- `docs/wisdom-2026-05-04.md` — ExtractWisdom snapshot over the design corpus.

### Backend — FastAPI (commits `6fec6b9`, `ef021a7`)
- `backend/main.py` — app entrypoint + health endpoint.
- `backend/src/core/byok_envelope.py` — per-job key encryption envelope (HKDF, ephemeral key).
- `backend/src/core/log_redaction.py` — structlog `sk-ant-*` redaction filter.
- `backend/src/generate/router.py` — `POST /generate` (key passthrough) + `GET /jobs/{id}` polling.
- `backend/src/generate/tasks.py` — async job worker.
- `backend/src/generate/anthropic_caller.py` — outbound Anthropic call.
- `backend/src/generate/prompt_builder.py`, `lesson_schema.py`, `schemas.py` — request/response shapes + schema validation.
- Redis-backed job status + idempotency keys.
- `Dockerfile` + `docker-compose.yml` + `dev_start.sh` (ports remapped to avoid OnDemand clash).

### Backend tests (`backend/tests/`)
- `test_no_key_in_logs.py` — **the mandatory** "key never hits a log line" test.
- `test_byok_envelope.py`, `test_anthropic_caller.py`, `test_generate_e2e.py`, `test_generate_stub.py`, `test_idempotency.py`, `test_health.py`.

### Pipeline — vendored from StudyBuddy_OnDemand (`8f30ac6`)
- `pipeline/prompts.py`, `providers/anthropic.py`, `providers/base.py`, `content_format_validator.py`, `VENDORED.md`.

### Mobile — React Native + Expo (`4a0b177` → `7e312ba`)
- Expo Router app: `(tabs)` for Home / Library / Settings, plus `lesson/[jobId]` view.
- `src/secure/keyStore.ts` — `expo-secure-store` wrapper (guarded behind `Platform.OS !== 'web'`).
- `src/api/client.ts` — backend HTTP client.
- `src/hooks/useGenerateJob.ts` — submit + poll (injectable interval, fixes test timer leaks).
- `src/components/LessonRenderer.tsx` — Markdown + KaTeX + Mermaid rendering.
- `src/components/LevelPicker.tsx` + `constants/levels.ts` — simplified to 3 level options.
- `src/storage/lessonStore.ts` — local library persistence.
- **Lesson library** with per-lesson delete (`7e312ba`).
- **Export lesson as PDF** (`220fa5c`); web opens in new tab (`b0a17d6`).
- Full **Expo web** compatibility (`21962a4`).
- `eas.json` — `preview` (APK) + `production` (AAB) build profiles (`1644205`).
- `app.json` package name `com.wegofwd2020.studybuddyq`.
- Tests: Home, Settings, api/client, secure/keyStore.

### Backlog tickets drafted (`docs/jira/`)
- `SBQ-UI-001` — parameter overrides · `SBQ-UI-002` — about page · `SBQ-EXP-001` — email share.

### Book Authoring — Phase 1 ✅ (per `adr/ADR-003-book-authoring.md`)
The OnDemand→Q authoring port (`docs/PORT_BRIEF.md`), built in PRs #8–#11.
End-to-end flow works: **paste TOC → structure → edit tree → generate all → read per-topic lessons.**
- **PR-1 (#9) — backend `POST /structure`:** vendored `toc_structurer` prompt IP (BYOK-safe divergence), structuring routed through the key-safe `call_anthropic` seam, 3× retry, shared `/jobs/{id}` polling. 9 tests.
- **PR-2 (#10) — mobile topic-tree editor:** `Books` tab, `useStructureJob`, local `bookStore`, `TopicTreeEditor` (edit/add/remove/reorder), new-book + saved-book screens. 21 tests.
- **PR-3 (#11) — generate-all loop:** client-orchestrated batch over `/generate` (no backend change), per-topic content saved on the book, skip-already-done, cancellable, per-topic viewer reusing `LessonRenderer`. 13 tests.
- Backend suite green (62 incl. structure); mobile suite green (56 / 10 suites).

---

## Not yet done

### Blocking MVP verification
- **Backend not deployed** — no public URL; APK can't point at it. *(This is the next task.)*
- **APK never built** — `eas login` + `eas init` not yet run inside `mobile/`.
- **No real-device end-to-end run** — none of the six success criteria verified against live Anthropic + real key.

### Deferred by design (v1.1+, per `MVP_v1.md`)
- Auth (email + Google), cloud sync, FCM push (polling only at MVP).
- Quiz / Explanation formats, French / Spanish, iOS.
- `SBQ-SEC-001` safety follow-up (gates the override UI from public alpha — not yet filed).

### Book Authoring — Phase 2+ (deferred, per `adr/ADR-003-book-authoring.md`)
- Phase 1 is built (see the "Book Authoring — Phase 1 ✅" entry under Done). Remaining: flow analysis (`POST /flow-check`), snapshots/versioning, regenerate-with-reason, full-book PDF/EPUB export.

---

## MVP success criteria — status

| # | Criterion | Status |
|---|---|---|
| 1 | User enters key once, never re-enters | ✅ implemented (round-trip test) · ⬜ unverified on device |
| 2 | Topic + Level → rendered lesson on real device | ✅ code complete · ⬜ blocked on deploy |
| 3 | Maths (KaTeX) renders | ✅ renderer built · ⬜ unverified on device |
| 4 | Diagram (Mermaid) renders | ✅ renderer built · ⬜ unverified on device |
| 5 | Backend never logs the key | ✅ enforced + tested in CI |
| 6 | Generation < 90 s p95 | ⬜ unmeasured (needs live runs) |

**Bottom line:** code is in place for all six; criteria 2/3/4/6 await a deployed backend and a real-device run. Criterion 5 is proven in test.

---

## Next up

1. **Deploy backend to a public URL** — shared OnDemand infra (preferred, D11), else Railway/Render/Fly free tier (~30 min, Docker ready), else ngrok for a quick demo.
2. `eas login` + `eas init` in `mobile/`, then
   `eas build --platform android --profile preview --env EXPO_PUBLIC_API_BASE_URL=https://<url>`.
3. Run the six success criteria on a Pixel emulator + one physical Android.
4. When all six pass → MVP done → start v1.1 (auth, sync, push, more formats).
5. Book Authoring **Phase 1 is done** (structure → edit → generate-all → read). Next, when prioritised: **Phase 2** per `adr/ADR-003-book-authoring.md` (flow analysis, snapshots/versioning, regenerate-with-reason, full-book PDF/EPUB).
