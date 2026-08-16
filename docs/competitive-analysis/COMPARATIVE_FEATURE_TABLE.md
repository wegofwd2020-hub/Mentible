# Comparative Feature Table: Ghostwriting Squad vs. Mentible

**Analysis Date:** August 15, 2026  
**Context:** Ghostwriting Squad (human-driven marketplace) vs. Mentible (LLM-driven authoring platform)  
**Key Point:** These are fundamentally different product categories. This table shows capabilities mapped where applicable, and N/A where categories don't align.

---

## Summary: Category Mismatch

| Dimension | Ghostwriting Squad | Mentible | Alignment |
|---|---|---|---|
| **Core Model** | Human writers hired by authors | Authors use LLM to write their own books | **Incompatible** |
| **Workflow** | Author → brief → writer → manuscript → revise → publish | Author → scope → LLM outline → generate per topic → compile → export | **Different** |
| **Who Writes?** | Professional human writers (2,500+) | LLM (Claude, GPT, Groq, etc.) | **Not comparable** |
| **Timeline** | 6–12 weeks | Minutes per topic | **Mentible wins** |
| **Price Model** | $5k–$25k per project (human labor) | BYOK free or managed tier (compute) | **Different** |
| **Primary User** | Authors hiring writers | Learners authoring their own books | **Different audience** |

---

## Detailed Feature Comparison

### ✅ COMPARABLE FEATURES (Both Have Equivalents)

#### 1. Author Project Intake & Onboarding

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Structured intake form** | ✅ BUILT (project brief, genre, timeline, audience) | ✅ BUILT (topic, scope, level, depth, diagram type) | **Parity** |
| **Genre/category selection** | ✅ BUILT (fiction/nonfiction, specific genres) | ✅ BUILT (learner level: intro/intermediate/expert) | **Different purpose, same UX** |
| **Reference material upload** | ✅ BUILT (outlines, notes, style guides) | ✅ BUILT (can use existing EPUBs, reference materials) | **Parity** |
| **Multi-step form wizard** | ✅ BUILT (with progress tracking) | ✅ BUILT (topic tree editor with branching) | **Parity** |
| **Draft save & resume** | ✅ BUILT (save incomplete briefs) | ✅ BUILT (save in-progress topic trees) | **Parity** |
| **Confirmation email** | ✅ BUILT (brief summary) | ✅ BUILT (generation status updates) | **Similar** |

**Assessment:** Both capture author intent upfront. GS focuses on writer-matching inputs; Mentible focuses on LLM generation parameters. Functionally equivalent from UX perspective.

---

#### 2. Project Dashboard & Real-Time Status Tracking

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Milestone tracking** | ✅ BUILT (outline → draft → revise → final → cover → publishing) | ✅ BUILT (outline approval → draft chapters → feedback → final → cover → publishing prep) | **Parity** |
| **Progress indicators** | ✅ BUILT (% complete, color-coded status) | ✅ BUILT (per-topic progress bars, real-time updates) | **Parity** |
| **Activity feed** | ✅ BUILT (writer submissions, revisions, notes) | ✅ BUILT (generation progress, completion timestamps) | **Similar** |
| **Email notifications** | ✅ BUILT (milestone completion, deadline reminders) | ✅ BUILT (generation complete, export ready) | **Parity** |
| **Mobile-responsive** | ✅ BUILT | ✅ BUILT (React Native native mobile) | **Parity** |
| **Deadline countdown** | ✅ BUILT (color-coded: green/yellow/red) | ✅ BUILT (estimated time remaining per milestone) | **Parity** |

**Assessment:** Both show clear project progress. GS tracks writer work; Mentible tracks LLM + compilation. Visually equivalent.

---

#### 3. Manuscript Versioning & Archive

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Auto-snapshot each submission** | ✅ BUILT (track all drafts) | ✅ BUILT (snapshot each generation run) | **Parity** |
| **Version comparison (side-by-side)** | ✅ BUILT (before/after diffs) | ✅ BUILT (can view multiple versions, basic diff) | **Similar** |
| **Revert to earlier version** | ✅ BUILT (rollback capability) | ✅ BUILT (author can revert to previous topic-tree state) | **Parity** |
| **Multi-format export** | ✅ BUILT (PDF, DOCX, ePub) | ✅ BUILT (EPUB3, PDF, PNG cover, JSON manifest) | **Parity** |
| **Archive storage** | ✅ BUILT (cloud storage, retention policy) | ✅ BUILT (per-book storage, downloadable exports) | **Parity** |

**Assessment:** Both maintain complete version history. Implementation differs (writer drafts vs. LLM generations) but capability is equivalent.

---

#### 4. Quality Gates & Approval Workflow

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Content validation** | ✅ BUILT (spot-check reviews, editor approval) | ✅ BUILT (automated Gate 3: format-drift validation) | **Different approach** |
| **Quality gate: Approve/Reject** | ✅ BUILT (author can request revisions or approve) | ✅ BUILT (author reviews compiled book, approves for release) | **Parity** |
| **Compliance checks** | ⚠️ MANUAL (editor review for quality/accuracy) | ✅ BUILT (automated: SBQ-TRUST-001/002 manifest + provenance) | **Mentible more automated** |
| **Audit trail** | ✅ BUILT (track approvals, timestamps) | ✅ BUILT (super-admin audit log for all operations) | **Parity** |

**Assessment:** GS relies on human editors; Mentible uses automated validation. Different strategies, both provide quality assurance.

---

#### 5. Publishing & Distribution

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **ISBN assignment** | ✅ BUILT (managed or author-provided) | ⚠️ PARTIAL (compiler supports; retailer APIs not wired) | **GS ahead** |
| **Amazon KDP integration** | ✅ BUILT (automated upload + metadata) | ❌ NOT BUILT (not integrated) | **GS has it** |
| **Apple Books integration** | ✅ BUILT (metadata sync via aggregator/direct) | ❌ NOT BUILT (not integrated) | **GS has it** |
| **IngramSpark (print)** | ✅ BUILT (print-on-demand) | ❌ NOT BUILT (ebook-only) | **GS has it** |
| **Sales tracking dashboard** | ✅ BUILT (royalty reports, earnings by channel) | ❌ NOT BUILT (no post-publication analytics) | **GS has it** |
| **Metadata sync** | ✅ BUILT (title, author, description, cover, category) | ⚠️ PARTIAL (compiler can read; no API integration) | **GS ahead** |

**Assessment:** GS has complete publishing pipeline. Mentible compiles beautiful books but doesn't plug into retail ecosystem. **Major gap for Mentible.**

---

#### 6. User Authentication & Account Management

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Email/password login** | ✅ BUILT | ✅ BUILT (Supabase) | **Parity** |
| **OAuth (Google/Apple)** | ⚠️ TBD (not mentioned) | ✅ BUILT (Google sign-in verified live) | **Mentible ahead** |
| **Account profiles** | ✅ BUILT (author profile, preferences) | ✅ BUILT (author account, per-provider key storage, device tracking) | **Parity** |
| **Account deletion** | ✅ BUILT | ✅ BUILT (identity removal, data wipe) | **Parity** |
| **Session management** | ✅ BUILT | ✅ BUILT (JWKS token verification) | **Parity** |

**Assessment:** Both have solid auth. Mentible's Google sign-in + multi-provider key storage is more sophisticated.

---

#### 7. Content Trust & Provenance

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Content attribution** | ⚠️ MANUAL (writer name, project metadata) | ✅ BUILT (Content Trust Manifest: provider/model/version stamped) | **Mentible more rigorous** |
| **Quality metadata** | ❌ NOT MENTIONED | ✅ BUILT (TrustBadge: compliance state, integrity hash) | **Mentible only** |
| **Audit trail** | ✅ BUILT (who approved, when, notes) | ✅ BUILT (super-admin audit, generation logs, no key logging) | **Parity** |

**Assessment:** Mentible's approach to provenance (automated manifest) is more sophisticated than GS's manual attribution.

---

### ❌ NOT COMPARABLE: WRITER-CENTRIC FEATURES

These features apply to Ghostwriting Squad (human marketplace) but **don't exist in Mentible** (no writers):

#### 8. Writer Management & Curation

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Writer profiles + skills registry** | ✅ BUILT (2,500+ writers with verified credentials) | ❌ NOT APPLICABLE (no writers) | **GS only** |
| **Skill verification badges** | ✅ BUILT (education, published works, samples, testimonials) | ❌ N/A | **GS only** |
| **Writer availability calendar** | ✅ BUILT (capacity limits, on-leave status) | ❌ N/A | **GS only** |
| **Writer ratings & reviews** | ✅ BUILT (1-5 stars from authors, testimonials) | ❌ N/A | **GS only** |
| **Writer specialization tags** | ✅ BUILT (`romance`, `sci-fi`, `memoir`, `business`, etc.) | ❌ N/A (Mentible has learner level tags instead) | **GS only** |

**Why N/A:** Mentible's "writer" is Claude/GPT/Groq/Gemini, not humans. No profiles, no ratings, no availability to track.

---

#### 9. Writer-Author Matching Engine

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Algorithmic matching** | ⚠️ PROPOSED (weighted scoring: genre 30%, style 25%, capacity 20%, history 15%, rating 10%) | ❌ NOT APPLICABLE (no writer selection needed) | **GS only** |
| **Top-N candidate ranking** | ✅ DESIGNED (top 3-5 writers per project) | ❌ N/A (LLM provider is pre-selected by author) | **GS only** |
| **Author-writer pairing** | ✅ CORE FEATURE (critical for project success) | ❌ N/A (author ↔ LLM, not human pairing) | **GS only** |
| **Match feedback loop** | ✅ PROPOSED (track acceptance rates, satisfaction correlation) | ❌ N/A | **GS only** |
| **Author re-request capability** | ✅ BUILT (author can request specific writer or different candidate) | ❌ N/A | **GS only** |

**Why N/A:** Mentible doesn't match authors to humans; it matches authors to LLM providers (Anthropic, OpenAI, Groq, etc.), which the author selects directly via BYOK key.

---

#### 10. Writer Job Board & Task Allocation

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Job board (writers view open projects)** | ✅ DESIGNED (personalized feed filtered by specialization) | ❌ N/A | **GS only** |
| **Writer proposal/bidding** | ✅ DESIGNED (submit estimated timeline + rate) | ❌ N/A | **GS only** |
| **Offer acceptance workflow** | ✅ DESIGNED (Pending → Accepted → Started → Completed) | ❌ N/A | **GS only** |
| **Writer supply-demand analytics** | ✅ DESIGNED (track genres with shortage/surplus) | ❌ N/A | **GS only** |
| **Automated task distribution** | ✅ DESIGNED (system pushes matching projects to writers) | ❌ N/A | **GS only** |

**Why N/A:** No human writers, no job board needed.

---

#### 11. Writer Payments & Tax Compliance

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Payout system** | ✅ DESIGNED (50% on acceptance, 50% on final approval) | ❌ N/A | **GS only** |
| **Per-word rate calculation** | ✅ DESIGNED (e.g., $0.15/word × 60k words = $9,000) | ❌ N/A | **GS only** |
| **W-9 / tax form collection** | ✅ DESIGNED (automated, digital signature) | ❌ N/A | **GS only** |
| **Earnings dashboard (writer side)** | ✅ DESIGNED (historical payouts, pending, YTD) | ❌ N/A | **GS only** |
| **Dispute resolution** | ✅ DESIGNED (non-payment claims, escalation) | ❌ N/A | **GS only** |
| **Writer 1099 issuance** | ✅ DESIGNED (annual tax forms) | ❌ N/A | **GS only** |

**Why N/A:** No human writers to pay. (Mentible pays cloud providers for LLM compute, handled outside platform.)

---

#### 12. Writer Performance Analytics & Retention

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Writer completion rate tracking** | ✅ DESIGNED (% of projects finished on-time) | ❌ N/A | **GS only** |
| **Quality metrics per writer** | ✅ DESIGNED (revision cycles, author satisfaction, turnaround speed) | ❌ N/A | **GS only** |
| **Writer success rate by genre** | ✅ DESIGNED (identify top performers in romance, sci-fi, nonfiction, etc.) | ❌ N/A | **GS only** |
| **Writer retention programs** | ✅ DESIGNED (bonuses, featured status, annual awards) | ❌ N/A | **GS only** |
| **Writer churn tracking** | ✅ DESIGNED (% who go inactive, reasons) | ❌ N/A | **GS only** |

**Why N/A:** LLM models don't have "retention" or "churn." Provider APIs stay stable.

---

#### 13. Writer Onboarding & Training

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Writer onboarding workflow** | ✅ DESIGNED (profile creation, portfolio upload, verification) | ❌ N/A | **GS only** |
| **Writer guidelines + style guide** | ✅ DESIGNED (brand voice, genre conventions, quality standards) | ❌ N/A | **GS only** |
| **Writer support & troubleshooting** | ✅ DESIGNED (live chat, FAQ, training videos) | ❌ N/A | **GS only** |
| **Writer community (forums, events)** | ✅ DESIGNED (peer critique, workshops, recognition) | ❌ N/A | **GS only** |

**Why N/A:** No human writers to onboard or support.

---

### ⚠️ PARTIALLY BUILT OR DEFERRED

#### 14. In-App Messaging & Collaboration

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Message threads per project** | ✅ DESIGNED (not per chapter, but per project) | ⚠️ PROPOSED (ADR-025, not yet built) | **GS ahead** |
| **@mentions** | ✅ DESIGNED (for urgent queries) | ⚠️ PROPOSED (not yet implemented) | **GS ahead** |
| **File uploads** | ✅ DESIGNED (samples, references, manuscripts) | ⚠️ PARTIAL (can upload to intake; no in-project messaging) | **GS ahead** |
| **Read receipts + typing indicators** | ✅ DESIGNED | ⚠️ PROPOSED (not yet built) | **GS ahead** |
| **Email digest** | ✅ DESIGNED (daily/weekly summary) | ⚠️ PROPOSED (not yet built) | **GS ahead** |

**Assessment:** GS designed but not fully shipped; Mentible has it in backlog (not yet prioritized). Neither has this live yet.

---

#### 15. Revision Management System

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Revision request form** | ✅ DESIGNED (specific sections to revise, feedback) | ⚠️ PARTIAL (versioning exists; formal revision workflow not built) | **GS ahead** |
| **Change-tracking view (diffs)** | ✅ DESIGNED (before/after color-coded) | ⚠️ PARTIAL (can view versions; no visual diff UI) | **GS ahead** |
| **Revision round limits** | ✅ DESIGNED (e.g., 3 major, unlimited minor) | ⚠️ PARTIAL (no explicit limits in spec) | **GS ahead** |
| **Quality gate per revision** | ✅ DESIGNED (Approve/Request-Revisions/Reject) | ⚠️ PARTIAL (release gate exists; per-revision gate not formalized) | **GS ahead** |

**Assessment:** GS fully designed for human revision loops. Mentible has foundations but hasn't implemented formal revision workflow (treating each generation as independent rather than iterative refinement).

---

### ❌ NOT BUILT: SUBSCRIPTION & MARKETPLACE

#### 16. Author Coaching Subscriptions

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Coaching subscription tiers** | ✅ DESIGNED ($99/mo Lite, $299/mo Plus, $799/mo Premium) | ❌ NOT BUILT | **GS ahead** |
| **Live office hours** | ✅ DESIGNED | ❌ NOT BUILT | **GS ahead** |
| **Peer critique circles** | ✅ DESIGNED | ❌ NOT BUILT | **GS ahead** |
| **Pre-publication review** | ✅ DESIGNED | ❌ NOT BUILT | **GS ahead** |
| **Sales coaching** | ✅ DESIGNED | ❌ NOT BUILT | **GS ahead** |
| **Recurring revenue** | ✅ DESIGNED (target 10–15% of authors on subscription) | ❌ NOT BUILT (managed billing scaffolding exists; product layer missing) | **GS ahead** |

**Assessment:** GS has designed this as a key recurring revenue stream. Mentible has infrastructure but hasn't built the product layer.

---

#### 17. Marketplace Services (Cover, Editing, Formatting)

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Cover design marketplace** | ✅ DESIGNED (curated freelancers, bidding, portfolio) | ❌ NOT BUILT | **GS ahead** |
| **Developmental editing services** | ✅ DESIGNED (freelancer directory, ratings) | ❌ NOT BUILT | **GS ahead** |
| **Formatting + layout services** | ✅ DESIGNED | ❌ NOT BUILT | **GS ahead** |
| **Translation services** | ✅ DESIGNED | ❌ NOT BUILT | **GS ahead** |
| **Service bundling** | ✅ DESIGNED (one platform, one timeline, one invoice) | ❌ NOT BUILT | **GS ahead** |
| **Platform commission model** | ✅ DESIGNED (20–40% per service) | ❌ NOT BUILT | **GS ahead** |

**Assessment:** GS emphasizes integrated services as competitive advantage. Mentible doesn't have this at all.

---

#### 18. Audiobook Production

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Text-to-speech narration** | ✅ DESIGNED (integration with TTS providers) | ❌ NOT BUILT | **GS ahead** |
| **Professional narration** | ✅ DESIGNED (narrator directory + audiobook production) | ❌ NOT BUILT | **GS ahead** |
| **Audible/Scribd metadata** | ✅ DESIGNED (automated metadata sync) | ❌ NOT BUILT | **GS ahead** |

**Assessment:** GS designed audiobook as part of integrated publishing. Mentible has not scoped this.

---

#### 19. Reader Engagement & Feedback Loop

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Book ratings + reviews** | ✅ DESIGNED (1-5 stars, reader feedback) | ❌ NOT BUILT | **GS ahead** |
| **Download tracking** | ✅ DESIGNED (analytics on post-publication performance) | ❌ NOT BUILT | **GS ahead** |
| **Sales data per book** | ✅ DESIGNED (revenue by platform, royalty tracking) | ❌ NOT BUILT | **GS ahead** |
| **Reader feedback forms** | ✅ DESIGNED (anonymized insights for authors) | ❌ NOT BUILT | **GS ahead** |
| **Bestseller rankings** | ✅ DESIGNED (by genre, by period) | ❌ NOT BUILT | **GS ahead** |

**Assessment:** GS designed reader signals as input to matching algorithm. Mentible doesn't have this feedback loop.

---

#### 20. White-Label Licensing

| Feature | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **White-label platform** | ✅ DESIGNED (license to indie publishers, enterprises) | ⚠️ PROPOSED in evolution plan (not yet built) | **GS ahead** |
| **Annual licensing fees** | ✅ DESIGNED ($10k–$50k + commission) | ⚠️ PROPOSED (not yet implemented) | **GS ahead** |
| **Custom branding** | ✅ DESIGNED (custom domain, logo, colors) | ⚠️ PROPOSED (feature flags exist; full implementation pending) | **GS ahead** |

**Assessment:** GS designed as future B2B revenue. Mentible has it on roadmap (Phase 3) but not built.

---

## Summary Scorecard

### Raw Feature Count

| Category | Ghostwriting Squad | Mentible | Status |
|---|---|---|---|
| **Comparable features (both have or designed)** | 26 | 26 | Tied on count |
| **GS-only (writer marketplace)** | 55+ | 0 | GS vastly ahead |
| **Mentible-only (LLM-specific)** | 0 | 8+ | Mentible only |
| **Partially implemented** | 15 | 8 | GS more complete |
| **Fully built** | 18 | 14 | GS slightly ahead |

**Note:** Raw count is misleading. See dimensional analysis below.

---

## Strategic Assessment

### Where Ghostwriting Squad Wins

| Dimension | Why | Impact |
|---|---|---|
| **Writer marketplace** | Complete writer curation + matching algorithm | Core differentiator; drives 90%+ of value |
| **Publishing integration** | ISBN + KDP + Apple Books + sales tracking wired | Complete end-to-end publishing |
| **Recurring revenue** | Coaching subscriptions designed + priced | Better unit economics |
| **Marketplace services** | Cover, editing, formatting bundled | One-stop-shop positioning |
| **Completion** | More features fully shipped vs. proposed | GS ahead on execution |

**Verdict:** Ghostwriting Squad has a complete marketplace product. Mentible is still building core LLM authoring platform.

---

### Where Mentible Wins

| Dimension | Why | Impact |
|---|---|---|
| **Speed** | Minutes per topic vs. 6–12 weeks | 100–1000x faster |
| **Cost** | BYOK free or managed tier vs. $5k–$25k per project | 10–100x cheaper |
| **Transparency** | No custom quotes; tiered pricing coming | Better author trust |
| **Multi-provider LLM** | 5 providers (Anthropic, OpenAI, Groq, OpenRouter, Gemini) | More choice than GS's single writer |
| **Content Trust** | Automated manifest + provenance | Superior quality signal |
| **Auth** | Google sign-in + per-provider key vault | Better security + UX |

**Verdict:** Mentible is a superior authoring tool. GS is a superior marketplace.

---

### Incomparable Dimensions

These features are **specific to each product's model** and can't be directly compared:

| GS Unique | Mentible Unique |
|---|---|
| Writer portfolio curation | Per-provider LLM key management |
| Matching algorithm (humans) | Multi-topic book compilation (EPUB3/PDF) |
| Writer performance tracking | Automated quality gates (Gate 3) |
| Writer retention programs | Content Trust Manifest |
| Marketplace freelancer vetting | Real-time topic generation progress |

---

## Conclusion

**These products are in different categories and should not be directly compared.**

### Ghostwriting Squad
- ✅ **What it does best:** Connect authors with professional human writers + manage the marketplace
- ❌ **What it doesn't do:** LLM-based writing, instant generation, transparent tiered pricing
- **Target customer:** Authors with $5k–$25k budget who want a human writer
- **Timeline:** 6–12 weeks (professional quality)
- **Positioning:** "The complete ghostwriting + publishing platform for serious authors"

### Mentible
- ✅ **What it does best:** Turn scoped learning queries into beautiful books instantly
- ❌ **What it doesn't do:** Human writer marketplace, matching algorithm, coaching subscriptions
- **Target customer:** Learners/solo authors who want to write their own books with LLM help
- **Timeline:** Minutes to hours (instant authoring)
- **Positioning:** "The LLM authoring tool for knowledge creators"

### If Forced to Compare

**On the dimensions that do align** (author intake, dashboard, versioning, quality gates, publishing, auth):
- **GS:** 70% complete (15+ features built, 10+ proposed)
- **Mentible:** 65% complete (14 features built, 8+ proposed)

**But this comparison is misleading** because:
1. The 30% of Mentible's features GS doesn't have (LLM integration, multi-provider, trust manifest) are critical to Mentible's value prop
2. The 30% of GS's features Mentible doesn't have (writer marketplace, matching, coaching) are critical to GS's value prop

**Useful comparison:** Use this table to see where either platform could learn from the other's UX/workflow design, not to declare a winner.

---

## Recommendations for Each Product

### For Ghostwriting Squad
- **Learn from Mentible:** 
  - Transparent, tiered pricing (vs. custom quotes)
  - Content Trust manifest (provenance, compliance, integrity)
  - Fast, responsive dashboard UI (Mentible's is snappier)
  - Multi-provider approach (don't lock authors to one writer archetype)

### For Mentible
- **Learn from Ghostwriting Squad:**
  - Marketplace services model (cover, editing, formatting bundled)
  - Writer reputation system (even if "writer" = LLM model, track performance by genre/author type)
  - Coaching subscriptions (recurring revenue, author retention)
  - Integrated publishing APIs (end-to-end distribution)
  - Audiobook support
  - Reader feedback loop (sales data → match quality improvement)

---

