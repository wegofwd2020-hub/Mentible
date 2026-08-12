# Durable async trust generation — Phase B: suggest-TOC — Design

**Status:** Approved (brainstorming, 2026-08-12). Second phase of the arc that moves the trust generators
off the synchronous request path onto durable Celery jobs. Phase A (merged) built the infra + converted
per-topic generate. Phase B converts **suggest-TOC** (the "Suggest from sources" outline generator).
Phase C (whole-book) is later.

## Problem

`POST /projects/{id}/suggest-toc` runs `suggest_toc(...)` inline via `asyncio.to_thread` and returns the
outline in the same request. A large source set can exceed CloudFlare's ~100s proxy timeout → **524**.
PR #410 band-aided this by raising `_MAX_TOKENS` to 16384, but the durable fix is the same submit-202 +
Celery-worker + poll pattern Phase A established. Unlike per-topic generate, suggest-TOC **persists
nothing** — it returns a suggested `StructuredTocView` the user reviews/edits/saves — so the job result
carries the **TOC structure itself**, and there is **no duplicate-row idempotency concern**.

## Goal

Route suggest-TOC through a durable Celery job (submit 202 → worker → poll `GET /jobs/{id}`), preserving
BYOK/ADR-001 discipline, and — since suggest-TOC is another foreground on-screen wait — show the **#421
`GenerateProgressBar`** (Waiting → Generating) on the "Suggest from sources" surface.

## Locked decisions

1. **Reuse the Phase A infra** — same Celery app, same `job:{id}:status` contract, same `GET /jobs/{id}`
   poll. New task `suggest_toc_task` mirrors `generate_topic_task`.
2. **Job result carries the TOC** — `result = {"toc": <StructuredTocView dict>}` (ephemeral suggestion,
   not a DB id). Same payload the current HTTP response carries, just via the status row.
3. **No duplicate-row idempotency needed** — suggest-TOC writes nothing to the DB. The `done`-short-circuit
   (re-run sees `done` → returns the cached result) is sufficient; `acks_late` re-run just no-ops.
4. **Backend writes `running`** (like Phase A) after the guards, so the phase label flips Waiting →
   Generating. ADR-001: BYOK key only via the encrypted envelope, shredded, never logged/persisted/in
   status.
5. **Progress bar on the Suggest surface** — reuse `GenerateProgressBar` + `useElapsedMs` (#421). The bar
   animates only during the generation wait; the existing `suggestBusy` re-entry guard (which spans the
   confirm-replace dialog) is unchanged.
6. **Parallel mobile hook** — add `useSuggestTocJob` mirroring `useGenerateTopicJob`, and a typed
   `getSuggestTocJob`. (The poll-loop duplication across `useGenerateTopicJob`/`useSuggestTocJob`/`client.ts`
   remains the already-logged follow-up; do NOT refactor a shared poller in this phase.)

## Architecture

### Backend
- **`suggest_toc_task`** in `backend/src/trust/tasks.py` (mirrors `generate_topic_task`): sync Celery task
  wrapping `asyncio.run(_run_suggest(...))`:
  - Idempotency: if `job:{id}:status` already `done`, return.
  - Resolve key: BYOK → decrypt `byok:{job_id}`; managed → `get_managed_key`.
  - Open asyncpg conn; load project (`topic`/`audience`/`goal`) + `list_inputs`; if no sources →
    `failed` "add at least one source before suggesting a TOC" (mirrors the current 422 guard's message).
  - `await _write_status(r, job_id, "running")` (after the guards, before the LLM call).
  - `out = await asyncio.to_thread(suggest_toc, sources=…, topic=…, audience=…, goal=…, provider_id=…,
    api_key=…, model=…)` inside a try; map `LLMSchemaError`/`LLMAuthError`/`LLMRateLimitError`/`LLMError`/
    bare `Exception` to `failed` with the SAME safe messages Phase A uses ("The API key was rejected by
    the provider. Check it in Settings." / "The provider is rate-limiting requests. Try again shortly." /
    "suggested TOC failed validation" / "topic generation failed"→use "couldn't suggest an outline").
  - Serialize `out` to the `StructuredTocView` dict shape the client expects (same shape
    `TocSuggestOut.toc` used) → `await _write_status(r, job_id, "done", result={"toc": <dict>})`.
  - `finally`: `del api_key`; `await _shred_envelope(r, job_id)`. Never raises out (no key-bearing
    traceback), mirroring `_run`.
- **Task registration:** import `suggest_toc_task` where `generate_topic_task` is registered
  (`celery_app.py` bottom-of-file import already pulls `trust.tasks`; the new task's `@celery_app.task`
  decorator registers it — name e.g. `trust.suggest_toc`).
- **Submit endpoint** `POST /projects/{id}/suggest-toc` becomes async: keep the owner (`need_owner=True`)
  + project-exists + "≥1 source" guards, resolve managed-vs-BYOK key, `job_id = uuid4()`, if BYOK
  `encrypt_api_key → byok:{job_id}` (TTL); `_write_status(queued)`; `suggest_toc_task.delay(job_id=…,
  project_id=…, provider_id=…, model=…, managed=…, recorded_by_sub=…)`; return **202
  `TocSuggestJobOut{job_id, status}`** (new schema; replaces the 200-with-toc response).
- **Poll:** reuse `GET /api/v1/jobs/{id}` unchanged; result carries `{toc}`.

### Mobile
- **`trustClient.ts`:** `suggestToc(projectId, body, token)` now returns `{ job_id, status }` (202); add
  `getSuggestTocJob(jobId, token): SuggestTocJobStatusView` where
  `SuggestTocJobStatusView = { status: "queued"|"running"|"done"|"failed"; result?: { toc: StructuredTocView }; error?: string }`.
  (A parallel typed getter, not a change to the per-topic `getJob`.)
- **`useSuggestTocJob`** (mirror `useGenerateTopicJob`): `run({ projectId, apiKey, accessToken, providerId?,
  onPhase? })` → submit → poll `getSuggestTocJob` every 3s until `done|failed` (600s deadline) → resolve
  `result.toc`; throw on failed/timeout (plain `Error(job.error ?? "…")`). `onPhase(queued|running)`
  forwarded from the poll.
- **`useTrustProject.suggestToc`:** becomes `suggestToc(opts?: { onPhase?: (p) => void }): Promise<StructuredTocView>`
  — loads the key, calls `runSuggestTocJob({ projectId, apiKey, accessToken, onPhase: opts?.onPhase })`,
  returns `result.toc`. (Same return type as today, so `onSuggest`'s `tocViewToStructured(await suggestToc())`
  is unchanged except for passing `onPhase`.)
- **`[projectId].tsx` `onSuggest` + Structure surface:**
  - Add `suggestGen: { startedAt: number; phase: "queued" | "running" } | null` state (separate from the
    existing `suggestBusy`, which stays as the re-entry guard + button-busy across the confirm dialog).
  - In `onSuggest`: set `suggestGen = { startedAt: Date.now(), phase: "queued" }` before the await; pass
    `onPhase: (phase) => setSuggestGen((p) => p ? { ...p, phase } : p)`; clear `suggestGen = null` once
    `suggestToc()` resolves OR throws (a `finally` around just the await, BEFORE the confirm-replace
    dialog — the bar must not linger during the dialog).
  - Widen the catch message like #420: `e instanceof ApiError ? e.userMessage() : e instanceof Error ?
    e.message : "Try again."` so the backend's actionable `job.error` surfaces.
  - Render `GenerateProgressBar` on the Structure "Suggest from sources" surface while `suggestGen` — call
    `useElapsedMs(suggestGen?.startedAt ?? null)` unconditionally at the component top and render
    `<GenerateProgressBar phase={suggestGen.phase} elapsedMs={elapsed} />` near the Suggest button (the
    StructurePanel receives `suggestGen` + the elapsed value, or a small wrapper like `TopicRowProgress`).

## Testing

- **Backend** (fakeredis + test DB + mocked provider, mirroring `test_trust_topic_task.py`): the task
  writes `running` before `done`; `done` result is `{"toc": {...}}` with the expected subjects; a source-less
  project → `failed` with the guard message; **no api key in any status payload or log** (extend the
  no-key assertions); envelope shredded on success and failure. Submit endpoint: owner → 202 + job_id
  (+ envelope for BYOK); reviewer/non-member → 403; source-less → 422 (guard stays on submit); enqueued.
- **Mobile:** `useSuggestTocJob` submits then polls, resolving `result.toc` on done and throwing the
  `job.error` on failed; the Structure Suggest flow shows the bar (Waiting → Generating via `onPhase`),
  clears it before the confirm dialog, and still applies/replaces the outline as today. No color-literal
  asserts.

## Decomposition (SDD)

- **T1 — backend `suggest_toc_task` + async submit endpoint** (`trust/tasks.py`, router, `TocSuggestJobOut`
  schema, BYOK envelope, `running` write, ADR-001). Backend tests incl. the no-key gate + result-carries-toc.
- **T2 — mobile client + hook** (`trustClient.suggestToc` → 202, `getSuggestTocJob`, `SuggestTocJobStatusView`,
  `useSuggestTocJob`; `useTrustProject.suggestToc` submit+poll). Hook tests.
- **T3 — wire `onSuggest` + progress bar** (`suggestGen` state, `onPhase`, render `GenerateProgressBar` on
  the Suggest surface, widen the catch message). Screen tests.

## Rollout

**Web deploy + backend refresh** (the new task runs in the **celery-worker** — the refresh must recreate
it; verify the worker source has `suggest_toc_task`). **No migration.** Backward-compatible caveat: the
submit endpoint's response shape CHANGES (200-with-toc → 202-with-job_id), so **older mobile clients would
break on Suggest** — but the web app deploys together and the APK is the same build; ship backend +
web together. (Per-topic Phase A had the same property.)

## Out of scope

- Phase C (whole-book async). The poll-loop dedup across the job hooks (logged follow-up). Moving the main
  `/generate` + `/structure` off BackgroundTasks. The `version/[versionId].tsx` whole-artifact bar (the
  #421 coherence follow-up).

## Global constraints

- **ADR-001 non-negotiable in the worker** — BYOK key only via the encrypted envelope, shredded, never
  logged/persisted/in status; the `running`/`done`/`failed` writes carry no key; a test asserts it. The
  worker already installs the structlog redaction backstop (`worker_process_init`, Phase A).
- Reuse the existing `job:{id}:status` contract + `GET /jobs/{id}`. `asyncpg` in the worker via
  `asyncio.run`. `task_acks_late` durability already configured.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. No color-literal asserts; `Alert` from `@/lib/alert`. Commit messages end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
