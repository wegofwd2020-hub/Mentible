# ADR-043 — Services-led stays the launch model; the self-serve payments launch is superseded

**Status:** **Accepted (2026-10-24) — drafted for owner sign-off.** Becomes Accepted when the decision-maker signs it.
**Decision-maker:** Sivakumar Mambakkam
**Supersedes:** the self-serve launch plan in `02-mentible-payments` (the paid-subscription launch on 1 Nov 2026, the 30-day card-backed trial, checkout, and the cancel/re-enable lifecycle as a launch commitment). It does **not** supersede ADR-039 itself; ADR-039 Option A is reaffirmed and extended here.
**Relates to:** ADR-037 (D3 services-led revenue), ADR-039 (monetization sequencing, Option A), ADR-005 (money model; managed-key vault and BYOK), ADR-014 (credential model), ADR-020 (super-admin operator tier), ADR-022 (account deletion)

## Trigger

On 24 Oct 2026 the payments spec (`02-mentible-payments`) was reviewed against the codebase. Two findings made the 1 Nov self-serve plan incompatible with accepted decisions:

1. **ADR-039 (Accepted 16 Aug 2026)** chose services-led revenue (Option A) and deferred the self-serve billing rail (P0-1). It says P0-1 engineering "does NOT start" until self-serve demand is proven and the platform (O1) and model (O2) are chosen. The spec builds that rail for 1 Nov.
2. **The free-launch date (20 Oct 2026) has passed** and nothing in the repo shows the free-launch flag was set. The spec's status is therefore stale.

The owner has chosen to keep the services-led model (Option A) and not start the self-serve rail now.

## Context

- **Services-led is the active revenue path** (ADR-037 D3): Paid Discovery, Founding Expert Sprint, Team Knowledge Pilot. Clients are invoiced manually. The public work-with-me funnel is built.
- **The billing machinery is already built but dormant:** plan definitions (`backend/src/billing/plans.py`), plan-entitlement access (`access.py`), metering (`usage_repo.py`), a RevenueCat webhook (`router.py`), and a merged paywall (`mobile/app/paywall.tsx`). None of it sells anything today.
- **Managed access for paying clients** is granted through the existing admin entitlement API (the mechanism used for tester access, #432/#433), not through a purchase flow.
- **No payment rail exists.** There is no Stripe code in the backend or mobile app, and no purchase-to-entitlement grant.
- The spec's Stripe plan (`docs/STRIPE_INTEGRATION_GUIDE.md`, 23 Sep 2026) is an unbuilt implementation plan. It is deferred with the rail.

## Decision

1. **Mentible's revenue model stays services-led** (ADR-037 D3, ADR-039 Option A). No self-serve subscription is offered at launch.
2. **The 1 Nov 2026 self-serve launch is withdrawn.** The paid-subscription launch, the 30-day card-required trial, Stripe Elements checkout, and the cancel/re-enable lifecycle are not committed work. They are archived as a future option, not scheduled.
3. **No payment rail is built now.** No Stripe integration, no purchase flow, no purchase-to-entitlement grant, and no trial logic. Nothing in the spec's Plan (section 10) starts.
4. **Paying clients get managed access by admin grant** through the existing entitlement API. Each grant is recorded in the existing audit trail (ADR-020). Access state for these clients is read through the existing `billing/access.py`; no second resolver is added.
5. **The dormant billing code stays dormant.** The RevenueCat webhook and paywall are not reactivated. Before any reactivation, the paywall's `run()` must get a try/catch, because a throwing controller locks the screen (per ADR-039).
6. **The payments spec's launch-gating work is not done.** `FLAG_PAYMENTS_ENABLED` and `FLAG_PAID_PLANS_VISIBLE` stay off. The product remains free for the trial and waitlist stages described in ADR-037 D3, subject to whether those limits are implemented (not verified here).

## Consequences

- **Good:** no reversal of an accepted decision; no premature platform or pricing lock-in; no card data or new Stripe surface to secure before revenue exists; the spec's 14 findings (`02-mentible-payments`, section 13) no longer block anything.
- **Cost:** no recurring self-serve revenue until the rail is built. The competitive "recurring vs. pay-per-book" argument stays unaddressed in the short term (ADR-039 Cons).
- **Spec:** the payments spec becomes a deferred design document. Its open decisions R1 to R5 are answered by this ADR (R1: ADR-039 stands; R2 to R4: decided later, only if self-serve is revived; R5: free-launch flag stays off, so the 20 Oct date is moot). Decisions 2, 3, 5, 6, 9 and 15 are not needed until revival.

## Revival: what would reopen self-serve

Self-serve is reopened by a new ADR, not by a decision in a spec or a chat. That ADR must settle:

- **O1, platform:** Stripe web checkout, Google Play billing through RevenueCat, or Stripe invoicing.
- **O2, model:** subscription with a usage allowance (ADR-005), metered, or one-time.
- **O3, pricing:** tiers and prices (config, decided last).
- **Demand signal:** the trigger threshold is an **[OPEN]** owner decision. Candidates to choose from: a number of closed engagements, a number of waitlist sign-ups, or both. Until it is set, the default is "not yet."

## Open items for the owner

- **[OPEN] Revival trigger threshold** (see above).
- **[OPEN] Free-tier limits** (2 projects, about 20 generations a month, per ADR-037 D3): confirm whether they are enforced in code.
- **[OPEN] Client access for paying engagements:** confirm the admin grant process and who may issue it.
- **[OPEN] Status of the payments spec's Stripe plan:** keep the file as an archived design, or move it to `docs/proposals/` with a deferred banner.
- **[OPEN] Trial promise:** the spec's 30-day card-backed trial appears nowhere else in the product. Confirm no public copy promises it.

## Not changed by this ADR

- ADR-039 Option A stays as the accepted monetization sequencing.
- ADR-037 D3 stays as the services-led revenue decision.
- ADR-005 managed-key vault and BYOK paths stay as built.
- ADR-022 account deletion and ADR-020 super-admin rules stay as they are.
- The entitlement, metering, and plan code stays in place and keeps working.
