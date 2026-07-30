# Trust Journey — Actionable Next-Step (Phase B slice 2) — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 Phase B slice 2** · builds on the merged Journey stepper (PR #357). Completes the handhold: slice 1 *tells* you the next step; this *takes you to it*.
**Scope:** make the `TrustJourney` next-step line **tappable** — in the project workspace it scrolls to the relevant control (Sources / Artifacts / Owner-actions), and the Share step jumps to the Posts tab. Mobile only, no backend change.

## Why
The Journey (slice 1) surfaces the current phase + a next-step line, but the controls are elsewhere on the screen — the user still has to hunt. Making the next-step actionable is the literal answer to "what do I do to move forward": read it, tap it, you're at the control.

## Grounding (verified)
- `src/components/TrustJourney.tsx`: pure component, renders phases + a `nextStep(currentKey, isOwner)` text line. Current phase = `phases.findIndex(p => !p.done)`.
- `app/trust/[projectId].tsx`: one `<ScrollView>` → `<PageContainer>` → title/topic → `<TrustJourney detail isOwner/>` → **`<View style={styles.sourcesBlock}>`** (Sources, line 135) → artifacts `.map` (`<View style={styles.artifact}>` per artifact, line 194; the artifact contains the **Generate a draft** button + per-version **Approve**) → **`<View style={styles.ownerBlock}>`** (Owner actions: **Invite** + **Add an artifact**, line 238). `isOwner = project.my_role === "owner"`.
- The Posts tab route is `/posts` (demo-excluded; reachable via nav).

---

## `TrustJourney.tsx` — add an optional `onNext`
```ts
interface TrustJourneyProps {
  detail: ProjectDetailView;
  isOwner: boolean;
  onNext?: (phaseKey: string) => void;   // when set, the next-step line is a button
}
```
- When `onNext` is provided, render the next-step as a **`Pressable`** (`accessibilityRole="button"`, `accessibilityLabel={"Go to next step: " + <text>}`) whose `onPress` calls `onNext(phases[currentIdx].key)`. Add a subtle affordance (e.g. a trailing "→" and the primary color) so it reads as tappable.
- When `onNext` is absent, render the plain `<Text>` exactly as today (keeps the component pure + all existing TrustJourney tests green without change).
- No change to phase-derivation or copy (slice-1 logic untouched).

## `app/trust/[projectId].tsx` — scroll wiring
- Add `const scrollRef = useRef<ScrollView>(null)` on the workspace `ScrollView` (`ref={scrollRef}`).
- Capture three anchor Y positions via `onLayout` (`e.nativeEvent.layout.y` → a ref):
  - `sourcesY` on the `sourcesBlock` view.
  - `artifactsY` — **wrap the artifacts `.map` in a single `<View onLayout=...>`** (a structural wrapper so the whole artifacts region has one anchor; no visual change).
  - `ownerActionsY` on the `ownerBlock` view.
- `onNextAction(phaseKey: string)`:
  ```ts
  const scrollTo = (y: number | undefined) =>
    scrollRef.current?.scrollTo({ y: Math.max((y ?? 0) - 8, 0), animated: true });
  switch (phaseKey) {
    case "capture":  scrollTo(sourcesY.current); break;
    case "create":   scrollTo(artifactsY.current); break;      // Generate-a-draft / (Add-artifact just below)
    case "validate": scrollTo(isOwner ? ownerActionsY.current : artifactsY.current); break; // owner→Invite, reviewer→Approve
    default:         router.push("/posts"); break;             // share → the Posts tab
  }
  ```
- Pass `onNext={onNextAction}` to `<TrustJourney>`.
- `router` via `useRouter()` (add the import/hook if the screen doesn't already have it).
- **Y is relative to `PageContainer`** (the ScrollView's content child) — a small constant padding offset from the true content top; the `-8` fudge + `Math.max(...,0)` keeps the target comfortably in view. Precise `measureLayout` is deferred (scroll-to-approximate is the value this slice).

## Testing
**`TrustJourney.test.tsx`** (extend):
- with `onNext`: the next-step renders as a button (`getByRole`/`getByLabelText(/Go to next step/)`); pressing it calls `onNext` with the current phase key (e.g. no data → `"capture"`; a validated version → `"share"`).
- without `onNext`: still plain text (the existing tests already cover this — confirm they pass unchanged).

**`TrustProjectDetail.journey.test.tsx`** (extend):
- a **validated** project (Share is current) → pressing the Journey next-step calls `router.push("/posts")` (mock `useRouter`).
- a capture/create-phase press does not throw (the ScrollView `scrollTo` is a harmless no-op under the RN test renderer). *(The actual scroll position is a device-verify — RN `scrollTo` side-effects aren't meaningfully unit-testable; note this.)*

Full suite + `tsc` + `eslint` green. **No Help change** (the `projects` topic already describes the journey; behavior-only tweak → no new FEATURES key, no coverage churn).

## Out of scope (later)
- Post-scroll **highlight/flash** of the target control.
- Precise `measureLayout`-based offset (using approximate `onLayout` y this slice).
- Refining the Journey's sub-step accuracy (no-artifact "add an artifact" step; the multi-artifact `.some` nuance) — that was the separate "refine accuracy" option, deferred.
- A resume/continue hero (re-entry) — deferred.
- Directly *triggering* a control on tap (vs scrolling to it) — scroll-to only.

## Open items (resolve in the plan, non-blocking)
1. The tappable affordance styling (color + "→") — plan keeps it minimal, reusing existing tokens.
2. Whether `validate`-reviewer should target the specific version's Approve vs the artifacts region generally — spec uses the artifacts region (`artifactsY`); per-version targeting deferred.
3. Guarding `scrollTo` when an anchor hasn't laid out yet (`y === undefined`) — handled by `?? 0` (scrolls to top harmlessly); acceptable.
