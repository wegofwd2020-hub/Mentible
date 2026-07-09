# Paywall Screen (Plans) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/paywall` ("Plans") screen presenting Managed vs BYOK side by side, behind a compile-checked `PurchaseController` seam whose only implementation today is an inert dev stub.

**Architecture:** A types-only contract (`billing/types.ts`), a factory with a test-only override (`billing/purchaseController.ts`), a dev stub returning placeholder offers (`billing/devPurchaseController.ts`), a loading hook (`billing/usePlanOffers.ts`), a presentational card (`components/PlanCard.tsx`), and the screen (`app/paywall.tsx`). Wiring RevenueCat later replaces exactly one module. No backend change, no migration, no generation gating.

**Tech Stack:** TypeScript (strict), React Native + Expo, expo-router (stack routes registered explicitly in `app/_layout.tsx`), Jest + `@testing-library/react-native`, `jest-expo` preset.

**Spec:** `docs/superpowers/specs/2026-07-09-paywall-screen-design.md`

## Global Constraints

- **Nothing may charge anyone on this branch.** `devPurchaseController.purchase()` resolves `{ kind: "unavailable" }`. It must **never** throw — the screen's `error` state is reserved for genuine failures, and "billing isn't configured" is not one.
- **`PlanOffer.price` is an opaque, store-formatted, localized string. NEVER parse it, never do arithmetic on it.**
- **Never render `Alert` on this screen.** RN-web no-ops `Alert.alert`, and the screen must work at `mambakkam.net/app/mentible`. Use inline notices. Any future dialog imports from `@/lib/alert`, never from `react-native`.
- **Never market "unlimited" generation on a managed plan.** `plans.py::managed_unlimited` has `allowance_micros=0` — an open-ended token liability. "Unlimited" may describe only Library storage ("Unlimited books in your Library") and BYOK ("No generation limit **from us**").
- **The CTA label and the renewal-terms line MUST both track the selected plan.** A CTA that promises one plan's terms while another is selected is the exact defect this screen exists to avoid.
- **Exactly four benefit bullets.** Not three, not five.
- **A managed `PlanOffer.id` must equal its `backend/src/billing/plans.py` plan id** (`"managed_basic"`). BYOK is exempt — it grants no entitlement and has no plan row.
- **Backend is untouched.** No new endpoint, no migration.
- **Do not use the word "checkout" in any payment identifier.** `CheckoutButton.tsx` already means *book export* ("check out" as in a library loan).
- **Theme tokens only** — `colors` / `spacing` / `radius` / `typography` from `@/constants/theme`. No hardcoded hex, no magic numbers.
- Test imports: `@/…` maps to `mobile/src/…` only. Screens under `mobile/app/` are imported from tests by **relative path** (e.g. `../../app/paywall`).
- Verification for every task: `cd mobile && npx tsc --noEmit && npx jest <path>`. Run **`tsc`, not only jest** — jest does not typecheck.

---

### Task 1: The purchase seam (contract + factory + dev stub)

**Files:**
- Create: `mobile/src/billing/types.ts`
- Create: `mobile/src/billing/purchaseController.ts`
- Create: `mobile/src/billing/devPurchaseController.ts`
- Create: `mobile/src/billing/index.ts`
- Test: `mobile/__tests__/billing/purchaseController.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PlanKind`, `PlanOffer`, `PurchaseResult`, `PurchaseController` (types); `getPurchaseController(): PurchaseController`; `__setPurchaseController(c: PurchaseController | null): void`; `devPurchaseController: PurchaseController`.

**Why `types.ts` is separate:** the factory imports the stub as a *value*, and the stub imports the contract as a *type*. Putting both in one file is a real runtime import cycle, not merely a type-level one.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/billing/purchaseController.test.ts`:

```ts
import {
  __setPurchaseController,
  getPurchaseController,
} from "@/billing/purchaseController";
import { devPurchaseController } from "@/billing/devPurchaseController";
import type { PurchaseController } from "@/billing/types";

afterEach(() => __setPurchaseController(null));

describe("purchase seam", () => {
  it("defaults to the dev controller", () => {
    expect(getPurchaseController()).toBe(devPurchaseController);
  });

  it("__setPurchaseController overrides it, and null restores the default", () => {
    const fake: PurchaseController = {
      offerings: jest.fn(),
      purchase: jest.fn(),
      restore: jest.fn(),
    };
    __setPurchaseController(fake);
    expect(getPurchaseController()).toBe(fake);
    __setPurchaseController(null);
    expect(getPurchaseController()).toBe(devPurchaseController);
  });
});

describe("devPurchaseController", () => {
  it("offers exactly one managed and one byok plan, managed first", async () => {
    const offers = await devPurchaseController.offerings();
    expect(offers.map((o) => o.kind)).toEqual(["managed", "byok"]);
  });

  it("gives the managed offer the backend plans.py plan id", async () => {
    const [managed] = await devPurchaseController.offerings();
    expect(managed.id).toBe("managed_basic");
  });

  it("gives every offer non-empty renewal terms", async () => {
    const offers = await devPurchaseController.offerings();
    for (const o of offers) expect(o.renewalTerms.length).toBeGreaterThan(0);
  });

  it("never markets unlimited generation on the managed plan", async () => {
    const [managed] = await devPurchaseController.offerings();
    expect(`${managed.title} ${managed.blurb}`.toLowerCase()).not.toContain("unlimited");
  });

  it("purchase() resolves unavailable and never throws", async () => {
    await expect(devPurchaseController.purchase("managed_basic")).resolves.toEqual({
      kind: "unavailable",
      reason: expect.any(String),
    });
  });

  it("restore() resolves unavailable and never throws", async () => {
    await expect(devPurchaseController.restore()).resolves.toEqual({
      kind: "unavailable",
      reason: expect.any(String),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/billing/purchaseController.test.ts`
Expected: FAIL — `Cannot find module '@/billing/purchaseController'`.

- [ ] **Step 3: Write the contract**

Create `mobile/src/billing/types.ts`:

```ts
// The purchase contract. TYPES ONLY — no runtime value lives here, so the factory
// (which imports the stub as a value) and the stub (which imports these as types)
// cannot form an import cycle.

export type PlanKind = "managed" | "byok";

export interface PlanOffer {
  /**
   * For kind "managed" this MUST equal a backend plans.py plan id ("managed_basic") —
   * that string is the only join key between "what you paid" (RevenueCat) and "what you
   * get" (the plan's allowance). For kind "byok" it is a store product id only: BYOK
   * grants no entitlement and has no plans.py row.
   */
  id: string;
  kind: PlanKind;
  title: string;
  /** Store-formatted and localized (RevenueCat's `product.priceString`). Never parse this. */
  price: string;
  period: "month" | "year";
  blurb: string;
  /** Rendered verbatim above the CTA. Store policy requires price + period + renewal there. */
  renewalTerms: string;
  badge?: string;
}

/**
 * `cancelled` is a first-class variant, not a thrown error: RevenueCat reports a user
 * backing out via `userCancelled` on an *error* object, and the commonest paywall bug is
 * rendering "Purchase failed" when someone simply tapped back. Modelling it here means the
 * screen physically cannot show an error for it. `unavailable` is a variant for the same
 * reason — the dev stub returns it, so the "not wired up yet" path is exercised by the code
 * that will later handle "Play Store unreachable".
 */
export type PurchaseResult =
  | { kind: "purchased"; planId: string }
  | { kind: "cancelled" }
  | { kind: "unavailable"; reason: string };

export interface PurchaseController {
  offerings(): Promise<PlanOffer[]>;
  purchase(planId: string): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult>;
}
```

- [ ] **Step 4: Write the dev stub**

Create `mobile/src/billing/devPurchaseController.ts`:

```ts
import type { PlanOffer, PurchaseController, PurchaseResult } from "./types";

// ─── DO NOT SHIP ────────────────────────────────────────────────────────────
// Placeholder prices. The real ones come from RevenueCat offerings, which are
// store-formatted and localized per storefront. These exist only so the Plans
// screen can be built, reviewed and tested before billing is configured.
// A store build MUST swap this controller out. If it doesn't, purchase() is
// inert (resolves `unavailable`) rather than wrong — it never charges and never
// throws.
// ────────────────────────────────────────────────────────────────────────────

// "Unlimited" is deliberately absent from the managed offer: plans.py's uncapped
// tier is an open-ended token liability. BYOK says "from us" because the limit
// that remains is the user's own provider account.
const DEV_OFFERS: PlanOffer[] = [
  {
    id: "managed_basic", // = plans.py plan id
    kind: "managed",
    title: "Managed",
    price: "$9.99/mo",
    period: "month",
    blurb: "Includes $5 of generation each month. No API key needed.",
    renewalTerms: "$9.99/month, billed monthly until you cancel. Renews automatically.",
    badge: "Easy",
  },
  {
    id: "byok",
    kind: "byok",
    title: "Bring your own key",
    price: "$19.99/yr",
    period: "year",
    blurb: "You pay Anthropic directly. No generation limit from us.",
    renewalTerms: "$19.99/year, billed annually until you cancel. Renews automatically.",
  },
];

const NOT_CONFIGURED = "Plans aren’t available in this build yet.";

// Params are omitted rather than ignored — a stub that accepts fewer arguments still
// satisfies the interface, and TS keeps the call sites honest.
export const devPurchaseController: PurchaseController = {
  async offerings(): Promise<PlanOffer[]> {
    return DEV_OFFERS;
  },
  async purchase(): Promise<PurchaseResult> {
    return { kind: "unavailable", reason: NOT_CONFIGURED };
  },
  async restore(): Promise<PurchaseResult> {
    return { kind: "unavailable", reason: NOT_CONFIGURED };
  },
};
```

- [ ] **Step 5: Write the factory**

Create `mobile/src/billing/purchaseController.ts`:

```ts
import { devPurchaseController } from "./devPurchaseController";
import type { PurchaseController } from "./types";

// THE SEAM. Today the only implementation is the dev stub. When RevenueCat is
// configured, add `revenueCatController.ts` and return it here — that is the
// entire integration surface on the client.
//
// Purchase success reaches the backend out-of-band via the RevenueCat webhook
// (backend/src/billing/revenuecat.py), never from this client. So a `purchased`
// result means "the store took money", never "the entitlement is live". The
// screen must re-read entitlement from GET /api/v1/billing/managed-status.

let override: PurchaseController | null = null;

export function getPurchaseController(): PurchaseController {
  return override ?? devPurchaseController;
}

/** Test-only. Pass `null` to restore the default. */
export function __setPurchaseController(c: PurchaseController | null): void {
  override = c;
}
```

Create `mobile/src/billing/index.ts`:

```ts
export type { PlanKind, PlanOffer, PurchaseController, PurchaseResult } from "./types";
export { getPurchaseController, __setPurchaseController } from "./purchaseController";
export { devPurchaseController } from "./devPurchaseController";
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/billing/purchaseController.test.ts`
Expected: `tsc` silent; jest PASS, 8 tests.

- [ ] **Step 7: Commit**

```bash
git add mobile/src/billing mobile/__tests__/billing
git commit -m "feat(billing): PurchaseController seam + inert dev stub

Types-only contract, factory with a test-only override, and a placeholder
controller whose purchase() resolves { kind: 'unavailable' } — never throws,
never charges. RevenueCat lands later as one more module behind the factory."
```

---

### Task 2: `usePlanOffers` hook

**Files:**
- Create: `mobile/src/billing/usePlanOffers.ts`
- Modify: `mobile/src/billing/index.ts`
- Test: `mobile/__tests__/billing/usePlanOffers.test.ts`

**Interfaces:**
- Consumes: `getPurchaseController()`, `__setPurchaseController()`, `PlanOffer` from Task 1.
- Produces: `usePlanOffers(): OffersState` where
  `type OffersState = { kind: "loading" } | { kind: "ready"; offers: PlanOffer[] } | { kind: "error"; message: string }`,
  and `reload(): void` is exposed on the `error` variant only.

Actually the hook returns `{ state: OffersState; reload: () => void }` — a stable shape, so the screen never conditionally destructures.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/billing/usePlanOffers.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { __setPurchaseController } from "@/billing/purchaseController";
import { usePlanOffers } from "@/billing/usePlanOffers";
import type { PlanOffer, PurchaseController } from "@/billing/types";

const OFFER: PlanOffer = {
  id: "managed_basic",
  kind: "managed",
  title: "Managed",
  price: "$9.99/mo",
  period: "month",
  blurb: "b",
  renewalTerms: "t",
};

function controller(over: Partial<PurchaseController> = {}): PurchaseController {
  return {
    offerings: jest.fn().mockResolvedValue([OFFER]),
    purchase: jest.fn(),
    restore: jest.fn(),
    ...over,
  };
}

afterEach(() => __setPurchaseController(null));

describe("usePlanOffers", () => {
  it("starts loading, then resolves to ready with the offers", async () => {
    __setPurchaseController(controller());
    const { result } = renderHook(() => usePlanOffers());
    expect(result.current.state.kind).toBe("loading");
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    if (result.current.state.kind !== "ready") throw new Error("expected ready");
    expect(result.current.state.offers).toEqual([OFFER]);
  });

  it("goes to error when offerings() rejects", async () => {
    __setPurchaseController(
      controller({ offerings: jest.fn().mockRejectedValue(new Error("boom")) }),
    );
    const { result } = renderHook(() => usePlanOffers());
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
  });

  it("reload() retries and can recover from error to ready", async () => {
    const offerings = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([OFFER]);
    __setPurchaseController(controller({ offerings }));
    const { result } = renderHook(() => usePlanOffers());
    await waitFor(() => expect(result.current.state.kind).toBe("error"));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(offerings).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/billing/usePlanOffers.test.ts`
Expected: FAIL — `Cannot find module '@/billing/usePlanOffers'`.

- [ ] **Step 3: Write the hook**

Create `mobile/src/billing/usePlanOffers.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { getPurchaseController } from "./purchaseController";
import type { PlanOffer } from "./types";

export type OffersState =
  | { kind: "loading" }
  | { kind: "ready"; offers: PlanOffer[] }
  | { kind: "error"; message: string };

// Loads the plan offers once on mount. `reload` re-runs it (the screen's Retry).
// The returned shape is stable — `{ state, reload }` regardless of variant — so the
// screen never conditionally destructures.
export function usePlanOffers(): { state: OffersState; reload: () => void } {
  const [state, setState] = useState<OffersState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const offers = await getPurchaseController().offerings();
      setState({ kind: "ready", offers });
    } catch {
      // The reason is never surfaced verbatim: an offerings failure is a store/network
      // problem the user can only retry, and provider errors can carry noise.
      setState({ kind: "error", message: "Couldn’t load plans. Check your connection." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: () => void load() };
}
```

Append to `mobile/src/billing/index.ts`:

```ts
export { usePlanOffers, type OffersState } from "./usePlanOffers";
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/billing/usePlanOffers.test.ts`
Expected: `tsc` silent; jest PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/billing mobile/__tests__/billing
git commit -m "feat(billing): usePlanOffers hook with loading/ready/error + reload"
```

---

### Task 3: `PlanCard` presentational component

**Files:**
- Create: `mobile/src/components/PlanCard.tsx`
- Test: `mobile/__tests__/components/PlanCard.test.tsx`

**Interfaces:**
- Consumes: `PlanOffer` from Task 1.
- Produces: `PlanCard({ offer, selected, onSelect }: { offer: PlanOffer; selected: boolean; onSelect: (id: string) => void })`.

Zero logic. It renders `offer` and reports taps. `accessibilityRole="radio"` with `accessibilityState={{ selected }}` — the two cards form a radio group, which is what a screen reader must hear.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/components/PlanCard.test.tsx`:

```tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PlanCard } from "@/components/PlanCard";
import type { PlanOffer } from "@/billing/types";

const OFFER: PlanOffer = {
  id: "managed_basic",
  kind: "managed",
  title: "Managed",
  price: "$9.99/mo",
  period: "month",
  blurb: "Includes $5 of generation each month. No API key needed.",
  renewalTerms: "$9.99/month, billed monthly until you cancel.",
  badge: "Easy",
};

describe("PlanCard", () => {
  it("renders title, price, blurb and badge", () => {
    render(<PlanCard offer={OFFER} selected={false} onSelect={jest.fn()} />);
    expect(screen.getByText("Managed")).toBeTruthy();
    expect(screen.getByText("$9.99/mo")).toBeTruthy();
    expect(screen.getByText(/No API key needed/)).toBeTruthy();
    expect(screen.getByText("Easy")).toBeTruthy();
  });

  it("omits the badge when the offer has none", () => {
    const noBadge: PlanOffer = { ...OFFER, badge: undefined };
    render(<PlanCard offer={noBadge} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByText("Easy")).toBeNull();
  });

  it("exposes selection to assistive tech as a radio", () => {
    render(<PlanCard offer={OFFER} selected onSelect={jest.fn()} />);
    const card = screen.getByRole("radio");
    expect(card.props.accessibilityState.selected).toBe(true);
  });

  it("does NOT render renewalTerms — those belong next to the CTA", () => {
    render(<PlanCard offer={OFFER} selected={false} onSelect={jest.fn()} />);
    expect(screen.queryByText(/billed monthly until you cancel/)).toBeNull();
  });

  it("calls onSelect with the offer id when tapped", () => {
    const onSelect = jest.fn();
    render(<PlanCard offer={OFFER} selected={false} onSelect={onSelect} />);
    fireEvent.press(screen.getByRole("radio"));
    expect(onSelect).toHaveBeenCalledWith("managed_basic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/PlanCard.test.tsx`
Expected: FAIL — `Cannot find module '@/components/PlanCard'`.

- [ ] **Step 3: Write the component**

Create `mobile/src/components/PlanCard.tsx`:

```tsx
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PlanOffer } from "@/billing/types";
import { colors, radius, spacing, typography } from "@/constants/theme";

interface Props {
  offer: PlanOffer;
  selected: boolean;
  onSelect: (id: string) => void;
}

// One selectable plan. Purely presentational — it renders the offer and reports taps.
// It deliberately does NOT render `offer.renewalTerms`: store policy wants price, period
// and renewal disclosed *adjacent to the purchase button*, so the screen owns that line.
export function PlanCard({ offer, selected, onSelect }: Props) {
  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={() => onSelect(offer.id)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${offer.title}, ${offer.price}`}
    >
      <View style={styles.head}>
        <View style={styles.titleRow}>
          <View style={[styles.dot, selected && styles.dotSelected]} />
          <Text style={styles.title}>{offer.title}</Text>
        </View>
        {offer.badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{offer.badge}</Text>
          </View>
        )}
      </View>
      <Text style={styles.price}>{offer.price}</Text>
      <Text style={styles.blurb}>{offer.blurb}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  cardSelected: { borderColor: colors.brand, backgroundColor: colors.surfaceHigh },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dot: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.textMuted,
  },
  dotSelected: { borderColor: colors.brand, backgroundColor: colors.brand },
  title: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "700" },
  badge: {
    backgroundColor: colors.brand + "22",
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  badgeText: { color: colors.text, fontSize: typography.sizeXs, fontWeight: "600" },
  price: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "700" },
  blurb: { color: colors.textMuted, fontSize: typography.sizeSm, lineHeight: 19 },
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/components/PlanCard.test.tsx`
Expected: `tsc` silent; jest PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/components/PlanCard.tsx mobile/__tests__/components/PlanCard.test.tsx
git commit -m "feat(billing): PlanCard — presentational, radio a11y, no renewal terms"
```

---

### Task 4: Help content (the Definition-of-Done gate)

**Files:**
- Modify: `mobile/src/help-content/features.ts`
- Modify: `mobile/src/help-content/topics.ts`
- Test: `mobile/__tests__/help/coverage.test.ts` (existing — must stay green)

**Interfaces:**
- Consumes: `HelpTopic` from `@/help`.
- Produces: feature key `"plans"`; help topic id `"plans"`. Task 5 renders `<HelpButton topic="plans" …/>`.

**Do this BEFORE the screen.** The coverage gate has three assertions, one of which rejects any topic whose `featureKey` is not in `FEATURES`, and another which rejects any `FEATURES` key with no topic. Both edits must land in the same commit or CI reddens either way. Landing them before Task 5 also means `HelpButton topic="plans"` never points at a missing topic.

- [ ] **Step 1: Add the feature key (this alone makes the gate fail)**

In `mobile/src/help-content/features.ts`, append to `FEATURES`:

```ts
  { key: "plans", label: "Plans & billing" },
```

so the array reads:

```ts
export const FEATURES = [
  { key: "generation", label: "Generating a book" },
  { key: "reading", label: "Reading a book" },
  { key: "provider-keys", label: "Provider API keys (BYOK)" },
  { key: "diagrams", label: "Diagrams" },
  { key: "export", label: "Export (EPUB3 / PDF)" },
  { key: "sharing", label: "Draft sharing" },
  { key: "accounts", label: "Accounts & sign-in" },
  { key: "plans", label: "Plans & billing" },
] as const;
```

- [ ] **Step 2: Run the gate to verify it fails**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: FAIL — first assertion, `expect(uncoveredFeatures(...)).toEqual([])` receives `["plans"]`.

- [ ] **Step 3: Add the covering topic**

In `mobile/src/help-content/topics.ts`, append to `HELP_TOPICS`:

```ts
  {
    id: "plans",
    title: "Plans & billing",
    keywords: ["plan", "plans", "billing", "subscription", "price", "pricing", "managed", "byok", "cancel", "restore"],
    featureKey: "plans",
    blocks: [
      {
        kind: "text",
        text: "Mentible gives you two ways to pay for the AI that writes your books. Both let you read, author, and export — they differ in who holds the provider key and who pays for tokens.",
      },
      {
        kind: "defs",
        defs: [
          {
            term: "Managed",
            def: "We hold the provider key and carry the token cost. Your plan includes a monthly generation allowance; when it runs out you can add your own key or wait for the period to renew. No API key to set up.",
          },
          {
            term: "Bring your own key (BYOK)",
            def: "You add your own provider key in Settings and pay that provider directly for tokens. We never see a bill for your generation, and we set no limit on it. Your key is stored in your device's secure storage.",
          },
        ],
      },
      {
        kind: "text",
        text: "Adding your own key never moves it into our managed vault — a BYOK key stays yours and stays on your device. The two paths are separate on purpose.",
      },
      {
        kind: "text",
        text: "Subscriptions renew automatically. Cancel any time in Google Play (Play Store → Payments & subscriptions), not in Mentible. Cancelling leaves your books and your Library untouched; managed generation falls back to your own key.",
      },
      {
        kind: "text",
        text: "Changed device or reinstalled? Use Restore on the Plans screen to bring back a subscription you already bought.",
      },
      { kind: "link", label: "See plans", href: "/paywall" },
    ],
  },
```

- [ ] **Step 4: Run the gate to verify it passes**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/help/coverage.test.ts`
Expected: `tsc` silent; jest PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/help-content
git commit -m "docs(help): plans & billing topic + FEATURES key

Satisfies the Help coverage gate for the Plans screen (CLAUDE.md DoD).
Lands before the screen so HelpButton never points at a missing topic."
```

---

### Task 5: The paywall screen

**Files:**
- Create: `mobile/app/paywall.tsx`
- Test: `mobile/__tests__/screens/Paywall.test.tsx`

**Interfaces:**
- Consumes: `usePlanOffers()` (Task 2), `getPurchaseController()` (Task 1), `PlanCard` (Task 3), help topic `"plans"` (Task 4).
- Produces: default-exported `PaywallScreen`. Route name `paywall` (registered in Task 6).

Screen state, following the house `{ kind }` idiom from `CheckoutButton.tsx`:

```ts
type Action =
  | { kind: "idle" }
  | { kind: "purchasing" }
  | { kind: "notice"; message: string };
```

`cancelled` returns to `idle` and renders nothing — that is the whole point of it being a variant. Offer-loading state comes from the hook (`loading` / `ready` / `error`) and is separate from `Action`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/Paywall.test.tsx`:

```tsx
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/components/PageContainer", () => ({
  PageContainer: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/help", () => ({ HelpButton: () => null }));

import { __setPurchaseController } from "@/billing/purchaseController";
import type { PlanOffer, PurchaseController, PurchaseResult } from "@/billing/types";
import PaywallScreen from "../../app/paywall";

const MANAGED: PlanOffer = {
  id: "managed_basic",
  kind: "managed",
  title: "Managed",
  price: "$9.99/mo",
  period: "month",
  blurb: "Includes $5 of generation each month. No API key needed.",
  renewalTerms: "$9.99/month, billed monthly until you cancel. Renews automatically.",
  badge: "Easy",
};
const BYOK: PlanOffer = {
  id: "byok",
  kind: "byok",
  title: "Bring your own key",
  price: "$19.99/yr",
  period: "year",
  blurb: "You pay Anthropic directly. No generation limit from us.",
  renewalTerms: "$19.99/year, billed annually until you cancel. Renews automatically.",
};

function controller(over: Partial<PurchaseController> = {}): PurchaseController {
  return {
    offerings: jest.fn().mockResolvedValue([MANAGED, BYOK]),
    purchase: jest.fn().mockResolvedValue({ kind: "cancelled" } as PurchaseResult),
    restore: jest.fn().mockResolvedValue({ kind: "cancelled" } as PurchaseResult),
    ...over,
  };
}

async function renderReady(c: PurchaseController = controller()) {
  __setPurchaseController(c);
  render(<PaywallScreen />);
  await waitFor(() => expect(screen.getByText("Managed")).toBeTruthy());
  return c;
}

afterEach(() => __setPurchaseController(null));

describe("Paywall screen", () => {
  it("preselects Managed, not the other plan", async () => {
    await renderReady();
    const [managed, byok] = screen.getAllByRole("radio");
    expect(managed.props.accessibilityState.selected).toBe(true);
    expect(byok.props.accessibilityState.selected).toBe(false);
  });

  it("shows exactly four benefit bullets", async () => {
    await renderReady();
    expect(screen.getAllByLabelText("benefit")).toHaveLength(4);
  });

  // The regression test for the teardown's central defect: a CTA promising one plan's
  // terms while another plan is selected.
  it("swaps BOTH the CTA label and the renewal terms when the plan changes", async () => {
    await renderReady();
    expect(screen.getByText("Start with Managed")).toBeTruthy();
    expect(screen.getByText(MANAGED.renewalTerms)).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Bring your own key, $19.99/yr"));

    expect(screen.getByText("Start with your own key")).toBeTruthy();
    expect(screen.getByText(BYOK.renewalTerms)).toBeTruthy();
    expect(screen.queryByText(MANAGED.renewalTerms)).toBeNull();
    expect(screen.queryByText("Start with Managed")).toBeNull();
  });

  it("purchases the SELECTED plan, not the default", async () => {
    const c = await renderReady();
    fireEvent.press(screen.getByLabelText("Bring your own key, $19.99/yr"));
    fireEvent.press(screen.getByText("Start with your own key"));
    await waitFor(() => expect(c.purchase).toHaveBeenCalledWith("byok"));
  });

  it("renders NO error when the user cancels the purchase", async () => {
    const c = await renderReady(
      controller({ purchase: jest.fn().mockResolvedValue({ kind: "cancelled" }) }),
    );
    fireEvent.press(screen.getByText("Start with Managed"));
    await waitFor(() => expect(c.purchase).toHaveBeenCalled());
    expect(screen.queryByLabelText("notice")).toBeNull();
    expect(screen.queryByLabelText("error")).toBeNull();
  });

  it("renders a notice (not an error) when purchase is unavailable", async () => {
    await renderReady(
      controller({
        purchase: jest.fn().mockResolvedValue({ kind: "unavailable", reason: "Not yet." }),
      }),
    );
    fireEvent.press(screen.getByText("Start with Managed"));
    await waitFor(() => expect(screen.getByLabelText("notice")).toBeTruthy());
    expect(screen.getByText("Not yet.")).toBeTruthy();
    expect(screen.queryByLabelText("error")).toBeNull();
  });

  it("Restore calls restore() and reports its outcome as a notice", async () => {
    const c = await renderReady(
      controller({
        restore: jest.fn().mockResolvedValue({ kind: "unavailable", reason: "Nothing to restore." }),
      }),
    );
    fireEvent.press(screen.getByText("Restore"));
    await waitFor(() => expect(c.restore).toHaveBeenCalled());
    expect(screen.getByText("Nothing to restore.")).toBeTruthy();
  });

  // Store policy: price + period + renewal, adjacent to the purchase button — for
  // WHICHEVER plan is selected. Asserts against the rendered screen, never the fixtures.
  it.each([
    ["Managed, $9.99/mo", MANAGED],
    ["Bring your own key, $19.99/yr", BYOK],
  ])("renders %s's renewal terms beside the CTA", async (label, offer) => {
    await renderReady();
    fireEvent.press(screen.getByLabelText(label));
    expect(screen.getByLabelText("renewal terms")).toHaveTextContent(offer.renewalTerms);
  });

  it("shows an error with Retry when offers fail to load, and Retry reloads", async () => {
    const offerings = jest
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([MANAGED, BYOK]);
    __setPurchaseController(controller({ offerings }));
    render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByLabelText("error")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText("Retry"));
    });
    await waitFor(() => expect(screen.getByText("Managed")).toBeTruthy());
  });

  // Alert.alert is a no-op on RN-web, and this screen ships to /app/mentible. Guard the
  // real defect — importing or calling it — not the spelling. Comment prose may say "Alert".
  it("never imports Alert from react-native, and never calls Alert.alert", () => {
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../app/paywall.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/Alert\.alert/);
    expect(src).not.toMatch(/import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*"react-native"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/screens/Paywall.test.tsx`
Expected: FAIL — `Cannot find module '../../app/paywall'`.

- [ ] **Step 3: Write the screen**

Create `mobile/app/paywall.tsx`:

```tsx
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { getPurchaseController, usePlanOffers } from "@/billing";
import type { PlanOffer } from "@/billing";
import { PageContainer } from "@/components/PageContainer";
import { PlanCard } from "@/components/PlanCard";
import { HelpButton } from "@/help";
import { colors, radius, spacing, typography } from "@/constants/theme";

// The Plans screen. Two key-custody paths side by side: Managed (we hold the provider
// key and carry token cost under an allowance) and BYOK (you pay your provider direct).
//
// Two rules this screen exists to keep, both enforced by __tests__/screens/Paywall.test.tsx:
//  1. The CTA label and the renewal-terms line ALWAYS describe the selected plan.
//  2. A user backing out of the store sheet is not an error and shows nothing.
//
// No Alert anywhere — RN-web no-ops Alert.alert and this ships to /app/mentible.

// Storage, not tokens: "unlimited" here means Library capacity. Never say it about
// managed generation — plans.py's uncapped tier is an open-ended token liability.
const BENEFITS = [
  "Unlimited books in your Library",
  "EPUB3 + PDF export",
  "Diagrams, math, quizzes",
  "Cancel any time in Google Play",
] as const;

function ctaLabel(offer: PlanOffer): string {
  return offer.kind === "managed" ? "Start with Managed" : "Start with your own key";
}

type Action = { kind: "idle" } | { kind: "purchasing" } | { kind: "notice"; message: string };

export default function PaywallScreen() {
  const router = useRouter();
  const { state, reload } = usePlanOffers();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>({ kind: "idle" });

  const offers = state.kind === "ready" ? state.offers : [];

  // Managed is the default — ADR-005 D1's stated default, and the tier that costs *us*
  // tokens. Defaulting against our own margin is the right default for a user with no key.
  const selected = useMemo(
    () =>
      offers.find((o) => o.id === selectedId) ??
      offers.find((o) => o.kind === "managed") ??
      offers[0],
    [offers, selectedId],
  );

  const run = async (fn: () => Promise<import("@/billing").PurchaseResult>) => {
    setAction({ kind: "purchasing" });
    const result = await fn();
    if (result.kind === "cancelled") {
      // The user backed out. Not an error. Say nothing.
      setAction({ kind: "idle" });
      return;
    }
    if (result.kind === "unavailable") {
      setAction({ kind: "notice", message: result.reason });
      return;
    }
    // "purchased" means the store took money — NOT that the entitlement is live. That
    // arrives out-of-band via the RevenueCat webhook, so we go back and let the Usage
    // screen re-read GET /billing/managed-status rather than trusting the client.
    setAction({ kind: "idle" });
    router.back();
  };

  if (state.kind === "loading") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          <ActivityIndicator color={colors.brand} accessibilityLabel="loading plans" />
        </PageContainer>
      </ScrollView>
    );
  }

  if (state.kind === "error") {
    return (
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <PageContainer>
          <Text style={styles.error} accessibilityLabel="error">
            {state.message}
          </Text>
          <Pressable style={styles.cta} onPress={reload} accessibilityRole="button">
            <Text style={styles.ctaText}>Retry</Text>
          </Pressable>
        </PageContainer>
      </ScrollView>
    );
  }

  const busy = action.kind === "purchasing";

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <PageContainer>
        <HelpButton topic="plans" label="Plans & billing" />

        <Text style={styles.h1}>Generate books with your key or ours</Text>

        <View style={styles.benefits}>
          {BENEFITS.map((b) => (
            <View key={b} style={styles.benefitRow} accessibilityLabel="benefit">
              <Text style={styles.tick}>✓</Text>
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        <View style={styles.cards} accessibilityRole="radiogroup">
          {offers.map((offer) => (
            <PlanCard
              key={offer.id}
              offer={offer}
              selected={selected?.id === offer.id}
              onSelect={setSelectedId}
            />
          ))}
        </View>

        {selected && (
          <>
            {/* Store policy: price + period + renewal, adjacent to the purchase button. */}
            <Text style={styles.terms} accessibilityLabel="renewal terms">
              {selected.renewalTerms}
            </Text>

            <Pressable
              style={[styles.cta, busy && styles.ctaDisabled]}
              disabled={busy}
              onPress={() => void run(() => getPurchaseController().purchase(selected.id))}
              accessibilityRole="button"
            >
              {busy ? (
                <ActivityIndicator color={colors.brandText} />
              ) : (
                <Text style={styles.ctaText}>{ctaLabel(selected)}</Text>
              )}
            </Pressable>
          </>
        )}

        {action.kind === "notice" && (
          <Text style={styles.notice} accessibilityLabel="notice">
            {action.message}
          </Text>
        )}

        <View style={styles.footer}>
          <Pressable
            onPress={() => void run(() => getPurchaseController().restore())}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.footerLink}>Restore</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => router.push("/about")} accessibilityRole="link">
            <Text style={styles.footerLink}>Terms</Text>
          </Pressable>
          <Text style={styles.footerDot}>·</Text>
          <Pressable onPress={() => router.push("/about")} accessibilityRole="link">
            <Text style={styles.footerLink}>Privacy policy</Text>
          </Pressable>
        </View>
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1 },
  h1: {
    color: colors.text,
    fontSize: typography.sizeXl,
    fontFamily: typography.fontHeading,
    lineHeight: 30,
  },
  benefits: { gap: spacing.sm },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  tick: { color: colors.growth, fontSize: typography.sizeMd, fontWeight: "700" },
  benefitText: { color: colors.text, fontSize: typography.sizeSm },
  cards: { gap: spacing.sm },
  terms: { color: colors.textMuted, fontSize: typography.sizeXs, lineHeight: 18 },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: radius.full,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  ctaDisabled: { opacity: 0.6 },
  ctaText: { color: colors.brandText, fontSize: typography.sizeMd, fontWeight: "700" },
  notice: { color: colors.textSecondary, fontSize: typography.sizeSm, textAlign: "center" },
  error: { color: colors.error, fontSize: typography.sizeSm },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  footerLink: { color: colors.textMuted, fontSize: typography.sizeXs },
  footerDot: { color: colors.textMuted, fontSize: typography.sizeXs },
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/screens/Paywall.test.tsx`
Expected: `tsc` silent; jest PASS, 10 tests.

If the `accessibilityRole="radiogroup"` value is rejected by the RN typings, drop that prop (the child `radio` roles carry the semantics) rather than casting.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/paywall.tsx mobile/__tests__/screens/Paywall.test.tsx
git commit -m "feat(billing): Plans screen — Managed vs BYOK, seam-backed

CTA label and renewal-terms line both track the selected plan (the defect
this screen exists to avoid). Cancelling a purchase renders nothing. No
Alert — the screen must work on RN-web at /app/mentible."
```

---

### Task 6: Entry points (route + Settings row + ManagedPlanCard link)

**Files:**
- Modify: `mobile/app/_layout.tsx` (after the `name="usage"` `Stack.Screen`, ~line 115-118)
- Modify: `mobile/app/(tabs)/settings.tsx` (inside the `{!IS_DEMO && (<>` block, above the `/usage` row at ~line 66)
- Modify: `mobile/src/components/ManagedPlanCard.tsx`
- Test: `mobile/__tests__/components/ManagedPlanCard.test.tsx` (existing — extend)

**Interfaces:**
- Consumes: route `paywall` from Task 5.
- Produces: nothing downstream.

- [ ] **Step 1: Write the failing test**

Append to `mobile/__tests__/components/ManagedPlanCard.test.tsx`, inside the existing `describe("ManagedPlanCard", …)`:

```tsx
  it("offers a link to Plans when the user has no entitlement (BYOK upsell)", () => {
    render(<ManagedPlanCard status={makeStatus()} />);
    expect(screen.getByText("See plans")).toBeTruthy();
  });

  it("offers a link to Plans when the plan has ended", () => {
    render(<ManagedPlanCard status={makeStatus({ entitlement: ent("canceled") })} />);
    expect(screen.getByText("See plans")).toBeTruthy();
  });

  it("offers a link to Plans when the allowance is spent", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({
          entitlement: ent("active"),
          allowance_micros: 5_000_000,
          usage: { cost_micros: 5_000_000, input_tokens: 0, output_tokens: 0, events: 1 },
        })}
      />,
    );
    expect(screen.getByText("See plans")).toBeTruthy();
  });

  it("does NOT nag a healthy paying user", () => {
    render(
      <ManagedPlanCard
        status={makeStatus({
          entitlement: ent("active"),
          allowance_micros: 5_000_000,
          usage: { cost_micros: 1_000_000, input_tokens: 0, output_tokens: 0, events: 1 },
        })}
      />,
    );
    expect(screen.queryByText("See plans")).toBeNull();
  });
```

The existing file has no `expo-router` mock. Add one at the top, above the imports:

```tsx
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/components/ManagedPlanCard.test.tsx`
Expected: FAIL on the three new "offers a link" tests — `Unable to find an element with text: See plans`. The "does NOT nag" test passes vacuously.

- [ ] **Step 3: Add the link to `ManagedPlanCard`**

In `mobile/src/components/ManagedPlanCard.tsx`:

Change the imports at the top from

```tsx
import { StyleSheet, Text, View } from "react-native";
```

to

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
```

Add, above the `ManagedPlanCard` function:

```tsx
// Shown where a plan would actually help: no entitlement (BYOK upsell), an ended plan,
// or a spent allowance. Never on a healthy active plan — paying users don't get nagged.
function SeePlansLink() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/paywall")} accessibilityRole="link">
      <Text style={styles.link}>See plans</Text>
    </Pressable>
  );
}
```

In the no-entitlement branch, add `<SeePlansLink />` after the existing `<Text style={styles.body}>…</Text>`:

```tsx
  if (!ent) {
    return (
      <View style={styles.card}>
        <Text style={styles.label}>Managed plan</Text>
        <Text style={styles.body}>
          You’re on bring-your-own-key — generation uses your own provider keys. No
          managed plan or allowance.
        </Text>
        <SeePlansLink />
      </View>
    );
  }
```

Add `<SeePlansLink />` immediately after the `canceled` warning and after the `overCap` warning:

```tsx
      {ent.status === "canceled" && (
        <>
          <Text style={styles.warn}>
            Your managed plan has ended. Generation falls back to your own key (BYOK).
          </Text>
          <SeePlansLink />
        </>
      )}
      {overCap && ent.status === "active" && (
        <>
          <Text style={styles.warn}>
            You’ve used your allowance for this period. Add your own key (BYOK) or wait for
            renewal.
          </Text>
          <SeePlansLink />
        </>
      )}
```

Add to the `StyleSheet.create({…})` block:

```tsx
  link: { color: colors.brand, fontSize: 14, fontWeight: "600" },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest __tests__/components/ManagedPlanCard.test.tsx`
Expected: `tsc` silent; jest PASS (existing tests + 4 new).

- [ ] **Step 5: Register the route**

In `mobile/app/_layout.tsx`, immediately after the `usage` `Stack.Screen`:

```tsx
        <Stack.Screen
          name="usage"
          options={{ title: "Usage", headerBackTitle: "Settings" }}
        />
        <Stack.Screen
          name="paywall"
          options={{ title: "Plans", headerBackTitle: "Settings" }}
        />
```

- [ ] **Step 6: Add the Settings row**

In `mobile/app/(tabs)/settings.tsx`, inside the existing `{!IS_DEMO && (<>` block (the demo build disables accounts and generation, so a paywall there is meaningless), immediately **above** the `/usage` row:

```tsx
      <Pressable style={styles.accountRow} onPress={() => router.push("/paywall")}>
        <View style={{ flex: 1 }}>
          <Text style={styles.accountTitle}>Plans & billing</Text>
          <Text style={styles.accountSub}>Managed generation, or bring your own key</Text>
        </View>
        <Text style={styles.accountChevron}>›</Text>
      </Pressable>
```

- [ ] **Step 7: Run the full mobile suite + typecheck**

Run: `cd mobile && npx tsc --noEmit && npx jest`
Expected: `tsc` silent; the whole suite green, including `__tests__/help/coverage.test.ts` and `__tests__/screens/Settings.test.tsx`.

If `Settings.test.tsx` fails on a stale snapshot or a now-ambiguous `getByText`, fix the *test* to disambiguate (e.g. `getByText("Usage")` → still unique; the new row's title is "Plans & billing"). Do not remove the new row.

- [ ] **Step 8: Commit**

```bash
git add mobile/app/_layout.tsx "mobile/app/(tabs)/settings.tsx" mobile/src/components/ManagedPlanCard.tsx mobile/__tests__/components/ManagedPlanCard.test.tsx
git commit -m "feat(billing): reach the Plans screen from Settings and the usage meter

Route registered in _layout. Settings row sits inside the !IS_DEMO block.
ManagedPlanCard links to Plans only where it helps — BYOK, ended, or
over-allowance — never on a healthy active plan."
```

---

### Task 7: Verify end-to-end in the web preview

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate**

Run: `cd mobile && npx tsc --noEmit && npx jest && npx eslint .`
Expected: all green. `tsc` is not optional — jest does not typecheck.

- [ ] **Step 2: Drive the real screen**

Run: `cd mobile && npx expo start --web`
Navigate: Settings → **Plans & billing**.

Confirm by observation, not by assumption:
1. Managed is preselected on arrival.
2. Tapping **Bring your own key** changes the CTA to "Start with your own key" **and** the terms line to the `$19.99/year…` string. Tapping back to Managed reverts both.
3. Tapping the CTA shows the inline "Plans aren’t available in this build yet." notice — no dialog, no crash, no charge.
4. Tapping **Restore** shows the same notice.
5. At default font scale, the CTA is visible without scrolling.

- [ ] **Step 3: Record the result**

If any of the five fail, fix and re-run. Do not mark the branch complete on a partial pass — state plainly which step failed and what the output was.

- [ ] **Step 4: Push**

```bash
git push -u origin feat/paywall-screen
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: adopted patterns → Task 5 (four benefits, both plans visible, Restore, one CTA); rejected patterns → Task 1 (no "unlimited" in the offer copy; `purchase()` inert) and Task 5 (preselect Managed, reactive CTA + terms, no trial, no anchor); architecture + `types.ts` split → Task 1; `usePlanOffers` → Task 2; `PlanCard` → Task 3; Help DoD → Task 4; entry points incl. `IS_DEMO` and the no-nag rule → Task 6; verification → Task 7. Out-of-scope items (RevenueCat wiring, generation gating, `/billing/plans` endpoint, trials) have no task, by design.

**Placeholder scan.** No "TBD"/"TODO"/"similar to Task N". Every code step carries complete code. The only literal `TODO`-adjacent text is the `DO NOT SHIP` banner, which is deliberate shipped content, not a plan gap.

**Type consistency.** `PlanOffer`, `PurchaseResult`, `PurchaseController` are defined once in Task 1 `types.ts` and referenced unchanged in Tasks 2, 3, 5. `getPurchaseController` / `__setPurchaseController` keep their names across Tasks 1, 2, 5, and the test files. `usePlanOffers()` returns `{ state, reload }` in Task 2 and is destructured that way in Task 5. `PlanCard`'s props (`offer`, `selected`, `onSelect`) match Task 3's definition and Task 5's call site. The accessibility label `"${offer.title}, ${offer.price}"` set in Task 3 is the exact string Task 5's tests query (`"Bring your own key, $19.99/yr"`).

**One known soft spot.** Task 5's "Terms" and "Privacy policy" footer links both `router.push("/about")` — the repo has an About tab but no separate legal routes. That is honest for now (About is where the legal text lives) and is the correct thing to revisit before a store submission, where Google requires a hosted privacy-policy URL. Flagged rather than faked.
