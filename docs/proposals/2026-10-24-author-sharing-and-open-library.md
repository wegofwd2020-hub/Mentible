# Author sharing and the Open Library: who sees and comments on a book

**Date:** 2026-10-24
**Scope:** How authors share their work with others. Who can read a draft, who can comment, and what becomes public.
**Not covered here:** what anyone pays. That is in [the pricing document](2026-10-24-pricing-and-monetization.md).
**Governing decision:** [ADR-027](../adr/ADR-027-collaborative-draft-sharing-and-release-permissions.md)

## Short answer

Authors can share in two places, and they have different audiences:

1. **Draft sharing (built).** An author invites named people to a work in progress. Invitees read it and leave comments. This is private: only invited people see it.
2. **Open Library (not built).** An author publishes a finished release edition to a public shelf. Anyone can see its listing. Reading the full edition requires an account.

Neither has anything to do with how Mentible charges. Draft sharing has one open question that touches money, and it is listed below.

## Two sharing surfaces

| | Draft sharing | Open Library |
|---|---|---|
| **What is shared** | A work in progress (a draft) | A finished release edition (EPUB3 or PDF) |
| **Audience** | Named people the author invites | Public. Anyone can find the listing. |
| **Who can read the full work** | Invited people. Registered invitees read and comment. Unregistered invitees read as guests. | Registered users only. Anonymous visitors see metadata only. |
| **Who can comment** | Registered invitees | Registered users, with ratings (ADR-023) |
| **Where content is hosted** | Mentible servers (deliberate exception to zero-knowledge) | Mentible servers |
| **Status** | Built and live (July 2026) | Not built. Gated on ADR-021 D8. |

## Draft permission matrix (built)

| Recipient | Reads the draft | Comments |
|---|---|---|
| Invited and registered | Yes | Yes |
| Invited, not registered | Yes, as a read-only guest | No |
| Not invited | No | No |

Commenting needs an account. A guest access path tied to the invited email is still an open decision (O5).

## Open Library rules (decided, not built)

- Only a finished **release** edition can be published. Drafts never reach the public shelf (D5).
- Anonymous visitors see metadata only: title, description, tags, cover, and aggregate ratings (D6).
- Registered users read the full edition and can rate and comment (D6, ADR-023).
- Publishing reverses ADR-021's "publicly readable" wording. That change is recorded as ADR-021 D9.

## Open decisions

| # | Question | Notes |
|---|---|---|
| O1 | Is draft sharing a paid, subscriber-gated feature, or open to any registered author? | The only place money touches sharing. ADR-027 recommends treating sharing as an author capability. Re-answer this with ADR-043 in view: a paid gate would now be an admin entitlement, not a subscription. |
| O2 | Comment visibility: author only, or all invitees? | Open |
| O3 | Retention, revocation, and moderation of drafts and comments | Open |
| O4 | Tags: free text now, or a controlled vocabulary later? | Open |
| O5 | How does a non-registered invitee claim access? | Open |

## Gates before the Open Library is built

ADR-021 D8 sets four prerequisites: legal and DMCA readiness, moderation readiness, real demand, and money-model fit. The services-led decision (ADR-043) may partly meet the money-model gate. That needs confirming against ADR-021 D8 in full.

## Keep these separate

- Sharing a draft with a reviewer is not a sale. It doesn't change what anyone pays.
- Publishing to the Open Library is not a subscription. It doesn't need a payment rail.
- The go-to-market one-pager uses "share" to mean publishing a finished piece. That is closer to the Open Library than to draft sharing, and it should be read that way.

## Open questions

1. Should O1 be answered now, or after the self-serve revival decision?
2. Does the Open Library need a launch date, or does it wait for ADR-021 D8?
3. Should guest access (O5) be built before commenting is opened to more people?
