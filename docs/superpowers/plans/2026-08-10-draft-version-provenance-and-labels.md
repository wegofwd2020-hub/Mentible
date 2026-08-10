# Draft version provenance + action labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the draft versioning model legible: (1) a provenance line on the open draft version screen ("Generated from N sources / with your guidance"), and (2) clearer whole-book Drafts labels distinguishing "start a new draft" (new artifact → v1) from "regenerate" (new version).

**Architecture:** A pure `describeProvenance(generation_meta)` helper rendered on the version screen; copy/label changes in the whole-book Drafts phase. No generation-behavior change, no backend.

**Tech Stack:** React Native + Expo TS; Jest/RNTL.

## Global Constraints

- Design: `docs/superpowers/specs/2026-08-10-draft-version-provenance-and-labels-design.md`.
- **Copy/label + one pure helper only — NO generation-behavior change.** Do not touch the per-artifact/in-version "Regenerate", per-topic mode, or any generate call.
- Read `generation_meta` (`Record<string, unknown> | null`) **defensively** — older/null/oddly-typed metas must NOT crash.
- `useThemedStyles`; reuse existing muted/heading styles; **NO color-literal test asserts**.
- `npx tsc --noEmit` clean + full `npx jest` green. Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `mobile/src/lib/draftProvenance.ts` — NEW: `describeProvenance` (T1)
- `mobile/app/trust/version/[versionId].tsx` — provenance line under the title (T1)
- `mobile/app/trust/[projectId].tsx` — whole-mode labels + "Your drafts" header (T2)
- Tests under `mobile/__tests__/`

---

### Task 1: Provenance line on the draft version screen

**Files:**
- Create: `mobile/src/lib/draftProvenance.ts`
- Modify: `mobile/app/trust/version/[versionId].tsx`
- Test: `mobile/__tests__/lib/draftProvenance.test.ts` (new) + the version screen's test (extend)

**Interfaces:**
- Produces: `describeProvenance(meta: Record<string, unknown> | null | undefined): string`.

- [ ] **Step 1: Write the failing test** (`draftProvenance.test.ts`):
```ts
import { describeProvenance } from "@/lib/draftProvenance";
it("summarizes sources and guidance", () => {
  expect(describeProvenance({ source_input_ids: ["a", "b", "c"] })).toContain("3 sources");
  const g = describeProvenance({ source_input_ids: ["a"], guidance: "focus on X" });
  expect(g).toContain("1 source");
  expect(g).toContain("with your guidance");
});
it("never throws on null / empty / malformed meta", () => {
  expect(typeof describeProvenance(null)).toBe("string");
  expect(typeof describeProvenance({})).toBe("string");
  expect(typeof describeProvenance({ source_input_ids: "nope" as unknown as string[] })).toBe("string");
});
```

- [ ] **Step 2: Run — verify fail** — `cd mobile && npx jest __tests__/lib/draftProvenance.test.ts`.

- [ ] **Step 3: Implement `draftProvenance.ts`:**
```ts
// Human-readable provenance for a draft version, from its generation_meta.
// Defensive: older/null/oddly-typed metas must never throw.
export function describeProvenance(meta: Record<string, unknown> | null | undefined): string {
  const ids = meta?.["source_input_ids"];
  const n = Array.isArray(ids) ? ids.length : 0;
  const base = n > 0 ? `Generated from ${n} source${n === 1 ? "" : "s"}` : "Generated draft";
  const guidance = meta?.["guidance"];
  const hasGuidance = typeof guidance === "string" && guidance.trim().length > 0;
  return hasGuidance ? `${base} · with your guidance` : base;
}
```

- [ ] **Step 4: Render it on the version screen.** In `trust/version/[versionId].tsx`, import `describeProvenance`. In VIEW mode, directly under the `<Text style={styles.title}>v{version.version_no}</Text>` (in the header block), add a muted line: `<Text style={styles.provenance}>{describeProvenance(version.generation_meta)}</Text>` — add a `provenance` style to `makeStyles` mirroring the existing muted caption (e.g. `{ color: c.textMuted, fontSize: typography.sizeSm, marginTop: 2 }`). Do NOT change edit/approve/withdraw/notes.

- [ ] **Step 5: Extend the version screen test** — assert the provenance line renders for a version whose `generation_meta` has `source_input_ids` (substring "source"); a null-meta version still renders (fallback string, no crash). Keep existing assertions. No color literals.

- [ ] **Step 6: Run** — `cd mobile && npx jest __tests__/lib/draftProvenance.test.ts __tests__ -t "[Vv]ersion" && npx tsc --noEmit`.

- [ ] **Step 7: Commit.**
```bash
git add mobile/src/lib/draftProvenance.ts "mobile/app/trust/version/[versionId].tsx" mobile/__tests__
git commit -m "feat(trust): show a draft version's provenance (sources + guidance) under its title"
```

---

### Task 2: Whole-book Drafts action labels

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: its existing test (extend)

**Interfaces:** none new — copy/label + a section header.

- [ ] **Step 1: READ the whole-mode Drafts block** in `trust/[projectId].tsx` (`mode === "whole"`): the Generate block has `<Text style={styles.artifactTitle}>Generate</Text>` above the `DRAFT_FORMATS.map` format grid; each card has `accessibilityLabel={\`Generate ${f.label}\`}`; below is the `artifacts.map` list of existing drafts.

- [ ] **Step 2: Write/extend the test** — assert (web/RNTL): the new-draft heading text is "Start a new draft"; the hint text ("new version" / "Regenerate" phrasing) is present; a format card's accessibilityLabel is "Start a new {label} draft"; a "Your drafts" header renders. Keep per-topic + generation assertions unchanged. No color literals.

- [ ] **Step 3: Implement (copy/label only).**
  - Change the Generate heading `Generate` → `Start a new draft`.
  - Add a hint `<Text>` under it (reuse `styles.genHint` or an existing muted style): "Creates a fresh draft (v1). To make a new version of an existing draft, open it and Regenerate."
  - Change each format card's `accessibilityLabel` from `` `Generate ${f.label}` `` → `` `Start a new ${f.label} draft` ``.
  - Add a section header above the `artifacts.map` (only when `artifacts.length > 0`): `<Text style={styles.artifactTitle}>Your drafts</Text>` (reuse the existing heading style).
  - Do NOT change `onGenerateFormat`, the per-artifact Regenerate, per-topic mode, or any behavior.

- [ ] **Step 4: Run** — `cd mobile && npx jest __tests__ -t "[Pp]roject" && npx tsc --noEmit` (or the nearest existing test name for `[projectId]`).

- [ ] **Step 5: Commit.**
```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__
git commit -m "feat(trust): label the whole-book Generate grid 'Start a new draft' + a Your drafts header"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit && npx eslint .` — full suite green + clean.
- [ ] No generation-behavior change (grep the diff: no touched generate/create calls); `generation_meta` read only via `describeProvenance`.
- [ ] **Web screenshot verify:** open a draft version → provenance line shows under v{n}; whole-book Drafts phase reads "Start a new draft" + hint + "Your drafts" list.
- [ ] PR body: version provenance + clearer whole-book labels; mobile-only → web redeploy, no backend.

## Self-Review

- **Spec coverage:** provenance helper + version-screen line (T1) · whole-mode labels + header (T2). Drafts-list provenance + Input-versioning correctly out of scope.
- **Type consistency:** `describeProvenance(meta)` consumes `VersionDetailView.generation_meta` (`Record<string, unknown> | null`); defensive reads.
- **Constraints:** copy/label + one pure helper; no generation change; defensive meta; no color-literal asserts.
