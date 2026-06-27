# SBQ-UI-003 — Contextual help hints (tappable `?` one-liners)

**Status:** In progress — `HelpHint` component built + wired to the Account
destructive buttons (reference implementation). Remaining: roll out to other
screens (Settings, generation params, BYOK entry, trust badge, Library).
**Type:** UX / reusable component (app-wide rollout)

## Problem
Several controls — especially destructive or jargony ones — aren't self-explanatory,
so users have to guess or rely on the confirmation alert *after* tapping. Examples on
the **Account** screen alone:
- **Remove saved API keys** vs **Sign out & clear this device** vs **Delete account** —
  three similar-looking actions with very different blast radii.
- **Providers** / per-provider credential custody (device-local vs synced).

A lightweight, inline "what does this do?" affordance would make these discoverable
*before* the user commits.

## Proposal
A reusable **`HelpHint`** component: a small **`?`** icon placed next to a control;
activating it surfaces a **one-line** plain-language explanation.

```tsx
<HelpHint text="Removes your saved provider API keys from this device. Nothing else is touched." />
```

**Presentation (per platform):**
- **Web:** tooltip on hover **and** on tap/focus (so it works on touch + pointer).
- **Native:** a small popover/bubble anchored to the `?`, or a lightweight `Alert`
  fallback. Dismiss on outside-tap.
- One line, sentence case, no period-less fragments; keep it short.

**Accessibility:** the `?` is a real button (`accessibilityRole="button"`,
`accessibilityLabel="Help: <control name>"`); the hint text is announced when opened.

**Restraint:** only on controls that are non-obvious or destructive — not every button.

## Rollout (incremental — do NOT do the whole app in one PR)
1. Build the `HelpHint` component + a short usage doc.
2. First adopters: the **Account** screen's three destructive actions (Remove saved
   API keys / Sign out & clear this device / Delete account).
3. Then: Settings, generation params (level/depth/diagram register/pages), BYOK key
   entry, the trust badge, Library actions.

## Acceptance criteria
- Reusable `HelpHint` with the web+native presentation above and a11y wired.
- Applied to the 3 Account destructive buttons as the reference implementation.
- One-line hint copy reviewed for clarity.
- Pattern documented so new screens adopt it consistently.

## Out of scope
- App-wide adoption in a single change (tracked as follow-up adoptions per screen).
- Long-form help / docs pages (this is one-liners only).

## Notes
- Surfaced 2026-06-27 alongside the account-UX fixes (post-sign-in → Library; the
  "Remove saved API keys" relabel; the robust Account back button). The relabel +
  hints are complementary: clearer labels reduce, but don't eliminate, the need for a
  one-line "what does this do?".
