# Trust job-poll dedup — Design

**Status:** Approved (brainstorming, 2026-08-13). A **behavior-preserving refactor** consolidating the
duplication the durable-async arc (Phases A/B/C) accrued: 3 near-identical mobile job-poll hooks + 3
copies of the `GET /jobs/{id}` fetch boilerplate → one generic `getJob<R>` + one shared `pollJob<R>`.

## Problem

`useGenerateTopicJob` (108 lines), `useSuggestTocJob` (101), and `useGenerateVersionJob` (115) each carry
an inner `pollXxxJob()` deadline loop that is byte-identical except for the getJob fn and the timeout
message, plus an imperative `run()` that is identical except for the submit call, the fallback message,
and the result→return mapping. Separately, `trustClient.ts` has three `getJob` functions
(`getJob`/`getSuggestTocJob`/`getGenerateVersionJob`) with identical fetch/ApiError bodies differing only
in return type, and three matching `…JobStatusView` interfaces. That's ~60 lines of poll loop + 3 fetch
copies duplicated three ways — the tracked follow-up from the async arc.

## Goal

One generic `getJob<R>` and one shared `pollJob<R>` that the three hooks call, dropping each hook from
~110 to ~40 lines — **with identical runtime behavior** (same interval, same 600s deadline, same
`onPhase` semantics, same per-hook timeout/fallback messages, same throw/rethrow contract). The existing
hook + screen tests are the behavior-preservation proof and must stay green.

## Scope boundary

**In:** the three TRUST job hooks + the three trust `getJob` copies/interfaces. **Out:** `client.ts`'s
`pollExportJob` (20-min export timeout) and `pollUntilDone` (main `/generate`+`/structure`) — a different
contract (timeouts, status shapes, non-trust flows). Folding those in is a possible later pass, noted, not
done here. No backend change.

## Architecture

### Generic status view + `getJob<R>` (trustClient.ts)
```ts
export interface JobStatusView<R> {
  status: "queued" | "running" | "done" | "failed";
  result?: R;
  error?: string;
}
export async function getJob<R>(jobId: string, token: string): Promise<JobStatusView<R>> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/jobs/${jobId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { const b = await res.text().catch(() => ""); throw new ApiError(res.status, b); }
  return res.json() as Promise<JobStatusView<R>>;
}
```
- The three result types stay: `TopicGenerateJobResult`, `SuggestTocJobResult = { toc: StructuredTocView }`,
  `GenerateVersionJobResult = { version_id; artifact_id; version_no }`. (Introduce named aliases where the
  old `…JobStatusView.result` shape was inline.)
- Remove `getSuggestTocJob`, `getGenerateVersionJob`, and the old non-generic `getJob`; remove the three
  `…JobStatusView` interfaces (callers use `JobStatusView<R>`). Keep the submit-body `…JobOut` types.

### Shared `pollJob<R>` (new `mobile/src/api/pollJob.ts`)
```ts
export interface PollJobOpts {
  intervalMs: number;
  timeoutMs?: number;          // default 600_000
  timeoutMessage: string;      // per-caller ("...generation" / "...the outline")
  failedMessage: string;       // per-caller fallback when job.error is absent
  onPhase?: (p: "queued" | "running") => void;
}
// Polls GET /jobs/{id} until done|failed or past the deadline. Resolves the job's
// `result` on done; throws Error(job.error ?? failedMessage) on failed OR a done
// with no result; rejects Error(timeoutMessage) past the deadline; rethrows a
// getJob/network error. onPhase fires only for queued/running.
export function pollJob<R>(jobId: string, token: string, opts: PollJobOpts): Promise<R>
```
Implementation = the existing `pollXxxJob` loop, generalized: `getJob<R>`, `onPhase(job.status)` for
queued/running, on `done` → `job.result ? resolve(job.result) : reject(new Error(job.error ?? failedMessage))`,
on `failed` → `reject(new Error(job.error ?? failedMessage))`, past deadline → `reject(new Error(timeoutMessage))`.

### The three hooks (thin)
Each `run()` keeps its `setStatus`/`setError` + the `ApiError → message` catch/rethrow wrapper, but the
inner `pollXxxJob` function is deleted and the body becomes: submit (unchanged) → `const result = await
pollJob<R>(submitted.job_id, args.accessToken, { intervalMs, timeoutMessage, failedMessage, onPhase })` →
`setStatus("done")` → map & return. Per hook:
- **topic:** `pollJob<TopicGenerateJobResult>(..., { timeoutMessage: "Timed out waiting for generation",
  failedMessage: "Generation failed" })` → `return result`.
- **suggest:** `pollJob<SuggestTocJobResult>(..., { timeoutMessage: "Timed out waiting for the outline",
  failedMessage: "Couldn't suggest an outline" })` → `return result.toc`.
- **version:** `pollJob<GenerateVersionJobResult>(..., { timeoutMessage: "Timed out waiting for generation",
  failedMessage: "Draft generation failed" })` → `return { id: result.version_id, artifact_id:
  result.artifact_id, version_no: result.version_no, created_at: null }`.
The catch's own `err instanceof Error ? err.message : <failedMessage>` fallback stays per-hook (same
string), so the rethrown-message behavior is byte-identical.

## Testing

- **`pollJob` unit tests** (new): queued→running→done resolves `result` and fires `onPhase` for both
  non-terminal states (not for done); `failed` throws `job.error`; `failed` with no error throws
  `failedMessage`; `done` with no `result` throws `job.error ?? failedMessage`; past the deadline throws
  `timeoutMessage`; a `getJob` reject propagates. Injectable `intervalMs`/`timeoutMs` (fake timers).
- **`getJob<R>` test:** hits `/api/v1/jobs/{id}`, returns the typed view, throws `ApiError` on non-ok.
- **The existing hook tests** (`useGenerateTopicJob`/`useSuggestTocJob`/`useGenerateVersionJob`) and all
  screen tests that exercise generate/suggest/revise **must stay green unchanged** — that is the
  behavior-preservation proof. If a hook test asserted the private `pollXxxJob` by name, rewrite it to the
  public `run` behavior (it shouldn't — they drive `run`).

## Decomposition (SDD)

- **T1 — `pollJob<R>` (additive, tree stays green):** add `mobile/src/api/pollJob.ts` — a **self-contained**
  `pollJob<R>(jobId, token, opts): Promise<R>` that fetches `GET /api/v1/jobs/{id}` itself (absorbing the
  `getJob` fetch/ApiError boilerplate — the 3 status-view interfaces collapse into an internal
  `JobStatusView<R>`) and runs the deadline loop. Nothing else changes → the 3 hooks + their getters are
  untouched, tree green. Unit tests for `pollJob`.
- **T2 — hooks + cleanup:** rewrite the three hooks onto `pollJob<R>` (delete the inner `pollXxxJob`
  functions); **remove** the now-unused `getJob`/`getSuggestTocJob`/`getGenerateVersionJob` + their 3
  `…JobStatusView` interfaces from `trustClient.ts` (grep-confirm no other consumer; update any test that
  imported them). Full `jest` + `tsc` + `eslint` green (the unchanged hook + screen tests are the
  behavior-preservation proof).

## Rollout

Pure refactor — no backend, no migration. **Mobile web deploy** to keep prod == main (no user-visible
change).

## Global constraints

- **Behavior-identical.** Same interval (3s), 600s deadline, `onPhase` queued/running-only, per-hook
  timeout/fallback messages, throw-on-failed/timeout, `ApiError.userMessage()` fidelity, rethrow contract.
  The existing hook + screen tests must pass unchanged.
- No color-literal asserts. `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
