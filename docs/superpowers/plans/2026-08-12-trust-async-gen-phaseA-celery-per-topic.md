# Trust async gen — Phase A: Celery infra + per-topic pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a durable Celery worker and route per-topic generate through it (submit → 202+job_id
→ worker → poll `GET /jobs/{id}`), fixing the CloudFlare 524 and surviving a deploy, preserving the
BYOK envelope discipline (ADR-001).

**Architecture:** Reuse the existing Redis job pattern (`byok:{id}` envelope, `job:{id}:status`,
`GET /jobs/{id}`). New `celery_app` + `celery-worker` container; a `generate_topic_task` that
decrypts→generates→persists→writes status→shreds; the mobile generate flow becomes submit+poll.

**Tech Stack:** FastAPI + Celery + Redis + asyncpg; React Native + Expo TS; pytest / Jest.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-trust-async-gen-phaseA-celery-per-topic-design.md`.
- **ADR-001 is non-negotiable in the worker.** BYOK key only via the encrypted `byok:{job_id}` Redis
  envelope; decrypt → use → **shred** (`_shred_envelope`); NEVER logged/persisted/put in the job
  result. structlog redaction applies. A test MUST assert the key never appears in the status payload
  or logs (mirror the mandatory no-key-in-logs gate).
- **Durability:** `task_acks_late=True` + `task_reject_on_worker_lost=True`; the task is **idempotent**
  (re-run guarded by the `job:{id}:status == done` marker) so a re-queued task doesn't duplicate a
  version.
- Reuse the existing contract: `_write_status`/`_shred_envelope`/`_byok_redis_key`/
  `_job_status_redis_key` (`generate/tasks.py`), `encrypt_api_key`/`decrypt_api_key`
  (`core/byok_envelope.py`), and `GET /api/v1/jobs/{job_id}` (`generate/router.py:250`) unchanged.
- Backend `ruff check` **AND** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest`.
  `asyncpg` in the worker via `asyncio.run`. Commit messages end with `Co-Authored-By: Claude Opus 4.8
  <noreply@anthropic.com>`.

Tasks sequential (T2 depends on T1's celery_app; T3 on T2's endpoint contract). Backend DB/Redis tests
run in CI; a local temp Postgres + fakeredis is ideal for red→green.

## File Structure & anchors

- `backend/requirements.txt` — add `celery[redis]` (line ~17 notes it as "later").
- `backend/src/core/celery_app.py` — NEW Celery app.
- `backend/src/trust/tasks.py` — NEW `generate_topic_task` (mirror `generate/tasks.py::run_generation`).
- `backend/src/trust/router.py` — convert `generate_topic_version` (~730) to submit; reuse helpers.
- `backend/src/trust/schemas.py` — `TopicGenerateJobOut { job_id: str; status: str }`.
- `docker-compose.demo.yml` — new `celery-worker` service mirroring the `api` service's image + env
  (lines 41-92: REDIS_URL, BYOK_MASTER_KEY, SYSTEM_OWNER_SECRET, ANTHROPIC_DEFAULT_MODEL, DATABASE_URL,
  managed keys), `depends_on: [redis]`, no ports.
- Mirror job plumbing: `backend/src/generate/{router.py (submit_generate ~75-175, get_job_status ~250),
  tasks.py (_write_status, _shred_envelope, run_generation)}`, `core/byok_envelope.py`.
- Trust key resolution to preserve: the current `generate_topic_version` managed-vs-BYOK block
  (`is_managed_eligible`/`get_managed_key` else `body.api_key`).
- `mobile/src/hooks/useStructureJob.ts` (poll pattern to mirror), `mobile/src/api/trustClient.ts`,
  `mobile/app/trust/[projectId].tsx` (DraftsPanel `onGenerateTopic`), `mobile/app/trust/topic-version/[id].tsx` (S1 `doRegen`).

---

### Task 1: Celery infra (app + worker container)

**Files:** `backend/requirements.txt`, `backend/src/core/celery_app.py` (new), `docker-compose.demo.yml`;
a `ping` task + test.

- [ ] **Step 1: Failing test** — a small test that imports `celery_app` and asserts config
  (`task_acks_late is True`, `task_reject_on_worker_lost is True`, broker/backend from `REDIS_URL`);
  and that a registered `ping` task returns "pong" when called directly (`.run()`/synchronously, no
  broker needed). Run — fail.

- [ ] **Step 2: Dependency.** `backend/requirements.txt`: add `celery[redis]` (pin a current version;
  match the repo's pinning style).

- [ ] **Step 3: `backend/src/core/celery_app.py`:**
  ```python
  from celery import Celery
  from backend.src.config import settings  # REDIS_URL
  celery_app = Celery("mentible", broker=settings.redis_url, backend=settings.redis_url)
  celery_app.conf.update(
      task_acks_late=True, task_reject_on_worker_lost=True, worker_prefetch_multiplier=1,
      task_serializer="json", result_serializer="json", accept_content=["json"],
  )
  @celery_app.task(name="ping")
  def ping() -> str:
      return "pong"
  # Import trust tasks so the worker registers them (added in T2).
  ```
  (Confirm the settings import path + `redis_url` attribute name against `backend/src/config.py`.)

- [ ] **Step 4: `docker-compose.demo.yml`** — add a `celery-worker` service after `api`:
  same `image: mentible-backend:latest`, `restart: always`,
  `command: ["celery","-A","backend.src.core.celery_app","worker","--loglevel=INFO","--concurrency=2"]`,
  the SAME `environment:` block as `api` (copy REDIS_URL, BYOK_MASTER_KEY, SYSTEM_OWNER_SECRET,
  ANTHROPIC_DEFAULT_MODEL, OIDC_*, DATABASE_URL, SUPER_ADMIN_*, ARTIFACT_STORE_DIR), `depends_on:
  [redis]`, NO `ports`, share the `mentible-artifacts` volume if the task needs it (it doesn't for
  per-topic — omit unless required). A simple `healthcheck` (e.g. `celery -A … inspect ping`) optional.

- [ ] **Step 5: Run** — `ruff check backend/src/core/celery_app.py && ruff format --check backend/src/core && python -m pytest -k celery -q`. Validate compose: `docker compose -f docker-compose.demo.yml config -q` (syntax) if docker available; else visual-review the service mirrors `api`.

- [ ] **Step 6: Commit.**
```bash
git add backend/requirements.txt backend/src/core/celery_app.py docker-compose.demo.yml backend/tests
git commit -m "feat(infra): Celery app + durable worker container (acks_late) + ping task"
```

---

### Task 2: Per-topic Celery task + async submit endpoint

**Files:** `backend/src/trust/tasks.py` (new), `backend/src/trust/router.py`, `backend/src/trust/schemas.py`; tests.

- [ ] **Step 1: Failing tests** (mock the LLM provider; fakeredis; test DB):
  - `generate_topic_task` produces a topic_version and writes `job:{id}:status = done` with
    `result.version_id`; on provider error → `failed`; the `byok:{id}` envelope is **deleted** after
    (both paths); **the api key never appears in the status payload** (assert the serialized status
    contains no `sk-ant-`/the key).
  - idempotent re-run: calling the task twice for the same job_id doesn't create a second version.
  - submit endpoint: owner → 202 `{job_id, status:"queued"}` + (BYOK) an envelope written to
    `byok:{id}`; reviewer/non-member → 403; unknown topic → 404; the task is enqueued (patch `.delay`).
  Run — fail.

- [ ] **Step 2: Schema.** `TopicGenerateJobOut { job_id: str; status: str }`.

- [ ] **Step 3: Task** `backend/src/trust/tasks.py::generate_topic_task` — a Celery task
  (`@celery_app.task(bind=True, name="trust.generate_topic")`) wrapping `asyncio.run(_run(...))`.
  `_run` (async): (a) idempotency — if `job:{id}:status` already `done`, return; (b) resolve key —
  BYOK: read `byok:{id}` + `decrypt_api_key(master_key, str(job_id), blob)`; managed: `get_managed_key`;
  (c) open asyncpg conn (`settings.database_url`); load the topic's sources/title (mirror the current
  `generate_topic_version` handler's data loading); `generate_topic_draft(...)`; `create_topic_version(...,
  generation_meta={"kind":"topic_draft", ...})`; (d) `_write_status(r, job_id, "done",
  result={"version_id": str(v.id), "topic_id": v.topic_id, "version_no": v.version_no})`; (e)
  `_shred_envelope(r, job_id)`. On exception → `_write_status(..., "failed", error=<safe>)` + shred.
  NEVER log/return the key (structlog redaction; the safe error must not include it). Reuse the
  generate-module helpers (import `_write_status`, `_shred_envelope`, `_byok_redis_key`,
  `_job_status_redis_key` — or move them to a shared `core/jobs.py` if cleaner; keep the Redis key
  strings identical so `GET /jobs/{id}` matches).

- [ ] **Step 4: Submit endpoint.** Convert `generate_topic_version` (router ~730): keep the
  owner/access check + managed-vs-BYOK resolution; then `job_id = uuid4()`; BYOK →
  `encrypt_api_key(master_key, str(job_id), api_key)` → `r.set(byok:{id}, envelope, ex=byok_ttl)`;
  `_write_status(r, job_id, "queued")`; `generate_topic_task.delay(job_id=str(job_id),
  project_id=str(project_id), topic_id=topic_id, provider_id=body.provider_id, model=model,
  guidance=body.guidance, managed=managed, recorded_by_sub=principal.sub)`; return 202
  `TopicGenerateJobOut(job_id=str(job_id), status="queued")` (`status_code=202`). Inject `get_redis`.

- [ ] **Step 5: Run** — `ruff check backend/src/trust && ruff format --check backend/src/trust && python -m pytest -k "topic or celery" -q` (temp PG + fakeredis; note if DB tests skip locally — CI runs them). Confirm the no-key-in-logs assertion passes.

- [ ] **Step 6: Commit.**
```bash
git add backend/src/trust/tasks.py backend/src/trust/router.py backend/src/trust/schemas.py backend/tests
git commit -m "feat(trust): per-topic generate as a durable Celery job (submit 202 + poll)"
```

---

### Task 3: Mobile submit + poll

**Files:** `mobile/src/api/trustClient.ts`, a new `mobile/src/hooks/useGenerateTopicJob.ts` (or extend
`useTrustProject`), `mobile/app/trust/[projectId].tsx`, `mobile/app/trust/topic-version/[id].tsx`; tests.

- [ ] **Step 1: Failing tests** — submitting a per-topic generate returns a `job_id`; polling
  `/jobs/{id}` transitions queued→done and yields `result.version_id`; the DraftsPanel Generate and the
  topic-viewer Revise both submit then, on `done`, refresh/navigate to the new version; on `failed`
  show an error. Follow the existing job-hook test seam (mirror `useStructureJob` tests). No color-literal asserts.

- [ ] **Step 2: Client.** `trustClient.ts`: `generateTopic(projectId, topicId, body, token)` now
  returns `{ job_id: string; status: string }` (202); add `getJob(jobId, token)` polling
  `GET /api/v1/jobs/${jobId}` → `{ status, result }` (reuse the existing job client shape if present).

- [ ] **Step 3: Hook.** `useGenerateTopicJob` mirroring `useStructureJob`: `submit(topicId, opts?)` →
  job_id; poll `/jobs/{id}` on an interval until `done|failed`; expose `status`/`error`/`result`.
  Update `useTrustProject.generateTopic` to submit + return the job handle (or the hook subsumes it).

- [ ] **Step 4: Wire the call sites.**
  - DraftsPanel `onGenerateTopic` (`[projectId].tsx`): submit → poll; keep `busyTopicId` set for the
    duration; on `done` `refresh()` (the topic becomes drafted); on `failed` Alert.
  - S1 Revise `doRegen` (`topic-version/[id].tsx`): submit → poll; on `done` `router.replace` to
    `result.version_id`; on `failed` Alert.

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.

- [ ] **Step 6: Commit.**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks mobile/app/trust mobile/__tests__
git commit -m "feat(trust): per-topic generate submit+poll (async job); wire DraftsPanel + Revise"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest -q` (CI runs DB/Redis); `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] **Security:** grep the diff + run the no-key-in-logs test — the BYOK key never lands in a log, the job status payload, or the DB; the envelope is shredded on success AND failure.
- [ ] `docker compose -f docker-compose.demo.yml config -q` valid; the `celery-worker` service mirrors `api`'s env.
- [ ] **Deploy:** backend refresh + `up -d --remove-orphans` (starts the NEW `celery-worker`); verify `docker ps` shows the worker Up and `celery -A … inspect ping` responds. NO migration. Then web.
- [ ] **Web verify:** a per-topic Generate returns fast (no long block), a spinner polls, and the topic becomes drafted; a second topic can be generated concurrently (no global grey). PR body: async per-topic generate (Celery worker); deploy adds a worker container.

## Self-Review

- **Spec coverage:** infra (T1) · task+endpoint (T2) · mobile submit+poll (T3). suggest-toc/whole-book
  (B/C) + the Pre-fix correctly out of scope.
- **Security:** ADR-001 envelope+shred+no-key-in-logs preserved in the new worker process (T2 + final
  verify). Durability via acks_late + idempotency.
- **Type consistency:** `TopicGenerateJobOut`/client `{job_id,status}`; poll result `{version_id,
  topic_id, version_no}`.
