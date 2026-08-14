# Mentible "Work with me" / book-a-call funnel — Design

**Status:** Approved (brainstorming, 2026-08-14). **Repo:** `Mentible` (the product —
React-Native/Expo app). The page is an **in-app Expo Router route**, not a page on the
`mambakkam-net` marketing site.

Turn the corrected funnel's amber "Book a 30-minute conversation" node into a real,
shippable surface: a **public** `/work-with-me` route that frames the **services-led** offer
(Discovery / Sprint / Pilot, per ADR-037) and lets a qualified SME book a call — link-out to a
scheduler whose booking form carries the qualification questions.

## Context (verified)

- App = **Expo Router ~5.1** (RN + react-native-web), served on web at
  `mambakkam.net/app/mentible` (`baseUrl: /app/mentible`) and shipped as the Android APK.
- **Public, ungated top-level routes already exist** — `app/concepts.tsx`,
  `app/diagram-types.tsx`, `app/account.tsx`, `app/paywall.tsx` — registered as
  `<Stack.Screen>` in `app/_layout.tsx`, headed by `StudioHeader` (renders a `‹` back chevron).
  Gating is opt-in via `<RequireSignIn>`; omit it for a public page.
- **Screen pattern** (mirror `app/(tabs)/about.tsx`): `ScrollView` → `PageContainer` →
  `useThemedStyles(makeStyles)` where `makeStyles(c: Palette)` reads theme tokens. This gets the
  studio brand (Playfair/Inter, cream/gold) + the app-background gradient for free (non-`(tabs)`
  routes show the gradient — see [[project_tab_scene_bleed]]).
- **External links** use `Linking.openURL(url)` (the repo convention — `about.tsx`, the shelves
  entry screen, and `PlanLimitsCard`'s `mailto:${BRAND_CONTACT}`). `expo-web-browser ~14.2` and
  `expo-linking ~7.1` are both installed; we use `Linking.openURL` to match existing code.
- Shared primitives: `@/components/PageContainer`, `@/components/ui` `Button`/`Label`,
  `@/components/StudioHeader`, `@/theme` `useThemedStyles`/`useTheme`, and an existing
  `BRAND_CONTACT` const (used by `PlanLimitsCard` for its mailto).

## Decisions (from brainstorming)

1. **Built in Mentible as an app route** (not the Astro marketing site) — the page is themed
   with, and lives beside, the studio the SME enters. Cross-platform (web + Android) for free.
2. **Public / ungated** — anyone can view and book; no `RequireSignIn`.
3. **Scheduler link-out** (not an embed) — a button opens `SCHEDULER_URL` via `Linking.openURL`.
   Works identically on web + native; **no iframe, CSP, SRI, or `widget.js`** (those were
   Astro-only concerns and are gone). A web-inline embed is explicitly deferred.
4. **Scheduler-native intake** — the qualify fields (**Org/role**, **What you want validated**,
   **Timeline**) are **required questions on the scheduler's booking form** (Calendly, default).
   Booking = the lead + the email to the owner. **We store nothing — zero PII on our infra.**
5. **On-brand via the app theme** (`useThemedStyles`) — no bespoke CSS.

## Architecture

One new route + one Stack registration in Mentible, plus one cross-repo CTA link in the
marketing landing. No backend, no data store, no new dependency.

### New route — `mobile/app/work-with-me.tsx`
Public screen, structured like `about.tsx`:
```tsx
export default function WorkWithMeScreen() {
  const styles = useThemedStyles(makeStyles);
  // NO RequireSignIn — public.
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        {/* sections below */}
      </PageContainer>
    </ScrollView>
  );
}
```
Sections, top→bottom:
1. **Hero** — H1 "Work with me: turn your expertise into validated, traceable knowledge" +
   an SME subhead naming the four-phase loop.
2. **Engagement types** — three cards: **Discovery / Sprint / Pilot** (copy seeded from ADR-037;
   owner-tunable — see Content).
3. **How it works** — a compact Capture → Create → Validate → Share strip.
4. **Who it's for** — short SME self-qualifier prose (unqualified visitors self-select out).
5. **Book** — the primary CTA (see below), preceded by one line: "Booking asks a couple of
   quick questions so I can prep."

### Book CTA (link-out)
```tsx
const SCHEDULER_URL =
  process.env.EXPO_PUBLIC_SCHEDULER_URL ?? "https://calendly.com/REPLACE_ME/30min";
// primary:
<Button label="Book a 30-minute conversation"
        onPress={() => { void Linking.openURL(SCHEDULER_URL); }}
        accessibilityLabel="Book a 30-minute conversation" />
// secondary fallback:
<Pressable onPress={() => void Linking.openURL(`mailto:${BRAND_CONTACT}?subject=${encodeURIComponent("Mentible — work with me")}`)}>
  <Text>Prefer email? Reach me directly.</Text>
</Pressable>
```
- `SCHEDULER_URL` is build-time config (`EXPO_PUBLIC_SCHEDULER_URL`, baked like
  `EXPO_PUBLIC_API_BASE_URL`), with a placeholder default so the build never breaks; the owner
  sets the real value at deploy. Swappable Calendly↔Cal.com by changing the URL.
- The `mailto` fallback (reusing `BRAND_CONTACT`) means the page is never a dead end if the
  scheduler is unreachable.

### Stack registration — `mobile/app/_layout.tsx`
Add beside the other top-level screens:
```tsx
<Stack.Screen name="work-with-me" options={{ title: "Work with me", headerBackTitle: "Back" }} />
```
`headerShown` defaults true → `StudioHeader` renders the title + back chevron. The route sits
outside `(tabs)`, so it shows the gradient background (correct, per the tab-scene work).

### Entry CTA — cross-repo, one line (`mambakkam-net/src/pages/mentible.astro`)
Add `const WORK_URL = '/app/mentible/work-with-me/';` beside the existing URL consts and ONE
`<a class="mtb-btn mtb-btn-primary" href={WORK_URL}>Work with me →</a>` in the hero CTA row
(alongside App/Demo/APK — the self-learner path is unchanged). This is a **URL string only** —
the page itself is entirely in Mentible. Shipped as a **separate small PR in `mambakkam-net`**
(different repo + deploy pipeline).

## Config / prerequisites (owner, one-time, outside code)

Manual scheduler setup — the page just points at the result:
1. Create the Calendly (or Cal.com) account + a **"30-minute conversation"** event type.
2. Add three **required** intake questions: *Organisation / role*, *What do you want
   validated?* (long text), *Timeline* (Now / This quarter / Exploring).
3. Set booking notifications to email the owner.
4. Put the event URL into `EXPO_PUBLIC_SCHEDULER_URL` for the web build + APK build.

## Content (seed copy — owner-tunable)

Engagement tiers (ADR-037, services-led):
- **Discovery** — a scoped conversation to map your expertise and pick a first artifact.
- **Sprint** — a fixed-scope engagement producing one expert-validated, traceable asset.
- **Pilot** — a longer run standing up your validation workflow across several assets.

Copy is real (no `TBD`); marked owner-editable before launch.

## Privacy / PII

We collect and store **nothing** — the scheduler is the data controller and holds all booking
data. Public route, no auth, no analytics added. (If a first-party lead store is ever wanted,
that's a separate spec — see Out of scope.)

## Testing / verification

- **jest** (`__tests__/screens/WorkWithMe.test.tsx`): the screen renders all five sections
  (assert key headings/labels); tapping the book button calls `Linking.openURL` with
  `SCHEDULER_URL` (mock `react-native` `Linking`); the mailto fallback calls it with a
  `mailto:` URL. No color-literal asserts.
- **tsc** (`npx tsc --noEmit`) + **eslint** clean.
- **Local web render (the gate):** `expo export -p web` → serve `dist` (prefix-aware server for
  the `baseUrl`) → puppeteer/headless screenshot of `/work-with-me` — confirm app theme
  (Playfair/Inter, gradient), all sections laid out, the book button present. Reuse the render
  recipe in [[project_tab_scene_bleed]]. Live scheduler open is a manual post-deploy check.
- **Not** declared in `mobile/src/help-content/features.ts` `FEATURES` → it's a marketing page,
  not a studio feature, so the Help-coverage gate requires no topic. (Stated so a reviewer
  doesn't flag a "missing" help topic.)

## Rollout

- Mentible: merge to `main` → web deploy (`scripts/deploy/web-deploy.sh app`, built with
  `EXPO_PUBLIC_SCHEDULER_URL`) makes `/app/mentible/work-with-me` live; the route also rides the
  next APK (built with the same env).
- mambakkam-net: the one-line CTA link ships in its own PR → `deploy-mambakkam.yml`.
- Owner completes scheduler setup + sets `EXPO_PUBLIC_SCHEDULER_URL` before launch.

## Out of scope

Web-inline scheduler embed (deferred — link-out first). A first-party lead store / CRM. The rest
of the marketing site (About/Books/Content). Self-serve Pro, derivatives, PDF/Word export, the
referral loop. In-app nav entry (Settings/nav item) for the page — reached via the landing CTA
and a direct link; revisit only if an in-app entry point is wanted.

## Open (non-blocking) decisions

- **Scheduler vendor:** Calendly (default) vs Cal.com — swappable via `EXPO_PUBLIC_SCHEDULER_URL`.
- **Engagement-tier copy** — seeded here; owner refines before launch.
- **`EXPO_PUBLIC_SCHEDULER_URL` value** — supplied at build time by the owner.
