# Per-topic panel alignment — S1: Revise + hierarchy — Design

**Status:** Approved (brainstorming, 2026-08-12). First sub-slice of the full-parity arc aligning the
per-topic draft viewer (`mobile/app/trust/topic-version/[id].tsx`) to the whole-book unified panel
(#412). S1 is **UI-only, no backend**. Follow-ons: S2 provenance + inline history (small backend),
S3 reviewer feedback thread + revise-from-note (backend migration), S4 optional manual edit.

## Problem

The per-topic viewer only offers **view + Approve/Withdraw**. The whole-book panel lets an owner
**Revise → a new version** (with guidance). Per-topic has no revise in the viewer — regeneration lives
only in the Drafts list — so the two panels feel inconsistent and a reviewer/owner reading a topic
draft can't act on it beyond approving.

## Goal

Give the owner a **Revise → new topic version (with guidance)** action in the topic viewer, with the
same hierarchy as the whole-book panel (**Approve** the single filled primary, **Revise** secondary).
Mobile-only, no backend — the topic-generate endpoint already accepts `guidance`.

## Locked decisions

1. **UI-only.** The backend `/projects/{id}/topics/{topic_id}/generate` already accepts
   `DraftGenerateIn.guidance`; wire it through the client + hook.
2. **Revise is secondary, Approve is primary** (`Button variant="ghost"` vs `variant="primary"`) —
   the topic viewer already uses `Button` primitives, so no custom two-pill styling needed.
3. **After a successful Revise, navigate to the new version** (`router.replace` to
   `/trust/topic-version/{newId}?projectId=…`) so the owner sees the fresh draft.
4. **Deferred to later sub-slices:** provenance line (S2, needs `generation_meta` exposed), inline
   version history (S2), reviewer feedback / revise-from-note (S3), manual edit (S4), Copy.

## Architecture

### A. Guidance wiring (no backend)
- `mobile/src/api/trustClient.ts` `generateTopic(projectId, topicId, body, token)`: widen `body` to
  `{ api_key: string; provider_id?: string; model?: string; guidance?: string }` and it already
  JSON-stringifies the whole body, so `guidance` flows to the endpoint (which reads
  `DraftGenerateIn.guidance`).
- `mobile/src/hooks/useTrustProject.ts` `generateTopic`: signature →
  `generateTopic(topicId: string, opts?: { guidance?: string })`; pass
  `{ api_key: key, provider_id: "anthropic", guidance: opts?.guidance }` (omit/undefined guidance is
  fine — backend default is None). Existing caller in the Drafts list (`generateTopic(topicId)`) is
  unaffected (opts optional).

### B. Revise flow in the viewer (`topic-version/[id].tsx`)
- New state: `regen` (bool), `guidance` (string), `genBusy` (bool) — mirror the whole-book viewer.
- Owner-only **"Revise"** `Button variant="ghost"` in the actions row (next to Approve/Withdraw). On
  press → `openRegen()`: if `topicVersion.is_validated`, first confirm via `Alert` ("Revise a
  validated draft? This creates a new version. The approval on v{n} stays; the new version needs
  re-approval." Cancel / Revise); then set `regen=true`.
- When `regen`, render a guidance `TextInput` (placeholder "Describe the change — a new version is
  created", `maxLength={500}`, multiline) + a "Generate new version" `Button variant="primary"`
  (`busy={genBusy}`). On submit:
  `const nv = await generateTopic(topicVersion.topic_id, { guidance: guidance.trim() || undefined });`
  then `router.replace(\`/trust/topic-version/${nv.id}?projectId=${projectId}\`)`. On error, `Alert`
  ("Couldn't revise", `e instanceof ApiError ? e.userMessage() : "Try again."`).
- Approve stays `variant="primary"` (single filled primary); Withdraw stays `variant="ghost"`.
- Defensive: the Revise control only renders when `topicVersion` is loaded and `isOwner`.

## Testing

- **Client/hook**: `generateTopic(topicId, { guidance: "x" })` sends `guidance:"x"` in the POST body
  (mock `trustFetch`/fetch); `generateTopic(topicId)` (no opts) still works, no `guidance` key or
  `undefined`.
- **Viewer**: owner sees a "Revise" control (ghost); pressing it (unvalidated version → no confirm)
  reveals a guidance box; submitting calls the hook `generateTopic` with `{ guidance }` and navigates
  (`router.replace`) to the returned version id. Reviewer does NOT see Revise. Approve remains present
  as the primary. No color-literal asserts.

## Files

- Modify: `mobile/src/api/trustClient.ts` (generateTopic body type)
- Modify: `mobile/src/hooks/useTrustProject.ts` (generateTopic opts)
- Modify: `mobile/app/trust/topic-version/[id].tsx` (Revise flow)
- Tests under `mobile/__tests__/`

## Decomposition (SDD)

- **T1 — guidance wiring** (client + hook + tests).
- **T2 — viewer Revise flow + hierarchy** (topic-version viewer + tests). Depends on T1.

## Rollout

Mobile-only → **web redeploy**, no backend, no migration.

## Out of scope (later sub-slices)

Provenance line + inline history (S2); reviewer feedback thread + revise-from-note (S3); manual edit
(S4); Copy; any backend change.

## Global constraints

Mobile-only, no backend/generation-behavior change (guidance already accepted server-side). Owner-only
Revise; reviewer unaffected. Read `project`/`topicVersion` defensively. `useThemedStyles`; reuse
`Button` primitives + existing styles; **no color-literal test asserts**. `npx tsc --noEmit` clean +
full `npx jest` green. Commit messages end with `Co-Authored-By: Claude Opus 4.8
<noreply@anthropic.com>`.
