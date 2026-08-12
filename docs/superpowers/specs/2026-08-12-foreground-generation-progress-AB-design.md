# Foreground generation progress (A+B) — Design

**Status:** Approved (brainstorming, 2026-08-12). A more-visible, honest progress indicator for
**on-demand / foreground** content generation — the case where the user clicks **Generate / Regenerate /
Revise** and **waits on the screen**. Replaces the tiny inline `…` busy glyph with an animated
indeterminate bar + a live elapsed timer + a truthful phase label.

## Scope boundary (important)

This pass covers **the on-screen wait only**. When the user stays on the screen watching a generation
finish, they see the rich indicator. The moment they **navigate away**, the inline indicator is gone by
design — a **persistent / background / push** progress surface for truly-async (fire-and-forget)
generation is a **separate, later design** (option C / D from the analysis), explicitly **out of scope
here**. Do not build a global job store, a cross-screen banner, FCM, or a jobs tray in this pass.

## Problem

Foreground generation today shows only a `…` on the pressed button and (before #420) greyed the rest.
Users can't tell whether anything is happening, how long it's taking, or whether the job is even running
yet vs waiting for a worker. The user asked for "something more visible than an hourglass — a
progress-bar-like notification."

## The load-bearing constraint (why the bar is INDETERMINATE, not a percentage)

A generation is **one Anthropic call** plus up to `_MAX_REPAIRS` schema-repair retries, all inside a
single blocking `generate_validated(...)` call. There is **no token stream and no progress fraction** —
so a literal 0→100% bar would be **fake**. The honest, more-visible design is an **indeterminate
(animated) bar** + **client-side elapsed time** + a **known ETA range** ("usually 1–3 min", from the
latency-probe: generation runs 1–3 minutes) + a **phase label** driven by the real job status.

## Transports in scope (they differ — the design accommodates both)

| Surface | Transport | Indicator |
|---|---|---|
| Per-topic **Generate / Regenerate** (`[projectId].tsx` DraftsPanel) | **async job** (Phase A: submit 202 + poll `/jobs/{id}`) | full **A+B** — animated bar + elapsed + **Queued → Generating** |
| Topic-viewer **Revise** (`topic-version/[id].tsx` `doRegen`) | **async job** (same `generateTopic` path) | full **A+B** |
| Whole-book **draft cards** (`[projectId].tsx` `generateFormat` → `generateVersion`) | **synchronous** blocking POST (Phase C not done) | **A only** — animated bar + elapsed; phase pinned to **Generating** (no Queued; no job status to read) |

The **animated bar + elapsed timer (A)** is purely client-side and works for any transport. The **phase
label (B: Queued vs Generating)** requires the async job status, so it applies only to the two async
surfaces.

## Locked decisions

1. **Indeterminate animated bar, never a fake %.** Loops continuously; respects reduced-motion (static
   striped bar, no loop, when reduce-motion is on).
2. **Live elapsed timer** from the click, ticking ~1 s, plus a static ETA hint "usually 1–3 min".
3. **Backend writes `running` (B).** The trust Celery task currently jumps `queued → done`; it must write
   `_write_status(r, job_id, "running")` immediately before invoking `generate_topic_draft`, so the poll
   can distinguish **Waiting for a slot… (queued)** from **Generating… (running)**. This matters under
   worker contention (concurrency=2 → a 3rd job sits queued). No key in the status (ADR-001 unchanged).
4. **Phase granularity = Queued → Generating only.** "Validating / Retry 2/3" is NOT surfaced — the
   repair loop is buried inside `generate_validated` with no callback seam. Deferred.
5. **Failure/timeout unchanged.** The existing call-site `Alert` (with the real `job.error`, per #420)
   still fires; the bar simply clears on `done`/`failed`. No new error UI.
6. **On navigate-away the indicator vanishes** (no persistence). The separate async-notification design
   handles that case later.

## Architecture

### Backend (B) — one status write
- `backend/src/trust/tasks.py::_run`: add `await _write_status(r, job_id, "running")` right before the
  `generate_topic_draft` call (after the topic/sources are resolved and the "no sources" guard, so a
  fast-failing job never flips to `running`). The `TopicGenerateJobStatusView.status` union already
  includes `"running"`; no schema change. Idempotency (the `done` short-circuit) is unaffected.
- **Test:** the task writes a `running` status before `done` on the success path; the `running` status
  payload contains no api key (extend the existing no-key-in-status assertions).

### Mobile — progress model (A)
Today the busy state is a bare `Set<string>` (`busyTopicIds`, from #420). Generalize per in-flight
generation to carry a start time and a phase:

```ts
type GenPhase = "queued" | "running";
interface GenProgress { startedAt: number; phase: GenPhase; }
```

- **Per-topic (`[projectId].tsx`):** replace `busyTopicIds: Set<string>` with
  `topicGen: Map<string, GenProgress>` keyed by topicId. `onGenerateTopic` seeds
  `{ startedAt: Date.now(), phase: "queued" }` on submit and deletes the key in `finally`.
  `disabled`/`isBusy` become `topicGen.has(unit.id)` (preserves the #420 per-row fix).
- **Phase updates (async):** `useGenerateTopicJob.run()` gains an optional `onPhase?: (p: GenPhase) => void`.
  `pollTopicJob` already reads `job.status` every tick — when it sees `"running"` (or still `"queued"`),
  it forwards it via `onPhase`. `onGenerateTopic` updates that topic's `GenProgress.phase`.
  (Hermes/RN has no `Date.now` issue here — this is app runtime, not a workflow script.)
- **Whole-book (`[projectId].tsx`):** `generateFormat` is a single synchronous `await` — track a
  `formatGen: Map<string, GenProgress>` keyed by `f.format`, seeded `{ startedAt, phase: "running" }`
  (no queued phase, no poll), cleared in `finally`. `genBusyFormat` (existing) can be derived from
  `formatGen.size`/keys or replaced by it.
- **Revise (`topic-version/[id].tsx`):** a single generation at a time — track
  `reviseGen: GenProgress | null` (seed `{ startedAt, phase: "queued" }`, update via `onPhase`, clear in
  `finally`). Replaces the bare `genBusy` boolean.
- **Elapsed:** a small `useElapsedMs(startedAt: number | null): number` hook — sets an interval (~1000 ms)
  while `startedAt` is non-null, returns `Date.now() - startedAt`, clears on null/unmount. One instance
  per visible indicator.

### Component (A) — one presentational bar
`mobile/src/components/GenerateProgressBar.tsx`:
```ts
export function GenerateProgressBar(props: {
  phase: "queued" | "running";
  elapsedMs: number;
  etaHint?: string;        // default "usually 1–3 min"
}): JSX.Element
```
- **Animated indeterminate bar:** an `Animated.Value` looping a transl/scale on the fill; respect
  reduce-motion via `AccessibilityInfo.isReduceMotionEnabled()` (or `useReducedMotion` if already used in
  the repo) → render a **static striped bar** and skip the loop.
- **Status line:** `phase === "queued" ? "Waiting for a slot…" : "Generating…"` + `" " + mmss(elapsedMs)`
  + (running only) `" · " + etaHint`. `mmss` formats `0:47` / `1:12`.
- **Theming:** use `useThemedStyles`/theme tokens like the rest of the trust UI; **no color literals**.
- **a11y:** `accessibilityRole="progressbar"`, `accessibilityState={{ busy: true }}`, an
  `accessibilityLabel` carrying the same status text so screen readers announce progress.
- Pure/presentational — all timing state lives in the callers; the component just renders `phase` +
  `elapsedMs`.

### Wiring
- **Per-topic row:** when `topicGen.has(unit.id)`, render `<GenerateProgressBar phase elapsedMs />` in
  place of (or beneath) the busy button; the button stays `busy`/`disabled` for that row only.
- **Whole-book card:** when `formatGen.has(f.format)`, render the bar in the card (phase always
  `running`).
- **Revise:** when `reviseGen`, render the bar in the Revise section.

## Testing

- **Component** (`GenerateProgressBar`): renders "Waiting for a slot…" for `queued` and "Generating… ·
  usually 1–3 min" for `running`; formats elapsed as `m:ss`; reduced-motion path renders the static bar
  (mock `AccessibilityInfo.isReduceMotionEnabled` → true) without the animation loop. No color-literal
  asserts.
- **Per-topic async** (`TrustProjectDetail.pertopic`): a generating topic shows the bar; a poll that
  reports `queued` then `running` flips the label Waiting → Generating; on `done` the bar clears and the
  row refreshes. The #420 regression (other topics stay enabled) still holds with the `Map`.
- **Whole-book:** pressing a draft card shows the bar with phase `running` (no Waiting phase); clears on
  resolve.
- **Revise:** `doRegen` shows the bar; clears on navigate/replace.
- **Backend** (`tasks`): the task writes a `running` status before the `done` status on success; the
  `running` payload contains no api key. Fast-fail paths (no sources / project missing) never write
  `running`.

## Decomposition (SDD)

- **T1 — Backend `running` write** (`trust/tasks.py` + test). Small; enables the phase label. Ships/needs
  a backend refresh but is inert until the mobile side reads it.
- **T2 — `GenerateProgressBar` component + `useElapsedMs` hook** (+ component/hook tests). Pure UI, no
  wiring yet.
- **T3 — Per-topic + Revise wiring** (async surfaces): generalize `busyTopicIds → topicGen Map`, add
  `onPhase` to `useGenerateTopicJob`/`run`, thread phase, render the bar on the row and in the viewer.
  Tests incl. the queued→running label flip and the #420 per-row regression.
- **T4 — Whole-book card wiring** (sync surface): `formatGen` Map, render the bar (phase `running`).
  Tests.

## Rollout

**Mobile web deploy + a backend refresh** (the `running` write). **No migration.** The backend change is
backward-compatible (older mobile ignores `running`; the union already allows it), so ordering is
flexible, but ship the backend first (or together) so the phase label has data.

## Out of scope (explicitly)

- Persistent / cross-screen / background progress; a global job store; a "generating" header chip or
  jobs tray; FCM/push on completion — the **separate async-notification design** (later).
- A real percentage / progress fraction, token streaming, or "Validating / Retry n/3" phases (no seam
  today).
- Whole-book async conversion (Phase C) — unrelated; whole-book stays synchronous here, bar = `running`
  only.

## Global constraints

- **ADR-001:** the `running` status write carries no api key; extend the no-key-in-status test. The key
  discipline in the worker (envelope + shred, `worker_process_init` redaction backstop) is untouched.
- **No color-literal asserts** in tests; `Alert` from `@/lib/alert`; theme via `useThemedStyles`/tokens.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Respect reduced-motion (no infinite animation when reduce-motion is on).
