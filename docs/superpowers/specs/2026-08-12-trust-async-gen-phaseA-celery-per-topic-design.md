# Durable async trust generation — Phase A: Celery infra + per-topic pilot — Design

**Status:** Approved (brainstorming, 2026-08-12). First phase of an arc converting the trust
generators (currently synchronous `asyncio.to_thread` inline → block the request → CloudFlare 524 on
long generations, and lost on deploy) to a **durable async job** (Celery worker + poll). Phase A
stands up the Celery infra and converts **per-topic generate** as the pilot. Phases B (suggest-TOC)
and C (whole-book) reuse the infra. A separate tiny Pre-fix (per-topic disable + `toSubtopics` guard)
ships independently for immediate relief.

## Problem

`POST /projects/{id}/topics/{topic_id}/generate` runs `generate_topic_draft` inline via
`asyncio.to_thread` and returns the version in the same request. A large topic can exceed
CloudFlare's ~100s proxy timeout → **524** (same family as the Suggest-TOC #410), and the synchronous
call blocks the request. Symptom the user hit: one slow/hung generation, combined with the DraftsPanel
greying every topic while one runs, looked like "can't generate." The durable fix: submit returns
**202 + job_id fast**, a **Celery worker** runs the generation, the client polls `GET /jobs/{id}`.
Mentible has **no Celery today** (in-process BackgroundTasks only — the `studybuddy-celery-*`
containers belong to a different product), so Phase A introduces it.

## Goal

Stand up a Celery worker (durable across deploys) and route per-topic generate through it — fixing the
524 and making an in-flight generation survive a worker restart — while preserving the BYOK envelope
discipline (ADR-001) and reusing the existing `GET /jobs/{id}` poll contract.

## Locked decisions

1. **Durable Celery** (broker + result via the existing Redis). `task_acks_late=True` +
   `task_reject_on_worker_lost=True` so a task killed by a deploy is re-queued and re-run — the
   durability the user asked for.
2. **Reuse the existing job status contract** — the task writes the same Redis keys
   (`job:{job_id}:status` payload `{status, result}`) that `GET /jobs/{id}` (`generate/router.py:250`)
   already reads, so the poll endpoint serves trust jobs unchanged. Celery's own result backend is not
   the client contract.
3. **Preserve BYOK/ADR-001** — the submit endpoint encrypts the key into `byok:{job_id}` (Redis, TTL);
   the worker task decrypts, uses, and **shreds** it; the key is never logged/persisted (structlog
   redaction + no key in the job result). Managed-key jobs carry no envelope (worker uses the vault
   key), mirroring the current trust generate.
4. **Idempotent re-run** — because `acks_late` can re-run a task, guard against a duplicate version:
   before creating, check a Redis `job:{job_id}:done`/version marker (or that the job's version isn't
   already recorded); if present, no-op and re-report done. (A rare duplicate topic_version is the
   failure mode without this.)
5. **Per-topic only in Phase A.** suggest-TOC + whole-book stay synchronous until B/C.

## Architecture

### Celery infra (new)
- `backend/requirements.txt`: add `celery[redis]`.
- `backend/src/core/celery_app.py`: `celery_app = Celery("mentible", broker=REDIS_URL,
  backend=REDIS_URL)` with `task_acks_late=True`, `task_reject_on_worker_lost=True`,
  `worker_prefetch_multiplier=1`. Autodiscover/register the trust tasks.
- `docker-compose.demo.yml`: a new `celery-worker` service — **same `mentible-backend:latest` image**,
  `command: celery -A backend.src.core.celery_app worker --loglevel=info --concurrency=2`, the same
  `env_file`/`environment` as `api` (REDIS_URL, DATABASE_URL, ENCRYPTION/BYOK master key, ANTHROPIC/
  managed keys), `depends_on: [redis]`. No published ports.
- Config: reuse the existing `REDIS_URL`/settings; add Celery broker/backend from it. A trivial
  `ping` task proves the worker is alive.

### Per-topic generate → async
- **Submit endpoint** `POST /projects/{id}/topics/{topic_id}/generate` becomes async: keep the
  owner/access + managed-vs-BYOK key resolution it already does, then:
  1. `job_id = uuid4()`; if BYOK, `encrypt_api_key` → `byok:{job_id}` (TTL); if managed, mark managed.
  2. Write `job:{job_id}:status = {status:"queued"}`.
  3. `generate_topic_task.delay(job_id=…, project_id=…, topic_id=…, provider_id=…, model=…,
     guidance=…, managed=…, principal_sub=…)`.
  4. Return **202** `{job_id, status:"queued"}` (a new `TopicGenerateJobOut`).
  (The old synchronous 200-with-version response is replaced; the client moves to submit+poll.)
- **Celery task** `backend/src/trust/tasks.py::generate_topic_task` (sync Celery task wrapping
  `asyncio.run(_run())`):
  - Idempotency: if `job:{job_id}:status` already `done`, return.
  - Resolve the key: BYOK → read+`decrypt_api_key` from `byok:{job_id}`; managed → `get_managed_key`.
  - Open an asyncpg connection (`DATABASE_URL`); load the topic's sources/title; call
    `generate_topic_draft` (mirror the current inline handler); `create_topic_version(..., generation_meta)`.
  - Write `job:{job_id}:status = {status:"done", result:{version_id, topic_id, version_no}}`; **shred**
    `byok:{job_id}`.
  - On any failure: `{status:"failed", error:<safe msg>}`, still shred. **Never** put the key in
    status/logs (ADR-001; structlog redaction).
- **Poll**: reuse `GET /api/v1/jobs/{job_id}` unchanged (it reads `job:{job_id}:status`). The result
  carries `version_id`.

### Mobile
- `trustClient.ts`: `generateTopic` becomes submit → `{ job_id }`; a `getJob(jobId)` (or reuse the
  existing job client) for polling; result `{ version_id, topic_id, version_no }`.
- `useTrustProject.ts` / a new `useGenerateTopicJob` hook (mirror `useStructureJob`): submit → poll
  `/jobs/{id}` until `done|failed`; on done return the version id.
- Wire the two call sites: the DraftsPanel per-topic **Generate/Regenerate** and the S1 Revise flow
  (`topic-version/[id].tsx doRegen`) — submit, show busy tied to the job, on done refresh/navigate.
  (The Pre-fix's per-topic `disabled={isBusy}` complements this.)

## Testing

- **Celery app** imports/configures with `acks_late`; the `ping` task returns.
- **Backend task** (mock the LLM + fake Redis + a test DB): produces a topic_version + writes
  `done` status with `version_id`; on LLM error → `failed`; the BYOK envelope is deleted (shredded)
  after; **a test asserts the api key never appears in the status payload or logs** (mirror the
  mandatory no-key-in-logs gate).
- **Submit endpoint**: owner → 202 + job_id (+ envelope written for BYOK); reviewer/non-member → 403;
  the task is enqueued. Idempotent re-run doesn't duplicate the version.
- **Mobile**: the generate flow submits then polls; on `done` navigates/refreshes with the version;
  on `failed` shows an error. No color-literal asserts.

## Decomposition (SDD)

- **T1 — Celery infra**: `celery_app.py` + `celery[redis]` dep + `celery-worker` service in
  `docker-compose.demo.yml` + a `ping` task + config wiring. (Worker verified live at deploy.)
- **T2 — per-topic Celery task + async submit endpoint** (`trust/tasks.py`, router submit, schema,
  BYOK envelope, idempotency, ADR-001 discipline). Backend tests incl. the no-key-in-logs gate.
- **T3 — mobile submit+poll** (client + hook + wire DraftsPanel + S1 Revise). Mobile tests.

## Rollout

**Backend refresh + a NEW `celery-worker` container** (the ROOT deploy block's `up -d --remove-orphans`
starts it; verify the worker is Up and consuming). No migration. Then web. **Security note:** a new
process handles BYOK keys — the deploy/whole-branch review must confirm ADR-001 (envelope + shred, no
key in logs/status/DB) holds in the worker.

## Out of scope (later phases)

- Phase B (suggest-TOC async), Phase C (whole-book async) — reuse this infra.
- Moving the main `/generate` + `/structure` off BackgroundTasks onto Celery (separate).
- The Pre-fix (#1 per-topic disable + `toSubtopics` guard) — separate small PR.

## Global constraints

**ADR-001 is non-negotiable in the worker** — BYOK key only transits the encrypted Redis envelope,
used then shredded, never logged/persisted (structlog redaction; a test asserts it). `task_acks_late`
+ idempotency for deploy-durability. Reuse the existing `job:{id}:status` contract + `GET /jobs/{id}`.
`asyncpg` in the worker via `asyncio.run`. Backend `ruff check` **and** `ruff format --check`; mobile
`npx tsc --noEmit` + full `npx jest`. Commit messages end with `Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>`.
