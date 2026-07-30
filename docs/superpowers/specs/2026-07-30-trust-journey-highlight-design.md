# Trust Journey — Post-Scroll Highlight (Phase B slice 4 polish) — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 Phase B slice 4 (polish)** · completes the actionable-Journey UX (PR #358/#359).
**Scope:** after the Journey next-step scrolls to a control, briefly highlight that section so the user's eye lands on the right place. One file (`app/trust/[projectId].tsx`) + its test. `TrustJourney` unchanged. Mobile only, no backend.

## Why
Slices 2–3 made the Journey next-step scroll to the relevant control, but a scroll alone can be disorienting — the user arrives somewhere without a clear "this is the thing." A brief highlight on the target section closes that loop.

## Grounding (verified)
- Workspace `app/trust/[projectId].tsx`: `onNextAction(phaseKey)` scrolls to one of three `onLayout` anchors (`sourcesY` on `sourcesBlock`, `artifactsY` on the artifacts-map wrapper `<View>`, `ownerActionsY` on `ownerBlock`) or `router.push("/posts")` for Share.
- **All three sections already have a 1px border** (`styles.sourcesBlock`, `styles.ownerBlock`, `styles.artifact` = `borderWidth: 1, borderColor: colors.border`). The artifacts anchor is a **style-less wrapper** around the `.map`.
- So the highlight = **swap `borderColor` to `colors.primary`** — width stays 1px → **no layout shift**.

---

## Implementation (`app/trust/[projectId].tsx`)
- State + timer:
  ```tsx
  const [highlight, setHighlight] = useState<"sources" | "artifacts" | "owner" | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (key: "sources" | "artifacts" | "owner") => {
    setHighlight(key);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlight(null), 1500);
  };
  ```
  (Clear the timer on unmount via a `useEffect` cleanup returning `() => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }`.)
- `onNextAction` sets the highlight alongside the scroll (Share routes away → no highlight):
  ```tsx
  case "capture":         scrollTo(sourcesY.current); flash("sources"); break;
  case "create":          scrollTo(artifactsY.current); flash("artifacts"); break;
  case "create_artifact": scrollTo(ownerActionsY.current); flash("owner"); break;
  case "validate":        { const owner = isOwner; scrollTo(owner ? ownerActionsY.current : artifactsY.current); flash(owner ? "owner" : "artifacts"); break; }
  default:                router.push("/posts"); break; // share — navigates away, no highlight
  ```
- Apply the highlight (border-color swap) + `testID` on the three anchors:
  - `sourcesBlock`: `style={[styles.sourcesBlock, highlight === "sources" && styles.highlighted]}` + `testID="journey-anchor-sources"` (keep its existing `onLayout`).
  - artifacts wrapper `<View>`: give it a base `styles.artifactsWrap` (`{ borderWidth: 1, borderColor: "transparent", borderRadius: radius.md }`) so a color swap causes no shift: `style={[styles.artifactsWrap, highlight === "artifacts" && styles.highlighted]}` + `testID="journey-anchor-artifacts"` (keep its `onLayout`).
  - `ownerBlock`: `style={[styles.ownerBlock, highlight === "owner" && styles.highlighted]}` + `testID="journey-anchor-owner"`.
- New style: `highlighted: { borderColor: colors.primary }`. (Add `artifactsWrap` as above.)
- **Simple appear→clear** (no `Animated` fade this slice — see out of scope).

## Testing (`__tests__/screens/TrustProjectDetail.journey.test.tsx`, extend)
Use `jest.useFakeTimers()` in these tests (restore in cleanup):
- Owner project at **Capture** (no sources) → press the Journey next-step → `getByTestId("journey-anchor-sources")`'s flattened style has `borderColor === colors.primary` (highlighted); after `act(() => jest.advanceTimersByTime(1500))` the highlight clears (borderColor back to the base). (Import `colors` from `@/constants/theme`.)
- A **create-phase** project (source + an artifact with no version) → press → `journey-anchor-artifacts` highlighted.
- Share press (`push("/posts")`) → no highlight applied (and still routes). 
- The existing journey tests (scroll/push, create_artifact-no-push) still pass.

Full suite + `tsc` + `eslint` green. No Help/FEATURES change.

## Out of scope (later)
- An **animated** fade (this is a plain appear→clear via a timeout; `Animated`/Reanimated cross-fade is a later refinement).
- Highlighting a **specific control** (e.g. the exact Generate button / the version's Approve) rather than its section.
- The other slice-4 candidates (resume hero, reviewer queue, empty-state hero).

## Open items (resolve in the plan, non-blocking)
1. Highlight duration (1500ms) — plan keeps it; easy to tune.
2. Whether to also thicken the border (2px) on highlight — no (would shift layout); color-only.
3. `useFakeTimers` interaction with any RNTL async in the file — plan scopes fake timers to the new highlight tests only (or uses `jest.useFakeTimers({ legacyFakeTimers: false })` per this file's convention); confirm the existing async tests aren't disturbed.
