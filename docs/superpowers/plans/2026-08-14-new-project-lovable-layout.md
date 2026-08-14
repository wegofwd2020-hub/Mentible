# New-project screen — Lovable layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle `mobile/app/trust/new.tsx` to the Lovable new-project layout (back link, display heading, multi-line Topic, side-by-side Audience/Goal, kicker labels, pill Create, centered column) — layout only, same fields/behavior.

**Architecture:** Rewrite `NewProjectInner`'s render + `makeStyles` in one file; enhance the `field` helper (multiline/required/maxLength + kicker label); add `useResponsive` for the 2-col + centered max-width. Reuse existing tokens/components.

**Tech Stack:** React Native (Expo), `useThemedStyles`, `useResponsive`, `FRAUNCES`; Jest + RNTL.

## Global Constraints

- Layout only — DO NOT change: the fields, `submit()`/`create()` payload, the 402→upgrade handling, `atProjectCap` cap wall (`plan != null && !plan.is_pro && plan.at_project_cap`; fail-open on `plan == null`), `RequireSignIn action="start a project"`, the title-required guard.
- No color-literal asserts; theme via `useThemedStyles`/tokens; `Alert` from `@/lib/alert`; Fraunces from `@/constants/fonts`. Mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** current file `mobile/app/trust/new.tsx` (91 lines) — `field(label, v, set, placeholder)` helper + `makeStyles`. `radius.full = 9999` (pill), `radius.md`. `useResponsive(): { width, isTablet, isDesktop }` (`@/hooks/useResponsive`; isTablet ≥768). `FRAUNCES.bold` (`@/constants/fonts`). `typography` has `sizeXxl` (used today); check for a larger size — if none, keep `sizeXxl`. `Button` (`@/components/ui`) accepts `variant`, `label`, `busy`, `disabled`, `style`, `onPress`, `accessibilityLabel`. Reference layout: `/home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/mentible_loverable_ux/src/routes/_authenticated/app/new.tsx`.

---

### Task 1: Restyle the new-project screen

**Files:**
- Modify: `mobile/app/trust/new.tsx`
- Test: `mobile/__tests__/screens/` — the new-project screen test (find `NewProject*`/`trust*new*`; extend, else add `NewProject.test.tsx`)

**Interfaces:** unchanged public behavior (`create` payload, navigation to `/trust/{id}`).

- [ ] **Step 1: Write the failing/updated screen test.** Mock `useOwnedProjects` (`create`), `useBillingPlan`, `expo-router` (`useRouter` → `{ replace, back }`), `useResponsive` (return `isTablet:true` for one case, `false` for another). Assert:
  - a "Back to projects" control renders and calls `router.back` on press;
  - the Title/Topic/Audience/Goal inputs render (by `accessibilityLabel`/placeholder) + accept text;
  - **Topic input is `multiline`** (`getByLabelText("Topic").props.multiline === true`);
  - "Create project" with a title → `create` called with `{ title, topic?, audience?, goal? }` (trimmed), then `router.replace("/trust/<id>")`;
  - empty title → the "Title required" alert, `create` NOT called;
  - `atProjectCap` (`plan:{is_pro:false, at_project_cap:true}`) → Create disabled + the "Free limit reached" hint; `plan:null` → enabled (fail-open);
  - a 402 from `create` → the "Upgrade to Pro" alert.
  No color-literal asserts.

- [ ] **Step 2: Run — FAIL** (no back link / Topic not multiline yet). `cd mobile && npx jest -t "new project"` (or the file).

- [ ] **Step 3: Implement in `new.tsx`.**
  - Add imports: `useResponsive` from `@/hooks/useResponsive`; `Pressable` from react-native.
  - `const { isTablet } = useResponsive();`
  - **Back link:** a `Pressable` (accessibilityRole "button", accessibilityLabel "Back to projects") with a "‹" or "←" glyph `Text` + "Back to projects" (`textMuted`), `onPress={() => (router.canGoBack?.() ? router.back() : router.replace("/projects"))}`. Place above the heading.
  - **Heading/subhead:** keep (Fraunces). Optionally bump size if a larger `typography` size exists; else keep `sizeXxl`.
  - **`field` helper — enhance** to `field(label, v, set, placeholder, opts?: { multiline?: boolean; required?: boolean; maxLength?: number })`: render a **kicker** label (uppercase via a style with `textTransform:"uppercase"`, `letterSpacing`, `textMuted`) with a trailing `*` (in `c.error`) when `required`; the `TextInput` gets `multiline`, `maxLength`, and for multiline `style={[styles.input, styles.inputMultiline]}` (`minHeight` ~ 3 rows, `textAlignVertical:"top"`).
  - **Fields:** `field("Title", …, "…", { required: true, maxLength: 120 })`; `field("Topic", …, "…", { multiline: true, maxLength: 500 })`; then **Audience + Goal** — wrap in a `View` styled `styles.row` when `isTablet` (`flexDirection:"row"`, `gap`, children `flex:1`) else `styles.col` (stacked); each is a `field(...)` with a `flex:1` container on tablet.
  - **Create button:** add `styles.submitBtn` = `{ borderRadius: radius.full, alignSelf: "flex-start", paddingHorizontal: spacing.lg, marginTop: spacing.sm }`. Keep `busy`, `disabled={atProjectCap}`, cap hint.
  - **Centered column:** give the inner content wrapper `{ width: "100%", maxWidth: 640, alignSelf: "center" }` (so it centers on wide/tablet-web, full-width on phone). Keep the `ScrollView` + `PageContainer`.

- [ ] **Step 4: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. All green.

- [ ] **Step 5: Commit**
```bash
git add "mobile/app/trust/new.tsx" mobile/__tests__
git commit -m "feat(trust): restyle new-project screen to the Lovable layout (back link, multiline Topic, 2-col Audience/Goal, pill Create, centered)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] Fields/behavior unchanged (create payload, nav, cap wall, RequireSignIn, title-required, 402→upgrade); Topic multiline; Audience/Goal 2-col on tablet / stacked on phone; pill Create; back link; centered.
- [ ] **Deploy:** web deploy + APK. No backend, no migration.

## Out of scope

- Backend / the create endpoint. Other trust screens. New fields.
