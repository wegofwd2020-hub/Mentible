# Trust job-poll dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the 3 near-identical mobile job-poll hooks + 3 `getJob` fetch copies into one shared `pollJob<R>`, dropping each hook from ~110 to ~40 lines, with **identical runtime behavior** (existing tests stay green).

**Architecture:** A self-contained `pollJob<R>(jobId, token, opts): Promise<R>` in `mobile/src/api/pollJob.ts` fetches `GET /api/v1/jobs/{id}` and runs the deadline loop (interval, 600s timeout, `onPhase` queued/running, resolve `result` on done, throw on failed/timeout). The three hooks call it and delete their private `pollXxxJob` loops.

**Tech Stack:** React Native (Expo), fetch + `ApiError`; Jest + fake timers.

## Global Constraints

- **Behavior-identical.** Same 3s interval, 600s deadline, `onPhase` fires only for queued/running, per-hook timeout + fallback messages preserved verbatim, throw-on-failed/timeout, `ApiError.userMessage()` fidelity, rethrow-Error contract. **The existing hook + screen tests must pass unchanged** — that is the proof.
- **Scope:** the 3 TRUST hooks + their 3 `getJob` copies only. Do NOT touch `client.ts`'s `pollExportJob`/`pollUntilDone` (different contract). No backend change.
- No color-literal asserts. `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Add the shared `pollJob<R>` helper (additive)

**Files:**
- Create: `mobile/src/api/pollJob.ts`
- Test: `mobile/__tests__/api/pollJob.test.ts`

**Interfaces:**
- Produces:
```ts
export interface JobStatusView<R> { status: "queued" | "running" | "done" | "failed"; result?: R; error?: string }
export interface PollJobOpts {
  intervalMs: number;
  timeoutMs?: number;         // default 600_000
  timeoutMessage: string;
  failedMessage: string;
  onPhase?: (p: "queued" | "running") => void;
}
export function pollJob<R>(jobId: string, token: string, opts: PollJobOpts): Promise<R>
```

- [ ] **Step 1: Write the failing test** — `mobile/__tests__/api/pollJob.test.ts`. Mock `global.fetch`. Cover: (a) queued→running→done resolves `result` and fires `onPhase("queued")` then `onPhase("running")` (never for done); (b) `failed` with `error` throws that `error`; (c) `failed` with no `error` throws `failedMessage`; (d) `done` with no `result` throws `job.error ?? failedMessage`; (e) past `timeoutMs` rejects with `timeoutMessage`; (f) a non-ok fetch throws `ApiError`. Use a small `intervalMs`/`timeoutMs` + fake timers; drive the queued→running→done transition via sequential `fetch` mock resolutions.

```ts
import { pollJob } from "@/api/pollJob";
import { ApiError } from "@/api/client";

function mockJobSequence(views: object[]) {
  const fn = jest.fn();
  views.forEach((v) => fn.mockResolvedValueOnce({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v), headers: { get: () => null } }));
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}
afterEach(() => jest.restoreAllMocks());

it("resolves result on done and fires onPhase for queued/running only", async () => {
  mockJobSequence([{ status: "queued" }, { status: "running" }, { status: "done", result: { v: 1 } }]);
  const phases: string[] = [];
  const r = await pollJob<{ v: number }>("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail", onPhase: (p) => phases.push(p) });
  expect(r).toEqual({ v: 1 });
  expect(phases).toEqual(["queued", "running"]);
});

it("throws job.error on failed", async () => {
  mockJobSequence([{ status: "failed", error: "bad key" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("bad key");
});

it("throws failedMessage on failed with no error, and on done without result", async () => {
  mockJobSequence([{ status: "failed" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("fail");
  mockJobSequence([{ status: "done" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("fail");
});

it("rejects with timeoutMessage past the deadline", async () => {
  mockJobSequence([{ status: "queued" }, { status: "queued" }]);
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMs: 0, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toThrow("t/o");
});

it("throws ApiError on a non-ok fetch", async () => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom", headers: { get: () => null } });
  await expect(pollJob("j1", "tok", { intervalMs: 1, timeoutMessage: "t/o", failedMessage: "fail" })).rejects.toBeInstanceOf(ApiError);
});
```

- [ ] **Step 2: Run it — FAIL** (`@/api/pollJob` missing).

- [ ] **Step 3: Implement `mobile/src/api/pollJob.ts`** — generalize the existing `pollXxxJob` loop, doing the fetch inline (from `getJob`'s body). Reuse `resolveBaseUrl`/`ApiError` from `@/api/client` (confirm the exact export names by reading `mobile/src/api/client.ts` — `getJob` in `trustClient.ts` uses `resolveBaseUrl()` and `new ApiError(res.status, body)`):

```ts
import { ApiError, resolveBaseUrl } from "@/api/client";

export interface JobStatusView<R> {
  status: "queued" | "running" | "done" | "failed";
  result?: R;
  error?: string;
}
export interface PollJobOpts {
  intervalMs: number;
  timeoutMs?: number;
  timeoutMessage: string;
  failedMessage: string;
  onPhase?: (p: "queued" | "running") => void;
}

const DEFAULT_TIMEOUT_MS = 600_000;

async function fetchJob<R>(jobId: string, token: string): Promise<JobStatusView<R>> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new ApiError(res.status, b); }
  return res.json() as Promise<JobStatusView<R>>;
}

// Submit-agnostic poll of the shared GET /api/v1/jobs/{id} status row. Resolves
// the job's `result` on done; throws Error(job.error ?? failedMessage) on failed
// or a done with no result; rejects Error(timeoutMessage) past the deadline;
// rethrows a fetch/ApiError. `onPhase` fires only for queued/running.
export function pollJob<R>(jobId: string, token: string, opts: PollJobOpts): Promise<R> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return new Promise<R>((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) { reject(new Error(opts.timeoutMessage)); return; }
      try {
        const job = await fetchJob<R>(jobId, token);
        if (job.status === "queued" || job.status === "running") { opts.onPhase?.(job.status); setTimeout(tick, opts.intervalMs); return; }
        if (job.status === "done" && job.result !== undefined) { resolve(job.result); return; }
        reject(new Error(job.error ?? opts.failedMessage));
      } catch (err) { reject(err); }
    };
    void tick();
  });
}
```
Note: verify `resolveBaseUrl` is exported from `@/api/client` (the three getters call it). If it lives in `trustClient.ts` instead, import from there — match the existing `getJob` implementation's imports exactly.

- [ ] **Step 4: Run the test — PASS.** Then `npx tsc --noEmit` + `npx eslint src/api/pollJob.ts __tests__/api/pollJob.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add mobile/src/api/pollJob.ts mobile/__tests__/api/pollJob.test.ts
git commit -m "feat(trust): shared pollJob<R> helper for the async job-poll hooks"
```

---

### Task 2: Rewrite the three hooks onto `pollJob<R>` + remove the dead getters

**Files:**
- Modify: `mobile/src/hooks/useGenerateTopicJob.ts`, `mobile/src/hooks/useSuggestTocJob.ts`, `mobile/src/hooks/useGenerateVersionJob.ts`
- Modify: `mobile/src/api/trustClient.ts` (remove `getJob`, `getSuggestTocJob`, `getGenerateVersionJob` + the 3 `…JobStatusView` interfaces; keep the `result` type aliases they referenced)
- Test: the existing hook tests + any test importing the removed getters

**Interfaces:**
- Consumes: `pollJob<R>` + `JobStatusView<R>` (Task 1).
- Each hook keeps its public `run(args)` signature and return type UNCHANGED.

- [ ] **Step 1: Rewrite each hook's `run`.** Delete the private `pollTopicJob`/`pollSuggestJob`/`pollGenerateVersionJob` function and the `getXxxJob`/`…JobStatusView` imports; import `pollJob`. Keep the `useState` status/error + the catch/rethrow wrapper (identical). Replace the submit+poll body. Preserve the exact per-hook messages.

  **useGenerateTopicJob** — `run` body:
```ts
setError(null); setStatus("generating");
try {
  const submitted = await generateTopicApi(args.projectId, args.topicId, { api_key: args.apiKey, provider_id: args.providerId ?? "anthropic", guidance: args.guidance }, args.accessToken);
  const result = await pollJob<TopicGenerateJobResult>(submitted.job_id, args.accessToken, { intervalMs, timeoutMessage: "Timed out waiting for generation", failedMessage: "Generation failed", onPhase: args.onPhase });
  setStatus("done");
  return result;
} catch (err) {
  const message = err instanceof ApiError ? err.userMessage() : err instanceof Error ? err.message : "Generation failed";
  setStatus("failed"); setError(message);
  throw err instanceof Error ? err : new Error(message);
}
```
  **useSuggestTocJob** — same shape: `pollJob<SuggestTocJobResult>(..., { intervalMs, timeoutMessage: "Timed out waiting for the outline", failedMessage: "Couldn't suggest an outline", onPhase: args.onPhase })` → `setStatus("done"); return result.toc;` catch fallback `"Couldn't suggest an outline"`. (Define/keep `SuggestTocJobResult = { toc: StructuredTocView }` — export it from trustClient if not already, since it was the inline `SuggestTocJobStatusView.result` shape.)
  **useGenerateVersionJob** — `pollJob<GenerateVersionJobResult>(..., { intervalMs, timeoutMessage: "Timed out waiting for generation", failedMessage: "Draft generation failed", onPhase: args.onPhase })` → `setStatus("done"); return { id: result.version_id, artifact_id: result.artifact_id, version_no: result.version_no, created_at: null };` catch fallback `"Draft generation failed"`.

- [ ] **Step 2: Remove the dead getters/interfaces from `trustClient.ts`.** Delete `getJob`, `getSuggestTocJob`, `getGenerateVersionJob` and the `TopicGenerateJobStatusView`/`SuggestTocJobStatusView`/`GenerateVersionJobStatusView` interfaces. Keep/parametrize the `result` types: `TopicGenerateJobResult`, `SuggestTocJobResult` (`{ toc: StructuredTocView }`), `GenerateVersionJobResult` (`{ version_id; artifact_id; version_no }`) — export each (the hooks import them for the `pollJob<R>` type arg). `grep -rn "getSuggestTocJob\|getGenerateVersionJob\|getJob\b\|JobStatusView" mobile/` to confirm no remaining consumer outside the hooks/tests; update any test that imported a removed getter (a `trustClient` unit test may — rewrite it to test `pollJob` behavior instead, or drop it if `pollJob`'s own test now covers it).

- [ ] **Step 3: Run the full gates** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. **All existing hook + screen tests must pass unchanged** (behavior proof). If a hook test fails only because it mocked `getJob`/`getSuggestTocJob`/`getGenerateVersionJob` by name, update it to mock `global.fetch` (what `pollJob` uses) or to mock the submit + drive `run` — the observable `run` behavior is unchanged, so the assertions on `run`'s resolved value / thrown message / `onPhase` stay identical.

- [ ] **Step 4: Confirm line reduction** — each hook is now ~40 lines (was 101–115); the 3 `pollXxxJob` loops + 3 getters are gone.

- [ ] **Step 5: Commit**
```bash
git add mobile/src/hooks/useGenerateTopicJob.ts mobile/src/hooks/useSuggestTocJob.ts mobile/src/hooks/useGenerateVersionJob.ts mobile/src/api/trustClient.ts mobile/__tests__
git commit -m "refactor(trust): the 3 job hooks poll via shared pollJob<R>; drop the duplicated loops + getters"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — all green, existing generate/suggest/revise tests unchanged.
- [ ] `grep -rn "pollTopicJob\|pollSuggestJob\|pollGenerateVersionJob\|getSuggestTocJob\|getGenerateVersionJob" mobile/src` → no hits (all collapsed).
- [ ] Behavior spot-check via the diff: per-hook timeout/fallback messages preserved; `onPhase` queued/running-only; return shapes unchanged.
- [ ] **Deploy:** mobile **web deploy** to keep prod == main. No backend refresh, no migration (pure refactor).

## Out of scope

- `client.ts`'s `pollExportJob` (20-min) / `pollUntilDone` (main `/generate`+`/structure`) — different contract; a possible later fold. Backend. The dead `TocSuggestOut` schema (separate cleanup).
