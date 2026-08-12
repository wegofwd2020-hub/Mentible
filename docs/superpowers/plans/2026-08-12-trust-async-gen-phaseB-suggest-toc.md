# Trust async gen — Phase B (suggest-TOC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move suggest-TOC off the synchronous request path onto a durable Celery job (submit 202 → worker → poll), fixing the CloudFlare 524, and show the #421 progress bar (Waiting → Generating) on the "Suggest from sources" surface.

**Architecture:** Mirror Phase A (per-topic generate, already on `main`): a new `suggest_toc_task` Celery task + an async submit endpoint reusing the existing `job:{id}:status` contract and `GET /api/v1/jobs/{id}` poll. Unlike per-topic, suggest-TOC persists nothing — the job `result` carries the suggested TOC dict, and there is no duplicate-row idempotency concern.

**Tech Stack:** FastAPI + Celery + Redis (existing infra); asyncpg in the worker via `asyncio.run`; React Native (Expo) submit+poll hook + the existing `GenerateProgressBar`/`useElapsedMs`; pytest + fakeredis; Jest + RNTL.

## Global Constraints

- **ADR-001 (non-negotiable, worker):** the BYOK key transits ONLY the encrypted `byok:{job_id}` Redis envelope, is used then **shredded** (finally, all paths), and NEVER appears in a log line, the `queued`/`running`/`done`/`failed` status payload, the Celery `.delay()` args, or the DB. A test asserts the key's absence in the status payload. The worker already installs the structlog redaction backstop (`worker_process_init`, Phase A).
- **Reuse the existing job contract:** the task writes `job:{job_id}:status = {status, result?, error?}`; poll is the unchanged `GET /api/v1/jobs/{job_id}`. Do NOT invent a parallel status channel.
- **Result shape:** `done` result is `{"toc": <StructuredTocView dict>}` — the same dict the current synchronous endpoint returns.
- **No duplicate-row idempotency logic** (suggest-TOC writes nothing to the DB); the `done`-short-circuit is enough.
- **Response-shape change:** `POST /projects/{id}/suggest-toc` goes 200-with-toc → **202-with-job_id**; ship backend + web together (older clients would break on Suggest — same property as Phase A).
- **Template:** the committed Phase A code is the structural template — `backend/src/trust/tasks.py` (`generate_topic_task`, `_run`, `_redis_client`, `_db_connect`, `_write_status`/`_shred_envelope`/`_byok_redis_key`/`_job_status_redis_key` imported from `backend/src/generate/tasks.py`) and `backend/src/trust/router.py::generate_topic_version` (the 202 submit). Read them before writing.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. No color-literal asserts; `Alert` from `@/lib/alert`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Backend — `suggest_toc_task` + async submit endpoint

**Files:**
- Modify: `backend/src/trust/toc_suggest.py` (extract `toc_output_to_view`)
- Modify: `backend/src/trust/tasks.py` (add `suggest_toc_task` + its `_run_suggest`)
- Modify: `backend/src/trust/router.py` (`suggest_project_toc` → async 202 submit)
- Modify: `backend/src/trust/schemas.py` (add `TocSuggestJobOut`)
- Modify: `backend/src/core/celery_app.py` (only if the bottom-of-file `from backend.src.trust import tasks` needs nothing — the new `@celery_app.task` registers on import; verify `trust.suggest_toc` is registered)
- Test: `backend/tests/test_trust_suggest_toc_task.py` (new), and update `backend/tests/test_trust_toc.py` if it asserts the old 200 shape

**Interfaces:**
- Consumes: `suggest_toc(...)` (existing), `_write_status`/`_shred_envelope`/`_byok_redis_key`/`_job_status_redis_key` (from `generate/tasks.py`), `encrypt_api_key`/`parse_master_key` (byok_envelope), `get_managed_key`/`is_managed_eligible`.
- Produces: Celery task `trust.suggest_toc`; `TocSuggestJobOut{job_id: str, status: str}`; job `result = {"toc": {...}}`.

- [ ] **Step 1: Extract `toc_output_to_view`.** The S-label→input-id mapping currently lives in `router.py`'s `suggest_project_toc` (the `by_label` block that builds the `toc` dict from `out` + `sources`). Move it verbatim into `backend/src/trust/toc_suggest.py` as a pure function so both the (old, until removed) router path and the new task can call it:

```python
import uuid

def toc_output_to_view(out: "_TocOutput", sources) -> dict:
    """Map the LLM's `_TocOutput` (+ the project's inputs, for S-label→id
    resolution) into the StructuredTocView dict the client consumes. Unknown
    S-labels are dropped, never raised on."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    return {
        "subjects": [
            {
                "subject_label": subj.subject_label,
                "units": [
                    {
                        "id": str(uuid.uuid4()),
                        "title": t.title,
                        "subtopics": [
                            ({"label": st.label, "detail": st.detail} if st.detail else st.label)
                            for st in t.subtopics
                        ],
                        "prerequisites": [],
                        "source_ids": [by_label[lbl] for lbl in t.sources if lbl in by_label],
                    }
                    for t in subj.topics
                ],
            }
            for subj in out.subjects
        ]
    }
```
(Copy the exact field construction from the current `router.py` block — match it verbatim so behavior is identical.)

- [ ] **Step 2: Write the failing task test** — `backend/tests/test_trust_suggest_toc_task.py`, mirroring `backend/tests/test_trust_topic_task.py`'s fixtures (`conn`, `fake_redis`, `_patch_redis_client`, DB-gated skip, provider patch, `_MASTER_KEY`, `_API_KEY`). Seed a project with `topic`/`audience`/`goal` + ≥1 `project_input`, write a BYOK envelope at `_byok_redis_key(job_id)`, run `suggest_toc_task`'s async body, and assert: (a) status goes `running` then `done`; (b) `done` result is `{"toc": {"subjects": [...]}}` with the expected subject/topic; (c) the api key appears in NO status payload (spy on `_write_status` like Phase A's ordering test); (d) the envelope is shredded (deleted) after; (e) a source-less project → `failed` with "add at least one source before suggesting a TOC" and no `running`. Mock the provider so `suggest_toc` returns a known `_TocOutput`.

- [ ] **Step 3: Run it — FAIL** (`suggest_toc_task` doesn't exist).

- [ ] **Step 4: Implement `suggest_toc_task` + `_run_suggest`** in `backend/src/trust/tasks.py`, mirroring `generate_topic_task`/`_run`:

```python
@celery_app.task(name="trust.suggest_toc", bind=True, acks_late=True)
def suggest_toc_task(self, **kwargs) -> None:
    asyncio.run(_run_suggest(**{k: _coerce(k, v) for k, v in kwargs.items()}))  # match _run's arg coercion style
```
`_run_suggest` (mirror `_run` structure — never raises; `finally` shreds):
```python
async def _run_suggest(*, job_id, project_id, provider_id, model, managed, recorded_by_sub) -> None:
    r = _redis_client()
    api_key = None
    try:
        raw = await r.get(_job_status_redis_key(job_id))
        if raw is not None and _status_of(raw) == "done":
            return
        # resolve key: managed → get_managed_key(provider_id); BYOK → decrypt byok:{job_id}
        api_key = ... # same as _run
        conn = await _db_connect()
        try:
            p = await project_repo.get_project(conn, project_id=project_id)
            if p is None:
                await _write_status(r, job_id, "failed", error="project not found"); return
            sources = await project_repo.list_inputs(conn, project_id=project_id)
        finally:
            await conn.close()
        if not sources:
            await _write_status(r, job_id, "failed",
                                error="add at least one source before suggesting a TOC")
            return
        resolved_model = model or settings.anthropic_default_model
        await _write_status(r, job_id, "running")
        try:
            out = await asyncio.to_thread(
                suggest_toc, sources=sources, topic=p.topic, audience=p.audience,
                goal=p.goal, provider_id=provider_id, api_key=api_key, model=resolved_model)
        except LLMSchemaError:
            await _write_status(r, job_id, "failed", error="suggested TOC failed validation"); return
        except LLMAuthError:
            await _write_status(r, job_id, "failed",
                                error="The API key was rejected by the provider. Check it in Settings."); return
        except LLMRateLimitError:
            await _write_status(r, job_id, "failed",
                                error="The provider is rate-limiting requests. Try again shortly."); return
        except (LLMError, Exception):
            log.warning("toc_suggest_failed", job_id=str(job_id), reason="llm_error")
            await _write_status(r, job_id, "failed", error="couldn't suggest an outline"); return
        toc = toc_output_to_view(out, sources)
        await _write_status(r, job_id, "done", result={"toc": toc})
    except Exception:
        log.warning("toc_suggest_failed", job_id=str(job_id), reason="unexpected")
        try:
            await _write_status(r, job_id, "failed", error="couldn't suggest an outline")
        except Exception:
            pass
    finally:
        if api_key is not None:
            del api_key
        await _shred_envelope(r, job_id)
        await r.aclose()
```
(Match the EXACT key-resolution, `_status_of`/idempotency, and shred code from `_run`; do not log `str(exc)` anywhere — safe fixed strings only. Split the `except (LLMError, Exception)` into two `except` clauses if `LLMError` needs a distinct message; here both map to the generic safe string.)

- [ ] **Step 5: Add `TocSuggestJobOut`** to `backend/src/trust/schemas.py`:
```python
class TocSuggestJobOut(BaseModel):
    job_id: str
    status: str
```

- [ ] **Step 6: Convert the submit endpoint** `suggest_project_toc` in `router.py` to async 202 (mirror `generate_topic_version`): keep `_require_role(need_owner=True)`, project-exists, and the "≥1 source" 422 guard; resolve managed-vs-BYOK (managed eligibility check); `job_id = uuid4()`; BYOK → `encrypt_api_key` → `byok:{job_id}` (TTL); `_write_status(queued)`; `suggest_toc_task.delay(job_id=…, project_id=…, provider_id=…, model=…, managed=…, recorded_by_sub=principal.sub)`; safe-surface `log.info("toc_suggest_submitted", …)`; `return schemas.TocSuggestJobOut(job_id=str(job_id), status="queued")`. Set `response_model=schemas.TocSuggestJobOut, status_code=status.HTTP_202_ACCEPTED`. Delete the old inline `asyncio.to_thread(suggest_toc, …)` + the `TocSuggestOut` build (the task owns it now). Remove the now-unused `suggest_toc` import from `router.py` if nothing else uses it (keep `toc_output_to_view` out of the router).

- [ ] **Step 7: Write the failing submit-endpoint test** (in `test_trust_toc.py` or the task test file): owner → 202 + `job_id` (+ BYOK envelope written); reviewer/non-member → 403; source-less project → 422 (guard stays synchronous on submit); the task is enqueued (patch `suggest_toc_task.delay` and assert called with `job_id`/`project_id`, NO `api_key`). Update/replace any existing test asserting the old 200-with-toc.

- [ ] **Step 8: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_trust_suggest_toc_task.py tests/test_trust_toc.py -q` (DB-gated). Expected: PASS. Also `python -c "from backend.src.core.celery_app import celery_app; print('trust.suggest_toc' in celery_app.tasks)"` → True.

- [ ] **Step 9: Commit**
```bash
git add backend/src/trust/toc_suggest.py backend/src/trust/tasks.py backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_suggest_toc_task.py backend/tests/test_trust_toc.py
git commit -m "feat(trust): suggest-TOC as a durable Celery job (submit 202 + poll)"
```

---

### Task 2: Mobile — client + `useSuggestTocJob`

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (`suggestToc` → 202; add `getSuggestTocJob` + `SuggestTocJobStatusView`)
- Create: `mobile/src/hooks/useSuggestTocJob.ts`
- Modify: `mobile/src/hooks/useTrustProject.ts` (`suggestToc` → submit+poll)
- Test: `mobile/__tests__/hooks/useSuggestTocJob.test.tsx`, and update `mobile/__tests__/api/trustClient*.test.ts` if it asserts the old `suggestToc` return shape

**Interfaces:**
- Consumes: `getJob`-style poll pattern from `useGenerateTopicJob.ts` (read it as the template — same `pollTopicJob` deadline/interval/`onPhase` shape).
- Produces:
  - `suggestToc(projectId, body, token): Promise<TocSuggestJobOut>` (202 `{job_id, status}`).
  - `getSuggestTocJob(jobId, token): Promise<SuggestTocJobStatusView>` where `SuggestTocJobStatusView = { status: "queued"|"running"|"done"|"failed"; result?: { toc: StructuredTocView }; error?: string }`.
  - `useSuggestTocJob().run({ projectId, apiKey, accessToken, providerId?, onPhase? }): Promise<StructuredTocView>`.
  - `useTrustProject.suggestToc(opts?: { onPhase?: (p: "queued"|"running") => void }): Promise<StructuredTocView>`.

- [ ] **Step 1: Client changes** in `trustClient.ts`. Change `suggestToc` to return `TocSuggestJobOut` (202 body `{job_id, status}` — POST `/projects/${projectId}/suggest-toc`). Add:
```ts
export interface TocSuggestJobOut { job_id: string; status: string }
export interface SuggestTocJobStatusView {
  status: "queued" | "running" | "done" | "failed";
  result?: { toc: StructuredTocView };
  error?: string;
}
export async function getSuggestTocJob(jobId: string, token: string): Promise<SuggestTocJobStatusView> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new ApiError(res.status, b); }
  return res.json() as Promise<SuggestTocJobStatusView>;
}
```

- [ ] **Step 2: Write the failing hook test** — `mobile/__tests__/hooks/useSuggestTocJob.test.tsx`, mirroring `useGenerateTopicJob`'s test seam: `run(...)` submits (mock `suggestToc` → `{job_id:"j1", status:"queued"}`) then polls (mock `getSuggestTocJob` returning `queued`, then `running` (fires `onPhase`), then `done` with `{result:{toc}}`) and resolves the `toc`; a `failed` job throws `job.error`.

- [ ] **Step 3: Implement `useSuggestTocJob.ts`** mirroring `useGenerateTopicJob.ts` (same `POLL_INTERVAL_MS`/`POLL_TIMEOUT_MS`, same imperative `run` + inner `pollSuggestJob(jobId, token, intervalMs, onPhase)` that calls `getSuggestTocJob`, forwards `onPhase(job.status)` for `queued`/`running`, resolves on `done` (returning `job.result!.toc`) / throws `Error(job.error ?? "Couldn't suggest an outline")` on `failed`, rejects "Timed out…" past the deadline). `run` returns `StructuredTocView`.

- [ ] **Step 4: Run the hook test — PASS.**

- [ ] **Step 5: `useTrustProject.suggestToc`** → submit+poll:
```ts
const { run: runSuggestTocJob } = useSuggestTocJob();
const suggestToc = useCallback(async (opts?: { onPhase?: (p: "queued" | "running") => void }): Promise<StructuredTocView> => {
  const key = await loadApiKey("anthropic");
  if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to suggest an outline.");
  if (!accessToken) throw new Error("Not signed in");
  return runSuggestTocJob({ projectId, apiKey: key, accessToken, onPhase: opts?.onPhase });
}, [accessToken, projectId, runSuggestTocJob]);
```
(The old `suggestTocApi(projectId, {...}, accessToken)` direct call is replaced.)

- [ ] **Step 6: Run** — `cd mobile && npx jest __tests__/hooks/useSuggestTocJob.test.tsx && npx tsc --noEmit && npx eslint src/hooks/useSuggestTocJob.ts src/api/trustClient.ts src/hooks/useTrustProject.ts`. Fix any `trustClient` test that asserted the old shape.

- [ ] **Step 7: Commit**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useSuggestTocJob.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/hooks/useSuggestTocJob.test.tsx
git commit -m "feat(trust): mobile suggest-TOC submit+poll (useSuggestTocJob)"
```

---

### Task 3: Mobile — wire `onSuggest` + the progress bar

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (`suggestGen` state, `onPhase`, render `GenerateProgressBar` on the Structure Suggest surface, widen the catch message)
- Test: `mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx`

**Interfaces:**
- Consumes: `GenerateProgressBar`, `useElapsedMs` (existing); `useTrustProject.suggestToc` now takes `{ onPhase }` (Task 2). The module-scope elapsed wrapper (`TopicRowProgress`) exists — reuse or add a sibling for the Suggest surface.

- [ ] **Step 1: Write the failing screen test** — extend `TrustProjectDetail.structure.test.tsx`: pressing "Suggest from sources" shows the progress bar; the mocked `suggestToc` invoking its `onPhase("running")` flips Waiting → Generating; on resolve the outline is applied (or the Replace prompt appears when a TOC already exists) as today; the bar is gone after. A `failed` suggest surfaces the `job.error` message (not a bare "Try again."). No color-literal asserts.

- [ ] **Step 2: Run it — FAIL.**

- [ ] **Step 3: Add `suggestGen` state + wire `onSuggest`** in `[projectId].tsx`:
```ts
const [suggestGen, setSuggestGen] = useState<{ startedAt: number; phase: "queued" | "running" } | null>(null);
```
In `onSuggest`, keep the `suggestBusy` re-entry guard exactly as-is, but drive the bar with `suggestGen` around ONLY the generation await:
```ts
setSuggestBusy(true);
setSuggestGen({ startedAt: Date.now(), phase: "queued" });
let suggested: StructuredTOC;
try {
  suggested = tocViewToStructured(
    await suggestToc({ onPhase: (phase) => setSuggestGen((p) => (p ? { ...p, phase } : p)) }),
  );
} catch (e) {
  Alert.alert("Couldn't suggest", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
  setSuggestBusy(false);
  return;
} finally {
  setSuggestGen(null);   // bar clears before the confirm dialog / apply
}
// ...then the existing apply()/confirm-replace flow (unchanged), which still owns setSuggestBusy(false)
```
(Preserve the existing `apply`/`tocHasContent(toc)` confirm-replace logic verbatim; only the generation await + `suggestGen`/message changed. `suggestGen` is cleared in the `finally` so the bar never shows during the Replace? dialog.)

- [ ] **Step 4: Render the bar on the Structure Suggest surface.** Call `useElapsedMs(suggestGen?.startedAt ?? null)` unconditionally at the component top; pass `suggestGen` (+ the elapsed value, or reuse the elapsed wrapper) into `StructurePanel`, and render `<GenerateProgressBar phase={suggestGen.phase} elapsedMs={…} />` near the "Suggest from sources" button when `suggestGen` is set. Keep the button `busy={suggestBusy}` as-is.

- [ ] **Step 5: Run the screen test — PASS**, then full gates: `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.

- [ ] **Step 6: Commit**
```bash
git add mobile/app/trust/[projectId].tsx mobile/__tests__/screens/TrustProjectDetail.structure.test.tsx
git commit -m "feat(trust): suggest-TOC shows the progress bar (Waiting->Generating) + surfaces real errors"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_trust_suggest_toc_task.py tests/test_trust_toc.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] **Security:** the `running`/`done`/`failed` status writes carry no key (Task 1 test); envelope shredded on success AND failure; `.delay()` args carry `job_id`, NOT the key.
- [ ] `python -c "from backend.src.core.celery_app import celery_app; print('trust.suggest_toc' in celery_app.tasks)"` → True.
- [ ] **Deploy:** web deploy + a backend refresh (the new task runs in the **celery-worker** — recreate it; verify the worker source has `suggest_toc_task` / `trust.suggest_toc` is registered). **No migration.** Ship backend + web together (response-shape change).

## Out of scope

- Phase C (whole-book async). The poll-loop dedup across `useGenerateTopicJob`/`useSuggestTocJob`/`client.ts` (logged follow-up). The `version/[versionId].tsx` whole-artifact progress bar (#421 follow-up).
