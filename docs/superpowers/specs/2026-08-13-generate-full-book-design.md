# Generate full book (fan-out over the TOC) — Design

**Status:** Approved (brainstorming, 2026-08-13).

## Problem

Whole-book generation (`generate.py`, the `book` format) produces a **short** draft: the `book`
FormatSpec literally says *"write a short draft of 3 to 6 sections"* with no length rule, and one
`max_tokens=16384` call must cover the entire book (≤6 sections). Per-topic generation
(`generate_topic.py`) is far longer because each topic gets its **own** 16k budget and writes **one
section per subtopic** (≤20). Users want a full-length book without clicking every topic by hand.

## Solution

A **"Generate full book"** action that **fans out the per-topic generator over every topic in the
project's TOC**, sequentially, as a durable background job — reusing `generate_topic_draft` (full depth
per topic). It is a **new action distinct from** the existing ≤6-section quick draft (which stays for
short formats / no-TOC projects). Output is N `topic_versions` (the existing per-topic data + validation
spine), so each topic is still validated topic-by-topic.

## Decisions (from brainstorming)

- **Sequential** orchestrator (predictable managed cost, rate-limit-safe, ceiling-checkable between topics).
- **Generate-missing-only** — skip topics that already have a `topic_version`; resumable after a partial
  failure; never clobbers approved work.
- **In-app "ready on return"** via a **durable `generation_job` row** (Redis TTL is too short for a long
  run). **Real push (FCM / web-push) is deferred** — nothing is wired today; the on-return surface covers
  the common case.
- **Estimate is advisory** — show the projected tokens/cost + warn if it would exceed the managed
  allowance/ceiling, but the **enforced** bound is a server-side ceiling check **between topics**.
- **TOC required** — the action only appears when the project has a structured TOC.

## Confirmed facts (reuse targets)

- Per-topic unit: `generate_topic_draft(sources, topic_title, subtopics, audience, goal, provider_id,
  api_key, model) -> ConformanceResult` (`generate_topic.py`); its section cap is ≤20, `max_tokens=16384`.
- Durable Celery: `celery_app` with `task_acks_late=True` + `task_reject_on_worker_lost=True` — a running
  job survives worker restart / client navigation. Existing per-topic task `trust.generate_topic`
  (`tasks.py:322`) shows the pattern (own Redis + asyncpg conn via `_redis_client`/`_db_connect`, managed
  metering via `_record_trust_usage`).
- TOC shape: `toc["subjects"][].units[]`, each `unit.id` = topic_id (+ its subtopics). `toc_util.find_toc_topic`
  iterates it. TOC stored on the project (`project_repo`).
- Missing detection: `topic_repo.list_topic_versions(conn, project_id)` → the topic_ids that already have a
  version; missing = TOC unit ids minus those.
- Cost: `billing/pricing.py::cost_micros(input_tokens, output_tokens)` (versioned table). Managed access +
  ceiling: `billing/access.resolve_managed_access` + `over_cap` (checks the O7 spend ceiling). Metering:
  `billing/usage_repo`.
- Latest migration: `0017_topic_feedback` → new is **`0018`**. Per-topic status rollup already exists:
  `router._topic_status_rollup` (`router.py:665`), `book_validated`.
- Generation is **owner-only** (mirror the per-topic submit's `_require_role(..., need_owner=True)`).

## Architecture

### Data — `generation_job` table (migration 0018)

```
generation_job(
  id              uuid primary key,
  project_id      uuid not null references project(id) on delete cascade,
  kind            text not null default 'book',
  status          text not null,            -- queued | running | done | halted | failed
  total           int  not null,            -- missing-topic count captured at enqueue
  done            int  not null default 0,  -- topics successfully generated
  failed_topic_ids text[] not null default '{}',
  created_by_sub  text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
)
-- index on (project_id, created_at desc) for "latest job".
```
Repo `generation_job_repo`: `create(...) -> row`, `get(id)`, `update_progress(id, *, done?, status?,
append_failed?)`, `latest_for_project(project_id)`. This row — NOT Redis — is the durable source of truth
for progress + the on-return surface. (`status='halted'` = stopped mid-run on the spend ceiling.)

### Backend — orchestrator task `trust.generate_book`

Enqueued by the submit endpoint; `bind=True`, own Redis/DB conn like the per-topic task:
```
resolve project + TOC; account; managed flag.
missing = [unit for unit in TOC units if unit.id not in existing_topic_version_topic_ids]
job.total already = len(missing) (set at enqueue).
for unit in missing:
    if managed and over_cap(...):            # spend ceiling between topics
        update job status='halted'; return
    try:
        # sources_for(unit) = the TOC unit's own `source_ids` resolved against
        # project_repo.list_inputs — EXACT per-topic parity (tasks.py:184-187),
        # NOT all project inputs. A unit with empty source_ids behaves exactly as
        # a hand-clicked per-topic generate on that topic (identical, not a new case).
        result = generate_topic_draft(sources_for(unit), unit.title, unit.subtopics, audience, goal, ...)
        persist a topic_version (topic_repo.create_topic_version, generation_meta)
        if managed: _record_trust_usage(result tokens)
        job.done += 1; update_progress
    except Exception:                         # per-topic failure never aborts the book
        append unit.id to job.failed_topic_ids; update_progress
update job status='done'
```
Never raises out of the loop (mirrors the per-topic task's "never raises" discipline). Each topic reuses
the exact per-topic generation + persistence + metering path, so depth/validation are identical to a
hand-clicked per-topic generate.

### Backend — endpoints (all under `/api/v1/trust`, owner-gated)

- **`GET /projects/{id}/generate-book/estimate`** → `{ missing_topics:int, est_output_tokens_max:int,
  est_input_tokens:int, est_cost_micros_max:int, remaining_micros:int|null, would_exceed:bool }`.
  Heuristic (no model call): `est_output_tokens_max = missing × 16384`; `est_input_tokens ≈ Σ over missing
  topics of (that topic's own source_ids content chars / 4) + a small prompt overhead` (topic-scoped, matching
  the per-topic path — NOT all project inputs per topic); `est_cost_micros_max =
  pricing.cost_micros(est_input, est_output_max)` for the default provider/model. `remaining_micros` =
  the managed allowance/ceiling headroom for managed users (null for BYOK); `would_exceed = managed &&
  remaining_micros != null && est_cost_micros_max > remaining_micros`. Advisory only.
- **`POST /projects/{id}/generate-book`** → creates a `generation_job` (status `queued`, total = missing
  count), enqueues `trust.generate_book`, returns `{ job_id, total }`. Managed gate identical to the
  per-topic submit (`resolve_managed_access` → 400 if ineligible; the ceiling is enforced *inside* the
  loop, not as a pre-block, since the estimate is advisory). 422 if the project has no TOC or no missing
  topics.
- **`GET /generation-jobs/{job_id}`** → the durable row `{ status, total, done, failed_topic_ids,
  created_at }` (owner-gated). Drives live progress + the on-return surface.
- **`GET /projects/{id}/generation-jobs/latest`** → the most recent book job for the project (or null) —
  so the client can show "ready on return" without having held the job_id.

### Mobile

- **`trustClient`**: `estimateBook(projectId, token)`, `generateBook(projectId, token, {apiKey?})`,
  `getGenerationJob(jobId, token)`, `latestGenerationJob(projectId, token)` + their types.
- **Whole-book view** (`trust/[projectId].tsx`, owner + TOC present): a **"Generate full book"** button →
  fetch the estimate → a confirm dialog: *"Generate N topics — up to ~X tokens (~$Y on your managed plan).
  Proceed?"*, with a warning line when `would_exceed`. On confirm → `generateBook` (keyless-aware: reuse
  the `knownNotPro`/`key ?? undefined` decision from the keyless work) → store the `job_id`.
- **Progress + on-return:** while on the project, poll `getGenerationJob(job_id)` (reuse `pollJob`-style)
  → a progress line "Generating chapters… 3/8". On project focus with no active local job, call
  `latestGenerationJob` → if `running` show progress; if `done` show "Book generated ✓ (7/8 · 1 failed)"
  with the failed topics listed (so the owner can regenerate those individually via the existing per-topic
  path). Fail-open: a status fetch error hides the surface, never breaks the screen.

## Cost & safety

- Managed fan-out spends real tokens on our key → the **between-topics ceiling check** (`over_cap`) is the
  hard stop; `status='halted'` tells the client we stopped early (owner can raise the ceiling or finish on
  BYOK). The estimate + `would_exceed` warning is the soft, pre-run signal.
- BYOK fan-out: no ceiling (their key), no estimate cost in $ (tokens only).
- Idempotent-ish: generate-missing means a re-run only fills gaps; approved topics are never touched.
- **Durability caveat (fix round, final review, F2):** BYOK book jobs are durable only within the BYOK
  envelope TTL (`byok_redis_ttl_seconds`, ≤600s) — a job redelivered after worker loss past that TTL fails
  (`envelope_missing`) and the owner must re-submit, which generate-missing then resumes cleanly. **Managed**
  jobs are fully durable (the vault key, not a per-job Redis envelope, so there's nothing to expire).

## Testing

- **Orchestrator (DB-backed):** a TOC with 3 topics, 1 already having a version → the job generates the 2
  missing, `total=2`, `done=2`, `status='done'`; a topic whose generation raises → it lands in
  `failed_topic_ids` and the others still complete; `over_cap` true before topic 2 → `status='halted'`,
  `done=1`. Mock `generate_topic_draft`.
- **Estimate:** missing count correct; `est_output_tokens_max == missing × 16384`; `would_exceed` true when
  the estimate beats a small remaining ceiling.
- **Endpoints:** owner-gated (reviewer/non-member → 403); managed-gated submit (no key + not eligible →
  400); 422 on no-TOC / no-missing.
- **Mobile (RNTL):** estimate confirm renders the numbers + the exceed warning; submit stores the job id;
  progress renders `done/total`; on-return "done" surface renders with the failed list; fetch failure →
  surface hidden, screen intact. No color-literal asserts.

## Rollout

Migration **0018** (`alembic upgrade head` in the ROOT backend refresh) + **backend refresh**
(force-recreate api + celery-worker — the worker runs the new task) + **web deploy** + a fresh **APK** for
Android testers. The submit endpoint is a new 202 path (backend + web ship together).

## Out of scope

- Real push notifications (FCM / web-push) — the on-return surface stands in; a separable follow-up.
- Parallel fan-out. "Regenerate all" (only generate-missing this pass). Assembling the topics into a single
  compiled EPUB is the existing publish path — unchanged. Books-surface generators.

## Global constraints

- Owner-only generation (`need_owner=True`); managed gate + between-topics ceiling enforced server-side.
  Keyless-aware submit (reuse the `knownNotPro` / `key ?? undefined` rule; never send `api_key: ""`).
- ADR-001: the managed key never logged. Per-topic failures never abort the job. The `generation_job` row
  is the durable progress/notify source (not Redis TTL).
- No color-literal asserts; `Alert` from `@/lib/alert`. Backend `ruff check` + `ruff format --check`;
  mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commits end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
