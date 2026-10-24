# Pricing and monetization: how Mentible charges

**Date:** 2026-10-24
**Scope:** Money only. Who pays Mentible, for what, and what is decided versus proposed.
**Not covered here:** who can see or share a book. That is in [the author sharing document](2026-10-24-author-sharing-and-open-library.md).

## Short answer

Mentible earns money in two ways, and only one is active:

1. **Services (active).** Paid, fixed-scope engagements, invoiced by hand. Accepted in ADR-037 D3 and ADR-039 Option A.
2. **Self-serve subscriptions (on hold).** Monthly plans paid in the app. Withdrawn as a launch commitment by ADR-043. Not built. Revival needs a new decision.

The one-page go-to-market plan proposes self-serve prices to test. It is not approved, and it does not change the decision above.

## Decided

| Item | Source | Status |
|---|---|---|
| Services ladder: Discovery $250; Founding Expert Sprint $1,500 (30 days); Team Knowledge Pilot $2,500–$5,000 | ADR-037 D3 | Accepted. Shown on the About tab (live on mentible.app). |
| Services-led revenue; self-serve deferred | ADR-037 D3, ADR-039 Option A | Accepted |
| Self-serve payments launch withdrawn (1 Nov 2026 plan) | ADR-043 | Accepted (24 Oct 2026) |
| Paying clients get managed access by admin grant | ADR-039, ADR-043 | Accepted |
| Free tier: 2 projects; 20 generations per rolling 30 days | ADR-037 D3; enforced in code | Accepted. Gap: the older generation routes don't check the count (open). |

## Proposed, not decided

| Item | Source | Status |
|---|---|---|
| Starter $9.99/month; Creator $19.99/month | Go-to-market one-pager | To be tested. Self-serve. Not approved. |
| One-time project $9–$29 | Go-to-market one-pager | To be tested. Not approved. |
| Education pilot $500–$1,500 per course | Go-to-market one-pager | To be tested. Could be invoiced, which would fit services-led. |
| USD 19.99/month with a 30-day card-backed trial | Payments spec (1 Nov launch) | Withdrawn by ADR-043. Kept as a deferred design. |

## What must be decided before any self-serve pricing goes live

A revival ADR has to settle the platform (Stripe on the web, or Google Play billing through RevenueCat), the billing model (subscription with a usage allowance, metered, or one-time), and the prices. ADR-043 also sets a demand trigger that has not been chosen yet.

Showing self-serve prices in the app, or on the site, before that is done would advertise a purchase path that doesn't exist. ADR-043 records this as the reason the About tab shows services prices only.

## Cost controls that apply either way

- Managed AI usage is capped by plan allowance and a hard spend ceiling (ADR-005). BYOK users pay their own provider.
- The one-page plan says to keep AI usage capped or offer BYOK. That matches the current design.

## Open questions

1. Are the Starter and Creator plans to be launched, or only tested as pricing research?
2. Is the education pilot an invoiced service? If so, it belongs under services, not self-serve.
3. What is the demand trigger for reviving self-serve (closed engagements, waitlist sign-ups, or both)?
4. Does the services ladder need its own pricing ADR, since ADR-037 covers it only as one decision among many?
