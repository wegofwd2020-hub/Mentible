# Paywall Screen (Plans) — Design Spec

**Date:** 2026-07-09
**Status:** Approved (brainstorm)
**Implements:** the deferred RevenueCat UI slice noted in `ManagedPlanCard.tsx`
("Purchase/upgrade (the RevenueCat flow) is a later slice; this is read-only") —
**presentation + purchase seam only.** Managed billing backend Phases 1–6 already exist
(ADR-005 D6) and are deployed dormant.
**Amends nothing.** No ADR change. No backend change. No migration.

## Summary

A `/paywall` screen ("Plans") presenting Mentible's two key-custody paths side by side —
**Managed** (we hold the provider key, tokens carried under a plan allowance) and **BYOK**
(you pay your provider directly) — behind a compile-checked `PurchaseController` seam whose
only implementation today is a dev stub. Nothing charges anyone; `purchase()` resolves
`{ kind: "unavailable" }`. Wiring RevenueCat later swaps one module.

Design derived from a competitor paywall teardown (an AI interior-design app). We adopt its
four structural strengths and explicitly reject its dark patterns. Both lists are recorded
below because the rejections are the load-bearing part of this spec — they are what the
tests defend.

### Adopted from the teardown

1. Four benefits, max. No scroll to CTA at default font scale.
2. Both plans visible simultaneously — no toggle, no accordion.
3. Footer `Restore · Terms · Privacy`. Restore is a real, wired button.
4. One full-width, verb-first CTA.

### Rejected from the teardown

| Their pattern | Our position |
|---|---|
| Preselect the expensive plan | Preselect **Managed** — ADR-005 D1's stated default, and the tier that costs *us* tokens. Defaulting against our own margin is the honest default for a user with no API key. |
| `Auto Renewal, Cancel Any Time` as a checklist *benefit* | Renewal terms get their own line **adjacent to the CTA**. "Cancel any time in Google Play" may appear as a benefit only because it states *where* you cancel — it is not the disclosure. |
| CTA promises a free trial regardless of which plan is selected | CTA label **and** renewal-terms line are both reactive to selection. This is the defect the branch's most important test guards. |
| Fake anchor (`$8.99/wk` exists only to make `$44.99/yr` read as "90% OFF") | No anchor, no discount badge. The Managed↔BYOK price gap is real COGS (we carry token spend), not a decoy. |
| 3-day trial into a weekly subscription | **No trial.** A short trial on managed tokens invites generate-everything-then-cancel. Adding one later is a `PlanOffer.trial?: string` field, not a redesign. |
| "Unlimited Design Creations" | Never market "unlimited" *generation* on a managed plan — `plans.py::managed_unlimited` has `allowance_micros=0`, an open-ended token liability backstopped only by the O7 spend ceiling. "Unlimited" is used only for **books in your Library** (storage, not tokens) and for BYOK ("no generation limit **from us**"). |

## Decisions (from brainstorm)

| # | Decision |
|---|---|
| D1 | **UI + stubbed purchase seam.** Real RevenueCat is a later, one-module swap. Nothing charges anyone on this branch. |
| D2 | **The two cards are Managed vs BYOK** (key custody), not billing periods and not Basic vs Unlimited. Maps 1:1 to ADR-005 D1. |
| D3 | **Scope = screen + entry points.** No over-allowance generation gating; the live generate path is untouched. |
| D4 | **Placeholder prices**, TODO-commented. RevenueCat offerings are the real source of truth (store-formatted, localized). |
| D5 | **Module seam + hook**, not a Context provider. Purchases need no app-wide reactive state; entitlement already comes from the server via `getManagedStatus`. |
| D6 | **Backend untouched.** No `/api/v1/billing/plans` endpoint — prices live in the store, and a backend plans endpoint would be a second source of truth that RevenueCat contradicts on localization. |
| D7 | **Managed preselected; no hero image.** A hero costs the vertical space that "no scroll to CTA" requires. |

## Screen anatomy

Dark theme (`colors.background` `#14152a`), so the teardown's "one dark CTA" inverts to
**brand orange** `colors.brand` `#f2731f` — already the theme's designated primary-action token.

```
┌──────────────────────────────────────┐
│  ← Plans                             │  stack header, from _layout.tsx options.title
├──────────────────────────────────────┤
│  [? Plans & billing]                 │  HelpButton, in the body (cf. sign-in.tsx)
│  Generate books with                 │  h1, typography.fontHeading
│  your key or ours                    │
│                                      │
│  ✓ Unlimited books in your Library   │  exactly 4
│  ✓ EPUB3 + PDF export                │
│  ✓ Diagrams, math, quizzes           │
│  ✓ Cancel any time in Google Play    │
│                                      │
│  ┌────────────────────────────────┐  │
│  │ ◉  Managed              ✦ Easy │  │  preselected
│  │    $9.99/mo                    │  │
│  │    Includes $5 of generation   │  │
│  │    each month. No API key.     │  │
│  └────────────────────────────────┘  │
│  ┌────────────────────────────────┐  │
│  │ ○  Bring your own key          │  │
│  │    $19.99/yr                   │  │
│  │    You pay Anthropic directly. │  │
│  │    No generation limit from us.│  │
│  └────────────────────────────────┘  │
│                                      │
│  $9.99/month, billed monthly until   │  ← reactive to selection
│  you cancel. Renews automatically.   │
│  ┌────────────────────────────────┐  │
│  │       Start with Managed       │  │  ← reactive to selection
│  └────────────────────────────────┘  │
│   Restore  ·  Terms  ·  Privacy      │
└──────────────────────────────────────┘
```

Selecting BYOK swaps the terms line to `$19.99/year, billed annually until you cancel.`
and the CTA to `Start with your own key`.

The screen uses a `ScrollView`. "No scroll to CTA" is a layout goal at default font scale,
**not** an invariant enforced with fixed heights — clipping the CTA at large accessibility
font scales would be worse than scrolling.

## Architecture

```
mobile/app/paywall.tsx           screen: selection state, CTA, compliance line
        │
        ├─→ mobile/src/billing/usePlanOffers.ts     hook: load offers, {kind} state machine
        │        │
        │        └─→ mobile/src/billing/purchaseController.ts   ← THE SEAM (factory)
        │                 │  getPurchaseController(): PurchaseController
        │                 │  __setPurchaseController(c)   // test-only
        │                 │
        │                 ├─→ mobile/src/billing/types.ts        the contract (types only)
        │                 └─→ devPurchaseController.ts           (today)
        │                     revenueCatController.ts            (later)
        │
        └─→ mobile/src/components/PlanCard.tsx     presentational, zero logic
```

The contract lives in its own `types.ts` rather than in `purchaseController.ts`, because the
factory imports the stub as a *value* while the stub imports the contract as a *type*. Same
file for both would be a real import cycle at runtime, not merely a type-level one.

### The contract

```ts
export type PlanKind = "managed" | "byok";

export interface PlanOffer {
  /**
   * For kind: "managed" this MUST equal a backend plans.py plan id ("managed_basic").
   * For kind: "byok" it is a store product id only — BYOK grants no entitlement and has
   * no allowance, so it has no plans.py row.
   */
  id: string;
  kind: PlanKind;
  title: string;
  price: string;           // store-formatted + localized. NEVER parse this.
  period: "month" | "year";
  blurb: string;
  /** Rendered verbatim above the CTA. Store policy requires price + period + renewal here. */
  renewalTerms: string;
  badge?: string;
}

export type PurchaseResult =
  | { kind: "purchased"; planId: string }
  | { kind: "cancelled" }                     // user backed out — NOT an error
  | { kind: "unavailable"; reason: string };  // billing not configured / store down

export interface PurchaseController {
  offerings(): Promise<PlanOffer[]>;
  purchase(planId: string): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult>;
}
```

**`price` is an opaque string, never a number.** RevenueCat returns `product.priceString`,
already localized. Designing for a number now would force a refactor at swap time.

**`cancelled` is a result variant, not a thrown error.** RevenueCat signals user-cancellation
via `userCancelled` on an *error* object; the commonest paywall bug is rendering "Purchase
failed" when someone tapped back. Modelling it as a success-path variant means the screen
physically cannot render an error for it. `unavailable` is a variant for the same reason —
the dev controller returns it, so the "not wired up yet" path is exercised by the code that
will later handle "Play Store unreachable."

**A managed `PlanOffer.id` must equal its `plans.py` plan id.** `plans.py` owns *allowance*
(what a plan grants); RevenueCat owns *price* (what it costs). That id string is the only
join key between "what you paid" and "what you get." BYOK is exempt: it grants no
entitlement, so `plans.py` has no row for it and the webhook maps no plan — a BYOK purchase
buys the app, not tokens (D17), and a BYOK key is never promoted to managed (ADR-014 D3).

### Data flow — today

`usePlanOffers()` → `devPurchaseController.offerings()` → two hardcoded, TODO-commented
`PlanOffer`s. CTA → `purchase(id)` → `{ kind: "unavailable", reason: "Managed plans aren't
available yet." }` → inline notice. No network call, no account mutation, no charge.

### Data flow — later (one file changes)

`getPurchaseController()` returns `revenueCatController`, mapping `Purchases.getOfferings()`
→ `PlanOffer`. `Purchases.logIn(sub)` has a defined backend counterpart: `revenuecat.py`'s
docstring states `app_user_id` **is** our IdP `sub`.

Purchase success reaches the backend **out-of-band via the RevenueCat webhook**, never from
the client. The screen therefore never writes entitlement — it navigates back and lets
`getManagedStatus()` refetch. A client that self-reports "I paid" is forgeable. Accordingly,
`purchase()` resolving `{kind:"purchased"}` means *"the store took money,"* never *"the
entitlement is live."*

## Entry points

- **`ManagedPlanCard.tsx`** — add a "See plans" link, rendered in the no-entitlement (BYOK
  upsell), `canceled`, and `overCap` branches. **Not** in the healthy-`active` branch — no
  nagging paying users.
- **`settings.tsx`** — a "Plans & billing" row above the existing `/usage` row, matching that
  row's `Pressable` shape. It goes **inside** the existing `{!IS_DEMO && …}` block: the demo
  build disables accounts and generation, so a paywall there is meaningless.
- **`_layout.tsx`** — `<Stack.Screen name="paywall" options={{ title: "Plans", headerBackTitle:
  "Settings" }} />`; routes are registered explicitly. The stack header supplies the title, so
  the screen body does not render its own. (`TopNavBar` is the bottom **tab** bar
  (`BottomTabBarProps`) and is not involved.)

## Error handling

Screen state follows the house `{ kind }` idiom (cf. `CheckoutButton.tsx`):

| State | Trigger | Rendering |
|---|---|---|
| `loading` | initial `offerings()` | skeleton cards |
| `ready` | offers loaded | the paywall |
| `purchasing` | CTA tapped | CTA shows `ActivityIndicator`, cards disabled |
| `notice` | `unavailable` / `restore` outcome | inline text, `colors.textSecondary` |
| `error` | `offerings()` threw | inline text, `colors.error`, plus Retry |

`cancelled` returns to `ready` and renders nothing.

**Inline notices, not `Alert`.** RN-web no-ops `Alert.alert`, and this screen must work on
`mambakkam.net/app/mentible`. Any future dialog comes from `@/lib/alert`, never `react-native`.

## Testing

- `mobile/__tests__/billing/purchaseController.test.ts` — `__setPurchaseController` swaps in a
  fake; `getPurchaseController` returns it. Guards the seam itself.
- `mobile/__tests__/components/PlanCard.test.tsx` — renders title/price/blurb; selected vs
  unselected `accessibilityState={{ selected }}`.
- `mobile/__tests__/screens/paywall.test.tsx`:
  1. Managed is selected on mount.
  2. Selecting BYOK swaps **both** the CTA label and the renewal-terms line.
     *(The regression test for the teardown's central defect. Most valuable test in the branch.)*
  3. `purchase()` → `cancelled` renders no error.
  4. `purchase()` → `unavailable` renders the notice, not an error.
  5. Restore is present and calls `restore()`.
  6. Every offer renders non-empty `renewalTerms` adjacent to the CTA. Store-policy guard.
- `mobile/__tests__/help/coverage.test.ts` — passes once FEATURES + topic land together.

No test hits a store, a network, or RevenueCat.

## Help (Definition of Done)

The coverage gate has three assertions, including one rejecting orphan `featureKey`s — so the
FEATURES entry and the topic must land in the same commit or CI reddens either way.

- `features.ts` → `{ key: "plans", label: "Plans & billing" }`
- `topics.ts` → a `plans` topic with `featureKey: "plans"`, covering: BYOK vs managed; where
  the allowance comes from; that cancelling happens in Google Play; and that a BYOK key is
  never silently promoted to managed (ADR-014 D3).
- `HelpButton topic="plans"` in the screen header, matching `sign-in.tsx`.

## Files

```
NEW  mobile/src/billing/types.ts                    the contract (types only, no runtime)
NEW  mobile/src/billing/purchaseController.ts       factory + __setPurchaseController
NEW  mobile/src/billing/devPurchaseController.ts    placeholder offers, DO NOT SHIP banner
NEW  mobile/src/billing/usePlanOffers.ts
NEW  mobile/src/billing/index.ts
NEW  mobile/src/components/PlanCard.tsx
NEW  mobile/app/paywall.tsx
NEW  mobile/__tests__/billing/purchaseController.test.ts
NEW  mobile/__tests__/components/PlanCard.test.tsx
NEW  mobile/__tests__/screens/paywall.test.tsx
EDIT mobile/app/_layout.tsx                         + <Stack.Screen name="paywall" …>
EDIT mobile/src/components/ManagedPlanCard.tsx      + "See plans" (BYOK / canceled / overCap only)
EDIT mobile/app/(tabs)/settings.tsx                 + "Plans & billing" row
EDIT mobile/src/help-content/features.ts            + { key: "plans" }
EDIT mobile/src/help-content/topics.ts              + plans topic
```

Backend: nothing. Migrations: none. Behaviour change for existing users: two new links; the
generation path is untouched.

Naming note: the existing `CheckoutButton.tsx` is **book export** ("check out" as in a library
loan), unrelated to payments. Avoid "checkout" in any payment identifier here.

## Risks

1. **Placeholder prices leaking into a store build.** `devPurchaseController` resolves
   `{ kind: "unavailable" }` from `purchase()` — it never throws and never charges — and the
   file carries a `DO NOT SHIP` banner. A store build must swap the controller; if it
   doesn't, purchase is inert rather than wrong. (It must not throw: the screen's `error`
   state is reserved for genuine failures, and "billing isn't configured" is not one.)
2. **"No scroll to CTA" is device-dependent.** At large Android font scales the screen will
   scroll. Accepted (see Screen anatomy).
3. **`plans` FEATURES key is user-visible** in Help search. The `label` reads "Plans & billing";
   the key stays `plans`.

## Verification

`npx tsc --noEmit` **and** `jest` (per the standing lesson: run `tsc`, not only jest, on TS
edits), plus driving the screen in the web preview to confirm the CTA label and renewal-terms
line both swap on selection.

## Out of scope

- Real RevenueCat wiring (needs the RC dashboard + Play Console products — a user task).
- Over-allowance generation gating (backend 402 contract + `useGenerateJob`).
- A `/api/v1/billing/plans` endpoint (D6).
- Free trials (D-list, "Rejected").
- iOS specifics beyond Restore existing (D3: Android first).
