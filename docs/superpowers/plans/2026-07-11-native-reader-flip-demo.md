# Native Web Reader — D1 Flag Flip (Demo First) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the native web reader (real-DOM rendering + interactive quiz) on the read-only demo surface (`/demos/mentible`) by setting `EXPO_PUBLIC_NATIVE_READER=1` in the deploy script's demo arm, and document the now-interactive quiz in Help.

**Architecture:** The flag is build-time (`readerFlag.ts` reads `process.env["EXPO_PUBLIC_NATIVE_READER"]`, inlined by Metro). The deploy script (`scripts/deploy/web-deploy.sh`) already sets `EXPO_PUBLIC_*` per surface; adding one export to its demo arm flips the demo only. The flag→renderer wiring is ALREADY fully tested (`__tests__/reader/readerFlag.test.ts` proves env=`"1"`+web → flag true; `__tests__/components/TopicRenderer.switch.test.tsx` proves flag true → NativeTopicReader with 0 iframe), so no new headless verification is needed — this supersedes spec §3's headless-build idea with the existing deterministic chain plus a build smoke and a post-deploy live check.

**Tech Stack:** Bash (deploy script), TypeScript, Expo SDK 53 / Metro, jest.

**Spec:** `docs/superpowers/specs/2026-07-11-native-reader-flip-demo-design.md`

## Global Constraints

- **Demo surface only.** Touch ONLY the demo arm (`if [ -n "$DEMO_FLAG" ]`) of `scripts/deploy/web-deploy.sh`. The `else` (full-app) arm MUST stay unchanged — the app keeps the iframe reader until its own follow-up PR.
- **No new `FEATURES` key.** Do not edit `mobile/src/help-content/features.ts`. Quiz docs fold into the existing `reading-a-book` topic so the coverage gate (`__tests__/help/coverage.test.ts`) stays green.
- **Zero code change to the reader itself.** The reader, flag, and switch are already merged and tested; this PR only sets an env var and adds Help copy.
- **Run tests from `mobile/`:** `cd mobile && npx jest <path>`.
- Commit trailer on every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

### Task 1: Enable the flag in the deploy script's demo arm

**Files:**
- Modify: `scripts/deploy/web-deploy.sh` (the demo arm, around lines 74-76)

**Interfaces:**
- Produces: the demo web build exports `EXPO_PUBLIC_NATIVE_READER=1`; the app build does not.

- [ ] **Step 1: Write the failing structural check**

Run this (from repo root) to confirm the flag is NOT yet in the demo arm:

```bash
awk '/if \[ -n "\$DEMO_FLAG" \]/{d=1} /^  else$/{d=0} d && /EXPO_PUBLIC_NATIVE_READER=1/{found=1} END{exit !found}' scripts/deploy/web-deploy.sh && echo "PRESENT" || echo "ABSENT"
```
Expected: `ABSENT`.

- [ ] **Step 2: Add the export to the demo arm.** In `scripts/deploy/web-deploy.sh`, replace:

```sh
    # Read-only demo: demo flag on, Supabase OFF (auth unavailable → no sign-in).
    export EXPO_PUBLIC_DEMO_MODE=1
```

with:

```sh
    # Read-only demo: demo flag on, Supabase OFF (auth unavailable → no sign-in).
    export EXPO_PUBLIC_DEMO_MODE=1
    # D1 flip (demo first, 2026-07-11): enable the native web reader on the demo
    # surface only. The full app keeps the iframe until its own follow-up PR. Web-only
    # by construction — readerFlag.ts also gates on Platform.OS === "web".
    export EXPO_PUBLIC_NATIVE_READER=1
```

- [ ] **Step 3: Verify the flag is in the demo arm and NOT the app arm**

Run (from repo root):

```bash
awk '/if \[ -n "\$DEMO_FLAG" \]/{d=1} /^  else$/{d=0} d && /EXPO_PUBLIC_NATIVE_READER=1/{found=1} END{exit !found}' scripts/deploy/web-deploy.sh && echo "IN_DEMO_ARM"
awk '/^  else$/{e=1} /^  fi$/{e=0} e && /EXPO_PUBLIC_NATIVE_READER/{bad=1} END{exit bad}' scripts/deploy/web-deploy.sh && echo "NOT_IN_APP_ARM"
```
Expected: prints `IN_DEMO_ARM` and `NOT_IN_APP_ARM`. Also run `bash -n scripts/deploy/web-deploy.sh` — expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add scripts/deploy/web-deploy.sh
git commit -m "$(printf 'feat(reader): D1 flip — enable native web reader on the demo surface\n\nSets EXPO_PUBLIC_NATIVE_READER=1 in the demo arm of web-deploy.sh only; the\nfull app keeps the iframe reader until its own follow-up. Flag→renderer wiring\nis already tested (readerFlag.test.ts + TopicRenderer.switch.test.tsx).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Document the interactive quiz in the reading-a-book Help topic

**Files:**
- Modify: `mobile/src/help-content/topics.ts` (the `reading-a-book` topic, keywords + a new block)
- Test: `mobile/__tests__/help/reading-quiz.test.ts` (new)

**Interfaces:**
- Consumes: `searchHelpTopics(query, topics)` and `HELP_TOPICS` (from `@/help` and `@/help-content`).
- Produces: the `reading-a-book` topic gains quiz keywords and an interactive-quiz text block. No `FEATURES` change.

- [ ] **Step 1: Write the failing test.** Create `mobile/__tests__/help/reading-quiz.test.ts`:

```ts
import { searchHelpTopics, blockText } from "@/help";
import { HELP_TOPICS } from "@/help-content";

const readingTopic = HELP_TOPICS.find((t) => t.id === "reading-a-book")!;

it("documents the interactive quiz in the reading-a-book topic", () => {
  const text = blockText(readingTopic.blocks).toLowerCase();
  expect(text).toContain("quiz");
  expect(text).toMatch(/tap|interactive/);
  expect(text).toContain("explanation");
});

it('searching "quiz" surfaces the reading-a-book topic', () => {
  const ids = searchHelpTopics("quiz", HELP_TOPICS).map((t) => t.id);
  expect(ids).toContain("reading-a-book");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/help/reading-quiz.test.ts`
Expected: FAIL — the current `reading-a-book` topic mentions no quiz, and searching "quiz" does not return it.

- [ ] **Step 3: Add the keywords and the block.** In `mobile/src/help-content/topics.ts`, in the `reading-a-book` topic:

(a) Add quiz keywords — replace:

```ts
      "topic", "lesson", "export", "epub", "pdf", "tour", "studio", "shelf",
    ],
```

with:

```ts
      "topic", "lesson", "export", "epub", "pdf", "tour", "studio", "shelf",
      "quiz", "question", "answer", "reveal", "score",
    ],
```

(b) Add the interactive-quiz block. Anchor on the preceding "New here?" text block so the match is unique — replace:

```ts
      {
        kind: "text",
        text: "New here? Your Library already has a book ready to open, so you can start reading before authoring anything of your own.",
      },
      { kind: "action", label: "Replay the app tour", step: "tour" },
```

with:

```ts
      {
        kind: "text",
        text: "New here? Your Library already has a book ready to open, so you can start reading before authoring anything of your own.",
      },
      {
        kind: "text",
        text: "Quizzes inside a book are interactive: tap an option to answer. Your choice locks in, the correct answer is highlighted, and the explanation appears so you can check your reasoning.",
      },
      { kind: "action", label: "Replay the app tour", step: "tour" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest __tests__/help/reading-quiz.test.ts __tests__/help/coverage.test.ts`
Expected: PASS — the new reading-quiz tests pass, and the coverage gate still passes (no new `FEATURES` key was added).

- [ ] **Step 5: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/src/help-content/topics.ts mobile/__tests__/help/reading-quiz.test.ts
git commit -m "$(printf 'docs(help): document the interactive quiz in reading-a-book\n\nFolds quiz guidance (tap to answer -> locks, grades, reveals explanation)\nand keywords into the existing reading topic; no new FEATURES key, so the\nhelp coverage gate stays green.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Full-suite gate + flagged demo-build smoke

**Files:** none (verification only).

- [ ] **Step 1: Typecheck, lint, full jest**

Run:
```bash
cd mobile && npm run typecheck && npm run lint && npm test
```
Expected: `tsc` 0 errors; lint 0 errors; jest all suites pass. This exercises the full flag→renderer chain (`__tests__/reader/readerFlag.test.ts`, `__tests__/components/TopicRenderer.switch.test.tsx`), the help coverage gate, and the new reading-quiz tests — together they prove that with the flag on, the native reader renders with zero iframe.

- [ ] **Step 2: Flagged demo-build smoke** (proves the demo build succeeds with the flag on)

Run:
```bash
cd mobile && EXPO_PUBLIC_DEMO_MODE=1 EXPO_PUBLIC_NATIVE_READER=1 npx expo export --platform web --clear
```
Expected: exits 0 and writes `dist/` (the build does not error with the flag set). Then clean up the scratch build so it is not committed:
```bash
rm -rf mobile/dist
```

- [ ] **Step 3: (operational, post-merge — NOT part of this PR's commits)**

After the PR merges, deploy the demo from `origin/main`:
```bash
scripts/deploy/web-deploy.sh demo
```
Then confirm on the live demo (`mambakkam.net/demos/mentible`): open a book topic with a quiz → the reader renders natively (no iframe; whole-page text selection works) and the quiz is interactive (tap an option → it locks, grades, and reveals the explanation). If anything regresses, redeploy the demo from a revert of this PR (instant; the demo is read-only, no data implications).

---

## Notes for the implementer

- **Do not touch the `else` (full-app) arm** of `web-deploy.sh`, and do not edit `app.json`, `eas.json`, or any `.env` file — the flip must be scoped to the demo build only.
- **Do not edit `mobile/src/help-content/features.ts`.** Adding a `FEATURES` key would make the coverage gate demand a dedicated topic forever; the fold-in avoids that by design.
- The reader/flag/switch code is already merged and reviewed — resist "improving" it here. This PR is an env var + Help copy.
- Spec §3 proposed a headless-Chrome e2e check; it is intentionally NOT implemented because `readerFlag.test.ts` + `TopicRenderer.switch.test.tsx` already prove the exact chain deterministically. The live post-deploy check (Task 3 Step 3) is the end-to-end confirmation.
```
