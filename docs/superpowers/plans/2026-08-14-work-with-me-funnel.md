# Work-with-me / book-a-call funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public in-app `/work-with-me` route that presents Mentible's services-led SME offer (Discovery/Sprint/Pilot) and links out to a scheduler to book a call.

**Architecture:** A single public (ungated) Expo Router screen in the Mentible app, structured like `app/(tabs)/about.tsx` (ScrollView + PageContainer + `useThemedStyles`), registered as a top-level `Stack.Screen`. The "Book" CTA is a link-out via `Linking.openURL(SCHEDULER_URL)` — no embed, no backend, no PII stored (the scheduler holds all booking data and its booking form carries the qualify questions). A separate one-line CTA link in the `mambakkam-net` landing page points at the route.

**Tech Stack:** React Native + Expo Router (react-native-web), `react-native` `Linking`, the app theme system (`@/theme`), Jest + React Native Testing Library. Task 2 is Astro/AstroWind in the `mambakkam-net` repo.

## Global Constraints

- **Public / ungated** — the screen must NOT be wrapped in `<RequireSignIn>`.
- **Link-out only** — the Book CTA uses `Linking.openURL`; no iframe/WebView/embed.
- **No lead backend, no PII stored by us** — scheduler-native intake only.
- **`SCHEDULER_URL`** resolves from `process.env.EXPO_PUBLIC_SCHEDULER_URL`, falling back to the placeholder `"https://calendly.com/REPLACE_ME/30min"` so the build never breaks.
- **Brand via the app theme** (`useThemedStyles(makeStyles)`, tokens from `@/constants/theme`, headings in `FRAUNCES.bold`) — no bespoke CSS/colors.
- **Do NOT** add a key to `mobile/src/help-content/features.ts` `FEATURES` (marketing page, not a studio feature) — the Help-coverage gate then requires no topic.
- Mobile gates: `cd mobile && npx tsc --noEmit && npx jest && npx eslint .`. **No color-literal asserts in RNTL.** Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `Button` (`@/components/ui`) props = `{ variant: "primary" | "ghost"; label: string; onPress: () => void; busy?: boolean; disabled?: boolean; accessibilityLabel?: string; style?: … }`. `Card`, `Label` also in `@/components/ui`. `BRAND_CONTACT = "wegofwd2020@gmail.com"` from `@/constants/brand`. `PageContainer` from `@/components/PageContainer`. `FRAUNCES` from `@/constants/fonts`. `spacing`/`radius`/`typography`/`type Palette` from `@/constants/theme`. `about.tsx` styles use `scroll: { flex: 1, backgroundColor: "transparent" }`. Top-level routes register in `app/_layout.tsx` as e.g. `<Stack.Screen name="concepts" options={{ title: "UI concepts (prototype)", headerBackTitle: "Settings" }} />`; `StudioHeader` (default header) renders the title + back chevron.

---

### Task 1: The `/work-with-me` screen (Mentible app)

**Files:**
- Create: `mobile/app/work-with-me.tsx`
- Modify: `mobile/app/_layout.tsx` (register the Stack screen)
- Test: `mobile/__tests__/screens/WorkWithMe.test.tsx`

**Interfaces:**
- Consumes: `Button`, `Card`, `Label` from `@/components/ui`; `PageContainer`; `useThemedStyles` from `@/theme`; `BRAND_CONTACT` from `@/constants/brand`; `FRAUNCES` from `@/constants/fonts`; `spacing`/`radius`/`typography`/`Palette` from `@/constants/theme`; `Linking` from `react-native`.
- Produces: default export `WorkWithMeScreen`; a named `export const SCHEDULER_URL: string` (imported by the test to assert the link-out target).

- [ ] **Step 1: Write the failing test** — `mobile/__tests__/screens/WorkWithMe.test.tsx`

```tsx
import React from "react";
import { Linking } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import WorkWithMeScreen, { SCHEDULER_URL } from "@/../app/work-with-me";

describe("WorkWithMeScreen", () => {
  beforeEach(() => {
    jest.spyOn(Linking, "openURL").mockResolvedValue(true as unknown as void);
  });
  afterEach(() => jest.restoreAllMocks());

  it("renders the hero, the three engagement tiers, and the book CTA", () => {
    const { getByText, getByLabelText } = render(<WorkWithMeScreen />);
    expect(getByText(/turn your expertise into validated/i)).toBeTruthy();
    expect(getByText("Discovery")).toBeTruthy();
    expect(getByText("Sprint")).toBeTruthy();
    expect(getByText("Pilot")).toBeTruthy();
    expect(getByLabelText("Book a 30-minute conversation")).toBeTruthy();
  });

  it("opens the scheduler URL when the book button is pressed", () => {
    const { getByLabelText } = render(<WorkWithMeScreen />);
    fireEvent.press(getByLabelText("Book a 30-minute conversation"));
    expect(Linking.openURL).toHaveBeenCalledWith(SCHEDULER_URL);
  });

  it("offers a mailto fallback", () => {
    const { getByLabelText } = render(<WorkWithMeScreen />);
    fireEvent.press(getByLabelText("Email me instead"));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^mailto:wegofwd2020@gmail\.com/));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/screens/WorkWithMe.test.tsx`
Expected: FAIL — cannot find module `app/work-with-me`.

- [ ] **Step 3: Create the screen** — `mobile/app/work-with-me.tsx`

```tsx
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { Button, Card, Label } from "@/components/ui";
import { BRAND_CONTACT } from "@/constants/brand";
import { FRAUNCES } from "@/constants/fonts";
import { radius, spacing, typography, type Palette } from "@/constants/theme";
import { useThemedStyles } from "@/theme";

// Build-time config (baked like EXPO_PUBLIC_API_BASE_URL). Placeholder default so the
// build never breaks; the owner sets the real Calendly/Cal.com event URL at deploy.
export const SCHEDULER_URL: string =
  process.env.EXPO_PUBLIC_SCHEDULER_URL ?? "https://calendly.com/REPLACE_ME/30min";

const TIERS: { title: string; body: string }[] = [
  { title: "Discovery", body: "A scoped conversation to map your expertise and pick a first artifact." },
  { title: "Sprint", body: "A fixed-scope engagement producing one expert-validated, traceable asset." },
  { title: "Pilot", body: "A longer run standing up your validation workflow across several assets." },
];

const PHASES = ["Capture", "Create", "Validate", "Share"];

export default function WorkWithMeScreen() {
  const styles = useThemedStyles(makeStyles);
  const bookCall = () => { void Linking.openURL(SCHEDULER_URL); };
  const emailMe = () =>
    void Linking.openURL(`mailto:${BRAND_CONTACT}?subject=${encodeURIComponent("Mentible — work with me")}`);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
      <PageContainer>
        <View style={styles.content}>
          {/* Hero */}
          <Text style={styles.h1}>Work with me: turn your expertise into validated, traceable knowledge</Text>
          <Text style={styles.subhead}>
            I help subject-matter experts capture what they know and turn it into expert-validated,
            traceable assets — a four-phase loop: Capture, Create, Validate, Share.
          </Text>

          {/* Engagement types */}
          <Text style={styles.h2}>Ways to work together</Text>
          <View style={styles.tiers}>
            {TIERS.map((t) => (
              <Card key={t.title} style={styles.tier}>
                <Text style={styles.tierTitle}>{t.title}</Text>
                <Text style={styles.tierBody}>{t.body}</Text>
              </Card>
            ))}
          </View>

          {/* How it works */}
          <Text style={styles.h2}>How it works</Text>
          <View style={styles.phases}>
            {PHASES.map((p, i) => (
              <View key={p} style={styles.phase}>
                <Text style={styles.phaseText}>{p}</Text>
                {i < PHASES.length - 1 ? <Text style={styles.phaseArrow}>→</Text> : null}
              </View>
            ))}
          </View>

          {/* Who it's for */}
          <Text style={styles.h2}>Who it's for</Text>
          <Text style={styles.subhead}>
            Practitioners with hard-won, defensible expertise who want it written down, refined,
            and signed off — not generic AI content. If that's you, let's talk.
          </Text>

          {/* Book */}
          <Label tone="secondary">Booking asks a couple of quick questions so I can prep.</Label>
          <Button
            variant="primary"
            label="Book a 30-minute conversation"
            onPress={bookCall}
            accessibilityLabel="Book a 30-minute conversation"
            style={styles.book}
          />
          <Pressable onPress={emailMe} accessibilityRole="button" accessibilityLabel="Email me instead" style={styles.mailto}>
            <Text style={styles.mailtoText}>Prefer email? Reach me directly.</Text>
          </Pressable>
        </View>
      </PageContainer>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) => ({
  scroll: { flex: 1, backgroundColor: "transparent" },
  body: { padding: spacing.md },
  content: { width: "100%" as const, maxWidth: 720, alignSelf: "center" as const, gap: spacing.md },
  h1: { color: c.text, fontFamily: FRAUNCES.bold, fontSize: typography.sizeXxl, letterSpacing: -0.5 },
  h2: { color: c.text, fontFamily: FRAUNCES.bold, fontSize: typography.sizeXl, marginTop: spacing.md },
  subhead: { color: c.textSecondary, fontSize: typography.sizeMd, lineHeight: 24 },
  tiers: { gap: spacing.sm },
  tier: { gap: spacing.xs },
  tierTitle: { color: c.text, fontSize: typography.sizeLg, fontWeight: "600" as const },
  tierBody: { color: c.textSecondary, fontSize: typography.sizeSm, lineHeight: 21 },
  phases: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: spacing.xs },
  phase: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.xs },
  phaseText: { color: c.text, fontSize: typography.sizeMd, fontWeight: "600" as const },
  phaseArrow: { color: c.textMuted, fontSize: typography.sizeMd },
  book: { alignSelf: "flex-start" as const, borderRadius: radius.full, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  mailto: { alignSelf: "flex-start" as const, paddingVertical: spacing.xs },
  mailtoText: { color: c.textMuted, fontSize: typography.sizeSm },
});
```

- [ ] **Step 4: Register the route** — in `mobile/app/_layout.tsx`, add this `Stack.Screen` beside the other top-level screens (e.g. right after the `name="concepts"` screen):

```tsx
<Stack.Screen
  name="work-with-me"
  options={{ title: "Work with me", headerBackTitle: "Back" }}
/>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd mobile && npx jest __tests__/screens/WorkWithMe.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full mobile gates**

Run: `cd mobile && npx tsc --noEmit && npx eslint app/work-with-me.tsx __tests__/screens/WorkWithMe.test.tsx && npx jest`
Expected: tsc clean, eslint clean, all jest green.

- [ ] **Step 7: Local web-render verify (the gate)** — confirm brand + sections render on web (RNTL doesn't prove the real render).

Run:
```bash
cd mobile && npx expo export -p web
```
Then serve `dist` with a prefix-aware static server for the export's `baseUrl` and screenshot `/<baseUrl>/work-with-me` with headless Chromium (reuse the recipe: puppeteer from `compiler/node_modules`, system Chrome, `waitUntil: "domcontentloaded"`, dismiss the first-run wizard, then navigate to the route). Confirm: Fraunces headings + Inter body, the gradient background, the three tier cards, the phase strip, and the "Book a 30-minute conversation" button all render.

- [ ] **Step 8: Commit**

```bash
cd /home/sivam/Documents/code/projects/AIStuff/STEM_studybuddy/Mentible
git add mobile/app/work-with-me.tsx "mobile/app/_layout.tsx" mobile/__tests__/screens/WorkWithMe.test.tsx
git commit -m "feat(mentible): public /work-with-me funnel — services offer + scheduler link-out

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Landing CTA link (mambakkam-net repo)

**Files:**
- Modify: `mambakkam-net/src/pages/mentible.astro` (add `WORK_URL` const + one hero CTA button)

**Interfaces:**
- Consumes: nothing from Task 1 at build time — links by URL to `/app/mentible/work-with-me/`.
- Produces: an on-page anchor visitors click to reach the Mentible route.

> This task is in the **`mambakkam-net`** repo (`~/Documents/code/projects/AIStuff/STEM_studybuddy/mambakkam-net`), a static Astro site — a different repo and deploy pipeline (`deploy-mambakkam.yml`). Do it as its own branch + PR there.

- [ ] **Step 1: Add the URL const** — in `src/pages/mentible.astro`, beside `const APP_URL = '/app/mentible/';`:

```astro
const WORK_URL = '/app/mentible/work-with-me/';
```

- [ ] **Step 2: Add the CTA button** — in the **hero** `<div class="mtb-cta-row">` (the first one, around line 145, holding the `APP_URL`/`DEMO_URL`/`APK_URL` buttons), add as the first child, mirroring the existing button + arrow-`svg` markup:

```astro
<a class="mtb-btn mtb-btn-primary" href={WORK_URL}>
  Work with me
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"></path></svg>
</a>
```

- [ ] **Step 3: Build + verify the link is present**

Run:
```bash
cd ~/Documents/code/projects/AIStuff/STEM_studybuddy/mambakkam-net
npm run build
grep -R "app/mentible/work-with-me" dist/mentible* && echo "link present in built output"
```
Expected: `npm run build` succeeds; grep finds the link in the built HTML.

- [ ] **Step 4: Lint** (match the repo config)

Run: `npx eslint src/pages/mentible.astro`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd ~/Documents/code/projects/AIStuff/STEM_studybuddy/mambakkam-net
git add src/pages/mentible.astro
git commit -m "feat(mentible): add 'Work with me' CTA linking to the in-app funnel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Mentible: `cd mobile && npx tsc --noEmit && npx jest && npx eslint .`; `npx expo export -p web` succeeds; the web-render screenshot shows the branded page with all sections + the book button.
- [ ] `/work-with-me` is reachable and **not** behind `RequireSignIn` (public); the book button opens `SCHEDULER_URL`; the mailto fallback works.
- [ ] No `FEATURES` key added (Help-coverage gate still green — it is not a declared feature).
- [ ] mambakkam-net: `npm run build` succeeds and the landing hero shows a "Work with me" button linking to `/app/mentible/work-with-me/`.
- [ ] **Deploy:** Mentible web (`scripts/deploy/web-deploy.sh app`, built with `EXPO_PUBLIC_SCHEDULER_URL`) + rides the next APK; mambakkam-net CTA via its own pipeline. Owner sets `EXPO_PUBLIC_SCHEDULER_URL` + completes the Calendly event/questions before launch.

## Out of scope

Web-inline scheduler embed (link-out first). A first-party lead store / CRM. The rest of the marketing site. Self-serve Pro, derivatives, PDF/Word export, the referral loop. An in-app nav entry for the page (reached via the landing CTA / direct link).
