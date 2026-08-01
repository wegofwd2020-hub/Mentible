# Theme Migration Sweep — static `colors` → `useThemedStyles`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the whole app respond to the theme switcher. Migrate every live RN screen/component from the static `colors` (baked Study palette) to per-render `useThemedStyles`, so a theme change in Settings applies site-wide.

**Architecture:** The multi-theme engine (`ThemeProvider` + `useThemedStyles`/`useTheme`, `constants/theme.ts` palettes) already exists; today only Settings + the 4 SME screens consume it. This sweep mechanically converts the remaining ~69 files. Pure refactor — no behavior/logic change, only how styles get their colors.

**Tech Stack:** React Native + Expo, `@/theme` (`useThemedStyles`, `useTheme`), `@/constants/theme` (`Palette`, `radius`/`spacing`/`typography` — these stay static, only `colors` is themed).

## Global Constraints
- **Behavior-preserving.** Only the color source changes. No copy/logic/layout change. Same rendered output under the default (Study) theme.
- **`radius`, `spacing`, `typography` stay static** (not themed) — keep importing them from `@/constants/theme`. Only `colors` → theme.
- **Hooks rule:** `useThemedStyles`/`useTheme` go at the top of the component, ABOVE any early return (`if (loading) return …`).
- **`as const`** on every RN style enum-literal prop inside a `makeStyles` factory (`flexDirection`, `alignItems`, `justifyContent`, `textAlign`, `textAlignVertical`, `textTransform`, `fontWeight`, `fontStyle`, `alignSelf`, `flexWrap`, `position`, `overflow`) — AND on every **STRING dimension value** (`width`/`maxWidth`/`minWidth`/`height`/`maxHeight`/`minHeight`/`flexBasis` set to a string like `"50%"`/`"100%"`). Moving these into the arrow `makeStyles` factory drops the literal narrowing `StyleSheet.create` gave them, so without `as const` they widen to `string`/`number` and fail `useThemedStyles`'s `T extends NamedStyles<T>` constraint → tsc errors. (Task 1 hit exactly this on `width: "100%"` / `maxWidth: "50%"`.)
- **ACTUALLY RUN `npx tsc --noEmit -p tsconfig.json` and confirm 0 errors before committing** — do not assume/claim it passed. Jest uses Babel and does NOT typecheck, so a green suite can hide tsc errors. tsc is a CI gate (`npm run typecheck`).
- **No residual `colors.`** in a migrated file (grep `\bcolors\.` must be empty). Remove the `colors` import + unused `StyleSheet` import.
- **Do NOT touch** the 7 excluded files: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `src/components/contentHtml.ts`, `src/reader/readerStyles.ts`, `src/reader/NativeChapterReader.web.tsx`, `src/reader/NativeQuizReader.web.tsx`, `src/reader/NativeTopicReader.web.tsx`.
- **Do NOT re-migrate** the already-done: `settings.tsx`, `posts.tsx`, `projects.tsx`, `reviews.tsx`, `trust/new.tsx`, `trust/[projectId].tsx`, `PhaseTabBar.tsx`, `TrustJourney`(gone), `AccentText.tsx`.
- Commands from `mobile/`: `npx tsc --noEmit -p tsconfig.json` (baseline 0), `npx eslint <files>`, `npx jest <relevant>`. Quote paths with `[` (e.g. `"app/book/read/[id].tsx"`).

## The transform recipe (apply to each file)
1. Import: drop `colors` from the `@/constants/theme` import; keep `radius`/`spacing`/`typography`; add `type Palette`. Add `import { useThemedStyles } from "@/theme"` (+ `useTheme` only if inline `colors.x` is used outside a stylesheet).
2. Module-level `const styles = StyleSheet.create({ … colors.x … })` → `const makeStyles = (c: Palette) => ({ … c.x … })` with `as const` on enum literals. Inside each component using it: `const styles = useThemedStyles(makeStyles);` (top, above early returns).
3. Inline `colors.x` (e.g. `ActivityIndicator color=`, `placeholderTextColor=`, icon `color=`) → `const theme = useTheme();` then `theme.x`.
4. If `colors` is used at **module scope outside any component** (a const array/map built at import) → it can't call the hook. Move that piece inside the component (compute per-render), OR if it's e.g. an icon-name→color map, thread the palette in. Flag in the report if a file needs judgment here.
5. Multiple components in one file each get their own `useThemedStyles` call (or share one factory).
   ⚠ **NEVER define a component inside another component's render body** to give it `styles`. A nested sub-component (`Row`, `FieldLabel`, `MiniButton`, etc.) must stay at **MODULE scope** and receive the themed `styles` as a **PROP** (`styles: ReturnType<typeof makeStyles>`), plus `theme`/palette values as props if it uses inline `theme.x`. Defining a component inside render = new identity every render → it unmounts/remounts each render, losing internal state (e.g. a tooltip's open state, or a TextInput's focus). This bit Task 7 (`FieldLabel`→`HelpHint` state reset). Prop-drill `styles`, don't move components inside.
6. Verify: `grep -nE '\bcolors\.' <file>` → empty; tsc 0; eslint 0.

Reference examples already in the codebase: `app/(tabs)/settings.tsx`, `app/(tabs)/projects.tsx` (both use `useThemedStyles(makeStyles)` with `as const`).

---

Each task below = migrate its file list per the recipe, then verify (no residual `colors.`, tsc, eslint, and run the suite at the end of the task). Tasks are independent (different files) but share the recipe. **Per task:** migrate the files → `grep -nE '\bcolors\.'` each (must be empty) → `npx tsc --noEmit` → `npx eslint <the files>` → `npx jest` (or the affected suites) → commit `refactor(theme): migrate <area> to useThemedStyles (theme sweep)`.

### Task 1: main tab screens
`app/(tabs)/library.tsx`, `app/(tabs)/books.tsx`, `app/(tabs)/shelves.tsx`, `app/(tabs)/about.tsx`, `app/(tabs)/help.tsx`

### Task 2: book screens (authoring)
`app/book/new.tsx`, `app/book/import.tsx`, `app/book/saved/[id].tsx`, `app/book/generate/[id].tsx`

### Task 3: book screens (reading/reviews)
`app/book/read/[id].tsx`, `app/book/reviews/[id].tsx`, `app/book/topic/[bookId]/[topicId].tsx`, `app/book/chapter/[bookId]/[chapterId].tsx`, `app/book/shared/[id].tsx`

### Task 4: account / admin / misc screens
`app/account.tsx`, `app/admin.tsx`, `app/admin/[sub].tsx`, `app/usage.tsx`, `app/paywall.tsx`, `app/sign-in.tsx`, `app/diagram-types.tsx`, `app/concepts.tsx`

### Task 5: shelves screens
`app/shelves/downloads.tsx`, `app/shelves/[sourceId].tsx`, `app/shelves/[sourceId]/[entryId].tsx`

### Task 6: nav + auth components
`src/components/TopNavBar.tsx`, `src/components/SideNav.tsx`, `src/auth/RequireSignIn.tsx`, `src/components/AuthForm.tsx`, `src/components/UserChip.tsx`

### Task 7: book/trust components A
`src/components/BookEditor.tsx`, `src/components/BookMetadataModal.tsx`, `src/components/TopicTreeEditor.tsx`, `src/components/TopicReadList.tsx`, `src/components/GenerationParamsEditor.tsx`, `src/components/LevelPicker.tsx`, `src/components/LessonRenderer.tsx`, `src/components/FiguresPanel.tsx`

### Task 8: book/trust components B
`src/components/DraftCommentThread.tsx`, `src/components/FeedbackBadge.tsx`, `src/components/TrustBadge.tsx`, `src/components/ExportStatusPills.tsx`, `src/components/ExportBookJsonButton.tsx`, `src/components/PublishButton.tsx`, `src/components/SaveToLibraryButton.tsx`, `src/components/ShareDraftModal.tsx`, `src/components/SharedWithYou.tsx`, `src/components/MoveToShelfModal.tsx`, `src/components/ShelfNameModal.tsx`

### Task 9: billing + shelf/openshelves components
`src/components/CheckoutButton.tsx`, `src/components/ManagedPlanCard.tsx`, `src/components/PlanCard.tsx`, `src/components/ProviderKeyForm.tsx`, `src/components/ShelfBand.tsx`, `src/components/ShelfBook.tsx`, `src/openshelves/AddSourceForm.tsx`, `src/openshelves/EntryDetail.tsx`, `src/openshelves/EntryRow.tsx`, `src/openshelves/ShelfFilterBar.tsx`, `src/openshelves/SourceRow.tsx`

### Task 10: onboarding / help / discovery
`src/onboarding/steps/KeyStep.tsx`, `src/onboarding/steps/SignupStep.tsx`, `src/onboarding/steps/TourStep.tsx`, `src/onboarding/WizardScaffold.tsx`, `src/help/components/HelpButton.tsx`, `src/help/components/HelpHint.tsx`, `src/help/components/HelpTopicView.tsx`, `src/discovery/DiscoveryNudge.tsx`

---

## Self-Review
- **Coverage:** all 76 `colors` importers = 69 in-scope (Tasks 1–10) + 7 excluded (listed in Global Constraints) + the already-migrated set. Cross-checked against `grep -rlE 'import \{[^}]*\bcolors\b'`.
- **Recipe completeness:** import swap, module→factory, inline→useTheme, module-scope-colors judgment, hooks-above-returns, `as const`, residual-grep — all specified.
- **Risk notes:** files with module-scope `colors` (an icon/color map outside a component) need the recipe step 4 judgment — the implementer flags any that can't be mechanically moved. `TopNavBar`/`SideNav` (nav) migrating means the nav follows the theme too (intended).
- **Verification:** every task ends with residual-grep + tsc + eslint + jest, so a broken migration can't land silently. Behavior-preserving under Study theme (default) = no test should change.
