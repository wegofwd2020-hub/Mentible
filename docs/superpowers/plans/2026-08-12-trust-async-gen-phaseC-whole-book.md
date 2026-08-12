# Trust async gen — Phase C (whole-book) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move whole-book draft generation (`POST /artifacts/{id}/versions/generate`) onto a durable Celery job (submit 202 → worker → poll), fixing the 524, and wire both mobile callers to the #421 progress bar with a Waiting → Generating phase.

**Architecture:** Mirror the merged Phase A (per-topic) — both persist a version. A new `generate_version_task` + async 202 endpoint reuse the `job:{id}:status` contract + `GET /api/v1/jobs/{id}` poll. Converting the endpoint to 202 forces both callers (whole-book cards `generateFormat`; version-viewer `doRegen` `generateVersion`) to submit+poll.

**Tech Stack:** FastAPI + Celery + Redis (existing); asyncpg in the worker via `asyncio.run`; RN (Expo) + existing `GenerateProgressBar`/`useElapsedMs`; pytest + fakeredis; Jest + RNTL.

## Global Constraints

- **ADR-001 (non-negotiable, worker):** BYOK key ONLY via the encrypted `byok:{job_id}` envelope, used then **shredded** (finally, all paths); NEVER in a log line, the `queued`/`running`/`done`/`failed` status payload, the `.delay()` args, or the DB. A test asserts the key's absence in the status payload (per-payload spy). The worker's structlog redaction backstop is already installed (Phase A `worker_process_init`).
- **Reuse the job contract:** task writes `job:{job_id}:status = {status, result?, error?}`; poll = unchanged `GET /api/v1/jobs/{job_id}`.
- **Result shape:** `done` result = `{"version_id", "artifact_id", "version_no"}`.
- **Dup-row idempotency = the `done`-short-circuit only** (whole-book persists a version, like per-topic; do NOT add new idempotency machinery — the narrow post-commit/pre-status window is the accepted parked risk, same as Phase A).
- **Response-shape change:** endpoint 200-with-version → **202-with-job_id**; ship backend + web together.
- **Template:** committed Phase A code — `backend/src/trust/tasks.py` (`generate_topic_task`, `_run`, `_redis_client`, `_db_connect`, the helpers imported from `generate/tasks.py`) and `router.py::generate_topic_version` (the 202 submit); mobile `useGenerateTopicJob.ts`. Read them before writing.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. No color-literal asserts; `Alert` from `@/lib/alert`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Backend — `generate_version_task` + async submit endpoint

**Files:**
- Modify: `backend/src/trust/generate.py` (extract `draft_output_to_sections`)
- Modify: `backend/src/trust/tasks.py` (add `generate_version_task` + `_run_version`)
- Modify: `backend/src/trust/router.py` (`generate_version` → async 202)
- Modify: `backend/src/trust/schemas.py` (add `VersionGenerateJobOut`)
- Test: `backend/tests/test_trust_version_task.py` (new); update `backend/tests/test_trust_draft.py` / `test_trust_router.py` if they assert the old 200 shape

**Interfaces:**
- Consumes: `generate_draft(...)`, `artifact_repo.create_version`, `project_id_for_artifact`, `project_repo.get_project`/`list_inputs`, the `_write_status`/`_shred_envelope`/`_byok_redis_key`/`_job_status_redis_key` helpers, `encrypt_api_key`/`parse_master_key`, `get_managed_key`/`is_managed_eligible`.
- Produces: Celery task `trust.generate_version`; `VersionGenerateJobOut{job_id: str, status: str}`; job `result = {"version_id","artifact_id","version_no"}`.

- [ ] **Step 1: Extract `draft_output_to_sections`.** The `by_label` S-label→id mapping + `sections` + `cited` block currently in `router.py`'s `generate_version` (the part after the LLM call that builds `sections`/`cited`) moves VERBATIM into `backend/src/trust/generate.py` as a pure helper returning `(sections, cited)`:
```python
def draft_output_to_sections(out, sources) -> tuple[list[dict], list[str]]:
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    sections = [
        {
            "heading": sec.heading,
            "body": sec.body,
            "source_ids": [by_label[label] for label in sec.sources if label in by_label],
        }
        for sec in out.sections
    ]
    cited = sorted({sid for s in sections for sid in s["source_ids"]})
    return sections, cited
```
(Copy the exact construction from the current router block.)

- [ ] **Step 2: Write the failing task test** — `backend/tests/test_trust_version_task.py`, mirroring `test_trust_topic_task.py`'s fixtures/seeding but for an **artifact** (seed a project + an `artifact` row + ≥1 `project_input` + a BYOK envelope). Assert: (a) status `running` then `done` (per-payload `_write_status` spy); (b) `done` result `{"version_id","artifact_id","version_no"}` and an `artifact_version` row exists with `generation_meta["kind"] == "draft"`; (c) no api key in any status payload; (d) envelope shredded; (e) source-less project → `failed` "add at least one source before generating a draft", no `running`; (f) idempotent re-run (status already `done`) creates no 2nd version. Mock the provider so `generate_draft` returns a known output.

- [ ] **Step 3: Run it — FAIL** (`generate_version_task` doesn't exist).

- [ ] **Step 4: Implement `generate_version_task` + `_run_version`** in `backend/src/trust/tasks.py`, mirroring `generate_topic_task`/`_run` EXACTLY (idempotency `done`-check, key resolution managed-vs-BYOK, `_db_connect`, never-raises + `finally` shred, the `running` write, the LLM-error taxonomy). Deltas vs `_run`: resolve `project_id` via `project_id_for_artifact`; load the artifact `format` (`SELECT format FROM artifact WHERE id=$1`) + project + `list_inputs`; artifact-missing → `failed` "artifact not found"; call `generate_draft(sources=…, artifact_format=fmt, topic=p.topic, audience=p.audience, goal=p.goal, provider_id=provider_id, api_key=api_key, model=resolved_model, guidance=guidance)`; `sections, cited = draft_output_to_sections(out, sources)`; `v = await artifact_repo.create_version(conn, artifact_id=artifact_id, content={"sections": sections}, created_by_sub=recorded_by_sub, generation_meta={"kind":"draft","model":resolved_model,"provider_id":provider_id,"source_input_ids":cited, **({"guidance": guidance} if guidance else {})})`; `_write_status(done, result={"version_id": str(v.id), "artifact_id": str(v.artifact_id), "version_no": v.version_no})`. Args: `job_id, artifact_id, provider_id, model, guidance, managed, recorded_by_sub`. Never log `str(exc)`.

- [ ] **Step 5: Add `VersionGenerateJobOut`** to `schemas.py`:
```python
class VersionGenerateJobOut(BaseModel):
    job_id: str
    status: str
```

- [ ] **Step 6: Convert the submit endpoint** `generate_version` in `router.py` to async 202 (mirror `generate_topic_version`): keep `project_id_for_artifact` (404 "artifact not found"), owner `_require_role(need_owner=True)`, project-exists, "≥1 source" 422 guards synchronous; resolve managed eligibility; `job_id = uuid4()`; BYOK → encrypt envelope; `_write_status(queued)`; `generate_version_task.delay(job_id=…, artifact_id=str(artifact_id), provider_id=…, model=…, guidance=body.guidance, managed=…, recorded_by_sub=principal.sub)`; safe `log.info("draft_generate_submitted", …)`; `return schemas.VersionGenerateJobOut(job_id=str(job_id), status="queued")`. `response_model=schemas.VersionGenerateJobOut, status_code=status.HTTP_202_ACCEPTED`. Delete the old inline `to_thread(generate_draft)` + the `sections`/`cited`/`create_version` + `VersionOut` build (the task owns it; the mapping is now `draft_output_to_sections`).

- [ ] **Step 7: Write the failing submit test** (in `test_trust_draft.py`/`test_trust_router.py`): owner → 202 + `job_id` (+ BYOK envelope written); reviewer/non-member → 403; artifact-missing → 404; source-less → 422; `generate_version_task.delay` enqueued with NO `api_key`. Update any test asserting the old 200-with-version.

- [ ] **Step 8: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_trust_version_task.py tests/test_trust_draft.py tests/test_trust_router.py -q` (DB-gated). `python -c "from backend.src.core.celery_app import celery_app; print('trust.generate_version' in celery_app.tasks)"` → True.

- [ ] **Step 9: Commit**
```bash
git add backend/src/trust/generate.py backend/src/trust/tasks.py backend/src/trust/router.py backend/src/trust/schemas.py backend/tests/test_trust_version_task.py backend/tests/test_trust_draft.py backend/tests/test_trust_router.py
git commit -m "feat(trust): whole-book generate as a durable Celery job (submit 202 + poll)"
```

---

### Task 2: Mobile — client + `useGenerateVersionJob`

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (`generateVersion` → 202; add `getGenerateVersionJob` + `GenerateVersionJobStatusView` + `VersionGenerateJobOut`)
- Create: `mobile/src/hooks/useGenerateVersionJob.ts`
- Modify: `mobile/src/hooks/useTrustProject.ts` (`generateVersion` + `generateFormat` → submit+poll)
- Test: `mobile/__tests__/hooks/useGenerateVersionJob.test.tsx`; update any `trustClient`/`useTrustProject` test asserting the old shape

**Interfaces:**
- Consumes: the `useGenerateTopicJob.ts` poll pattern (template).
- Produces:
  - `generateVersion(artifactId, body, token): Promise<VersionGenerateJobOut>` (202 `{job_id, status}`).
  - `getGenerateVersionJob(jobId, token): Promise<GenerateVersionJobStatusView>` where `GenerateVersionJobStatusView = { status: "queued"|"running"|"done"|"failed"; result?: { version_id: string; artifact_id: string; version_no: number }; error?: string }`.
  - `useGenerateVersionJob().run({ artifactId, apiKey, accessToken, guidance?, onPhase? }): Promise<{ id: string; artifact_id: string; version_no: number; created_at: null }>`.

- [ ] **Step 1: Client changes** in `trustClient.ts`: `generateVersion` returns `VersionGenerateJobOut`; add the status view + `getGenerateVersionJob` (GET `/api/v1/jobs/${jobId}`, same `getJob` fetch/ApiError shape).

- [ ] **Step 2: Write the failing hook test** — `useGenerateVersionJob.test.tsx`, mirroring `useGenerateTopicJob`'s: `run` submits (mock `generateVersion` → `{job_id, status:"queued"}`), polls (`queued` → `running` fires `onPhase` → `done` with `result:{version_id,artifact_id,version_no}`), resolves `{ id: version_id, artifact_id, version_no, created_at: null }`; a `failed` job throws `job.error`.

- [ ] **Step 3: Implement `useGenerateVersionJob.ts`** mirroring `useGenerateTopicJob.ts` (same interval/deadline/onPhase; resolve the reconstructed version object from `result`; throw on failed/timeout).

- [ ] **Step 4: Run the hook test — PASS.**

- [ ] **Step 5: `useTrustProject`** — convert both:
```ts
const { run: runGenerateVersionJob } = useGenerateVersionJob();
const generateVersion = useCallback(async (artifactId: string, opts?: { guidance?: string; onPhase?: (p: "queued"|"running") => void }) => {
  const key = await loadApiKey("anthropic");
  if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
  if (!accessToken) throw new Error("Not signed in");
  const v = await runGenerateVersionJob({ artifactId, apiKey: key, accessToken, guidance: opts?.guidance, onPhase: opts?.onPhase });
  await refresh(); return v;
}, [accessToken, refresh, runGenerateVersionJob]);

const generateFormat = useCallback(async (fmt: DraftFormat, opts?: { onPhase?: (p: "queued"|"running") => void }) => {
  const key = await loadApiKey("anthropic");
  if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate a draft.");
  if (!accessToken) throw new Error("Not signed in");
  const a = await createArtifact(projectId, { role: fmt.role, format: fmt.format, title: fmt.label }, accessToken);
  const v = await runGenerateVersionJob({ artifactId: a.id, apiKey: key, accessToken, onPhase: opts?.onPhase });
  await refresh(); return v;
}, [accessToken, projectId, refresh, runGenerateVersionJob]);
```

- [ ] **Step 6: Run** — `cd mobile && npx jest __tests__/hooks/useGenerateVersionJob.test.tsx && npx tsc --noEmit && npx eslint src/hooks/useGenerateVersionJob.ts src/api/trustClient.ts src/hooks/useTrustProject.ts`. Fix any test asserting the old shape.

- [ ] **Step 7: Commit**
```bash
git add mobile/src/api/trustClient.ts mobile/src/hooks/useGenerateVersionJob.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/hooks/useGenerateVersionJob.test.tsx
git commit -m "feat(trust): mobile whole-book generate submit+poll (useGenerateVersionJob)"
```

---

### Task 3: Mobile — whole-book cards Waiting → Generating

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (`formatGen` value → `{startedAt, phase}`; `onPhase`; card bar phase)
- Test: `mobile/__tests__/screens/TrustProjectDetail.generate.test.tsx`

**Interfaces:**
- Consumes: `useTrustProject.generateFormat(fmt, { onPhase })` (Task 2); the existing `TopicRowProgress` wrapper + `GenerateProgressBar`.

- [ ] **Step 1: Write the failing test** — extend `TrustProjectDetail.generate.test.tsx`: pressing a whole-book "Start a new … draft" card shows the bar in **"Waiting…"**, and when the mocked `generateFormat` fires its `onPhase("running")` it flips to **"Generating…"**. (Today it only ever shows "Generating".)

- [ ] **Step 2: Run it — FAIL.**

- [ ] **Step 3: Upgrade `formatGen`** in `[projectId].tsx`:
```ts
const [formatGen, setFormatGen] = useState<ReadonlyMap<string, { startedAt: number; phase: "queued" | "running" }>>(new Map());
const onGenerateFormat = async (fmt: DraftFormat) => {
  setFormatGen((cur) => new Map(cur).set(fmt.format, { startedAt: Date.now(), phase: "queued" }));
  try {
    await generateFormat(fmt, { onPhase: (phase) => setFormatGen((cur) => {
      const p = cur.get(fmt.format); if (!p) return cur;
      const next = new Map(cur); next.set(fmt.format, { ...p, phase }); return next;
    }) });
  } catch (e) {
    Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
  } finally {
    setFormatGen((cur) => { const next = new Map(cur); next.delete(fmt.format); return next; });
  }
};
```
In the card render: `const prog = formatGen.get(f.format); const busy = prog !== undefined;` and `{prog ? <TopicRowProgress startedAt={prog.startedAt} phase={prog.phase} /> : null}` (was `phase="running"`). Update the `DraftsPanel` `formatGen` prop TYPE to the new value shape.

- [ ] **Step 4: Run the test — PASS.** Then `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.

- [ ] **Step 5: Commit**
```bash
git add mobile/app/trust/[projectId].tsx mobile/__tests__/screens/TrustProjectDetail.generate.test.tsx
git commit -m "feat(trust): whole-book draft cards show Waiting->Generating (async)"
```

---

### Task 4: Mobile — version-viewer "Generate new version" bar

**Files:**
- Modify: `mobile/app/trust/version/[versionId].tsx` (`genBusy` → `reviseGen`; add the bar; surface real error)
- Test: `mobile/__tests__/screens/` — the version-viewer test (find the one that renders `version/[versionId]`; e.g. `TrustVersionViewer*.test.tsx`), or add one

**Interfaces:**
- Consumes: `useTrustProject.generateVersion(artifactId, { guidance, onPhase })` (Task 2); `GenerateProgressBar` + `useElapsedMs`.

- [ ] **Step 1: Write the failing test** — pressing "Generate new version" shows the bar in "Waiting…"; `onPhase("running")` flips it to "Generating…"; on resolve it navigates (`router.push` to the new version id); a `failed` regen surfaces `job.error` (not a bare "Try again."). No color-literal asserts.

- [ ] **Step 2: Run it — FAIL.**

- [ ] **Step 3: Convert `genBusy` → `reviseGen`** in `version/[versionId].tsx` (mirror the topic-viewer Revise from #421 T3):
```ts
const [reviseGen, setReviseGen] = useState<{ startedAt: number; phase: "queued" | "running" } | null>(null);
const elapsed = useElapsedMs(reviseGen?.startedAt ?? null);   // unconditional, at component top
const doRegen = async () => {
  setReviseGen({ startedAt: Date.now(), phase: "queued" });
  try {
    const v = await generateVersion(String(artifactId), {
      guidance: guidance.trim() || undefined,
      onPhase: (phase) => setReviseGen((p) => (p ? { ...p, phase } : p)),
    });
    router.push({ pathname: "/trust/version/[versionId]", params: { versionId: v.id, artifactId: String(artifactId), projectId: String(projectId) } });
    setRegen(false); setGuidance("");
  } catch (e) {
    Alert.alert("Couldn't regenerate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
  } finally { setReviseGen(null); }
};
```
Gate the "Generate new version" button `disabled`/label on `reviseGen !== null` (was `genBusy`); render `{reviseGen ? <GenerateProgressBar phase={reviseGen.phase} elapsedMs={elapsed} /> : null}` in the regen section (below the button, full-width — not inside a flex-row).

- [ ] **Step 4: Run the test — PASS.** Then `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.

- [ ] **Step 5: Commit**
```bash
git add mobile/app/trust/version/[versionId].tsx mobile/__tests__/screens/
git commit -m "feat(trust): version-viewer Generate-new-version shows the progress bar (closes #421 follow-up)"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_trust_version_task.py tests/test_trust_draft.py tests/test_trust_router.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] **Security:** status writes carry no key (Task 1 test); envelope shredded success + failure; `.delay()` args carry `job_id`, NOT the key.
- [ ] `python -c "from backend.src.core.celery_app import celery_app; print('trust.generate_version' in celery_app.tasks)"` → True.
- [ ] **Deploy:** web deploy + backend refresh (new task runs in the **celery-worker** — recreate it; verify `trust.generate_version` registered). **No migration.** Ship backend + web together (200→202 shape change).

## Out of scope

- The poll-loop dedup across the 4 job hooks (follow-up). Removing dead `TocSuggestOut`. Moving the main `/generate`+`/structure` off BackgroundTasks.
