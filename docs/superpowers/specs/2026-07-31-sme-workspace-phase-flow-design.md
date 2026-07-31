# SME Workspace Phase-Flow — Design Spec

**Status:** Approved (2026-07-31) · wayfinding workstream · resolves **ADR-038 O3** (app-shell IA → tabs live *inside* the project workspace, per `mentible-direction.md` §7) and consumes **O4** (companion doc reviewed).
**Problem:** [[feedback_real_gap_is_wayfinding]] — in the 2026-07-30 user test, people didn't doubt the generation or validity; they got **stuck not knowing what to do next**. The trust project screen shows every section (Sources / Artifacts / Owner actions) at once as one scroll, so the next action isn't obvious.
**Goal:** turn `trust/[projectId]` into a **guided, phase-tabbed workspace** where the current phase is auto-selected and each phase surfaces one clear primary action — the Studio Loop (direction §8) *as the UI*, not a stepper on top of a scroll.

## Grounding (verified in-repo)
- `mobile/app/trust/[projectId].tsx` today: a `ScrollView` with `<TrustJourney>` (4-phase stepper) + three blocks — **Sources** (`sourcesBlock`: owner add-source form + input list), **Artifacts** (`artifactsWrap`: artifacts → versions → Approve / Generate-draft), **Owner actions** (`ownerBlock`: invite expert, add artifact). `onNextAction` scrolls to + flashes a block; refs `sourcesY/artifactsY/ownerActionsY` + a highlight timer.
- `mobile/src/components/TrustJourney.tsx`: derives phase state internally — `captured = inputs.length>0`, `hasArtifact`, `anyVersion`, `allValidated = hasArtifact && every artifact has a validated version`; `phases = [capture, create, validate, share]`; `currentIdx = first !done`; `currentKey = (create && !hasArtifact) ? "create_artifact" : phases[currentIdx].key`; `nextStep(currentKey, isOwner)` → the role-aware next-step copy.
- `mobile/src/hooks/useTrustProject.ts`: provides `project` (`ProjectDetailView`), `loading/error`, and actions `addInput`, `addArtifact`, `generateVersion`, `approve`, `invite`, plus `inputs`. `isOwner = project.my_role === "owner"`.
- The screen is already an SME surface: wrapped in `SmeThemeScope` (Navy Trust) with `useThemedStyles` (ADR-038). Reuse that — do not regress it.
- `recorded_via` chips ("expert-validated" / "operator-recorded") live on validated versions — keep them (the never-bare-"validated" rule).

## Design

### A. `deriveProjectPhase(detail, isOwner)` — extracted pure helper
Move `TrustJourney`'s phase logic into a pure function (new `mobile/src/lib/projectPhase.ts`) so the tab bar and panels share one source of truth:
```ts
export type PhaseKey = "capture" | "create" | "validate" | "share";
export interface ProjectPhase {
  phases: { key: PhaseKey; label: string; done: boolean }[]; // labels: Sources/Drafts/Feedback/Publish
  currentIdx: number;
  currentKey: PhaseKey | "create_artifact"; // create-with-no-artifact nuance preserved
}
export function deriveProjectPhase(detail: ProjectDetailView, isOwner: boolean): ProjectPhase;
```
Tab labels are the content nouns **Sources · Drafts · Feedback · Publish** (map 1:1 to Capture/Create/Validate/Share). `TrustJourney` is refactored to consume this helper (or is retired on this screen — see §F).

### B. `PhaseTabBar` — merged stepper + tabs
New `mobile/src/components/PhaseTabBar.tsx`: one horizontal control, 4 tabs, each = a phase.
- Each tab shows its **state glyph** (✓ done / ● current / ○ upcoming) + label; the bar **is** the stepper (no separate progress row).
- Props: `{ phase: ProjectPhase; selected: PhaseKey; onSelect(key) }`. Tabs are freely tappable.
- Accessibility: each tab `accessibilityRole="tab"`, `accessibilityState={{ selected }}`, `accessibilityLabel` = `"${label}: ${state}"` (keeps the existing phase-label selectors working).
- Navy Trust styled via `useThemedStyles` (SME surface). Titles may use the Fraunces heading token per ADR-038 where it reads as a heading.

### C. The workspace screen (`trust/[projectId].tsx`)
Structure becomes:
```
<SmeThemeScope>
  <ScrollView>
    <PageContainer>
      <Text title>{project.title}</Text>
      <PhaseTabBar phase selected onSelect={setSelected} />
      {selected === "capture"  && <SourcesPanel  ... />}
      {selected === "create"   && <DraftsPanel   ... />}
      {selected === "validate" && <FeedbackPanel ... />}
      {selected === "share"    && <PublishPanel  ... />}
```
- **Auto-select:** on first load, `selected` initialises to the current phase (`currentKey` collapsed to its base phase — `create_artifact` → `create`). The user's manual tab taps are then remembered for the life of the screen.
- The old `onNext` scroll+flash, the `*Y` layout refs, and the highlight timer are **removed** — tab selection replaces them.

### D. Panels (role-adaptive), each with ONE primary CTA
Split today's blocks into four panel components (co-located in the screen file or `mobile/src/components/trust/`):

| Panel (phase) | Owner | Reviewer | Primary CTA (owner) |
|---|---|---|---|
| **Sources** (capture) | add-source form + input list | input list (read-only) | *Add a source* |
| **Drafts** (create) | artifacts → versions; add-artifact when none | drafts read-only | *Generate a draft* / *Add an artifact* (if none) |
| **Feedback** (validate) | invite-expert + version approval status | versions with **Approve** + `recorded_via` chips | *Invite an expert* (owner) / *Approve v_n* (reviewer) |
| **Publish** (share) | **placeholder** this slice | placeholder | — |

- All actions reuse the existing `useTrustProject` methods verbatim (`addInput`/`addArtifact`/`generateVersion`/`approve`/`invite`) and the existing busy-state handling + `Alert` error copy.
- **Publish panel = minimal placeholder** (revisit later — user decision): a short line like "Sharing & export are coming soon." No share-to-Posts CTA yet, no export.
- A panel whose phase isn't reachable yet (e.g. Feedback before any draft) shows a brief "not yet — finish _Drafts_ first" note instead of actions.

### E. Empty / role notes
- Reviewer never sees owner-only controls (add-source form, invite, add-artifact, generate) — same `isOwner` gating as today, per panel.
- The current-phase auto-select means a reviewer lands on **Feedback** (their job), an owner mid-capture lands on **Sources**.

### F. `TrustJourney` disposition
`TrustJourney` is superseded on this screen by `PhaseTabBar`. Check for other consumers: if none, remove `TrustJourney.tsx` + its tests; if it's used elsewhere, leave it and just refactor its internals onto `deriveProjectPhase`. (Grep confirms usage before deciding — the plan does this.)

## Testing
- **`deriveProjectPhase`** (`__tests__/lib/projectPhase.test.ts`): phase `done` flags across states (no inputs → capture current; input + no artifact → create/`create_artifact`; artifact + no version → create; version unvalidated → validate; all validated → share); owner vs reviewer `currentKey`.
- **`PhaseTabBar`** (`__tests__/components/PhaseTabBar.test.tsx`): renders 4 tabs with correct state glyphs; tapping a tab calls `onSelect`; selected tab has `accessibilityState.selected`.
- **Screen** (`__tests__/screens/TrustProjectDetail*.tsx`, updated): current phase auto-selected on load; tapping **Drafts** swaps to the drafts panel; owner **Sources** shows the add-source form; reviewer lands on **Feedback** with an **Approve** control; `recorded_via` chip still renders on a validated version. The existing highlight/journey tests are **rewritten** to tab-selection assertions (the scroll+flash they tested is gone).
- Full suite + `tsc` + `eslint` green.

## Definition of Done (Help)
No new `FEATURES` key (nav/flow restructure of an existing surface, not a new feature). If the Help topic for the trust workspace references the old scroll layout, update its copy in the same PR.

## Out of scope (later slices)
- Real **Publish/export** (PDF/ePub/share-to-Posts) — the Publish tab is a placeholder now.
- **Dashboard usage meter** (direction §7 `/app`) and **file uploads** (§12) — separate wayfinding slices.
- Any **backend / data-model / RLS** change — the direction doc's Supabase-RLS + `user_roles` model is the Lovable prototype's; this repo stays no-RLS + app-level guard (CLAUDE.md rule #4 / ADR-037). This slice is **UI-only**.
- First-run **onboarding** (a distinct handhold slice); this slice fixes the in-project next-action, which is the reported gap.

## Open items (resolve in the plan, non-blocking)
1. Panel components inline in the screen vs a new `components/trust/` dir — plan decides based on file size after extraction (the screen is already large; extracting panels likely helps).
2. Exact "not-yet-reachable tab" copy per phase.
3. Whether the phase auto-select should also re-run when the data changes mid-session (e.g. owner adds the first source → advance to Drafts) or stay put until the user navigates — default: **stay put** after first load (don't yank the tab out from under the user); revisit if it feels wrong on device.
