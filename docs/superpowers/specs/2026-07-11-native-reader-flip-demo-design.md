# Native web reader — D1 flag flip (demo first)

**Status:** Design approved 2026-07-11.
**Scope:** enable the native web reader on the **read-only demo** surface (`/demos/mentible`)
only. The full-app flip (`/app/mentible`) and any broader rollout are a separate follow-up PR.

## Background

The native web reader (real-DOM rendering, whole-page selection, find-in-page, KaTeX/Mermaid,
and the interactive quiz) is built, reviewed, and merged to `main`, dormant behind
`EXPO_PUBLIC_NATIVE_READER`, which is currently set **nowhere**. All four fast-follows that
gated the flip are resolved (mermaid-XSS test, code-split measurement → issue #287, DOMParser
security assertion, interactive quiz reveal). This is the D1 "flip", staged demo-first.

Two facts that shape the design:

- **Zero bundle delta.** `LessonRenderer` statically imports `NativeTopicReader`, so the reader
  code + Mermaid are already in the deployed bundle at `main`. The flag only selects *which
  renderer executes*; flipping neither adds nor removes bytes. Issue #287's ~1.27 MB Mermaid
  core is already paid today and is orthogonal to this flip.
- **The flag is build-time.** `readerFlag.ts` reads
  `process.env["EXPO_PUBLIC_NATIVE_READER"] === "1"` (bracket notation). The whole codebase
  reads `EXPO_PUBLIC_*` this way (`IS_DEMO`, `SUPABASE_URL`, `API_BASE_URL`), and those are all
  live in the deployed demo/app — so Expo SDK 53's Metro inlines bracket notation and the flag
  will take effect. `__tests__/reader/readerFlag.test.ts` already unit-proves the logic.

## Decisions

- **Demo surface only** this PR. The demo is read-only / no-account, so the interactive quiz
  (pure client-side DOM interaction, no backend) works fully and showcases well, at the lowest
  possible risk. Full-app flip follows after a live soak.
- **Help folded into the existing `reading-a-book` topic**, not a new `FEATURES` key. The
  coverage gate (`__tests__/help/coverage.test.ts`) requires every *key* to have a topic; it
  does not require a key per feature. Folding keeps the gate trivially green and documents the
  quiz where users read.
- **End-to-end verification before deploy.** A flip that silently no-ops would waste a deploy,
  so the plan builds the demo `dist` with the flag and confirms the native reader actually
  activates (0 iframes, `.mentible-reader` present, quiz buttons) before production is touched.

## 1. Deploy script (`scripts/deploy/web-deploy.sh`)

In the demo branch of the env block only (the `if [ -n "$DEMO_FLAG" ]` arm, which already sets
`EXPO_PUBLIC_DEMO_MODE=1`), add:

```sh
    export EXPO_PUBLIC_NATIVE_READER=1
```

The `else` (full-app) arm is **unchanged** — the app keeps the iframe reader until its own
follow-up PR. A one-line comment notes that this is the demo-first D1 flip and the app arm is
deliberately left off.

## 2. Help (`src/help-content/topics.ts`)

Add to the existing `reading-a-book` topic (`featureKey: "reading"`, id `reading-a-book`):
- a `text` (or `steps`) block describing the interactive quiz: tap an option to answer; it
  locks, marks your choice right/wrong, highlights the correct answer, and reveals the
  explanation;
- quiz-related `keywords` (`"quiz"`, `"question"`, `"answer"`, `"reveal"`, `"score"`).

No change to `src/help-content/features.ts`. The coverage gate stays green because no new key is
introduced.

## 3. Verification

- **Static gates:** `npm run typecheck`, `npm run lint`, `npm test` (full suite, including
  `readerFlag.test.ts` and the help coverage gate) all green.
- **End-to-end (the real proof the flip works):**
  1. Build the demo bundle exactly as the deploy script does, with the flag on:
     `EXPO_PUBLIC_DEMO_MODE=1 EXPO_PUBLIC_NATIVE_READER=1 npx expo export --platform web --clear`.
  2. Serve `dist/` and load it in headless Chrome (reuse the CDP-driver approach already in
     `mobile/security/`).
  3. Navigate to a bundled book's topic that contains a quiz, and assert: **0 `<iframe>`** in
     the document, a `.mentible-reader` element is present, and quiz options render as
     `<button class="quiz-opt">` that lock + reveal on a simulated click.
  - **Fallback** if driving the SPA to a specific topic proves brittle: a documented manual
    browser check performing the same three assertions, recorded in the PR.

## 4. Deploy (operational, post-merge)

`scripts/deploy/web-deploy.sh demo` builds from `origin/main` and publishes `/demos/mentible`.
Then confirm on the live demo: open a quiz topic → native reader (no iframe), quiz is
interactive. If anything regresses, redeploy the demo from a revert of this PR (instant, no
data implications — the demo is read-only).

## Non-goals

- **Full-app flip** (`/app/mentible`) — separate PR after the demo soak.
- **Runtime / per-user gating** — the flag is build-time and per-surface; there is no
  percentage rollout, and none is added here.
- **Bundle-size work** (#287) — orthogonal and already paid; not touched.
- **A new Help `FEATURES` key** for the quiz — deliberately avoided.

## Files

```
EDIT  scripts/deploy/web-deploy.sh        set EXPO_PUBLIC_NATIVE_READER=1 in the demo arm (§1)
EDIT  mobile/src/help-content/topics.ts   interactive-quiz block + keywords in reading-a-book (§2)
NEW?  mobile/security/ (or scripts/)      optional headless demo-reader check for §3 e2e proof
```
