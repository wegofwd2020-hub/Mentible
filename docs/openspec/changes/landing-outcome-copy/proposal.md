# Change: Landing page outcome copy ("How it works" + hero)

## Why

The landing page explained what the software does, not what the end user gets.
This change adds outcome copy: a hero sub-line, a stat, a "How it works" heading,
and a "You get" line under each of the four steps, plus one illustrative example.

Source brief: `mentible-site-update-instructions.md` (owner draft copy).

## What changes

Source files (React Native / Expo web, rendered at mentible.app):

- `mobile/src/components/landing/Hero.tsx`
  - Sub-copy replaced with the outcome line.
  - Stat "1 source / book + derivatives" replaced with "Eleven formats / from one approved source".
- `mobile/src/components/landing/Phases.tsx`
  - Heading replaced: "From your material to a published book, with every claim traceable."
  - Steps 01–04 use the draft descriptions. Step 04 is renamed "Share" to "Publish".
  - Each step gets a visually distinct "You get:" line (muted, top rule, bold label).
  - Example block added below the steps, marked illustrative
    (`HOW_IT_WORKS_EXAMPLE.illustrative = true`, rendered with an "Illustrative example" tag).
- `mobile/src/components/landing/Formats.tsx`
  - `FORMATS` exported so the "Eleven formats" claim is tested against the real list.

Unchanged by design: the Formats section copy, CTA labels, the example video,
the "Weeks, not months" and "Named-expert sign-off" stats, and the footer.

## Claim verification

| Claim | Result | Evidence |
|---|---|---|
| "Eleven formats" | Verified | `FORMATS` has 11 entries (test: `OutcomeCopy.test.tsx`). |
| "a grounding check flags any sentence the sources do not support" | Verified (backend) | `backend/src/trust/grounding.py` labels each sentence supported / partial / unsupported against the section's cited sources. UI surfacing of the flag was not checked. |
| "Approval is stamped with who recorded it" | Verified | `approval_repo.py` writes `recorded_by_sub` and `recorded_via` on every approval record. |
| "Inventing nothing" | Verified, phrase removed from step copy | Draft prompts instruct "Invent nothing beyond the sources" (`backend/src/trust/draft_prompt.py`). The new step 02 copy does not use the phrase. |
| "a first draft in days" (step 02 "You get") | Not verified | No timing evidence in the codebase. Flagged for the owner; not softened in code. |
| "nothing to check against the sources by hand" (step 02 "You get") | Not verified | Qualitative; the grounding check reduces but does not remove manual review. Flagged for the owner. |

## Pre-publish items

1. Footer contact placeholder: NOT changed. The address is still unconfirmed. Blocked on the owner.
2. Legal pages: labels NOT changed. Flagged as a blocker for promoting the site.
3. Navigation anchors: both exist in source. Nav "Trust" maps to anchor `trust`
   (`ExampleVideo.tsx`, the video card). Nav "Pilot" maps to anchor `pilot`
   (`PilotCTA.tsx`). No links were added or removed. Note that the "Trust" anchor
   sits on an unlabelled video card. Rendered-page check not performed.
4. Claim verification: see the table above.

## Tests

- `mobile/src/components/landing/__tests__/OutcomeCopy.test.tsx` (new): heading, four
  steps, "You get" labels, illustrative flag, formats count, grounding wording.
  Mock data: the copy constants serve as fixtures.
- `mobile/src/components/landing/__tests__/LandingHome.test.tsx` (updated): hero
  assertions match the new copy; chip queries use exact labels because step copy now
  also mentions PDF.

## Out of scope

- Real case study to replace the example block (owner to supply verified data).
- Desktop and mobile visual check (not run in this change; see tasks).
