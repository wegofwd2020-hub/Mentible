# Trust Journey Handhold (Phase B, slice 1) — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 Phase B — wayfinding handhold** · addresses the user-test signal (`feedback_real_gap_is_wayfinding`): people don't know what to do to move forward. The SME loop (Capture ✅ → Create ✅ → Validate ✅ → Share ✅) is now real; this makes it **legible** — a first-timer is guided into it and through it.
**Scope:** a **Journey guide** in the project workspace (a 4-phase stepper that shows where the owner is + the next action) + a **first-run fork to authoring** (the tour offers "Start a project"). Mobile only, **no backend change** (phase state is derived from the existing project detail).

## Why this slice
`trust/new` already routes into the workspace, but the workspace (`app/trust/[projectId].tsx`) is a wall of controls (Sources, Generate-a-draft, Invite, Approve, Add-artifact) with **no sense of order or next step** — the core "what do I do?" complaint. And the first-run tour still ends at "Open my Library" (reading), never pointing a would-be SME at the loop. This slice fixes both: get them in (first-run fork) and guide them through (Journey stepper).

## Grounding (verified)
- **Workspace** `app/trust/[projectId].tsx`: renders `PageContainer` → title/topic → **Sources** block → **Artifacts** (each with **Generate a draft** + **Approve**) → owner **Invite** / **Add an artifact**. `isOwner = project.my_role === "owner"`. Data = `useTrustProject(...).project` (`ProjectDetailView`).
- **Detail shape** (`src/api/trustClient.ts`): `ProjectDetailView { project:{title,topic,...}, artifacts: [{artifact, versions:[{is_validated, version_no}]}], inputs: ProjectInputView[], my_role }`. **All four phases derive from this — no backend call.**
- **Tour** `src/onboarding/steps/TourStep.tsx`: 2 pages; final page CTA `primaryLabel="Open my Library"` → `router.push("/library")` via `onDone()` then navigate. `WizardScaffold` supports `primaryLabel/onPrimary` + `skipLabel/onSkip` (no secondary button). `IS_DEMO` from `@/constants/demo` (demo = no backend/Projects).
- **Nav:** the Posts tab (Share) + Projects/Reviews are demo-excluded; `/trust/new` is `RequireSignIn`.

---

## The four phases (derived state)
For the project detail `d`:
- **Capture** — `done = d.inputs.length > 0`
- **Create** — `done = d.artifacts.some(a => a.versions.length > 0)`
- **Validate** — `done = d.artifacts.some(a => a.versions.some(v => v.is_validated))`
- **Share** — the goal; `available = Validate.done` (Share lives on the Posts tab / derivatives — cross-surface, so this phase points there rather than acting in-workspace).

**Current phase** = the first phase that is not done (Capture → Create → Validate → Share). If all done, the current phase is Share ("Ready to share").

## Component — `src/components/TrustJourney.tsx`
```ts
export interface TrustJourneyProps {
  detail: ProjectDetailView;
  isOwner: boolean;
}
export function TrustJourney({ detail, isOwner }: TrustJourneyProps): JSX.Element;
```
- Pure/derived (no hooks beyond render). Renders a compact horizontal stepper: **① Capture · ② Create · ③ Validate · ④ Share**, each with a state glyph (✓ done / ● current / ○ upcoming) and a short label.
- Below the stepper: a **prominent "next step" line** for the current phase, role-aware:
  - **Capture current** (owner): "Next: add a source — paste a transcript, note, or link below." (reviewer: "The owner is still capturing sources.")
  - **Create current** (owner): "Next: generate a draft from your sources." (reviewer: "Waiting for the owner to generate a draft.")
  - **Validate current** (owner): "Next: invite an expert to review — then they approve a version." (reviewer: "Your turn: review the latest version and approve it below.")
  - **Share current / all done**: "This project has an expert-validated version. Share it from the Posts tab." (both roles)
- Copy is house-style (verbs of craft; never "expert validated" for an un-approved project — the Validate line only claims validation once a version `is_validated`).
- Styling: the file's existing static `colors`/`StyleSheet` idiom (NOT theme-migrated). Accessibility label per phase: `"{name}: {done|current|upcoming}"`.
- **Slice-1 boundary:** the next-step line is **descriptive text** (tells them what + where — the controls are directly below). Making it a tappable scroll-to-section is a follow-up (open item).

## Wire into the workspace
`app/trust/[projectId].tsx`: render `<TrustJourney detail={project} isOwner={isOwner} />` immediately after the title/topic, before the Sources block. No other change to the existing controls.

## First-run fork (`src/onboarding/steps/TourStep.tsx`)
On the final tour page, branch on `IS_DEMO`:
- **`!IS_DEMO`** (real build): the page becomes the **fork** — title "What would you like to do?"; `primaryLabel="Start a project"` → `onDone()` + `router.push("/trust/new")`; `skipLabel="Just read for now"` → `onDone()` + `router.push("/library")`. (SME-primary: authoring is the primary CTA.) Body: a one-line each — "Create — capture an expert's knowledge and turn it into a validated asset." / "Read — open the books already in your Library."
- **`IS_DEMO`**: unchanged — `primaryLabel="Open my Library"` → `/library` (demo has no backend/Projects).
- `/trust/new` is `RequireSignIn`, so a not-yet-signed-in first-timer who taps "Start a project" gets the sign-in interstitial (acceptable — it points them to sign in for authoring).

## Testing
**`__tests__/components/TrustJourney.test.tsx`** (pure render):
- 0 sources → Capture is current; the owner next-step text is the add-a-source line.
- sources but no version → Create current ("generate a draft").
- a version, none validated → Validate current; **owner** sees "invite an expert", **reviewer** sees "review … approve".
- a validated version → Share current ("Share it from the Posts tab") for both roles.
- reviewer role never sees owner-only next-step phrasing on earlier phases.

**`__tests__/screens/TrustProjectDetail.journey.test.tsx`**: the workspace renders the Journey stepper (the four phase labels present) above Sources. (Mock `useTrustProject`, mirror the existing detail-test harness.)

**`__tests__/onboarding/TourStep.test.tsx`** (extend or add): non-demo final page shows "Start a project" and pressing it routes to `/trust/new`; demo build keeps "Open my Library" → `/library`. (Mock `expo-router` + `@/constants/demo` `IS_DEMO`.)

**Full suite** + `tsc` + eslint green. **Help:** extend the existing `projects` (or `sources`) topic with a short "the four phases: Capture → Create → Validate → Share" paragraph — no new FEATURES key (avoid coverage churn).

## Out of scope (later slices)
- **Tappable next-step that scrolls to / triggers the relevant control** (slice-1 is descriptive text).
- A "Continue / resume" hero on the Library or Projects landing (surfacing an in-progress project).
- Reviewer-side dedicated review queue framing beyond the one next-step line.
- Projects empty-state hero polish.
- Any theming migration of the workspace.
- Backend "project status" field driving the phase (derived client-side this slice).

## Open items (resolve in the plan, non-blocking)
1. Stepper layout on narrow phones (4 phases in a row) — wrap or scroll; plan picks (a compact row with short labels should fit; else horizontal scroll).
2. Whether the Share next-step deep-links to the Posts tab (`router.push`) or is text-only — spec keeps it **text** this slice (Share is cross-surface; a deep-link is a nice follow-up).
3. Reviewer with multiple artifacts/versions — the next-step line refers to "the latest version" generically; per-version targeting is deferred.
