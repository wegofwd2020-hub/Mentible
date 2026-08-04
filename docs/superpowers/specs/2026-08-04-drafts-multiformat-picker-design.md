# Drafts Multi-format Generate Picker — Design (Project workspace, slice 1)

**Status:** Approved (brainstorming, 2026-08-04)
**Context:** ADR-037 trust workspace. Slice 1 of aligning the Project workspace to the Lovable
prototype IA (Input · Drafts · Feedback · Publish). Companion: PR #370 draft viewer
(`app/trust/version/[versionId].tsx`), spec `docs/superpowers/specs/2026-08-03-trust-draft-viewer-design.md`.

## Problem

The Drafts tab today offers a single hard-coded action — "Generate a draft" on one `book`
artifact (`app/trust/[projectId].tsx` `onAddArtifact("cornerstone","book")` → `generateVersion`).
The target flow (Lovable screens 4/4-linkedin) is a **GENERATE picker**: a menu of destination
formats (LinkedIn post · X thread · Reel script · Podcast cold-open · Long-form essay · Chapter
outline), each generating a draft **of that format**, listed below in a DRAFTS section.

## Goal

A format picker in the Drafts panel: tap a format → a new artifact of that format is created and
a first draft generated with **format-appropriate output**, appearing in the drafts list. Every
generated draft opens in the existing PR #370 viewer (read / edit / regenerate).

## Non-goals (later slices)

- Copy-to-clipboard action (slice 2).
- Feedback = revision-notes log (slice 3).
- Publish = per-asset export / download (slice 4).
- Relocating Approve onto the draft view (slice 2).
- Re-generating v2 from the picker — iteration happens via the viewer's Regenerate (PR #370).

## Core decisions

- **Unified generator.** One generation path; a per-format spec drives the prompt. Content stays
  the `{"sections":[{heading,body,source_ids}]}` shape — a LinkedIn post is 1 section, an essay is
  N sections — so the PR #370 viewer/edit/regenerate pipeline works for **every** format unchanged.
- **Each `+` = a new artifact + a fresh v1.** Iterate a draft via the viewer's Regenerate, not by
  re-tapping the picker.
- **Role is derived, not asked:** `essay`/`book` → `cornerstone`; `linkedin`/`x_thread`/`reel`/
  `podcast` → `derivative`.
- **`essay` is a new format.** The other five already exist in `ARTIFACT_FORMATS`.

## The 6 formats

| Card label | `format` | role | section hint | length / style rule |
|---|---|---|---|---|
| LinkedIn post | `linkedin` | derivative | 1 | 180–260 words. Professional but human. 3–5 hashtags. Clear CTA. |
| X thread | `x_thread` | derivative | 1 | 5–8 tweets in the body, each ≤ 280 chars, punchy, 1–2 hashtags. |
| Reel script | `reel` | derivative | 1 | ~60-second spoken script: hook, body beats, close. |
| Podcast cold-open | `podcast` | derivative | 1 | 60–90 second cold-open monologue. |
| Long-form essay | `essay` | cornerstone | 3–5 | 800–1200 words, section headings + prose. |
| Chapter outline | `book` | cornerstone | 3–6 | Current book behaviour (3–6 sections). |

## Architecture

### Backend (`backend/src/trust/`)

**1. Migration `0011`** — extend the `artifact.format` CHECK constraint (added in `0009`) to include
`'essay'`; downgrade drops it back. Add `'essay'` to `ARTIFACT_FORMATS` in `models.py`.

```sql
-- upgrade
ALTER TABLE artifact DROP CONSTRAINT artifact_format_check;
ALTER TABLE artifact ADD CONSTRAINT artifact_format_check CHECK (format IN
  ('book','guide','learning_module','podcast','youtube','reel','linkedin','x_thread','essay'));
```

(Constraint name confirmed from the DB after `0009`; if it differs, use the actual name.)

**2. `FORMAT_SPECS`** (new `format_specs.py`) — maps each `format` → a spec used by the prompt:

```python
@dataclass(frozen=True)
class FormatSpec:
    min_sections: int
    max_sections: int
    rules: str      # length + style, injected into the prompt

FORMAT_SPECS: dict[str, FormatSpec] = {
    "linkedin": FormatSpec(1, 1, "Write ONE LinkedIn post of 180-260 words as a single section "
                                 "(leave heading empty). Professional but human, 3-5 hashtags, a clear CTA."),
    "x_thread": FormatSpec(1, 1, "Write ONE X thread of 5-8 tweets in the section body, each tweet "
                                 "<= 280 characters on its own line, punchy, 1-2 hashtags total."),
    "reel":     FormatSpec(1, 1, "Write ONE ~60-second reel script as a single section: hook, 2-3 beats, close."),
    "podcast":  FormatSpec(1, 1, "Write ONE 60-90 second podcast cold-open monologue as a single section."),
    "essay":    FormatSpec(3, 5, "Write a long-form essay of 800-1200 words across 3-5 sections with headings."),
    "book":     FormatSpec(3, 6, "Write 3 to 6 sections."),   # current behaviour
}
DEFAULT_SPEC = FORMAT_SPECS["book"]
```

**3. `build_draft_prompt` becomes format-aware.** It already receives `artifact_format`; today it
hard-codes "3 to 6 sections". Change it to look up `FORMAT_SPECS.get(artifact_format, DEFAULT_SPEC)`
and inject `spec.rules` + the section-count range into the prompt instead of the fixed text. The
JSON schema line and citation discipline are unchanged. `generate_draft` / the `generate_version`
router handler pass `artifact_format` already — **no endpoint change**.

**4. `_DraftOutput` bound.** Today `sections: list[_DraftSection] = Field(min_length=1, max_length=6)`.
Keep `min_length=1`; the max stays `6` (essay ≤ 5, book ≤ 6 both fit). The prompt (not the schema)
enforces the per-format range; the schema stays a permissive guardrail.

### Mobile (`mobile/`)

**5. `src/constants/draftFormats.ts`** — the picker catalog:

```ts
export interface DraftFormat { format: string; label: string; hint: string; role: "cornerstone" | "derivative" }
export const DRAFT_FORMATS: DraftFormat[] = [
  { format: "linkedin", label: "LinkedIn post",     hint: "180–260 words",  role: "derivative" },
  { format: "x_thread", label: "X thread",          hint: "5–8 tweets",     role: "derivative" },
  { format: "reel",     label: "Reel script",       hint: "60 seconds",     role: "derivative" },
  { format: "podcast",  label: "Podcast cold-open",  hint: "60–90 sec",     role: "derivative" },
  { format: "essay",    label: "Long-form essay",   hint: "800–1200 words", role: "cornerstone" },
  { format: "book",     label: "Chapter outline",   hint: "book",           role: "cornerstone" },
];
```

**6. Hook helper** — `useTrustProject.generateFormat(fmt: DraftFormat)`: `createArtifact(projectId,
{role, format, title: label})` → `generateVersion(artifact.id)` → `refresh()`. Reuses the existing
`addArtifact` + `generateVersion`; a thin orchestrator so the panel stays declarative. Returns the
new artifact id (for optional navigation).

**7. DraftsPanel GENERATE section** (`app/trust/[projectId].tsx`) — replace the single
"Generate a draft" / "Add an artifact" controls with a **GENERATE** list of the 6 format cards
(label + hint + `+`), matching the Lovable layout. Owner-only (unchanged gate). Tapping a card →
`generateFormat` with a per-card busy state (disable that card + show spinner; disable all when
`inputs.length === 0`, with the existing "Add a source first" hint). The **DRAFTS** list below
already renders per-artifact (`project.artifacts.map`), labelled by `artifact.title ?? format` +
each version — no change needed; generated drafts appear there and open the PR #370 viewer on tap
(built in slice 0 / task 7). Reviewers see the DRAFTS list only (no GENERATE picker).

**8. Empty state.** When no artifact exists, show the GENERATE picker directly (the picker *is* the
create affordance) — drop the separate "Add an artifact" button and its `onAddArtifact` handler.
`deriveProjectPhase`'s `create_artifact` sub-state still resolves to the `create` tab; the picker
renders in that tab whether or not an artifact exists.

## Data flow

```
Drafts tab (owner) → tap "LinkedIn post" +
  → generateFormat({format:"linkedin", role:"derivative", label:"LinkedIn post"})
  → createArtifact(projectId, {role:"derivative", format:"linkedin", title:"LinkedIn post"})
  → generateVersion(artifactId)              # owner-only; uses FORMAT_SPECS["linkedin"] in the prompt
  → new artifact_version v1 ({sections:[{heading:"",body:<post>,source_ids:[…]}]})
  → refresh → draft appears under DRAFTS → tap → PR #370 viewer
```

## Error handling

- Generation errors surface via the existing generate error path (`ApiError.userMessage()` /
  the 502/429 messages) on the tapped card; the card re-enables.
- Missing API key / no sources: the existing guards apply (key error from the hook; "Add a source
  first" when `inputs` is empty).

## Testing

**Backend (pytest, mocked LLM):**
- Migration round-trip: `essay` accepted by the CHECK after `0011`; rejected before / after downgrade.
- `build_draft_prompt` includes the per-format rule text: a `linkedin` prompt contains the
  LinkedIn rule and "1" section framing; an `essay` prompt contains the 800–1200 / 3–5 framing;
  a `book` prompt is unchanged ("3 to 6 sections").
- Unknown format falls back to `DEFAULT_SPEC` (book) without error.
- `create_artifact` with `format="essay"` succeeds (owner-only, persists).

**Mobile (Jest + RNTL):**
- DraftsPanel renders the 6 format cards with labels + hints (owner); reviewer sees none.
- Tapping a card calls `generateFormat` with that card's `{format, role, label}`; per-card busy
  state disables it; all disabled when `inputs` empty.
- `generateFormat` calls `createArtifact({role,format,title})` then `generateVersion(newId)`.
- Existing DraftsPanel / journey / owner suites stay green (the DRAFTS list + phase logic unchanged).

## Files

**Backend**
- `alembic/versions/0011_artifact_format_essay.py` (new).
- `src/trust/models.py` — add `"essay"` to `ARTIFACT_FORMATS`.
- `src/trust/format_specs.py` (new) — `FormatSpec` + `FORMAT_SPECS`.
- `src/trust/draft_prompt.py` — format-aware prompt via `FORMAT_SPECS`.
- Tests: `backend/tests/test_trust_draft.py`, `backend/tests/test_trust_router.py` (essay artifact).

**Mobile**
- `src/constants/draftFormats.ts` (new).
- `src/hooks/useTrustProject.ts` — `generateFormat`.
- `app/trust/[projectId].tsx` — DraftsPanel GENERATE picker (replaces single generate / add-artifact).
- Tests: `mobile/__tests__/screens/TrustProjectDetail.*` (new picker test + keep existing green).

## Rollout note

Backend adds a **migration** (`0011`) + a new format. On ship, the prod backend must run
`alembic upgrade head` (the refresh runbook's step 6 does real work this time) or `create_artifact`
with `format="essay"` fails the CHECK on prod. (Recurring "refresh prod backend" reminder.)
