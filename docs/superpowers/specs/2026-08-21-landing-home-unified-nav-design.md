# Landing Home + Unified Nav — Design Spec

**Status:** Proposed · **Date:** 2026-08-21 · **Area:** `mobile/app/(tabs)/index.tsx`, `mobile/src/components/landing/*` (new), `mobile/src/components/{TopNavBar,SideNav}.tsx`, `mobile/src/components/navItems.ts`, `mobile/src/constants/labels.ts`, `mobile/src/help-content/*` · **Reference:** the "Mentible, Honestly" copy deck (corrected, honest copy) + the captured Lovable layout (structure only). **Related:** ADR-037 (SME positioning), ADR-038 (Navy Trust / Fraunces + AccentText).

## Why

The app has **no front door**: `(tabs)/index.tsx` is a bare `<Redirect href="/library" />`, so `/` drops the user straight into a tab. We're adopting the captured landing-page *structure* — hero → approval record → Capture·Create·Validate·Share → formats → pilot CTA — as Mentible's own **Home**, to (a) give visitors and returning users a real front door that states the value, and (b) make the trust story the first thing seen. The captured page was built to match the app's existing **Navy Trust** identity (Fraunces + Inter + gold, ADR-038), so this is a *reuse*, not a reskin. All copy is the **corrected/honest** version from the deck — no fabricated proof.

## Decisions (locked with the user)

- **Scope:** the **Landing Home** screen **+ the unified 2-state nav**. The four marketing subpages (`/about`, `/content`, `/books`, `/pricing`) are **deferred** — their nav links resolve to Home sections / `work-with-me` for now.
- **Visibility:** **everyone** sees Home (signed-in included); they navigate into Library/Studio/Projects from there.
- **Platforms:** **web + native.** Web gets the 2-state top bar; native keeps bottom tabs and carries the marketing content as scroll sections inside Home.
- **Design system:** reuse the app's theme tokens (`useThemedStyles`), Fraunces/Inter, `AccentText`, and primitives (`Card`, `Label`, `Chip`, `StudioHeader`). **No hardcoded OKLCH, no new fonts.** The landing inherits the active theme (see Theming).
- **Copy:** the corrected deck copy verbatim. **Honesty guardrails carried in (below).**

## Routing & entry

- `mobile/app/(tabs)/index.tsx` — replace the redirect with the **Landing Home** screen (a thin route that renders `<LandingHome />`). `/` now renders Home for every auth state (`signed_in` / `signed_out` / `unavailable` / `loading`).
- `index` becomes a **visible tab** — added to `NAV_TABS` + first in `NAV_ORDER` (icon `home`/`home-outline`, label `NAV.home = "Home"`).
- `TopNavBar`'s leading Mentible mark currently jumps to `library` ("home"); repoint it to `index`.
- Other tabs unchanged. Library keeps its own screen (no longer the de-facto home).

## The Landing Home screen — `mobile/src/components/landing/`

A vertical `ScrollView` of sections, each a small component built from existing primitives + theme tokens. Section ids double as web anchor targets (`#how-it-works`, `#formats`, `#trust`, `#pricing`) so the signed-out top-bar links scroll to them.

- **`Hero.tsx`** — heading `Turn expertise into <AccentText>trusted knowledge.</AccentText>`; corrected subhead ("…drafted by AI from your own sources, every claim cited back to one, then reviewed and signed off by a named expert."); two CTAs — **Book a 30-minute conversation** → `router.push("/work-with-me")`, **See how it works** → scroll to `#how-it-works`. Corrected 3-stat strip (Weeks-not-months · 1 source → many formats · Named-expert sign-off).
- **`ApprovalCardExample.tsx`** (anchor `#trust`) — the honest approval record on the navy card: named expert, **PROVENANCE** (recorded_via), **GROUNDING**, **COVERAGE**, **READABILITY**, and the "we never hide who signed off" line. **Labeled "Example"** — illustrative, not a real customer.
- **`Phases.tsx`** (anchor `#how-it-works`) — four `Card`s: Capture (paste transcripts/notes — no "interview/record" claim), Create (grounded, cited, invents nothing), Validate (approve/withdraw + provenance + auto coverage/readability), Share (EPUB/PDF/KDP pack + derivatives).
- **`Formats.tsx`** (anchor `#formats`) — grid of the **built** formats only: book · EPUB/PDF/DOCX · KDP pack · LinkedIn post & carousel · X thread & posts · image & animated card · audio. (No YouTube / newsletter / learning-module — those are pilot-only, omitted here.)
- **`PilotCTA.tsx`** (anchor `#pricing`) — a band → `work-with-me` (the services funnel). No invented pricing tiers in this slice.

## Unified nav — `TopNavBar` / `SideNav` (web) + bottom tabs (native)

The web nav (`TopNavBar`, the `<Tabs tabBar={…}>`) becomes **auth-state-aware** via `useAuth()` (`AuthStatus = "loading" | "signed_in" | "signed_out" | "unavailable"`):

- **`signed_out`** → marketing links `How it works · Formats · Trust · Pricing` (anchor-scroll to Home sections) + a **`[ Sign in ]`** button → `/sign-in`.
- **`signed_in`** → app tabs `Home · Library · Studio · Projects · Reviews · Publish` + an **avatar menu ▾** (`Settings · Help · About · Sign out`).
- **`unavailable`** (demo) → app tabs as today (already trimmed by `IS_DEMO` in `NAV_ORDER`), **no** Sign-in/avatar. Home tile shown.
- **`loading`** → logo + Home only (no flash of the wrong set).

Implementation notes:
- Add a `MARKETING_LINKS` list (`{ label, anchor }[]`) beside `NAV_TABS` in `navItems.ts`; add `home` to `NAV_TABS` + `NAV_ORDER`; add labels `NAV.home`, `NAV.howItWorks`, `NAV.formats`, `NAV.trust` (Pricing reuses an existing or new label) to `labels.ts`.
- `TopNavBar` and `SideNav` both branch on `status`; extract the shared branch into a small helper so the two stay in sync. Anchor-scroll is web-only (`document.getElementById(id).scrollIntoView`); guard behind `Platform.OS === "web"`.
- **Avatar menu** — a new small `AccountMenu.tsx` (popover) listing Settings/Help/About/Sign out; `signOut` from `useAuth()`.
- **Native**: bottom tabs keep `NAV_ORDER` (now leading with Home). Marketing links are **not** native nav — they're the Home scroll sections. Native top header = `StudioHeader` wordmark + (signed-in) avatar / (signed-out) a Sign-in affordance.

## Theming

The landing uses `useThemedStyles(makeStyles)` and theme tokens (`background`, `surface`, `border`, `text`, `primary`, …) — it inherits the **active** palette (the app ships multiple; ThemeProvider). The captured navy+gold look corresponds to the **Navy Trust / Studio** identity. **Assumption:** the default theme is the navy+gold Studio palette; if the default is navy+*indigo* (`primary #6d5ae6`), the landing's accent follows that, not the captured gold. Making the captured navy+gold THE default is a separate one-line theme-default decision — flagged, not bundled here. The one deliberately fixed surface is `ApprovalCardExample`'s dark navy card (it mimics the product's real approval card), which pins its own navy/gold like the deck's featured card.

## Honesty guardrails (carried from the deck)

- Approval card is **labeled "Example"**; uses `recorded_via`/grounding/coverage/readability — never a fabricated four-axis scorecard or "review time".
- Formats section lists **only built** exports.
- No "Shipped" case studies, no sample-draft metrics, no "interview/recorded/transcribed" capture claim.
- Copy says "signed-off / recorded", not blanket "expert-approved" absolutes.

## Demo mode

`IS_DEMO` builds: Home shows (marketing content is fine read-only); nav is the trimmed demo set with no Sign-in/avatar; the "Book a conversation" CTA still opens `work-with-me`/scheduler.

## Files

- **Modify:** `app/(tabs)/index.tsx` (landing screen), `components/TopNavBar.tsx`, `components/SideNav.tsx`, `components/navItems.ts`, `constants/labels.ts`, `app/(tabs)/_layout.tsx` (register `index` as a visible tab if needed).
- **Create:** `components/landing/{LandingHome,Hero,ApprovalCardExample,Phases,Formats,PilotCTA}.tsx`, `components/AccountMenu.tsx`.
- **Help:** `help-content/features.ts` (+`landing-home` feature), `help-content/topics.ts` (topic with that `featureKey`) — same PR (coverage gate).

## Testing

- **RNTL:** `LandingHome` renders all sections; hero CTAs route to `work-with-me` / scroll; Formats lists exactly the built set (snapshot the labels); ApprovalCardExample shows the "Example" label + provenance line.
- **Nav 2-state:** `TopNavBar`/`SideNav` render marketing links + Sign-in when `status="signed_out"`; app tabs + avatar when `"signed_in"`; demo set, no sign-in, when `"unavailable"`; Home tile present in all. Anchor-scroll helper guarded to web.
- **AccountMenu:** lists Settings/Help/About/Sign out; Sign out calls `useAuth().signOut`.
- **Guard test:** the app-shell test that broke before (mounting a component into a screen) — run the **full** `npx jest`, not a targeted subset (past lesson: reviewers swept only touched dirs).
- **Help coverage gate** green (`__tests__/help/coverage.test.ts`).

## Non-goals (this slice)

- The four marketing subpages as real routes (deferred; links = anchors / work-with-me).
- Any restyle beyond the landing + nav; no theme-default change (flagged separately).
- Invented pricing tiers, YouTube/newsletter/learning-module formats, case studies.
- No backend changes.

## Rollout

Mobile-only. Full `npx jest` green → merge → web deploy both surfaces → **APK vc48** (folds in with the ADR-014 Inc-2.1 release, or ships on its own). No backend refresh, no migration.
