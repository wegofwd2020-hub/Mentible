# Trust Journey — Phase Accuracy (Phase B slice 3) — Design Spec

**Status:** Approved (2026-07-30) · **ADR-037 Phase B slice 3** · refines the merged Journey (PR #357/#358) so its guidance is correct in every state.
**Scope:** two correctness fixes to `TrustJourney` (+ one workspace scroll target): (1) split the **Create** phase into "add an artifact" vs "generate a draft" so the handhold points at the control that actually exists; (2) tighten **Validate/Share readiness** so a project with an unvalidated/empty artifact doesn't read "ready to share." Mobile only, no backend change.

## Why
Slice 1/2 shipped the Journey + actionable next-step, but the derivation has two holes the review flagged / this exposes:
1. **Create mis-guide:** a fresh project (sources captured, **no artifact yet**) shows "Next: generate a draft" and its tap scrolls to an **empty Artifacts region** — there is no Generate button until an artifact exists (the owner must "Add an artifact" first). The handhold points at a missing control.
2. **Premature "ready to share":** `validate.done` uses `.some` (any version validated), so a project with one validated artifact **plus a second artifact still holding an unvalidated (or empty) draft** reads as "Share it from the Posts tab" — overclaiming completion.

## Grounding (verified)
- `src/components/TrustJourney.tsx`: derives `captured/created/validated` from `ProjectDetailView` (`inputs`, `artifacts[].versions[].is_validated`); `nextStep(currentKey, isOwner)`; the current phase = first not-done; slice-2 `onNext(currentKey)`.
- `app/trust/[projectId].tsx`: the owner **"Add an artifact"** control lives in `styles.ownerBlock` (anchored by `ownerActionsY`); **"Generate a draft"** is per-artifact in the artifacts region (anchored by `artifactsY`). `onNextAction` switch maps phase keys → scroll anchors / `/posts`.
- The workspace's "Add an artifact" creates `role:"cornerstone", format:"book"`; multi-artifact is possible but uncommon.

---

## New phase model (`TrustJourney.tsx`)
```ts
const captured = (detail.inputs?.length ?? 0) > 0;
const hasArtifact = detail.artifacts.length > 0;
const anyVersion = detail.artifacts.some((a) => a.versions.length > 0);
// Every artifact must have a validated version (and there must be ≥1 artifact) —
// an artifact with only unvalidated drafts, or a fresh empty artifact, keeps the
// project in Validate rather than falsely reading "ready to share".
const allValidated = hasArtifact && detail.artifacts.every((a) => a.versions.some((v) => v.is_validated));

const phases = [
  { key: "capture",  label: "Capture",  done: captured },
  { key: "create",   label: "Create",   done: anyVersion },
  { key: "validate", label: "Validate", done: allValidated },
  { key: "share",    label: "Share",    done: false },
];
const currentIdx = phases.findIndex((p) => !p.done);  // Share never done → always ≥0
```

### Create sub-step (only when Create is the current phase, i.e. `captured && !anyVersion`)
- **no artifact** (`!hasArtifact`): next-step **"Next: add an artifact to hold your draft."** (owner) — the actionable key is **`"create_artifact"`**.
- **artifact, no version** (`hasArtifact`): next-step **"Next: generate a draft from your sources below."** (owner) — key `"create"`.
- Reviewer copy for Create stays generic ("Waiting for the owner to create a draft.").

So the **key passed to `onNext`** for the current phase is: `create` → resolved to `"create_artifact"` when `!hasArtifact`, else `"create"`; all other phases pass their own key unchanged. (Implement as: `const currentKey = phases[currentIdx].key === "create" && !hasArtifact ? "create_artifact" : phases[currentIdx].key;` and drive both the `nextStep` text and `onNext(currentKey)` from it.)

`nextStep()` gains a `"create_artifact"` arm ("add an artifact…"); the existing `"create"` arm stays "generate a draft…". No change to capture/validate/share copy.

## Workspace scroll target (`app/trust/[projectId].tsx`)
`onNextAction` gains one case:
```ts
case "create_artifact": scrollTo(ownerActionsY.current); break;  // the "Add an artifact" control
```
(`create` still → `artifactsY`; capture → `sourcesY`; validate → owner? `ownerActionsY` : `artifactsY`; share → `router.push("/posts")`.)

## Testing
**`TrustJourney.test.tsx`** (extend):
- captured + **no artifact** → Create current, next-step is the **"add an artifact"** copy; with `onNext`, pressing reports **`"create_artifact"`**.
- captured + **artifact, no version** → Create current, "generate a draft"; `onNext` reports `"create"`. (Build a detail with an artifact that has `versions: []`.)
- **one validated artifact + a second artifact with an unvalidated draft** → **Validate** is still current (NOT Share); the Share copy does NOT render.
- one validated artifact + a second **empty** artifact (`versions: []`) → Validate still current (empty artifact's `.some` is false → `every` fails).
- a **single** validated artifact → Share current (unchanged happy path).
- existing tests (capture with no data, plain-text-without-onNext, etc.) still pass — adjust any that assumed the old `.some`/single-Create-copy if needed.

**`TrustProjectDetail.journey.test.tsx`** (extend): a captured-but-no-artifact owner project → pressing the next-step calls `onNext("create_artifact")` path (no throw; `mockPush` not called). Share happy-path (single validated) → `push("/posts")` still works.

Full suite + `tsc` + `eslint` green. No Help/FEATURES change.

## Out of scope (later)
- Per-artifact / per-version next-step targeting in the Validate phase (copy stays generic).
- Distinguishing cornerstone vs derivative artifacts in the phase model (all workspace artifacts are cornerstone today).
- The resume/continue hero, post-scroll highlight, reviewer review-queue framing.
- Any backend "project status" field.

## Open items (resolve in the plan, non-blocking)
1. Exact "add an artifact" copy wording — plan keeps it short + house-style.
2. Whether an artifact the owner added but hasn't drafted should show a distinct Validate sub-message ("finish the second draft") — deferred; generic Validate copy is acceptable this slice.
3. Confirm no existing TrustJourney test asserted the old premature-share behavior (update if so).
