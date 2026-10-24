# Review: Go-to-Market and Pricing One-Pager (October 2026)

**Date:** 2026-10-24
**Source:** `Mentible_GTM_Pricing_One_Page.pdf` (October 2026, one page; not checked into the repo)
**Status:** Review note only. No decision is recorded here. ADR-037, ADR-039 and ADR-043 are unchanged.

## What the one-pager proposes

- **Positioning:** creators and educators first (turn expertise into content people learn from and share). Self-paced learners second. The current site foregrounds adult learners and finished books.
- **Product model:** "Create and share" (capture, shape into a guide or book, repurpose, publish) and "Learn" (start from a topic, study a structured book, share the artifact).
- **Go-to-market:** Validate (15–20 interviews; recruit 10 paid pilot users) → Pilot (one knowledge source into one long-form asset plus short-form pieces) → Expand (faculty or continuing-education course pilot; caregiver and special-education needs explored separately).
- **Pricing to test:**

  | Offer | Test price | Role |
  |---|---|---|
  | Free exploration | $0 | Sample books, limited generation |
  | Starter | $9.99/month | Bounded managed usage; one active project |
  | Creator | $19.99/month | More usage, multiple projects, content repurposing |
  | One-time project | $9–$29 | Occasional book or guide creation |
  | Education pilot | $500–$1,500/course | One course or cohort per semester |

- **Pilot success:** 10 paid users; at least 6 completed and user-approved content packages; evidence of repeat creation; one repeatable acquisition channel. Keep AI usage capped or offer BYOK; defer automated posting and analytics.

## Conflicts with accepted decisions

1. **Self-serve subscriptions (ADR-043, ADR-039, ADR-037 D3).** The Starter and Creator monthly plans are self-serve subscriptions. ADR-043 withdrew the self-serve launch and set a revival threshold that has not been met. Launching these plans would revive self-serve without the ADR-043 revival decision.
2. **Audience (ADR-037).** ADR-037 makes SME experts primary and services-led. The one-pager makes creators and educators primary and does not mention SMEs.
3. **Ambiguous pilot wording.** "10 paid pilot users" could mean invoiced pilots (services-led, consistent with ADR-037) or subscriptions (self-serve, conflicting with ADR-043). The document does not say which.

## Consistent with accepted decisions

- The free tier matches ADR-037 D3 (2 projects; 20 generations per rolling 30 days). Check the one-pager's "limited generation" wording against that limit before publishing.
- The education pilot and one-time projects look like invoiced work, which fits services-led revenue.
- The AI spend caps and BYOK option match the managed-usage rules (ADR-005).
- The 30-day trial in the payments spec does not appear in the one-pager. The payments spec's $19.99 monthly price matches the Creator tier.

## Open questions for the owner

- Are Starter and Creator meant to be launched, or only tested as pricing research? If launched, ADR-043 needs a revival decision first.
- Does the creator and educator audience replace the SME focus, or sit beside it? ADR-037 needs an amendment if it replaces it.
- Does "10 paid pilot users" mean invoiced pilots or subscriptions?
- Is the one-pager a public site input? If so, check it against ADR-043 before publishing.
