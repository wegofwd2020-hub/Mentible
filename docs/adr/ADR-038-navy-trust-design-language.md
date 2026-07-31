# ADR-038 — Navy Trust design language for the SME studio

**Status:** Accepted — direction (2026-07-31); palette build (D1) deferred as a fast-follow, O3/O4 as noted below
**Relates to:** ADR-037 (SME expert-validation reposition — the product this brand dresses), [[project_multi_theme_engine]] (the ThemeProvider this would extend)
**Source:** `mentible-design-export.md` (external design export — the Lovable prototype's design system), companion `mentible-direction.md` (product/IA — not yet reviewed here)

## Context

An external design export defines a brand/visual system for Mentible — "Navy
Trust": editorial, warm-modern, dark-navy default, a single restrained gold
accent, Fraunces serif headings + Inter body, bento layout, and "trust UI as
first-class components." It is explicitly Anthropic-adjacent and anti-generic-SaaS.

Two facts frame adoption:

1. **The export targets a web/Tailwind/shadcn stack, not this repo.** It is
   written in OKLCH CSS custom properties, `.dark` class, `rounded-3xl`,
   `tracking-widest`, `<link>` font loading, and `/`·`/app` routes with a
   `src/styles.css`. Mentible's app is **React Native + Expo**. So the export
   is a **north-star to port**, not a drop-in: OKLCH has no RN StyleSheet
   equivalent, Tailwind classes/utilities don't exist, and fonts load via
   `expo-font`. The export's own **plain-language hex fallbacks** are the RN
   source of truth: navy bg `#101828`, card `#1b2436`, cream text `#F7F4EE`,
   gold accent `#D9A75A`.

2. **A theme engine already exists** (`mobile/src/constants/theme.ts` +
   `mobile/src/theme/ThemeProvider.tsx`). Today it ships **5 palettes** —
   `study` (dark, **the default**), `manuscript` (light), `reading` (sepia),
   `gilded-noir` (charcoal + gold), `forest-moss` (dark green). Each is a
   `Palette` of hex tokens (`background, surface, surfaceHigh, border,
   borderLight, text, textMuted, primary, accent, error, …`). Screens still
   mostly read the static `colors` (Study) export; the per-render
   `useThemedStyles` migration is the big deferred work.

### Conflicts to resolve (why this needs a decision, not just a merge)

- **Purple default vs "never purple."** The export bans purple/indigo. The
  shipped **default `study` palette is purple** (`primary: #6d5ae6`). "Navy
  Trust as the SME default" therefore *changes the app's default theme* — a
  product decision, not a token swap.
- **Navy Trust ≠ Gilded Noir.** The closest existing palette (`gilded-noir`,
  dark + single gold) is **charcoal `#0d0d0d`**, not navy `#101828`. Navy Trust
  is a distinct palette, not a rename.
- **Fraunces is (almost certainly) not loaded.** Adopting serif headings needs
  a new `expo-font` asset + the app's font-gate wiring, on both native and web.
- **Tab-label mismatch.** The export's app shell names tabs
  **Input · Drafts · Feedback · Publish**; the built app uses Projects / Reviews
  / trust-detail. Same four-phase flow (Capture→Create→Validate→Share), different
  labels.

## Decision (proposed)

Adopt "Navy Trust" as the **SME studio's brand direction**, ported to RN as a
**new, sixth palette** rather than a re-tune of an existing one, and governed as
the design language for *new* SME surfaces. Concretely:

- **D1 — New palette `navy-trust`** (dark) in `constants/theme.ts`, built from
  the export's hex fallbacks mapped onto the existing `Palette` shape
  (`background #101828`, `surface #1b2436`, `text #F7F4EE`, `accent #D9A75A`,
  cream-on-navy `primary`). Gold is **accent-only, never a large fill**. Runs
  through the existing `contrast.ts` legibility gate like every other palette.
  Registered in `themes` + `THEME_META` (`mode: "dark"`).
- **D2 — Semantic tokens only.** New SME surfaces consume `useThemedStyles` /
  the palette tokens — never hardcoded hex, `text-white`, or `#fff`. This is the
  RN translation of the export's "never hardcode hex in components" rule and
  aligns with the deferred theme-migration.
- **D3 — Trust UI is first-class.** `recorded_via` approval badges,
  source-citation chips, revision counts, usage meters are styled components,
  not decoration — and honor the existing repo rule: **never render bare
  "validated"; render `recorded_via`** (ADR-037). The export's copy rule
  ("never label anything 'expert validated' unless approval was recorded") is
  the same rule, restated — keep them in lock-step.
- **D4 — Copy/voice rules** (plain, senior, editorial; no hype; no emoji in
  product copy; never invent stats) adopted as-is; they don't conflict with
  anything shipped.

## Resolved (2026-07-31)

- **O1 — Default theme → DECIDED: SME-surfaces default, selectable elsewhere.**
  `navy-trust` is the default palette **within the SME/trust surfaces**; the
  learner mode keeps `study` as its default; the palette is user-selectable
  everywhere. Matches ADR-037's SME-primary / learner-secondary split without a
  disruptive global reskin, and avoids a big-bang change to the purple default.
- **O2 — Fraunces → DECIDED: palette first, Fraunces as a fast-follow.** Ship
  the `navy-trust` palette (D1) first; adopt Fraunces serif headings as a
  separate follow-up (new `expo-font` asset + the app's font-gate wiring, native
  + web) since fonts are the riskier cross-platform piece.
- **O3 — Tab labels → DEFERRED to the wayfinding workstream.** Whether to rename
  the trust tabs (Input/Drafts/Feedback/Publish vs Projects/Reviews) is
  **layer-2 IA**; per [[feedback_real_gap_is_wayfinding]] the IA/flow is the
  higher-priority workstream and this decision belongs there, not in the theme
  work. Keep Projects/Reviews until then.
- **O4 — Companion file → OPEN follow-up.** `mentible-direction.md` (product
  vision, IA, data model, voice) is referenced but not yet supplied/reviewed; it
  likely carries the layer-2 decisions that should lead O3. Review it before
  acting on O3.

## Build sequence

1. **D1 palette — ✅ BUILT** (branch `next/2026-07-31`).
   - *Slice 1:* `navyTrustColors` in `constants/theme.ts` + `THEME_META`
     (`mode: "dark"`); contrast-gated in `__tests__/theme/palettes.test.ts`;
     auto-listed in the Settings Appearance switcher.
   - *Slice 2 (O1 = forced):* `SmeThemeScope` (a `ThemeContext` override forcing
     navy-trust, no persistence, no-op `setTheme`) + migrated the 4 SME screens
     (`projects`, `reviews`, `trust/new`, `trust/[projectId]`) **and** the
     `TrustJourney` stepper from static `colors` → `useThemedStyles`. The SME
     surfaces always render Navy Trust regardless of the global theme. Scope
     limited to those surfaces; the ~76-file global migration stays deferred.
   - Whole-slice adversarial review: APPROVE after fixing the `TrustJourney`
     seam. Full mobile suite 1201/1201, tsc 0, eslint 0.
2. **Fraunces (O2) — ✅ BUILT** (branch `next/2026-07-31`, brand=B / SME-scoped).
   `@expo-google-fonts/fraunces` (400/600/700) added to `FONT_ASSETS`;
   `resolveFamily` gained a heading `brand` (serif default / fraunces). SME
   heading styles set the concrete `Fraunces_*` family (so they render on web,
   where the native text interceptor doesn't run); the interceptor recognises
   Fraunces-intent and derives the weight from the family name, so (a) it stays
   Fraunces on native and (b) **dyslexic mode still overrides it** (OpenDyslexic —
   a11y preserved). Applied to the trust detail title + section titles and the
   projects/reviews list/empty headings. Rest of the app keeps Source Serif 4.
   Review: APPROVE after fixing a web faux-bold (redundant fontWeight beside a
   baked-weight family). Full suite 1207/1207, tsc 0, eslint 0.
   *Deferred:* the italic-Fraunces **accent word** (export §4) + `letterSpacing`
   `-0.02em` polish — not yet applied.
3. **Tab-label + app-shell IA** (O3) — inside the wayfinding workstream, after O4.

## Deferred (non-blocking)

- `navyTrustColors.success` reuses Forest & Moss's green (`#7fae86`) — cosmetic,
  passes contrast; give it a bespoke navy-appropriate hue if/when polishing.
- Native stack **headers** on the trust screens are not themed (SmeThemeScope
  wraps screen content, not the router-owned header) — follow-up if the header
  chrome needs the navy brand too.

## Consequences

- **Priority-honest.** Per the wayfinding steer, layer-3 (palette/type) ranks
  **below** layer-2 IA/flow. This ADR therefore scopes Navy Trust as *proposed
  brand + one new palette*, explicitly **not** a reason to prioritize the
  76-file `useThemedStyles` migration ahead of guided-authorship work. New SME
  surfaces get built in Navy Trust; the mass migration stays deferred.
- Adds a 6th palette + (later) a serif font asset — small, additive, reversible.
- Keeps a single source of truth: the export governs *look*, the repo's
  `recorded_via` rule governs *trust claims*, and they already agree.

## Not doing

- No port of OKLCH/Tailwind/`styles.css`/bento CSS into the repo (web-only).
- No global reskin of the 82 existing screens as part of this ADR.
- No change to the Lovable "Gilded Noir / Forest & Moss" palettes (Navy Trust is
  additive, not a rename).
