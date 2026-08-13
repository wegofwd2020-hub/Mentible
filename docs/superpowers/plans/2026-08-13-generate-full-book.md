# Generate full book (fan-out over the TOC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Generate full book" action that fans the per-topic generator out over every (missing) TOC topic, sequentially, as a durable background job — producing full-length per-topic content, with a pre-run estimate and an in-app "ready on return" surface.

**Architecture:** New `generation_job` table (durable progress). A sequential Celery orchestrator `trust.generate_book` reuses `generate_topic_draft` per topic (generate-missing, continue-on-fail, spend-ceiling halt between topics). New estimate + submit + status endpoints. Mobile: estimate→confirm→submit + progress/on-return surface. Reuses per-topic generation, durable Celery, pricing, and the managed access/ceiling checks.

**Tech Stack:** FastAPI + asyncpg + Celery (backend); React Native (Expo) (mobile); pytest; Jest + RNTL.

## Global Constraints

- **Owner-only** generation (`_require_role(conn, account, project_id, need_owner=True)`). Managed submit gate = `access.resolve_managed_access` (400 if ineligible), keyless-aware on the client (`knownNotPro` / `apiKey: key ?? undefined`; never send `api_key: ""`). The **spend ceiling** (`access.over_cap`) is enforced **inside** the orchestrator loop between topics, not as a pre-block.
- Per-topic failures **never abort** the job (mirror the per-topic task's never-raises discipline). The `generation_job` DB row — NOT Redis TTL — is the durable progress/notify source of truth.
- ADR-001: the managed key never logged. No color-literal asserts; `Alert` from `@/lib/alert`.
- Backend `ruff check .` **and** `ruff format --check .`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** latest migration `0017` → new is **`0018`** (alembic files `backend/alembic/versions/`, `revision`/`down_revision` string style, `op.execute(<raw SQL>)`, `gen_random_uuid()`). TOC = `project.toc["subjects"][].units[]`, each `unit` has `id` (=topic_id), `title`, `subtopics`, `source_ids`. Missing-topic detection: `topic_repo.list_topic_versions(conn, project_id=…)` → `TopicVersion.topic_id`s that exist; missing = unit ids minus those. Per-topic unit: `generate_topic.generate_topic_draft(sources, topic_title, subtopics, audience, goal, provider_id, api_key, model)`; each topic's sources = the unit's `source_ids` resolved against `project_repo.list_inputs` (topic-scoped, `tasks.py:184-187`). Persist via `topic_repo.create_topic_version(conn, project_id, topic_id, title, source_ids, content, created_by_sub, generation_meta)`. Cost: `billing/pricing.cost_micros(input_tokens, output_tokens)`. Managed: `billing/access.resolve_managed_access(conn, account_id=, provider_id=, principal=)` + `over_cap(conn, account_id=, access=)`; metering `_record_trust_usage`. Per-topic task shape (own redis/db conn, `asyncio.run`): `backend/src/trust/tasks.py:322`. Submit-endpoint pattern (owner gate + managed): `router.py:693` `generate_topic_version`. Output cap per topic = `max_tokens 16384`.

---

### Task 1: Migration 0018 + `generation_job_repo`

**Files:**
- Create: `backend/alembic/versions/0018_generation_job.py`, `backend/src/trust/generation_job_repo.py`
- Test: `backend/tests/test_generation_job_repo.py`

**Interfaces:**
- Produces: table `generation_job`; `generation_job_repo` with `create(conn, *, project_id, total, created_by_sub) -> Row`, `get(conn, *, job_id) -> Row|None`, `update_progress(conn, *, job_id, done=None, status=None, add_failed_topic_id=None) -> None`, `latest_for_project(conn, *, project_id) -> Row|None`. `Row` fields: `id, project_id, kind, status, total, done, failed_topic_ids, created_by_sub, created_at`.

- [ ] **Step 1: Write the migration** `backend/alembic/versions/0018_generation_job.py` (mirror `0017`'s structure):
```python
"""generation_job — durable progress for the fan-out 'generate full book' job (per-topic over the TOC)"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE generation_job (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            kind              text NOT NULL DEFAULT 'book',
            status            text NOT NULL CHECK (status IN ('queued','running','done','halted','failed')),
            total             int  NOT NULL,
            done              int  NOT NULL DEFAULT 0,
            failed_topic_ids  text[] NOT NULL DEFAULT '{}',
            created_by_sub    text NOT NULL,
            created_at        timestamptz NOT NULL DEFAULT now(),
            updated_at        timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX generation_job_project_idx ON generation_job (project_id, created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS generation_job")
```

- [ ] **Step 2: Write the failing repo test** `backend/tests/test_generation_job_repo.py` (use the DB-backed test fixtures the other trust repo tests use — e.g. the `conn` fixture in `test_trust_*`): `create(total=3)` → a row with `status='queued'`, `done=0`, `failed_topic_ids==[]`; `update_progress(done=1, status='running')` then `get` reflects it; `update_progress(add_failed_topic_id='u2')` appends; `latest_for_project` returns the newest by `created_at`.

- [ ] **Step 3: Run — FAIL** (no repo).

- [ ] **Step 4: Implement `generation_job_repo.py`** — asyncpg, mirror `topic_repo`'s style (a `_COLS` string + a `_row(r)` mapper or return `asyncpg.Record`/dict). `create` INSERTs `(project_id, status='queued', total, created_by_sub)` RETURNING all cols. `update_progress` builds a dynamic SET for the provided fields plus `updated_at = now()`; `add_failed_topic_id` → `failed_topic_ids = array_append(failed_topic_ids, $x)`; `done`/`status` set when provided. `get` selects by id. `latest_for_project` → `ORDER BY created_at DESC LIMIT 1`.

- [ ] **Step 5: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_generation_job_repo.py -q`. PASS.

- [ ] **Step 6: Commit** `feat(trust): generation_job table + repo (durable fan-out progress) [0018]`.

---

### Task 2: `book_gen` missing-topics helper + estimate endpoint

**Files:**
- Create: `backend/src/trust/book_gen.py` (shared missing-topics + estimate helpers)
- Modify: `backend/src/trust/schemas.py` (`BookEstimateOut`), `backend/src/trust/router.py` (the GET)
- Test: `backend/tests/test_book_estimate.py`

**Interfaces:**
- Produces: `book_gen.missing_topics(project, existing_topic_ids: set[str]) -> list[dict]` (TOC units with no version, each `{id,title,subtopics,source_ids}`); `book_gen.estimate(missing, inputs_by_id, provider_id, model) -> BookEstimate` (`missing_topics:int, est_input_tokens:int, est_output_tokens_max:int, est_cost_micros_max:int`). `GET /projects/{id}/generate-book/estimate -> BookEstimateOut` = the estimate + `remaining_micros: int|None` + `would_exceed: bool`.

- [ ] **Step 1: Write the failing test** `test_book_estimate.py`: seed a project TOC of 3 units (unit `u1` given a `topic_version`), `GET /api/v1/trust/projects/{id}/generate-book/estimate` → `missing_topics == 2`, `est_output_tokens_max == 2 * 16384`, `est_cost_micros_max > 0`; a reviewer/non-member → 403. (Use the trust router test fixtures.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `book_gen.py`:**
```python
_MAX_OUTPUT_TOKENS = 16384  # per-topic cap (mirror generate_topic._MAX_TOKENS)

def _iter_units(toc):
    for subj in (toc or {}).get("subjects", []):
        for unit in subj.get("units", []):
            yield unit

def missing_topics(project, existing_topic_ids):
    return [u for u in _iter_units(project.toc) if str(u.get("id")) not in existing_topic_ids]

def estimate(missing, inputs_by_id, provider_id, model):
    est_input = 0
    for u in missing:
        chars = sum(len(inputs_by_id[sid].content) for sid in (u.get("source_ids") or []) if sid in inputs_by_id)
        est_input += chars // 4 + 400  # /4 ≈ tokens; +400 prompt overhead
    est_output = len(missing) * _MAX_OUTPUT_TOKENS
    from backend.src.billing import pricing
    cost = pricing.cost_micros(provider_id, model, est_input, est_output)  # (provider, model, in, out)
    return BookEstimate(len(missing), est_input, est_output, cost)
```
(`pricing.cost_micros(provider: str, model: str, input_tokens: int, output_tokens: int) -> int` — provider/model FIRST; use a default `model` string, e.g. `settings.anthropic_default_model`, when the caller has none.)

- [ ] **Step 4: `BookEstimateOut`** in `schemas.py` (`missing_topics, est_input_tokens, est_output_tokens_max, est_cost_micros_max, remaining_micros: int|None, would_exceed: bool`).

- [ ] **Step 5: The endpoint** in `router.py` (owner-or-reviewer? spec says owner-only actions, but the estimate is read-only — use `need_owner=True` to match the generate gate). Resolve project, existing topic ids via `topic_repo.list_topic_versions`, `inputs_by_id` via `list_inputs`; compute estimate. `remaining_micros`/`would_exceed`: for a managed-eligible caller, `remaining_micros = ` headroom from `resolve_managed_access` allowance/ceiling vs current `usage_repo.period_usage` (null when BYOK/none); `would_exceed = remaining_micros is not None and est_cost_micros_max > remaining_micros`.

- [ ] **Step 6: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_book_estimate.py -q`. Commit `feat(trust): generate-book estimate endpoint + missing-topics helper`.

---

### Task 3: Orchestrator task `trust.generate_book`

**Files:**
- Modify: `backend/src/trust/tasks.py` (the task + its async `_run_book`)
- Test: `backend/tests/test_generate_book_task.py`

**Interfaces:**
- Produces: `generate_book_task` (Celery `name="trust.generate_book"`, `bind=True`), args `{job_id, project_id, provider_id, model, managed, recorded_by_sub}`. Reuses `generate_topic_draft`, `topic_repo.create_topic_version`, `generation_job_repo.update_progress`, `access.over_cap`, `_record_trust_usage`.

- [ ] **Step 1: Write the failing test** `test_generate_book_task.py` (mock `generate_topic_draft` to return a canned `ConformanceResult`; DB-backed like `test_trust_version_task.py`). Cases: TOC of 3 units, `u1` already has a version → running the task generates `u2`+`u3`, `generation_job.done==2`, `status=='done'`, two new `topic_version`s; make `generate_topic_draft` raise for `u3` → `u3` in `failed_topic_ids`, `done==1`, `status=='done'`; monkeypatch `access.over_cap` → True before `u3` → `status=='halted'`, `done==1` (u3 not attempted). Assert the task never raises.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement `_run_book` + `generate_book_task`** in `tasks.py`, mirroring `_run`/`generate_topic_task` (own `_redis_client`/`_db_connect`, `asyncio.run`). Logic:
```
job set status='running'
p = get_project; existing = {tv.topic_id for tv in list_topic_versions(project_id)}
missing = book_gen.missing_topics(p, existing)
account = get account (for over_cap/metering) when managed
for unit in missing:
    if managed:
        grant = await resolve_managed_access(...); 
        if grant is None or await over_cap(conn, account_id=account.id, access=grant):
            update_progress(status='halted'); return
    try:
        sources = [inputs_by_id[sid] for sid in unit['source_ids'] if sid in inputs_by_id]
        result = generate_topic_draft(sources=sources, topic_title=unit['title'], subtopics=unit['subtopics'], audience=p.audience, goal=p.goal, provider_id=provider_id, api_key=<managed vault key or None path — SEE per-topic task>, model=model)
        sections, cited = topic draft → sections (reuse the per-topic mapping in _run)
        create_topic_version(...); 
        if managed: await _record_trust_usage(result tokens)
        update_progress(done=job.done+1)
    except Exception:
        update_progress(add_failed_topic_id=unit['id'])
update_progress(status='done')
```
**Reuse the per-topic task's exact key/source/section-mapping code** (`tasks.py` `_run` lines ~184-256) — extract a shared helper if cleaner, else replicate faithfully. The managed key for the LLM call is resolved the SAME way the per-topic task does it (managed → vault key; BYOK → the passed key) — do NOT invent a new key path.

- [ ] **Step 4: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_generate_book_task.py -q`. Commit `feat(trust): trust.generate_book orchestrator — sequential fan-out over the TOC (missing-only, ceiling-halt, continue-on-fail)`.

---

### Task 4: Submit + status endpoints

**Files:**
- Modify: `backend/src/trust/schemas.py` (`GenerateBookIn`, `GenerationJobOut`), `backend/src/trust/router.py` (3 routes)
- Test: `backend/tests/test_generate_book_router.py`

**Interfaces:**
- Produces: `POST /projects/{id}/generate-book -> {job_id, total}` (202); `GET /generation-jobs/{job_id} -> GenerationJobOut`; `GET /projects/{id}/generation-jobs/latest -> GenerationJobOut | null`.

- [ ] **Step 1: Failing test** `test_generate_book_router.py`: owner POSTs with a TOC (1 missing topic) + BYOK key → 202, a `generation_job` row exists with `total==1`; owner with no TOC or 0 missing → 422; a reviewer → 403; `GET /generation-jobs/{id}` returns the row for the owner, 403 for a non-member; `latest` returns it. Mock `generate_book_task.delay`.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement the 3 routes** in `router.py`, mirroring `generate_topic_version` (`router.py:693`) for the owner gate + managed eligibility on POST:
  - `POST`: `_require_role(need_owner=True)`; resolve missing topics; `if not missing → 422`; `managed = body.api_key is None`; if managed, `resolve_managed_access(...) is None → 400`; create the `generation_job` (total=len(missing)); if BYOK, store the key envelope in Redis under the job (mirror the per-topic BYOK envelope so the worker can read it); `generate_book_task.delay(job_id=…, project_id=…, provider_id=body.provider_id, model=…, managed=managed, recorded_by_sub=principal.sub)`; return `{job_id, total}`.
  - `GET /generation-jobs/{id}`: load the row → resolve its `project_id` → `_require_role(need_owner=True)` → `GenerationJobOut`.
  - `GET /projects/{id}/generation-jobs/latest`: owner gate → `latest_for_project` → row or null.
- [ ] **Step 4: `GenerationJobOut`** = `{id, project_id, status, total, done, failed_topic_ids, created_at}`.

- [ ] **Step 5: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_generate_book_router.py -q`. Commit `feat(trust): generate-book submit + generation-job status endpoints`.

---

### Task 5: Mobile — client + estimate/confirm/submit

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (methods + types), `mobile/app/trust/[projectId].tsx` (the whole-book view action)
- Test: `mobile/__tests__/api/trustClient.test.ts` + a screen test

**Interfaces:**
- Consumes: `estimateBook(projectId, token)`, `generateBook(projectId, token, {apiKey?})`, `getGenerationJob(jobId, token)`, `latestGenerationJob(projectId, token)`.

- [ ] **Step 1: Client methods + types** in `trustClient.ts`: `BookEstimate` (`{missing_topics, est_input_tokens, est_output_tokens_max, est_cost_micros_max, remaining_micros: number|null, would_exceed: boolean}`), `GenerationJob` (`{id, project_id, status, total, done, failed_topic_ids: string[], created_at}`); `estimateBook` GET `/projects/{id}/generate-book/estimate`; `generateBook` POST `/projects/{id}/generate-book` body `{ api_key?: provider... }` (omit api_key when absent — reuse the keyless pattern); `getGenerationJob` GET `/generation-jobs/{id}`; `latestGenerationJob` GET `/projects/{id}/generation-jobs/latest`.

- [ ] **Step 2: Client test** — assert the 4 URLs/methods; `generateBook` with no apiKey omits `api_key` in the body.

- [ ] **Step 3: Failing screen test** — in the whole-book view (owner + TOC present), a "Generate full book" control appears; pressing it calls `estimateBook`, shows a confirm with the token/cost numbers + an exceed warning when `would_exceed`; confirming calls `generateBook`. Mock `useBillingPlan` + the client. No color-literal asserts.

- [ ] **Step 4: Implement** in `[projectId].tsx` (DraftsPanel whole-book view, `isOwner && toc`): a **"Generate full book"** button → `estimateBook` → an `Alert`/confirm surface: "Generate N topics — up to ~{est_output_tokens_max} tokens (~${est_cost_micros_max/1e6} on your managed plan). Proceed?" + a warning line when `would_exceed`. On confirm → resolve the key like the other generators (`loadApiKey`; `knownNotPro` guard; `apiKey: key ?? undefined`) → `generateBook(projectId, token, {apiKey})` → keep the returned `job_id` in state (Task 6 polls it).

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Commit `feat(trust): Generate-full-book action + pre-run estimate confirm (mobile)`.

---

### Task 6: Mobile — progress + on-return surface

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (progress + on-focus surface)
- Test: the screen test

**Interfaces:**
- Consumes: `getGenerationJob`, `latestGenerationJob` (Task 5).

- [ ] **Step 1: Failing screen test** — with an active `job_id`, the view polls `getGenerationJob` and renders "Generating chapters… {done}/{total}"; on project focus with no active job, `latestGenerationJob` → a `done` job renders "Book generated ✓ ({done}/{total}· {failed} failed)" listing the failed topic ids; a `running` latest renders the progress line; a fetch rejection → the surface is absent, screen intact (fail-open). No color-literal asserts.

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — a small `useState`/effect: when a `job_id` is set (from Task 5) poll `getGenerationJob` on an interval (reuse the `pollJob` cadence or a simple `setInterval` cleared on unmount / terminal status) → progress line. On `useFocusEffect` with no active local job, call `latestGenerationJob(projectId)`; render the surface per its `status` (`running` → progress; `done`/`halted` → "Book generated ✓ (done/total · failed)" with the failed topic list; the owner regenerates a failed topic via the existing per-topic Generate). Fail-open on any fetch error. Refresh the project (`refresh()`) when a job reaches `done` so the new topic versions show.

- [ ] **Step 4: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Commit `feat(trust): full-book generation progress + on-return "ready" surface`.

---

## Final verification (after all tasks)

- [ ] `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_generation_job_repo.py tests/test_book_estimate.py tests/test_generate_book_task.py tests/test_generate_book_router.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] End-to-end reasoning: submit → durable job → sequential per-topic generation (missing-only) → progress row updates → done; a per-topic failure is recorded not fatal; the ceiling halts mid-run; the client shows progress + on-return status.
- [ ] **Deploy:** migration **0018** (`alembic upgrade head` in the ROOT refresh) + backend refresh (force-recreate api + celery-worker) + web deploy + fresh APK. Backend + web ship together (new 202 path).

## Out of scope

- Real push (FCM/web-push). Parallel fan-out. Regenerate-all. Compiling the topics into one EPUB (existing publish path). Books-surface generators.
