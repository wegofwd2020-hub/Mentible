# Durable async trust generation — Phase C: whole-book — Design

**Status:** Approved (brainstorming, 2026-08-12). Final phase of the arc moving the trust generators off
the synchronous request path onto durable Celery jobs. Phase A = per-topic (merged), Phase B = suggest-TOC
(merged). Phase C = **whole-book draft generation** (`POST /artifacts/{id}/versions/generate`) — the
longest, most 524-prone generation. After C, all three trust generators are async.

## Problem

`generate_version` runs `generate_draft(...)` inline via `asyncio.to_thread` and returns the created
version in the same request. A whole-book draft is the longest generation → most exposed to CloudFlare's
~100s → **524**. Convert it to the same submit-202 + Celery-worker + poll pattern as Phase A/B.

Converting the endpoint to 202 **forces both of its mobile callers** to submit+poll:
1. Whole-book draft **cards** (`generateFormat` in `[projectId].tsx`) — already shows the #421 progress
   bar (phase pinned to `running`); Phase C **upgrades** it to **Waiting → Generating** (there's now a
   real async job).
2. The whole-artifact **"Generate new version"** in `version/[versionId].tsx` (`doRegen` →
   `generateVersion`) — currently plain "Generating…" text with no bar; Phase C **adds** the bar,
   closing the #421 coherence-gap follow-up.

Unlike suggest-TOC, whole-book generate **persists an artifact_version** (a DB write), so — like per-topic
— an `acks_late` re-run has a duplicate-version risk; the `done`-short-circuit guards it (same posture as
Phase A, including the same narrow parked window, MINOR-1).

## Goal

Route whole-book generate through a durable Celery job (submit 202 → worker → poll), preserving ADR-001,
and wire both foreground surfaces to the #421 progress bar with a Waiting → Generating phase.

## Locked decisions

1. **Reuse the Phase A/B infra** — same Celery app, `job:{id}:status` contract, `GET /jobs/{id}` poll.
   New task `generate_version_task` mirrors `generate_topic_task` (both persist a version).
2. **Result carries the version id** — `result = {"version_id", "artifact_id", "version_no"}` (mirrors
   per-topic's `{version_id, topic_id, version_no}`). The client reconstructs the `VersionOut`-shaped
   object its callers already consume.
3. **Dup-row idempotency = the `done`-short-circuit** (same as per-topic; the narrow post-commit /
   pre-status window remains the parked MINOR-1 — do NOT add new idempotency machinery here).
4. **Backend writes `running`** after the guards (phase label).
5. **`generateFormat` keeps `createArtifact` synchronous**, THEN submits+polls the generate job — same
   two-step as today, only the generate step goes async. A generate failure still leaves an artifact with
   0 versions (identical to today's behavior — not a new orphan).
6. **Both surfaces get Waiting → Generating**: the cards' `formatGen` map value becomes
   `{startedAt, phase}` (was `startedAt` only); the version-viewer's `genBusy` boolean becomes a
   `{startedAt, phase} | null` (mirror the topic-viewer Revise from #421 T3).
7. **ADR-001** in the worker: BYOK key only via the encrypted envelope, shredded, never
   logged/persisted/in status/in `.delay()` args. A test asserts it.

## Architecture

### Backend
- **Extract `draft_output_to_sections(out, sources) -> list[dict]`** (+ the `cited` derivation) from
  `router.py`'s `generate_version` into `backend/src/trust/generate.py` — the S-label→input-id `by_label`
  mapping that builds `sections`. Move it verbatim so both the (removed) router path and the task produce
  identical content.
- **`generate_version_task`** in `backend/src/trust/tasks.py` (mirror `generate_topic_task`): sync task
  wrapping `asyncio.run(_run_version(...))`:
  - Idempotency `done`-check.
  - Resolve key (managed / BYOK envelope decrypt).
  - Open asyncpg conn; resolve `project_id_for_artifact`; load project + artifact `format` + `list_inputs`;
    artifact-missing → `failed` "artifact not found"; project-missing → `failed`; source-less → `failed`
    "add at least one source before generating a draft" (BEFORE the `running` write).
  - `_write_status(running)`; `asyncio.to_thread(generate_draft, sources=…, artifact_format=fmt,
    topic=…, audience=…, goal=…, provider_id=…, api_key=…, model=…, guidance=…)`; map
    `LLMSchemaError`/`LLMAuthError`/`LLMRateLimitError`/`LLMError`/bare `Exception` → `failed` with the
    Phase-A safe messages ("generated draft failed validation" / "The API key was rejected by the
    provider. Check it in Settings." / "The provider is rate-limiting requests. Try again shortly." /
    "draft generation failed").
  - `sections = draft_output_to_sections(out, sources)`; `create_version(artifact_id=…, content={"sections":
    sections}, created_by_sub=recorded_by_sub, generation_meta={"kind":"draft","model":…,"provider_id":…,
    "source_input_ids": cited, **(guidance if set)})`; `_write_status(done, result={"version_id": str(v.id),
    "artifact_id": str(v.artifact_id), "version_no": v.version_no})`; `finally` shred. Never raises out;
    no `str(exc)` in logs.
- **Submit endpoint** `POST /artifacts/{id}/versions/generate` → async 202: keep owner + artifact-exists
  (404) + project-exists + "≥1 source" 422 guards synchronous; resolve managed-vs-BYOK; `job_id`;
  encrypt envelope (BYOK); `_write_status(queued)`; `generate_version_task.delay(job_id=…, artifact_id=…,
  provider_id=…, model=…, guidance=…, managed=…, recorded_by_sub=principal.sub)`; return **202
  `VersionGenerateJobOut{job_id, status}`** (new schema). Delete the old inline `to_thread(generate_draft)`
  + `create_version` + `VersionOut` build from the router.
- **Task registration:** the `@celery_app.task` decorator registers `trust.generate_version` on import
  (celery_app already imports `trust.tasks`). Verify.

### Mobile
- **`trustClient.ts`:** `generateVersion(artifactId, body, token)` → `VersionGenerateJobOut { job_id, status }`
  (202); add `GenerateVersionJobStatusView = { status: "queued"|"running"|"done"|"failed"; result?: {
  version_id: string; artifact_id: string; version_no: number }; error?: string }` and
  `getGenerateVersionJob(jobId, token)` (GET `/api/v1/jobs/${id}`, same shape as `getJob`).
- **`useGenerateVersionJob`** (mirror `useGenerateTopicJob`): `run({ artifactId, apiKey, accessToken,
  guidance?, onPhase? }): Promise<{ id, artifact_id, version_no, created_at: null }>` — submit → poll →
  resolve the `VersionOut`-shaped object (from `result`), throw `job.error` on failed, 600s timeout.
- **`useTrustProject.generateVersion`:** `generateVersion(artifactId, opts?: { guidance?; onPhase? })` →
  `runGenerateVersionJob({...})` → `await refresh()` → return the version object (same shape callers use).
- **`useTrustProject.generateFormat`:** `generateFormat(fmt, opts?: { onPhase? })` → `createArtifact`
  (sync, unchanged) → `runGenerateVersionJob({ artifactId: a.id, apiKey, accessToken, onPhase })` →
  `await refresh()`.
- **T3 — whole-book cards (`[projectId].tsx`):** `formatGen: Map<string, number>` →
  `Map<string, { startedAt: number; phase: "queued" | "running" }>`. `onGenerateFormat` seeds
  `{startedAt, phase:"queued"}`, passes `onPhase: (phase) => setFormatGen(update that key's phase)`,
  deletes in `finally`. The card's `TopicRowProgress` now gets `phase={prog.phase}` (was hard-coded
  `"running"`). `busy = formatGen.has(f.format)`.
- **T4 — version-viewer (`version/[versionId].tsx`):** `const [genBusy, setGenBusy] = useState(false)` →
  `reviseGen: { startedAt; phase } | null` (mirror the topic-viewer Revise from #421). `doRegen` seeds
  `queued`, passes `onPhase`, clears in `finally`; gate the button `busy`/`disabled` on `reviseGen !== null`;
  `useElapsedMs(reviseGen?.startedAt ?? null)` unconditional at top; render `GenerateProgressBar` in the
  regen section when `reviseGen`. Widen the catch to surface `job.error` (like #420).

## Testing

- **Backend** (fakeredis + test DB + mocked provider, mirror `test_trust_topic_task.py`): task writes
  `running` before `done`; `done` result `{"version_id","artifact_id","version_no"}` + an `artifact_version`
  row created with `generation_meta.kind == "draft"`; source-less → `failed` no `running`; **no key in any
  status payload** (per-payload spy); envelope shredded on success + failure; idempotent re-run doesn't
  create a 2nd version (done-check). Submit endpoint: owner → 202 + job_id (+ envelope); reviewer/non-member
  → 403; artifact-missing → 404; source-less → 422; enqueued with NO api_key.
- **Mobile:** `useGenerateVersionJob` submit→poll→done resolves the version, failed throws `job.error`;
  the cards show Waiting → Generating (T3); the version-viewer shows the bar + flip (T4). No color-literal
  asserts.

## Decomposition (SDD)

- **T1 — backend** `generate_version_task` + async 202 endpoint + `draft_output_to_sections` extract +
  `VersionGenerateJobOut`. Backend tests incl. no-key gate + result + dup-guard.
- **T2 — mobile client + hook** (`trustClient.generateVersion` → 202, `getGenerateVersionJob`,
  `GenerateVersionJobStatusView`, `useGenerateVersionJob`; `useTrustProject.generateVersion`/`generateFormat`
  submit+poll). Hook tests.
- **T3 — whole-book cards** (`[projectId].tsx`): `formatGen` value → `{startedAt, phase}`, `onPhase`,
  bar phase Waiting → Generating. Screen tests.
- **T4 — version-viewer** (`version/[versionId].tsx`): add the bar + Waiting → Generating + surface the
  real error. Screen tests. (Closes the #421 coherence follow-up.)

## Rollout

**Web deploy + backend refresh together** — the new task runs in the **celery-worker** (recreate it;
verify `trust.generate_version` registered). **No migration.** Response shape 200→202 (older clients break
on whole-book generate; web + APK ship from one build).

## Out of scope

- The poll-loop dedup across `useGenerateTopicJob`/`useSuggestTocJob`/`useGenerateVersionJob`/`client.ts`
  (now 4 near-identical pollers — a real follow-up, but not this phase). Moving the main `/generate` +
  `/structure` off BackgroundTasks. Removing the dead `TocSuggestOut` schema (Phase B follow-up).

## Global constraints

- **ADR-001 non-negotiable in the worker** — envelope-only key, shred all paths, never logged/persisted/in
  status/in `.delay()` args; a test asserts it. The worker's structlog redaction backstop is already
  installed (Phase A `worker_process_init`).
- Reuse the `job:{id}:status` contract + `GET /jobs/{id}`. `asyncpg` in the worker via `asyncio.run`.
  `task_acks_late` durability already configured.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. No color-literal asserts; `Alert` from `@/lib/alert`. Commit messages end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
