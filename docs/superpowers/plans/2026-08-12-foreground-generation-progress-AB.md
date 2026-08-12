# Foreground generation progress (A+B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tiny inline `…` busy glyph on on-demand (foreground) generation with an animated indeterminate progress bar + live elapsed timer + an honest phase label (Waiting → Generating).

**Architecture:** A pure presentational `GenerateProgressBar` + a `useElapsedMs` hook drive the UI from per-generation state the callers already own. The two async surfaces (per-topic Generate/Regenerate, topic-viewer Revise) additionally read the job phase — enabled by the trust Celery task writing a `running` status it does not write today. Whole-book cards (synchronous) show the bar with phase pinned to `running`.

**Tech Stack:** React Native (Expo), RN `Animated` + `AccessibilityInfo` (reduced-motion), `@/theme` `useThemedStyles`; FastAPI + Celery + Redis job-status; Jest + RNTL; pytest + fakeredis.

## Global Constraints

- **Scope = the on-screen wait ONLY.** Do NOT build any persistent/cross-screen/background progress, global job store, header chip, jobs tray, or FCM/push — that is a separate later design. On navigate-away the indicator vanishes by design.
- **The bar is INDETERMINATE (animated), never a percentage** — one LLM call, no progress fraction; a 0→100% bar would be fake.
- **ADR-001:** the new `running` status write carries no api key; extend the no-key-in-status assertion. The worker key discipline (envelope + shred + `worker_process_init` redaction) is untouched.
- **Phase granularity = `queued` → `running` only.** No "Validating / Retry n/3" (no seam today).
- **Reduced-motion:** no infinite animation when reduce-motion is enabled — render a static bar.
- No color-literal asserts in tests. `Alert` from `@/lib/alert`. Theme via `useThemedStyles`/tokens.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Backend — write a `running` status when the topic task starts

**Files:**
- Modify: `backend/src/trust/tasks.py` (insert one status write before the `generate_topic_draft` call)
- Test: `backend/tests/test_trust_topic_task.py` (add a running-before-done ordering test)

**Interfaces:**
- Consumes: existing `_write_status(r, job_id, status, *, error=, result=, ...)` from `backend/src/generate/tasks.py`.
- Produces: the job status transitions `queued` (router, at submit) → `running` (task start) → `done|failed`. `TopicGenerateJobStatusView.status` already includes `"running"` — no schema change.

- [ ] **Step 1: Write the failing test** — add to `backend/tests/test_trust_topic_task.py`. It spies on `_write_status` to capture the status sequence the task emits, asserting `running` is written before `done` on the success path, and the `running` write carries no key. Mirror the existing success-path test's fixtures (`conn`, `fake_redis`, `_patch_redis_client`, `fake_provider`, `_MASTER_KEY`, `_API_KEY`, `_GOOD`) and how it seeds a project/topic + BYOK envelope.

```python
async def test_task_writes_running_before_done(conn, fake_redis, monkeypatch):
    # Seed a project + a topic with a source, exactly like the success-path
    # test in this file (reuse its helper/inline setup for project_repo +
    # topic + a project_input + the BYOK envelope at _byok_redis_key(job_id)).
    project_id, topic_id, job_id = await _seed_topic_job(conn, fake_redis)  # same setup the success test uses

    seq: list[tuple[str, str]] = []
    orig = trust_tasks._write_status

    async def spy(r, jid, status, **kw):
        # capture (status, serialized-payload) so we can assert order + no key
        import json as _json
        seq.append((status, _json.dumps({"status": status, **{k: v for k, v in kw.items() if v is not None}})))
        return await orig(r, jid, status, **kw)

    monkeypatch.setattr(trust_tasks, "_write_status", spy)

    with patch.object(trust_tasks, "make_provider", return_value=fake_provider(_GOOD)):  # match the success test's provider patch
        await trust_tasks._run(job_id=str(job_id), project_id=str(project_id), topic_id=topic_id,
                               provider_id="anthropic", model=None, guidance=None, managed=False,
                               recorded_by_sub="owner-sub")

    statuses = [s for s, _ in seq]
    assert "running" in statuses and "done" in statuses
    assert statuses.index("running") < statuses.index("done")
    # ADR-001: the running payload never carries the key
    running_payload = next(p for s, p in seq if s == "running")
    assert _API_KEY not in running_payload
```

Note: use the SAME project/topic/envelope setup and the SAME provider-patch mechanism the existing success test (`test_...creates a topic_version...`) uses — read that test and copy its seeding verbatim rather than inventing `_seed_topic_job`/`make_provider` names if they differ.

- [ ] **Step 2: Run it to confirm it fails** — `cd backend && DATABASE_URL=$DATABASE_URL python -m pytest tests/test_trust_topic_task.py::test_task_writes_running_before_done -q`. Expected: FAIL (`"running" not in statuses` — the task never writes it today).

- [ ] **Step 3: Insert the `running` write** in `backend/src/trust/tasks.py::_run`, immediately after the "no sources" guard and before the generation call (currently ~lines 146–148):

```python
            if not sources:
                await _write_status(r, job_id, "failed", error="no sources for this topic")
                return

            resolved_model = model or settings.anthropic_default_model
            await _write_status(r, job_id, "running")   # phase: queued -> running (foreground progress)
            try:
                out = await asyncio.to_thread(
                    generate_topic_draft,
                    ...
```

- [ ] **Step 4: Run the test to confirm it passes** + the existing no-key + success tests still pass — `python -m pytest tests/test_trust_topic_task.py -q`. Expected: PASS.

- [ ] **Step 5: Lint** — `ruff check backend && ruff format --check backend`. Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add backend/src/trust/tasks.py backend/tests/test_trust_topic_task.py
git commit -m "feat(trust): write a 'running' job status when per-topic generation starts"
```

---

### Task 2: Mobile — `useElapsedMs` hook + `GenerateProgressBar` component

**Files:**
- Create: `mobile/src/hooks/useElapsedMs.ts`
- Create: `mobile/src/components/GenerateProgressBar.tsx`
- Test: `mobile/__tests__/components/GenerateProgressBar.test.tsx`, `mobile/__tests__/hooks/useElapsedMs.test.ts`

**Interfaces:**
- Produces:
  - `useElapsedMs(startedAt: number | null): number` — ms since `startedAt`, ~1s tick, `0` when null.
  - `GenerateProgressBar(props: { phase: "queued" | "running"; elapsedMs: number; etaHint?: string }): JSX.Element` — pure presentational.

- [ ] **Step 1: Write the failing hook test** — `mobile/__tests__/hooks/useElapsedMs.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react-native";
import { useElapsedMs } from "@/hooks/useElapsedMs";

jest.useFakeTimers();

it("returns 0 when startedAt is null and ticks up while set", () => {
  const t0 = 10_000;
  jest.setSystemTime(t0);
  const { result, rerender } = renderHook(({ s }: { s: number | null }) => useElapsedMs(s), {
    initialProps: { s: null as number | null },
  });
  expect(result.current).toBe(0);
  rerender({ s: t0 });
  act(() => { jest.setSystemTime(t0 + 2_000); jest.advanceTimersByTime(2_000); });
  expect(result.current).toBeGreaterThanOrEqual(2_000);
  rerender({ s: null });
  expect(result.current).toBe(0);
});
```

- [ ] **Step 2: Run it — FAIL** (`Cannot find module '@/hooks/useElapsedMs'`).

- [ ] **Step 3: Implement `useElapsedMs.ts`:**

```ts
import { useEffect, useRef, useState } from "react";

// Milliseconds since `startedAt`, updated ~1s. Returns 0 when startedAt is null.
// One instance per visible progress indicator; clears its interval on
// null/unmount so a finished generation stops ticking.
export function useElapsedMs(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (startedAt === null) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    setNow(Date.now());
    timer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  }, [startedAt]);

  return startedAt === null ? 0 : Math.max(0, now - startedAt);
}
```

- [ ] **Step 4: Run the hook test — PASS.**

- [ ] **Step 5: Write the failing component test** — `mobile/__tests__/components/GenerateProgressBar.test.tsx`:

```tsx
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { GenerateProgressBar } from "@/components/GenerateProgressBar";

it("shows a waiting label while queued", () => {
  render(<GenerateProgressBar phase="queued" elapsedMs={5_000} />);
  expect(screen.getByText(/waiting/i)).toBeTruthy();
});

it("shows generating + m:ss + eta while running", () => {
  render(<GenerateProgressBar phase="running" elapsedMs={47_000} etaHint="usually 1–3 min" />);
  expect(screen.getByText(/generating/i)).toBeTruthy();
  expect(screen.getByText(/0:47/)).toBeTruthy();
  expect(screen.getByText(/usually 1–3 min/i)).toBeTruthy();
});

it("exposes a progressbar role for a11y", () => {
  render(<GenerateProgressBar phase="running" elapsedMs={1_000} />);
  expect(screen.getByRole("progressbar")).toBeTruthy();
});

it("renders a static bar when reduce-motion is enabled (no crash, still labelled)", async () => {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
  render(<GenerateProgressBar phase="running" elapsedMs={1_000} />);
  expect(await screen.findByText(/generating/i)).toBeTruthy();
});
```

- [ ] **Step 6: Run it — FAIL** (module missing).

- [ ] **Step 7: Implement `GenerateProgressBar.tsx`** — pure presentational; loops an `Animated.Value` for the indeterminate fill, gated on reduce-motion; theme via `useThemedStyles`.

```tsx
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Text, View } from "react-native";
import { useThemedStyles, type Theme } from "@/theme";

function mmss(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function GenerateProgressBar({
  phase, elapsedMs, etaHint = "usually 1–3 min",
}: { phase: "queued" | "running"; elapsedMs: number; etaHint?: string }): JSX.Element {
  const styles = useThemedStyles(makeStyles);
  const [reduceMotion, setReduceMotion] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => active && setReduceMotion(r));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(anim, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, anim]);

  const label =
    phase === "queued"
      ? `Waiting for a slot… ${mmss(elapsedMs)}`
      : `Generating… ${mmss(elapsedMs)} · ${etaHint}`;

  // Indeterminate: a partial fill sliding across the track (translateX).
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: ["-40%", "160%"] });

  return (
    <View accessibilityRole="progressbar" accessibilityState={{ busy: true }} accessibilityLabel={label}>
      <View style={styles.track}>
        {reduceMotion ? (
          <View style={styles.staticFill} />
        ) : (
          <Animated.View style={[styles.slidingFill, { transform: [{ translateX }] }]} />
        )}
      </View>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) => ({
  track: { height: 4, borderRadius: 2, backgroundColor: t.border, overflow: "hidden" as const, marginTop: 8 },
  slidingFill: { height: 4, width: "40%" as const, borderRadius: 2, backgroundColor: t.primary },
  staticFill: { height: 4, width: "100%" as const, borderRadius: 2, backgroundColor: t.primary, opacity: 0.5 },
  label: { marginTop: 4, fontSize: 12, color: t.textMuted },
});
```

(If `Theme`'s token names differ — e.g. `t.textMuted`/`t.border`/`t.primary` — read `mobile/src/theme` and use the actual token names; do NOT introduce color literals.)

- [ ] **Step 8: Run the component test — PASS.** Then `npx tsc --noEmit`.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/hooks/useElapsedMs.ts mobile/src/components/GenerateProgressBar.tsx mobile/__tests__/hooks/useElapsedMs.test.ts mobile/__tests__/components/GenerateProgressBar.test.tsx
git commit -m "feat(trust): GenerateProgressBar (indeterminate bar + elapsed + phase) + useElapsedMs"
```

---

### Task 3: Mobile — wire the async surfaces (per-topic + Revise) with phase

**Files:**
- Modify: `mobile/src/hooks/useGenerateTopicJob.ts` (add `onPhase` callback)
- Modify: `mobile/src/hooks/useTrustProject.ts` (thread `onPhase` through `generateTopic`)
- Modify: `mobile/app/trust/[projectId].tsx` (per-topic: `busyTopicIds: Set` → `topicGen: Map`; render the bar)
- Modify: `mobile/app/trust/topic-version/[id].tsx` (Revise: `genBusy` boolean → `reviseGen` progress; render the bar)
- Test: `mobile/__tests__/screens/TrustProjectDetail.pertopic.test.tsx`, `mobile/__tests__/screens/TopicVersionViewer.revise.test.tsx`

**Interfaces:**
- Consumes: `GenerateProgressBar`, `useElapsedMs` (Task 2); `TopicGenerateJobStatusView.status` incl. `"running"` (Task 1).
- Produces:
  - `useGenerateTopicJob().run(args)` gains `args.onPhase?: (p: "queued" | "running") => void`, called from `pollTopicJob` each tick with the current `job.status` (only for `queued`/`running`).
  - `useTrustProject().generateTopic(topicId, opts?)` gains `opts.onPhase?: (p) => void`, forwarded into `run`.
  - Per-topic busy state becomes `Map<string, { startedAt: number; phase: "queued" | "running" }>` (preserves the #420 per-row gating: `disabled`/`isBusy = topicGen.has(id)`).

- [ ] **Step 1: `onPhase` in `useGenerateTopicJob.ts`.** Add `onPhase?: (p: "queued" | "running") => void` to `RunGenerateTopicArgs`; in `pollTopicJob`, add an `onPhase` param and call it with `job.status` when it is `"queued"` or `"running"` (before deciding to keep polling); pass `args.onPhase` from `run`:

```ts
// in pollTopicJob's tick(), after `const job = await getJob(...)`:
if (job.status === "queued" || job.status === "running") onPhase?.(job.status);
if (job.status === "done" || job.status === "failed") { resolve(job); }
else { setTimeout(tick, intervalMs); }
```
Thread `onPhase` from `run(args)` → `pollTopicJob(submitted.job_id, args.accessToken, intervalMs, args.onPhase)`. Seed the first phase optimistically as `"queued"` at submit (the caller sets it) — `onPhase` upgrades to `"running"` when the poll observes it.

- [ ] **Step 2: `generateTopic` forwards `onPhase` in `useTrustProject.ts`:**

```ts
const generateTopic = useCallback(async (topicId, opts?: { guidance?: string; onPhase?: (p: "queued" | "running") => void }) => {
  const key = await loadApiKey("anthropic");
  if (!key) throw new Error("No API key saved. Add an Anthropic key in Settings to generate.");
  if (!accessToken) throw new Error("Not signed in");
  const result = await runTopicGenJob({ projectId, topicId, apiKey: key, accessToken, guidance: opts?.guidance, onPhase: opts?.onPhase });
  await refresh();
  return { id: result.version_id, topic_id: result.topic_id, version_no: result.version_no, created_at: null };
}, [accessToken, projectId, refresh, runTopicGenJob]);
```

- [ ] **Step 3: Write the failing per-topic test** — extend `TrustProjectDetail.pertopic.test.tsx`: a generating topic shows the bar; while the mocked `generateTopic` is pending it shows "Waiting…", and once the mock invokes its `onPhase("running")` it shows "Generating…". Keep the #420 test (other topics stay enabled) intact.

```tsx
it("shows the progress bar and flips Waiting -> Generating via onPhase", async () => {
  const mock = base();
  let resolve!: (v: { id: string }) => void;
  let phaseCb: ((p: "queued" | "running") => void) | undefined;
  mock.generateTopic = jest.fn().mockImplementation((_id: string, opts?: { onPhase?: (p: "queued" | "running") => void }) => {
    phaseCb = opts?.onPhase;
    return new Promise<{ id: string }>((r) => { resolve = r; });
  });
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  fireEvent.press(await screen.findByLabelText("Per topic"));
  fireEvent.press(await screen.findByLabelText("Generate Topic Two"));

  expect(await screen.findByText(/waiting/i)).toBeTruthy();     // queued
  act(() => phaseCb?.("running"));
  expect(await screen.findByText(/generating/i)).toBeTruthy();  // running
  act(() => resolve({ id: "tv2" }));
});
```

- [ ] **Step 4: Run it — FAIL** (no bar yet / no onPhase wiring).

- [ ] **Step 5: Wire per-topic in `[projectId].tsx`.** Replace `busyTopicIds: Set<string>` with a Map:

```ts
type GenProgress = { startedAt: number; phase: "queued" | "running" };
const [topicGen, setTopicGen] = useState<ReadonlyMap<string, GenProgress>>(new Map());

const onGenerateTopic = async (topicId: string) => {
  setTopicGen((cur) => new Map(cur).set(topicId, { startedAt: Date.now(), phase: "queued" }));
  try {
    await generateTopic(topicId, {
      onPhase: (phase) => setTopicGen((cur) => {
        const p = cur.get(topicId); if (!p) return cur;
        const next = new Map(cur); next.set(topicId, { ...p, phase }); return next;
      }),
    });
  } catch (e) {
    Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
  } finally {
    setTopicGen((cur) => { const next = new Map(cur); next.delete(topicId); return next; });
  }
};
```
Pass `topicGen` into `DraftsPanel` (replace the `busyTopicIds` prop). In DraftsPanel: `const prog = topicGen.get(unit.id); const isBusy = prog !== undefined;` keep `busy={isBusy}` `disabled={isBusy}` on the Button, and when `prog` render the bar under the row:

```tsx
{prog ? <TopicRowProgress startedAt={prog.startedAt} phase={prog.phase} /> : null}
```
where `TopicRowProgress` is a tiny local wrapper that calls `useElapsedMs(startedAt)` and renders `<GenerateProgressBar phase={phase} elapsedMs={elapsed} />` (a wrapper is needed because `useElapsedMs` is a hook and cannot be called inside the `.map`). Define it at module scope in `[projectId].tsx` (or a small file).

- [ ] **Step 6: Run per-topic test — PASS**; the #420 regression test still passes.

- [ ] **Step 7: Wire Revise in `topic-version/[id].tsx`.** Replace `const [genBusy, setGenBusy] = useState(false)` with `const [reviseGen, setReviseGen] = useState<GenProgress | null>(null)`. In `doRegen`: set `{ startedAt: Date.now(), phase: "queued" }` on start, pass `onPhase: (phase) => setReviseGen((p) => p ? { ...p, phase } : p)`, clear to `null` in `finally`. Anywhere `genBusy` gated UI (button busy/disabled), use `reviseGen !== null`. Render `<GenerateProgressBar phase={reviseGen.phase} elapsedMs={useElapsedMs(reviseGen?.startedAt ?? null)} />` in the Revise section (call `useElapsedMs` unconditionally at component top with `reviseGen?.startedAt ?? null`, then render the bar when `reviseGen`).

- [ ] **Step 8: Revise test** — extend `TopicVersionViewer.revise.test.tsx`: pressing Generate-new-version shows the bar (Waiting), `onPhase("running")` flips it to Generating; on resolve it navigates (existing assertion). Keep the existing revise + failed-message tests green.

- [ ] **Step 9: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add mobile/src/hooks/useGenerateTopicJob.ts mobile/src/hooks/useTrustProject.ts mobile/app/trust/[projectId].tsx mobile/app/trust/topic-version/[id].tsx mobile/__tests__/screens/TrustProjectDetail.pertopic.test.tsx mobile/__tests__/screens/TopicVersionViewer.revise.test.tsx
git commit -m "feat(trust): async per-topic + Revise show the progress bar with Waiting->Generating phase"
```

---

### Task 4: Mobile — wire the whole-book draft cards (sync, phase = running)

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (whole-book: `genBusyFormat` → `formatGen: Map`; render the bar in the busy card)
- Test: `mobile/__tests__/screens/TrustProjectDetail.publish.test.tsx` or the existing whole-book generate test (find the one that presses "Start a new … draft")

**Interfaces:**
- Consumes: `GenerateProgressBar`, `useElapsedMs`, the `TopicRowProgress` wrapper (or an equivalent) from Task 3.
- `generateFormat` is synchronous (`generateVersion` blocking POST) → phase is always `"running"` (no queued, no poll).

- [ ] **Step 1: Write the failing test** — find the existing test that presses a whole-book draft card (`Start a new … draft`) and add: while `generateFormat` is pending, the card shows the bar with "Generating…". Use a never-resolving mock like the #420 test.

```tsx
it("shows the progress bar on a whole-book draft card while generating", async () => {
  const mock = base();
  mock.generateFormat = jest.fn().mockImplementation(() => new Promise(() => {}));  // pending
  (useTrustProject as jest.Mock).mockReturnValue(mock);
  render(<TrustProjectDetail />);
  fireEvent.press(await screen.findByLabelText(/Drafts:/));
  // whole-book is the default mode; press the first draft-format card
  fireEvent.press(await screen.findByLabelText(/Start a new .* draft/));
  expect(await screen.findByText(/generating/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run it — FAIL.**

- [ ] **Step 3: Replace `genBusyFormat`** in `[projectId].tsx`:

```ts
const [formatGen, setFormatGen] = useState<ReadonlyMap<string, number>>(new Map());  // format -> startedAt

const onGenerateFormat = async (fmt: DraftFormat) => {
  setFormatGen((cur) => new Map(cur).set(fmt.format, Date.now()));
  try {
    await generateFormat(fmt);
  } catch (e) {
    Alert.alert("Couldn't generate", e instanceof ApiError ? e.userMessage() : e instanceof Error ? e.message : "Try again.");
  } finally {
    setFormatGen((cur) => { const next = new Map(cur); next.delete(fmt.format); return next; });
  }
};
```
In the whole-book card map: `const startedAt = formatGen.get(f.format); const busy = startedAt !== undefined;` gate `disabled = busy || inputs.length === 0`, keep the `+`/`…` glyph, and when `busy` render `<TopicRowProgress startedAt={startedAt} phase="running" />` inside the card. (Pass `formatGen` into `DraftsPanel`, replacing the `genBusyFormat` prop; update its type + the whole-book render block.)

- [ ] **Step 4: Run the test — PASS.**

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add mobile/app/trust/[projectId].tsx mobile/__tests__/screens/TrustProjectDetail.publish.test.tsx
git commit -m "feat(trust): whole-book draft cards show the progress bar while generating"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_trust_topic_task.py -q` (DB-gated in CI); `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] **Security:** the new `running` status write carries no key (Task 1 test); the worker key discipline is untouched (grep the diff — no new key-bearing log/persist).
- [ ] **Manual/visual (optional):** the local web-verify recipe (dev-token + status="signed_in" patch + stub answering the project + `/jobs/{id}` with `queued`→`running`→`done`) to eyeball the bar + label flip. Not required to merge.
- [ ] **Deploy:** mobile **web deploy** + a **backend refresh** (the `running` write). **No migration.** Ship backend first/together so the phase label has data; older mobile ignores `running` (forward-compatible).

## Out of scope (later)

- Persistent/background/cross-screen progress; global job store; header chip; jobs tray; FCM/push (the separate async-notification design).
- Real percentage / token streaming / "Validating / Retry n/3" phases.
- Whole-book async (Phase C) — whole-book stays synchronous here (bar = `running` only).
