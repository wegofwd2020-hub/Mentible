# Onboarding polish — design

**Date:** 2026-07-03
**Author:** Siva Mambakkam (with Claude)
**Status:** Approved (design) — pending spec review
**Scope:** `mobile/` only. Content + copy changes, no new components.

---

## Motivation

We wrote two standalone user guides (`docs/user-guides/01-sign-in-with-google.md`,
`02-add-claude-api-key.md`) and a shareable web page for new testers. Reviewing the
app showed most of that guidance **already lives in-app**:

- `FirstRunWizard` chains three steps: **signup → key → tour**.
- `SignupStep` renders `AuthForm` (email + **Continue with Google**).
- `KeyStep` renders `ProviderKeyForm` + a `ProviderGuideCard` that shows the
  provider's cost badge, "How to get your key" numbered steps, an **Open
  console** button, and the key-shape hint — sourced from
  `src/constants/providerGuides.ts`.
- `Help` (`helpContent.ts`) already has deep-linkable topics: `getting-started`,
  `getting-started-account`, `provider-keys`, plus `action` blocks that relaunch
  wizard steps and `link` blocks into Settings / sign-in.

So this is **not** a new onboarding flow. It closes three gaps the review found:

1. **Discoverability / staleness** — the `getting-started` Help topic is stale
   (says *"Add your Anthropic API key"*, pre multi-provider and pre Books-only)
   and omits the framing the guides added (bundled books, read-before-account).
2. **Missing reassurance framing** in the wizard — that the two bundled books are
   readable without an account/key, and that the key stays on-device.
3. **Web-vs-Android wording** — copy says *"Android Keystore"*, wrong for the web
   and iOS surfaces that render the same strings.

## Non-goals (YAGNI)

- No new Help topic (`getting-started` already exists — enrich it).
- No new components, no wizard step reorder, no new wizard step.
- No `Platform.select` per-OS branching — plain platform-neutral copy is enough.
- No changes to `providerGuides.ts` acquisition steps (already correct).
- The standalone `docs/user-guides/*` and the Artifact web page stay as-is
  (external share assets); this work is the in-app counterpart.

---

## Changes

### Change 1 — Rewrite the `getting-started` Help topic

**File:** `mobile/src/constants/helpContent.ts` (topic `id: "getting-started"`).

Make it the consolidated intro the other two topics branch off. New blocks:

- `text` — one-paragraph "what Mentible is" + *"Two finished books are already in
  your Library — read them right now, no account or key needed."*
- `steps` — the current-and-correct first-run path:
  1. *(Optional)* Sign in to sync your library across devices — or keep reading
     without an account.
  2. Add a provider API key in Settings (BYOK). Claude (Anthropic) is recommended
     for finished books; free tiers exist for trying it. Your key stays on your
     device.
  3. In Books, start a New Book and structure its table of contents.
  4. Generate — each topic is written with math, diagrams and tables, scoped by
     level and depth.
  5. Save the finished book to your Library to read or export.
- Reuse existing block kinds to cross-link:
  `{ kind: "action", label: "Create your account", step: "signup" }`,
  `{ kind: "action", label: "Add an API key", step: "key" }`.

Keep `keywords` as-is (already covers start/begin/first/setup/onboard).

**Wording:** no "Android"/"Anthropic-only" assumptions; provider-neutral with
Claude named as the recommendation.

### Change 2 — Enrich two wizard subtitles (copy only)

Both steps pass `subtitle` to `WizardScaffold` (which already renders an optional
`subtitle`). No structural change.

**File:** `mobile/src/onboarding/steps/SignupStep.tsx`
- Subtitle → *"Optional — your Library already has two books to read. Sign in to
  sync across devices and to author your own."*

**File:** `mobile/src/onboarding/steps/KeyStep.tsx`
- Add one reassurance line beneath the form/guide card (or fold into the
  subtitle): *"Your key stays on this device, is used once per request, and is
  never logged or stored on our servers. You can skip and read the included books
  first."*
- Prefer the subtitle if it reads cleanly; otherwise a small muted `Text` note
  under `ProviderGuideCard` reusing existing muted-text styling.

### Change 3 — Fix web-vs-Android wording

**File:** `mobile/app/(tabs)/settings.tsx` (~line 79)
- *"Keys are stored in the Android Keystore and sent directly to this app's
  backend…"* → *"Keys are stored in your device's secure storage and sent
  directly to this app's backend…"*

**File:** `mobile/src/constants/helpContent.ts` (topic `provider-keys`, ~line 143)
- *"stored in the device keystore"* → *"stored in your device's secure storage"*
  for consistency with the above.

**File:** `mobile/app/(tabs)/about.tsx` (~line 60)
- *"the device keystore"* → *"your device's secure storage"* (same user-facing
  BYOK blurb).

**Left unchanged:** code *comments* that mention "Android Keystore" / "device
keystore" as native-implementation notes (`src/secure/keyStore.ts`,
`src/device/clearDeviceData.ts`, `src/device/deviceIdentity.ts`) — they are
technically accurate about the native path and not user-facing.

---

## Testing / verification

- **Search index safety:** `helpContent.ts` exposes `searchHelpTopics` which
  indexes `title + keywords + block text`. Verified 2026-07-03: `grep` for
  `"Add your Anthropic API key"`, `"Android Keystore"`, `"device keystore"`
  across `mobile/` finds **no test assertions** — only the source strings being
  edited (and three native-note code comments, left unchanged). No snapshot to
  update.
- **Manual:** on web (`mambakkam.net/app/mentible` build) open Help → Getting
  started, confirm the new copy and that the `action` blocks relaunch the signup
  and key wizard steps; confirm Settings BYOK blurb no longer says "Android".
- **Lint/typecheck:** `mobile/` — content edits only; expect green.

## Risk

Low. Content/copy only; no logic, no new dependencies, no data-model change.
Main watch-item: a test asserting an old string (Change 1 / Change 3).

## Rollout

Single PR against `main`. No migration, no deploy coupling beyond the next web
build picking up the new strings.
