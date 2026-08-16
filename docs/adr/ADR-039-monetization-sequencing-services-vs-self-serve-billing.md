# ADR-039 — Monetization sequencing: services-led now vs. the self-serve billing rail (P0-1)

**Status:** **Accepted (2026-08-16) — Option A: services-led; the self-serve billing rail (P0-1)
is deferred.** Revenue comes from invoiced services through the built work-with-me funnel; managed
access to paying clients is granted via the existing admin entitlement API. P0-1 engineering does
NOT start until self-serve demand is proven and the model + platform (O1/O2) are chosen.
**Decision-maker:** Sivakumar Mambakkam
**Trigger:** The prioritized shortlist (`docs/competitive-analysis/PRIORITIZED_SHORTLIST.md`) and the
YouBooks competitive docs flag **P0-1 "activate the managed billing / payment rail"** as the urgent
next move ("this week"). Before building it, two questions surfaced: **(a)** pricing isn't finalized,
and **(b)** the self-serve billing rail is the thing **[ADR-037](ADR-037-reposition-to-expert-validation-studio.md)
D3 explicitly deferred** ("services-led revenue; self-serve subscription deferred"). So starting P0-1
would *reverse* an accepted decision. This ADR is the fork.

## Context (verified)

- **Built already:** the managed-billing *machinery* — `backend/src/billing/{plans,entitlement_repo,
  access,eligibility}.py`, metering, plan definitions (`managed_unlimited`, `managed_basic $5`), the
  admin entitlement-grant API, and a **merged but dormant paywall UI**. **Not built:** the **payment
  rail** — no Stripe/RevenueCat checkout, no subscription-purchase flow, no purchase→entitlement grant.
- **Also built (this cycle):** the **work-with-me funnel** (public `/work-with-me` → scheduler
  link-out) — the ADR-037 services-led front door. Invoicing behind it is currently **manual /
  out-of-band** (no code needed to take money that way).
- **ADR-037 D3 (Accepted):** revenue is **services-led** (Discovery / Sprint / Pilot); the self-serve
  app subscription of ADR-005 is **deferred**.
- **ADR-005 D4:** managed plan = subscription **with a metered token allowance** (we carry vendor cost).

## The decision

**Do we commit to self-serve subscriptions *now* (building P0-1, reversing ADR-037 D3), or stay
services-led and keep the self-serve rail deferred?**

### What pricing does — and does not — block
- **Dollar amounts do NOT block the rail.** Plan definitions + prices are **config/data** set at
  launch; the rail is built against them. Pricing indecision is *not* a reason to stall engineering.
- **What must be decided before building P0-1 (adjacent to pricing, not the number):**
  1. **Pricing model** — subscription-with-allowance (ADR-005 lean) vs. pure metered/usage vs.
     one-time. Changes the integration fundamentally.
  2. **Billing platform** — **Stripe web checkout** vs. **Google Play IAP / RevenueCat** (Play policy
     generally *forces* IAP for in-app digital subscriptions → ~30% cut) vs. **Stripe invoicing**
     (services). The biggest fork; tied to go-to-market, not to the price.

## Options

**Option A — Stay services-led; defer P0-1 (recommended).**
Take revenue **now** through the built funnel + **manual invoicing** (Discovery/Sprint/Pilot). Zero
billing-rail work required to earn. Revisit self-serve once a few engagements close and the market has
revealed which tier/price it actually wants. Consistent with ADR-037 D3.
- *Pros:* earns today; no reversal; no premature model/platform lock-in; prices decided with real
  signal. *Cons:* no recurring self-serve revenue yet; the competitive docs' "recurring vs YouBooks
  pay-per-book" argument goes unaddressed short-term.

**Option B — Commit to self-serve now; build P0-1.**
Reverses ADR-037 D3. Requires the **model + platform** decisions above first; prices can still be
config'd late. Delivers recurring self-serve revenue and the "activate billing this week" move.
- *Pros:* recurring revenue; the shortlist/competitive "moat vs YouBooks" move. *Cons:* reverses an
  accepted ADR; forces model/platform commitment now; builds a self-serve funnel before the
  SME-services thesis (ADR-037) is validated; the buyer ADR-037 targets (SMEs) may not be self-serve.

## Recommendation

**Option A.** Given ADR-037 (SME-primary, services-led), the funnel already shipped, and YouBooks
being a **different buyer** (indie-author generation, not validated-knowledge), the cheapest and
lowest-regret first revenue is **invoiced services via the funnel now** — with the self-serve rail
**deferred** until demand is proven. Then build P0-1 with real tier/price signal instead of guesses.
**Do not start P0-1 engineering until this fork is chosen** (and, if B, the model + platform sub-decisions).

## Consequences / what unblocks P0-1 later

- If we stay A: add a lightweight way to record/track invoiced engagements (could be manual/CRM at
  first); no product billing code. Grant managed access to paying clients via the existing admin
  entitlement API (already used for tester full-access, #432/#433).
- When P0-1 is greenlit (B, or A→self-serve later): the machinery is ready; the work is the **payment
  rail + purchase→grant + purchase UI**, gated by the chosen model/platform. Prices remain config.
  ⚠ Reactivating the dormant paywall: the `run()`-without-try/catch landmine (a throwing controller
  locks the screen) must be fixed first — see the paywall notes.

## Open questions

- **O1 — Platform:** Stripe-web vs. Play-IAP/RevenueCat vs. Stripe-invoice (services). Blocks B.
- **O2 — Model:** subscription-with-allowance (ADR-005) vs. metered vs. one-time. Blocks B.
- **O3 — Pricing:** tier count, prices, what each gates (pairs with ADR-031 feature-axis
  entitlements). Config, decided last — never blocks the build.

## Relationships

Sequences/amends **ADR-005** (billing/managed-key) and **ADR-037 D3** (services-led; self-serve
deferred). Chosen option updates the shortlist's P0-1 framing.
