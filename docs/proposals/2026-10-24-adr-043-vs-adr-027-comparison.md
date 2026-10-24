# ADR-043 vs ADR-027: comparison

**Date:** 2026-10-24
**Compares:** [ADR-043](../adr/ADR-043-services-led-supersedes-self-serve-payments-launch.md) (services-led; self-serve payments launch withdrawn) and [ADR-027](../adr/ADR-027-collaborative-draft-sharing-and-release-permissions.md) (collaborative draft sharing and the release / Open Library permission model)
**Purpose:** Records how the two decisions differ and where they interact. No decision is changed here.

## Side by side

| | ADR-043 | ADR-027 |
|---|---|---|
| **Topic** | Monetization: whether to launch self-serve subscriptions or stay services-led | Sharing and permissions: draft sharing to invited people, and a public Open Library |
| **Status** | Accepted (24 Oct 2026, merged) | Proposed (3 Jul 2026). D2–D4 are built and live: draft sharing shipped in July 2026. |
| **Decision-maker** | Sivakumar Mambakkam | Sivakumar Mambakkam |
| **What's built** | Nothing new. The billing machinery exists but is dormant. | Draft sharing, invitations and comments (migrations 0007 and 0008, the sharing router, mobile comment UI). |
| **What's deferred** | The self-serve payment rail, pending a revival ADR | Open Library publishing and registration-gated reading (D5–D8), gated on ADR-021 D8 |
| **Build gate** | Revival needs O1 (platform), O2 (model), O3 (pricing), and a demand trigger that is not yet set | Four ADR-021 D8 prerequisites: legal/DMCA, moderation readiness, real demand, money-model fit |
| **Privacy posture** | Card data never reaches Mentible servers | Hosts author content on Mentible servers. A deliberate exception to zero-knowledge, scoped to shared content only (D8). |
| **Money** | Services-led. Managed access granted by admin entitlement. | Open question O1: is draft sharing a paid, subscriber-gated feature, or open to any registered author? |
| **Supersedes or reverses** | Withdraws the self-serve launch in the payments spec only | Reverses ADR-021's "publicly readable" wording (recorded as ADR-021 D9) |
| **Open items** | Revival threshold; free-tier limit gap on the older generation routes; archiving the payments spec | O1 to O5: subscriber gate, comment visibility, retention, tag vocabulary, guest claim flow |

## Where they interact

1. **O1 depends on a model that is now on hold.** ADR-027 recommends treating sharing as an author capability and revisiting a paid gate only if hosting cost warrants it. That still holds, but any paid gate would now be an admin entitlement, not a subscription. O1 should be re-answered with ADR-043 in view.
2. **ADR-043 may help meet one of ADR-027's gates.** The "money-model fit" prerequisite could be partly satisfied by the services-led decision. ADR-021 D8 has not been checked in full, so this is unconfirmed.
3. **Both defer a build for the same reason.** Each waits for a demand or money signal, and each names its prerequisites.

## Shared weak spot

Both headers say "Proposed," but both have accepted or built parts. ADR-027's built parts are live. ADR-037 has the same issue. A short status pass across the three would fix it.

## Open questions

- Should ADR-027 O1 be re-answered now, or after ADR-043's revival threshold is set?
- Does ADR-021 D8's "money-model fit" gate count as met by ADR-043, or does it need a separate decision?
- Should the three ADRs (027, 037, 043) get a status pass together?
