# Tamil STT Capture — Slice 3 (Review UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the transcript review surface: an owner opens a transcript, edits segment text, tags speakers, saves a new immutable version, and approves it inline — closing the Capture → Validate loop.

**Architecture:** A pushed route `app/trust/transcript/[artifactId].tsx` loads the transcript version (transcript-typed fetch — the content shape differs from drafts), renders an editable segment list with confidence shading, and reuses `useTrustProject`'s `addVersion` (save) + `approve`/`unapprove` (the existing approval path). Slice 2's capture card is rewired to navigate here on success. Stacked on `feat/stt-capture-slice2` (#512); rebase onto main after it merges.

**Tech Stack:** React Native + Expo (SDK 53, Hermes), expo-router, Jest + RNTL.

**Spec:** `docs/superpowers/specs/2026-09-04-tamil-stt-capture-design.md` (§6.2 Review, §6.3 Help gate, §7 slice 3)

## Global Constraints

- Transcript version content shape (backend, on main): `{ language: string, segments: [{ text, start, end, confidence, speaker }], source_audio_ref, stt_meta: { provider, model } }`. `start`/`end`/`confidence` may be null; `speaker` is null until tagged.
- The existing draft version viewer (`trust/version/[versionId].tsx`) renders `content.sections` — it will NOT render transcript segments. The review surface is separate.
- Save = `useTrustProject().addVersion(artifactId, content)` → new immutable `artifact_version`. Then approve via `useTrustProject().approve(versionId)` (owner/reviewer) — the same append-only approval with `recorded_via` the draft path uses.
- Screen: `useThemedStyles` (selected theme), wrapped in `RequireSignIn`, early-returns under `IS_DEMO`, root `ScrollView` uses `flex: 1` (RN-web + New-Arch text-collapse traps). Import `Alert` from `@/lib/alert`.
- Navigation params match the existing version viewer: `{ artifactId, versionId, projectId }`.
- **DoD Help gate:** add a `FEATURES` key + matching topic + a reachable `HELP_TREE` leaf in the SAME PR (two gates: `coverage.test.ts` AND `tree.test.ts`).
- Run FULL `npx jest` + `npx tsc --noEmit` before finishing.

---

### Task 1: Transcript-typed version fetch

**Files:**
- Modify: `mobile/src/api/trustClient.ts`
- Test: `mobile/__tests__/api/getTranscriptVersion.test.ts`

**Interfaces:**
- Produces:
  - `interface TranscriptSegment { text: string; start: number | null; end: number | null; confidence: number | null; speaker: string | null }`
  - `interface TranscriptContent { language: string; segments: TranscriptSegment[]; source_audio_ref?: string; stt_meta?: { provider?: string; model?: string } }`
  - `interface TranscriptVersionDetail { id: string; artifact_id: string; version_no: number; content: TranscriptContent; is_validated: boolean; recorded_via: string | null; created_at: string | null }`
  - `async function getTranscriptVersion(versionId: string, token: string): Promise<TranscriptVersionDetail>` — GET `/versions/{id}` (the same endpoint `getVersion` uses), transcript-typed.

- [ ] **Step 1: Write the failing test** — mock `global.fetch` to return a transcript-shaped body; assert URL `…/api/v1/trust/versions/v1`, bearer header, and that `.content.segments[0].speaker` is preserved (null passes through).

```typescript
// mobile/__tests__/api/getTranscriptVersion.test.ts
import { getTranscriptVersion } from "@/api/trustClient";

jest.mock("@/api/client", () => ({
  resolveBaseUrl: () => "https://api.test",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, body: string) { super(body); this.status = status; }
  },
}));

it("GETs /versions/{id} and returns the transcript content", async () => {
  const body = {
    id: "v1", artifact_id: "a1", version_no: 1, is_validated: false, recorded_via: null, created_at: null,
    content: { language: "ta", segments: [{ text: "வணக்கம்", start: 0, end: 1.2, confidence: 0.4, speaker: null }], stt_meta: { provider: "groq", model: "whisper-large-v3" } },
  };
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => "" });
  (global as unknown as { fetch: unknown }).fetch = fetchMock;

  const out = await getTranscriptVersion("v1", "tok");
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.test/api/v1/trust/versions/v1");
  expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok");
  expect(out.content.segments[0]).toMatchObject({ text: "வணக்கம்", confidence: 0.4, speaker: null });
});
```

- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — add the interfaces near `VersionDetailView`, and the fetch (reuse `trustFetch`):

```typescript
export interface TranscriptSegment { text: string; start: number | null; end: number | null; confidence: number | null; speaker: string | null }
export interface TranscriptContent { language: string; segments: TranscriptSegment[]; source_audio_ref?: string; stt_meta?: { provider?: string; model?: string } }
export interface TranscriptVersionDetail {
  id: string; artifact_id: string; version_no: number;
  content: TranscriptContent;
  is_validated: boolean; recorded_via: string | null; created_at: string | null;
}

// GET a transcript version. Same /versions/{id} endpoint as getVersion, but the
// stored content is a transcript ({segments}), not a draft ({sections}) — so it
// gets its own type rather than a lie-typed cast.
export async function getTranscriptVersion(versionId: string, token: string): Promise<TranscriptVersionDetail> {
  return (await trustFetch<TranscriptVersionDetail>(`/versions/${versionId}`, token, { method: "GET" })) as TranscriptVersionDetail;
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(stt): transcript-typed version fetch`.

---

### Task 2: Pure segment helpers

**Files:**
- Create: `mobile/src/lib/transcriptSegments.ts`
- Test: `mobile/__tests__/lib/transcriptSegments.test.ts`

**Interfaces:**
- Consumes: `TranscriptSegment`, `TranscriptContent` (Task 1); `Palette` (`@/constants/theme`).
- Produces:
  - `type EditableSegment = TranscriptSegment & { key: string }` — a stable render key (index-based; segment order is otherwise stable).
  - `toEditable(segments: TranscriptSegment[]): EditableSegment[]`
  - `updateSegment(list: EditableSegment[], key: string, patch: Partial<Pick<TranscriptSegment, "text" | "speaker">>): EditableSegment[]` — immutable update.
  - `orderLowConfidenceFirst(list: EditableSegment[]): EditableSegment[]` — stable sort, nulls treated as lowest confidence (surfaced first); ties keep original order.
  - `confidenceTone(confidence: number | null): "low" | "medium" | "high"` — `< 0.5` low, `< 0.8` medium, else high; null → low.
  - `segmentsForSave(edited: EditableSegment[], original: TranscriptContent): TranscriptContent` — strip the `key`, preserve `language`/`source_audio_ref`/`stt_meta`.
  - `speakerNames(list: EditableSegment[]): string[]` — distinct non-empty speaker names, in first-seen order (for quick-assign chips).

- [ ] **Step 1: Write failing tests** covering: `updateSegment` changes only the matching key and is immutable; `orderLowConfidenceFirst` puts null/low before high and is stable on ties; `confidenceTone` boundaries (0.49→low, 0.5→medium, 0.8→high, null→low); `segmentsForSave` drops `key` and preserves `language`/`stt_meta`; `speakerNames` dedupes in order.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the helpers (pure, no RN imports beyond the `Palette` type).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(stt): transcript segment helpers`.

---

### Task 3: Transcript review screen

**Files:**
- Create: `mobile/app/trust/transcript/[artifactId].tsx`
- Test: `mobile/__tests__/screens/TranscriptReview.test.tsx`

**Interfaces:**
- Consumes: `getTranscriptVersion`, `TranscriptVersionDetail` (Task 1); helpers (Task 2); `useTrustProject` (`addVersion`, `approve`, `unapprove`, `accessToken`); `RequireSignIn`; `IS_DEMO`/`demoBlocked`; `PageContainer`; theme.
- Route params: `{ artifactId, versionId, projectId }` via `useLocalSearchParams`.

**Behavior:**
- Under `IS_DEMO`, render a short "not available in the demo" notice and stop.
- Load `getTranscriptVersion(versionId)` into editable segments; show a spinner while loading, an error line on failure.
- Each segment row: confidence tone shading (a left border / tint via `confidenceTone`), an editable text `TextInput`, a speaker `TextInput` plus quick-assign chips from `speakerNames`.
- A "Low-confidence first" toggle reorders via `orderLowConfidenceFirst` (default on — surfaces what needs attention).
- **Save** → `addVersion(artifactId, segmentsForSave(edited, original))` → on success, load the new version (`getTranscriptVersion(newId)`) so the view now reflects the saved, not-yet-approved version, and its version_no updates.
- **Approve / Withdraw** (inline, owner/reviewer): `approve(currentVersionId)` / `unapprove(currentVersionId)`; reflect `is_validated` + a `recorded_via` badge (reuse the version viewer's badge copy: `expert_self` → "You approved", `operator` → "Recorded by operator").
- Root `ScrollView` `flex: 1`; `useThemedStyles`; `Alert` from `@/lib/alert`.

- [ ] **Step 1: Write the failing test** — mock `getTranscriptVersion` (2 segments, one low-confidence), `useTrustProject` (`addVersion` returns `{id:"v2"}`, `approve` a jest.fn, `accessToken:"tok"`), `expo-router` `useLocalSearchParams`. Assert: both segment texts render; editing a segment's text then Save calls `addVersion` with a content whose edited segment text changed and whose `stt_meta` is preserved; pressing Approve calls `approve`.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the screen. Mirror `trust/version/[versionId].tsx` structure: an inner component + a default export, `makeStyles(c: Palette)`, back button, header with version_no + provenance/badge, then the segment list and the Save/Approve actions. Wrap the default export in `RequireSignIn action="review a transcript"`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `feat(stt): transcript review screen`.

---

### Task 4: Navigate from the capture card into review

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (the slice-2 capture card success handler)
- Test: covered by the full suite; extend the existing capture wiring if a screen test exists.

**Behavior:** replace the slice-2 success `Alert` with navigation to the review screen, passing `{ artifactId, versionId, projectId }` from the transcribe result. `SourcesPanel` needs the projectId + a router push; thread a `projectId` prop and use `useRouter()` (or pass an `onTranscribed(result)` callback the parent implements with its existing `router`).

- [ ] **Step 1:** Thread what the panel needs. The parent (`[projectId].tsx`) already has `router` and `projectId`; simplest is to pass an `onTranscribed: (r: { artifact_id: string; version_id: string }) => void` prop that does the `router.push`, and have `onSubmitAudio` call it instead of Alerting. Keep the error Alert.
- [ ] **Step 2:** Implement the parent's `onTranscribed`:

```typescript
const onTranscribed = (r: { artifact_id: string; version_id: string }) =>
  router.push({ pathname: "/trust/transcript/[artifactId]", params: { artifactId: r.artifact_id, versionId: r.version_id, projectId: String(projectId) } });
```

Pass `onTranscribed={onTranscribed}` to `SourcesPanel`; in `onSubmitAudio`, `const r = await onTranscribe(...); onTranscribed(r);` (type `onTranscribe`'s result as `{ artifact_id: string; version_id: string }` — it already resolves `TranscribeJobResult`).

- [ ] **Step 3:** Run `npx tsc --noEmit` + the trust screen tests.
- [ ] **Step 4: Commit** — `feat(stt): navigate to review after transcription`.

---

### Task 5: Help feature + topic + tree leaf

**Files:**
- Modify: `mobile/src/help-content/features.ts`, `topics.ts`, `tree.ts`
- Test: `mobile/__tests__/help/coverage.test.ts` + `tree.test.ts` (gates)

- [ ] **Step 1:** Add to `FEATURES`: `{ key: "transcript-review", label: "Reviewing a transcript (edit, tag speakers, approve)" }`.
- [ ] **Step 2: Run `npx jest help/coverage`, verify it FAILS** (no topic).
- [ ] **Step 3:** Add the `transcript-review` topic in `topics.ts` (`featureKey: "transcript-review"`): open a transcript from the capture card; fix segment text; tag who's speaking; low-confidence segments surface first; Save makes a new version; Approve records validation. Follow the existing topic shape (text blocks + a steps block).
- [ ] **Step 4:** Add a tree leaf in `tree.ts` next to `leaf-capture-audio`: `{ id: "leaf-transcript-review", title: "Review a transcript", topicId: "transcript-review" }`.
- [ ] **Step 5: Run `npx jest help/`, verify PASS.**
- [ ] **Step 6: Run FULL `npx jest` + `npx tsc --noEmit`.**
- [ ] **Step 7: Commit** — `feat(stt): review Help topic`.

---

## Verification (post-tasks)

- `npx jest` (full, green) + `npx tsc --noEmit` (clean).
- `mobile:verify` on emulator (once prod/staging backend is at #510 + managed STT key): upload → transcript lands → review screen opens → edit a segment + tag a speaker → Save (new version) → Approve → validated badge.
