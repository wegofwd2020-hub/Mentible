# Mentible Feature Roadmap
## Current State + 18-Month Plan (August 2026 – February 2028)

**Last Updated:** August 16, 2026  
**Current Version:** v0.2.0 (Production)  
**Roadmap Version:** 1.0

---

## Executive Summary

### Current State (Production)
- ✅ **26 features BUILT** (core authoring, auth, quality, publishing, operations)
- ⚠️ **3 features PARTIAL** (publishing APIs, collaboration, managed billing)
- 📋 **5 features PROPOSED** (designed, not built)
- ❌ **15 features NOT BUILT** (backlog)

### Next 18 Months
**Focus:** Features 3, 4, 5, 6 (complete end-to-end author journey)

| Phase | Timeline | Features | Business Goal |
|---|---|---|---|
| **Phase 1: Quality** | Mo 1–2 | Quality gates (auto + paid review) | Tier pricing, recurring revenue |
| **Phase 2: Publishing** | Mo 2–4 | Publishing integration (KDP + Apple + IngramSpark) | Complete author journey |
| **Phase 3: Collaboration** | Mo 3–5 | In-app feedback, beta readers, revisions | Content improvement, retention |
| **Phase 4: Services** | Mo 5–8 | Marketplace (design, editing, formatting) | Revenue × 4, lock-in |

---

## 🟢 CURRENTLY BUILT FEATURES (26)

### Tier 1: Core Authoring (5 Features)

#### 1. Books-Only Authoring
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Structured intake (topic, scope, level, depth) → topic-tree editor → per-topic LLM generation
- **Test Coverage:** 85%
- **Launch Date:** Jun 27, 2026
- **Impact:** Focused, opinionated workflow (no single queries)
- **Used by:** All authors

---

#### 2. Multi-Provider LLM Integration
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Support for 5+ LLM providers (Anthropic Claude, OpenAI GPT, Groq, OpenRouter, Google Gemini)
- **Test Coverage:** 92%
- **Launch Date:** Jun 27, 2026
- **Impact:** User choice, no vendor lock-in
- **Used by:** 40%+ of power users (mix providers)
- **Providers Supported:**
  - Anthropic Claude (Claude 3 Opus, Sonnet)
  - OpenAI GPT (GPT-4, GPT-4 Turbo)
  - Groq (Mixtral, LLaMA 2)
  - OpenRouter (aggregator access to 50+ models)
  - Google Gemini

---

#### 3. Per-Topic Generation with Progress Tracking
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Real-time progress bars, generation status, estimated time remaining per topic
- **Test Coverage:** 88%
- **Launch Date:** Jun 27, 2026
- **Impact:** Transparency, user confidence
- **UX:** Mobile-first dashboard with visual progress

---

#### 4. Generation Parameter Customization
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Tone, depth, length, style guide options per topic
- **Test Coverage:** 80%
- **Launch Date:** Jun 27, 2026
- **Impact:** Fine-grained control over LLM output
- **Parameters:**
  - Tone: Formal, casual, conversational, academic
  - Depth: Intro, intermediate, expert
  - Length: Short (500w), medium (1000w), long (2000w)
  - Style: Narrative, bullet-point, Q&A, storytelling

---

#### 5. Outline Editor with Topic Tree
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Drag-and-drop topic hierarchy, nested chapters, section management
- **Test Coverage:** 82%
- **Launch Date:** Jun 27, 2026
- **Impact:** Visual organization, easy chapter/section management
- **Features:**
  - Add/remove topics
  - Reorder chapters
  - Nested subtopics
  - Per-chapter descriptions

---

### Tier 2: Authentication & Accounts (3 Features)

#### 6. User Accounts & Authentication
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Supabase IdP, email/password, Google sign-in, per-provider credential storage
- **Test Coverage:** 88%
- **Launch Date:** Jun 27, 2026
- **Impact:** Secure identity, multi-provider key storage (never stores keys unencrypted)
- **Auth Methods:**
  - Email + password
  - Google OAuth
  - Session management (JWT)
  - Device tracking

---

#### 7. Per-Provider API Key Management (BYOK)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Authors bring own API keys per provider, ephemeral storage (Redis TTL)
- **Test Coverage:** 90%
- **Launch Date:** Jun 27, 2026
- **Impact:** Security (Mentible never stores keys); cost transparency
- **Security Model:**
  - Keys encrypted at rest
  - Ephemeral Redis cache (TTL: 1 hour)
  - No key logging in audit trail
  - Device verification required

---

#### 8. Account Settings & Preferences
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Email settings, device management, provider preferences, account deletion
- **Test Coverage:** 85%
- **Launch Date:** Jun 27, 2026
- **Impact:** User control, privacy
- **Settings:**
  - Email notifications (on/off)
  - Device list + revoke
  - Default LLM provider
  - Theme (light/dark)
  - Language preference

---

### Tier 3: Project Management & Tracking (4 Features)

#### 9. Project Dashboard & Real-Time Status Tracking
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Milestone tracking (outline → draft → feedback → final → cover → publishing prep)
- **Test Coverage:** 80%
- **Launch Date:** Jun 27, 2026
- **Impact:** Visibility into project progress
- **Milestones:**
  - Outline approval (0%)
  - First draft chapters (25%)
  - Feedback & revision (50%)
  - Final manuscript (75%)
  - Cover & publishing prep (100%)

---

#### 10. Writer Activity Feed (Author Side)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Timestamp-tracked generation events, submissions, completions
- **Test Coverage:** 78%
- **Launch Date:** Jun 27, 2026
- **Impact:** Transparency, notification triggers
- **Events Tracked:**
  - Generation started/completed
  - Topic submission
  - Revision requested
  - Export initiated

---

#### 11. Manuscript Versioning & Archive
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Auto-snapshot each generation, side-by-side comparison, revert capability
- **Test Coverage:** 78%
- **Launch Date:** Jun 27, 2026
- **Impact:** Safety net, iteration history
- **Version Control:**
  - Auto-snapshot per topic generation
  - Compare versions (text diff)
  - Revert to earlier version
  - Archive in EPUB3, PDF, DOCX

---

#### 12. Revision Request System (Basic)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Form to request changes per topic/chapter
- **Test Coverage:** 75%
- **Launch Date:** Jun 27, 2026
- **Impact:** Structured feedback loop
- **Workflow:**
  - Flag topics for revision
  - Add specific feedback
  - Track revision rounds
  - Status: pending/approved

---

### Tier 4: Quality & Compliance (5 Features)

#### 13. Content Trust Manifest (SBQ-TRUST-001/002)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Automated stamping of provider/model/version on each generation
- **Test Coverage:** 82%
- **Launch Date:** Jun 27, 2026
- **Impact:** Provenance tracking, transparency
- **Manifest Includes:**
  - Provider (Anthropic, OpenAI, etc.)
  - Model (Claude 3 Opus, GPT-4, etc.)
  - Model version
  - Generation timestamp
  - Parameters used (tone, depth, length)
  - Hash for integrity

---

#### 14. TrustBadge (Visual Provenance)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Visual badge in compiled book showing trust/compliance status
- **Test Coverage:** 78%
- **Launch Date:** Jun 27, 2026
- **Impact:** Reader confidence, author credibility
- **Badge Shows:**
  - AI-generated (with provider)
  - Quality review status
  - Compliance checks passed
  - Edition number

---

#### 15. Quality Gate 3: Format Drift Validation
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Automated validation that manuscript format is valid (structure, headings, metadata)
- **Test Coverage:** 84%
- **Launch Date:** Jun 27, 2026
- **Impact:** Prevents broken books from shipping
- **Checks:**
  - Valid EPUB3 structure
  - Headings hierarchy correct
  - Cover image present
  - Metadata complete
  - No broken links

---

#### 16. Compliance Metadata Validation
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Ensures all required metadata fields filled (title, author, description, category)
- **Test Coverage:** 80%
- **Launch Date:** Jun 27, 2026
- **Impact:** Books ready for retailers immediately after export
- **Required Fields:**
  - Book title
  - Author name
  - Description (100–5000 chars)
  - Category/genre
  - Language
  - Age gate (if applicable)

---

#### 17. Super-Admin Operator Console
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Backend API + mobile interface for user suspension, reactivation, deletion + audit trail
- **Test Coverage:** 90%
- **Launch Date:** Jun 27, 2026
- **Impact:** Operational safety, compliance, fraud prevention
- **Admin Operations:**
  - Suspend user account
  - Reactivate account
  - Delete account + data
  - View audit log
  - Override generation limits
  - Flag books for review

---

### Tier 5: Publishing & Artifacts (5 Features)

#### 18. EPUB3 Compiler (Full OCF/OPF Compliance)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Node.js compiler producing valid EPUB3 with OCF/OPF, nav, per-topic XHTML, MathML, SVG inline
- **Test Coverage:** 88%
- **Launch Date:** Jun 27, 2026
- **Impact:** Professional publication-ready books
- **Features:**
  - OCF (Open Container Format) compliant
  - OPF (Open Publication Format) metadata
  - XHTML per chapter
  - MathML for equations
  - SVG for diagrams
  - NCX + HTML5 nav
  - Accessibility metadata (ARIA)

---

#### 19. PDF Export (Vivliostyle Textbook Layout)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Professional PDF output with textbook layout, page numbers, TOC, quizzes, appendix
- **Test Coverage:** 88%
- **Launch Date:** Jun 27, 2026
- **Impact:** Print-ready + screen-reading versions
- **Features:**
  - Vivliostyle layout engine
  - Automatic page numbering
  - Generated table of contents
  - Headers/footers
  - Appendix support
  - Embedded fonts

---

#### 20. Cover Image Extraction & Integration
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Extract cover from uploaded EPUB, embed in EPUB3/PDF, optimize for retailers
- **Test Coverage:** 82%
- **Launch Date:** Jun 27, 2026
- **Impact:** Professional book appearance
- **Optimization:**
  - Cover resizing (1080×1350 for KDP, etc.)
  - Format conversion (to JPEG/PNG)
  - Validation (DPI, dimensions, safety margins)

---

#### 21. EPUB Import & Library
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Authors can import existing EPUB files, extract metadata, use as reference
- **Test Coverage:** 75%
- **Launch Date:** Jun 27, 2026
- **Impact:** Interoperability, reference library
- **Import Features:**
  - Parse existing EPUB
  - Extract metadata (title, author, TOC)
  - Show cover thumbnail
  - Use for style reference

---

#### 22. JSON Manuscript Export
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Export book.json (structured manuscript data) for archival or external tools
- **Test Coverage:** 76%
- **Launch Date:** Jun 27, 2026
- **Impact:** Data portability, interoperability
- **JSON Includes:**
  - Metadata (title, author, dates)
  - Topic tree (chapters, sections)
  - Content per chapter
  - Generation metadata (provider, model, params)
  - Version history

---

### Tier 6: Rate Limiting & Operations (2 Features)

#### 23. Rate Limiting (Per-Identity + IP Fallback)
- **Status:** ✅ BUILT & SHIPPED (2026-06-16)
- **Description:** Fixed-window limiter on expensive endpoints (/generate, /structure, /export)
- **Test Coverage:** 86%
- **Launch Date:** Jun 16, 2026
- **Impact:** DDoS protection, cost control, fair usage
- **Limits:**
  - Per-minute: 20 requests
  - Per-day: 500 requests
  - Fallback: IP-based if auth fails
  - Response: 429 with Retry-After header

---

#### 24. Managed Billing & Key Vault (ADR-005 D6)
- **Status:** ✅ BUILT (but OFF BY DEFAULT)
- **Description:** Authed managed-key vault, per-account metering, spend ceiling, plans/entitlements
- **Test Coverage:** 80%
- **Launch Date:** Jun 30, 2026
- **Status:** OFF in production (BYOK only live path)
- **Impact:** Enables managed tier without requiring authors' API keys
- **Features:**
  - RevenueCat integration
  - Per-account API keys (Mentible's)
  - Metering: track usage per author
  - Plans: Starter, Pro, Studio
  - Spend limits + warnings
  - Admin margin tracking

---

### Tier 7: Mobile & UX (2 Features)

#### 25. Book Metadata Window & Review Data
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Tap a book to view name, release date, model, level, depth, diagram type, page count, reviewer info
- **Test Coverage:** 70%
- **Launch Date:** Jun 27, 2026
- **Impact:** Discovery of book details, publication insights
- **Displayed Metadata:**
  - Title, author, release date
  - LLM provider + model
  - Learner level (intro/intermediate/expert)
  - Depth (light/medium/heavy)
  - Diagram type
  - Page count
  - Reviewer name & date

---

#### 26. Contextual Help Hints (HelpHint)
- **Status:** ✅ BUILT & SHIPPED (2026-06-27)
- **Description:** Inline ? buttons explaining UX decisions (generation params, BYOK key storage, provider toggle)
- **Test Coverage:** 65%
- **Launch Date:** Jun 27, 2026
- **Impact:** Reduces support burden, improves onboarding
- **Help Topics:**
  - What's "level" vs "depth"?
  - Why store my key locally?
  - How do providers differ?
  - What if my generation fails?

---

## 🟡 PARTIALLY BUILT FEATURES (3)

### Partial 1: Publishing Distribution Integration
- **Status:** ⚠️ PARTIAL (Compiler done, APIs not wired)
- **What's Built:** EPUB3/PDF compiler with professional output
- **What's Missing:** KDP API integration, Apple Books metadata sync, IngramSpark (print) wiring
- **Current Impact:** Authors must manually upload to retailers
- **Priority:** P0 (blocking for end-to-end experience)
- **Timeline to Complete:** Phase 2 (Months 2–4)

---

### Partial 2: Collaborative Draft Sharing (ADR-027)
- **Status:** ⚠️ PARTIAL (Core sharing built, access tiers incomplete)
- **What's Built:** Invite-based draft sharing, version-scoped comments (PRs #267, #268, #271)
- **What's Missing:** Tier 5–8 access control, "Everyone Library" moderation, public sharing
- **Current Impact:** Can share with 3–5 reviewers, not broader audience
- **Priority:** P1 (depends on Everyone Library)
- **Timeline to Complete:** Phase 3 (Months 3–5)

---

### Partial 3: Managed Billing Activation
- **Status:** ⚠️ PARTIAL (Infrastructure built, feature off)
- **What's Built:** Vault, metering, plans, RevenueCat integration
- **What's Missing:** Product layer activation, UI wiring, subscription purchase flow
- **Current Impact:** BYOK only (free or cost-of-compute)
- **Priority:** P0 (unlocks recurring revenue)
- **Timeline to Complete:** Phase 1 (Months 1–2)

---

## 🔵 PROPOSED FEATURES (5) — Designed but Not Built

### 1. Revision Management System (Full Workflow)
- **Status:** 📋 PROPOSED (ADR-019 designed)
- **Description:** Tracked revision cycles with author feedback, writer acknowledgment, quality gates
- **Business Case:** Quality improvement loop without hiring ghostwriters
- **Features:**
  - Revision request form (specific sections)
  - Change-tracking view (before/after diffs)
  - Revision round limits (e.g., 3 major, unlimited minor)
  - Approval workflow (Approve/Request-Revisions/Reject)
- **Timeline:** Phase 3 (Mo 3–5)
- **Effort:** 2–3 months
- **Dependency:** Feature 3 (Collaboration)

---

### 2. In-App Messaging & Collaboration
- **Status:** 📋 PROPOSED (ADR-025 designed)
- **Description:** Secure messaging between author and editor/beta readers
- **Business Case:** Reduce external tool dependency, keep conversation in Mentible
- **Features:**
  - Message threads per project (not per chapter)
  - @mentions for urgent queries
  - File uploads (samples, references, manuscripts)
  - Read receipts + typing indicators
  - Email digest (daily/weekly summary)
- **Timeline:** Phase 3 (Mo 3–5)
- **Effort:** 2–3 months
- **Dependency:** User accounts (already built)

---

### 3. Reader Engagement & Feedback Loop (ADR-023)
- **Status:** 📋 PROPOSED (design only)
- **Description:** Track published book downloads, reader ratings, anonymous feedback forms
- **Business Case:** Feeds back into author satisfaction metrics, writer reputation (future)
- **Features:**
  - Book ratings + reviews (1–5 stars)
  - Reader feedback forms (anonymized)
  - Download tracking (per book, per retailer)
  - Sales analytics dashboard
  - Bestseller rankings (by genre)
- **Timeline:** Phase 4 (Mo 6–8)
- **Effort:** 2–3 months
- **Dependency:** Publishing integration (Phase 2)

---

### 4. Library & Content Discovery (ADR-021)
- **Status:** 📋 PROPOSED ("Everyone Library" design)
- **Description:** Author-generated content library, community-curated, moderation system
- **Business Case:** Network effects, social proof, discovery for new authors
- **Features:**
  - Author uploads to Everyone Library
  - Community ratings + favorites
  - Category browsing (by genre, level, topic)
  - Moderation workflow (auto-flag, manual review)
  - Featured collections (staff picks, bestsellers)
- **Timeline:** Phase 4+ (deferred, high complexity)
- **Effort:** 3–4 months
- **Dependency:** Reader engagement (Phase 4)

---

### 5. White-Label Licensing (Design Phase)
- **Status:** 📋 PROPOSED (design only)
- **Description:** License Mentible to indie publishers, writing communities, corporate training orgs
- **Business Case:** B2B revenue, expansion to education/enterprise
- **Features:**
  - Custom domain (company.mentible.io)
  - Branded UI (logo, colors, fonts)
  - Private author community
  - Admin dashboard (analytics, user management)
  - Annual licensing fee ($10k–$50k) + per-project commission
- **Timeline:** Phase 4+ (deferred)
- **Effort:** 2–3 months
- **Dependency:** Marketplace services (Phase 4)

---

## 🚀 NOT YET BUILT FEATURES (15) — Backlog/Future

### Writer-Related (5 Features) — Not Applicable Today
These were designed for Ghostwriting Squad comparison. **Mentible does not have writers** (LLM only).

1. **Writer Profile & Skills Registry** — N/A (no human writers)
2. **Writer-Author Matching Engine** — N/A (no human writers)
3. **Writer Job Board & Task Allocation** — N/A (no human writers)
4. **Writer Payment & Tax Compliance** — N/A (no human writers)
5. **Writer Performance Analytics & Retention** — N/A (no human writers)

---

### Marketplace Services (2 Features)
These are planned for Phase 4 (Months 5–8):

1. **Marketplace Services Directory** (Cover Design, Editing, Formatting)
   - Status: ❌ NOT BUILT
   - Business Case: Professional-quality books without external vendors
   - Timeline: Phase 4 (Mo 5–8)
   - Effort: 6–8 weeks recruiting + vetting
   - Target: 50–100 freelancers onboarded by Month 8

2. **Bundled Service Pricing & Upsells**
   - Status: ❌ NOT BUILT
   - Business Case: Revenue multiplication (cover $500–$1k, editing $500–$1k, formatting $300–$600)
   - Timeline: Phase 4 (Mo 5–8)
   - Effort: 2–3 months (pricing design + payment integration)
   - Model: 25% commission on each service

---

### Subscriptions & Recurring Revenue (2 Features)

1. **Author Coaching Subscriptions**
   - Status: ❌ NOT BUILT
   - Tiers:
     - Lite: $99/mo (monthly email AMA, community access)
     - Plus: $299/mo (bi-weekly office hours, critique circles, pre-pub review)
     - Premium: $799/mo (1:1 coaching, sales strategy, ongoing support)
   - Business Case: Recurring revenue, author retention, LTV increase
   - Timeline: Phase 4 (Mo 5–8)
   - Effort: 2–3 months

2. **Subscription Entitlements & Gating**
   - Status: ❌ NOT BUILT (but foundation exists)
   - Gate: Premium features by subscription tier
     - Free: BYOK generation + basic export
     - Managed: Managed keys + higher rate limits
     - Pro: Marketplace services at discounts
     - Studio: Everything + coaching access
   - Timeline: Phase 1–2 (concurrent with billing activation)
   - Effort: 1–2 months

---

### Publishing Distribution (3 Features)

1. **Amazon KDP API Integration**
   - Status: ❌ NOT BUILT (planned)
   - Scope: Auto-upload to KDP, metadata sync, OAuth flow
   - Timeline: Phase 2 (Mo 2–4)
   - Effort: 2–3 months

2. **Apple Books Integration**
   - Status: ❌ NOT BUILT (using aggregator instead)
   - Scope: Via Draft2Digital or direct API
   - Timeline: Phase 2 (Mo 2–4)
   - Effort: 1–2 months (aggregator simpler than direct)

3. **IngramSpark (Print-on-Demand)**
   - Status: ❌ NOT BUILT (ebook-focused today)
   - Scope: Interior formatting, cover, print integration
   - Timeline: Phase 2+ (deferred, lower priority)
   - Effort: 2–3 months

---

### Hosted Library & Infrastructure (2 Features)

1. **Hosted Private Library (ADR-033)**
   - Status: ❌ NOT BUILT
   - Description: Per-user server-hosted library tier (opt-in, paid)
   - Device-local free baseline unchanged
   - Timeline: Phase 4+ (deferred)
   - Effort: 3–4 months

2. **Per-User Library RAG & Embeddings**
   - Status: ❌ NOT BUILT
   - Description: Search books by topic, retrieval-augmented generation for references
   - Timeline: Phase 4+ (deferred)
   - Effort: 2–3 months

---

### Audio & Multimedia (1 Feature)

1. **Audiobook Production Pipeline**
   - Status: ❌ NOT BUILT
   - Scope: TTS narration or professional narrator directory
   - Timeline: Phase 4+ (deferred, low priority)
   - Effort: 3–4 months

---

## 📊 ROADMAP BY PHASE

### Phase 1: Quality Gates & Foundation (Months 1–2)

| Feature | Effort | Status | Impact |
|---|---|---|---|
| **Quality Gates (Automated)** | 1–2 mo | 🔵 PLANNED | Plagiarism check, readability, policy compliance |
| **Quality Gates (Paid Review)** | 2–3 mo | 🔵 PLANNED | Optional expert review (editor, sensitivity reader) |
| **Managed Billing Activation** | 1–2 mo | 🔵 PLANNED | Turn on existing infrastructure, unlock recurring revenue |
| **Analytics Foundation** | 1–2 mo | 🔵 PLANNED | CAC, LTV, churn, NPS tracking |

**Goal:** Authors confident before publishing; recurring revenue path established

**Success Metrics:**
- ✅ >95% books pass automated review
- ✅ 15–30% of authors request expert review
- ✅ 5–10% of users on managed tier by end of phase

---

### Phase 2: Publishing Integration (Months 2–4)

| Feature | Effort | Status | Impact |
|---|---|---|---|
| **Publishing API Research & Choice** | 2 weeks | 🔵 PLANNED | Decide: Draft2Digital vs. direct APIs |
| **Amazon KDP Integration** | 2–3 mo | 🔵 PLANNED | One-click upload to KDP + metadata sync |
| **Apple Books Integration** | 1–2 mo | 🔵 PLANNED | Via aggregator or direct |
| **Sales Tracking Dashboard** | 1–2 mo | 🔵 PLANNED | Unified view: KDP + Apple + others |
| **ISBN Assignment** | 1 mo | 🔵 PLANNED | Via Draft2Digital or direct assignment |

**Goal:** Complete author journey (idea → published book on all retailers)

**Success Metrics:**
- ✅ 80%+ of compiled books published to KDP
- ✅ <48 hours from compile to KDP live
- ✅ Unified sales dashboard shows >3 retailers

---

### Phase 3: Collaboration & Quality (Months 3–5)

| Feature | Effort | Status | Impact |
|---|---|---|---|
| **Revision Management System** | 2–3 mo | 🔵 PLANNED | Structured feedback loops |
| **In-App Messaging** | 2–3 mo | 🔵 PLANNED | Beta readers, editors in-platform |
| **Collaborative Draft Sharing (Extended)** | 1–2 mo | 🔵 PLANNED | Tier 5–8 access control, broader sharing |
| **Change-Tracking Diffs** | 1–2 mo | 🔵 PLANNED | Visual before/after comparison |

**Goal:** Quality improvement loop; authors retain and republish

**Success Metrics:**
- ✅ 30%+ of projects have ≥1 collaborator
- ✅ Avg revision cycles <2 per project
- ✅ 40%+ of authors return for book #2

---

### Phase 4: Marketplace & Scale (Months 5–8)

| Feature | Effort | Status | Impact |
|---|---|---|---|
| **Marketplace Services Directory** | 6–8 weeks | 🔵 PLANNED | Recruit 50–100 designers, editors, formatters |
| **Service Bundling & Pricing** | 2–3 mo | 🔵 PLANNED | Tier pricing (Standard, Premium, Elite) |
| **Author Coaching Subscriptions** | 2–3 mo | 🔵 PLANNED | Lite/Plus/Premium coaching access |
| **Reader Engagement & Feedback** | 2–3 mo | 🔵 PLANNED | Ratings, downloads, feedback forms |
| **Matching Algorithm (Future)** | 3–6 mo | 🔵 DEFERRED | Learn from sales data (future phases) |

**Goal:** Revenue multiplication; author lock-in; network effects

**Success Metrics:**
- ✅ 50–100 freelancers onboarded
- ✅ 40%+ of authors buy ≥1 marketplace service
- ✅ 10–15% on coaching subscriptions
- ✅ ARR reaches $1M–$2M

---

### Phase 5: Scale & Optimization (Months 8–18)

| Feature | Timeline | Status |
|---|---|---|
| **Matching Algorithm Maturity** | Mo 13–18 | 🔵 DEFERRED |
| **Publishing Integrations Expansion** | Mo 13–16 | 🔵 DEFERRED |
| **White-Label Licensing Pilot** | Mo 12–15 | 🔵 DEFERRED |
| **Everyone Library (UGC)** | Mo 10–18 | 🔵 DEFERRED |
| **Hosted Library (Premium Tier)** | Mo 13–18 | 🔵 DEFERRED |

**Goal:** $3M–$5M ARR by month 18; establish moat through data

---

## 📈 DEPENDENCY MAP

```
Quality Gates (Feat 4)
    ↓
Publishing Integration (Feat 5)
    ↓
Collaboration Tools (Feat 3)
    ↓
Marketplace Services (Feat 6)
    ↓
Reader Engagement (Feat TBD)
    ↓
Matching Algorithm (Future)
```

**Critical Path:**
1. Quality gates (confidence to publish)
2. Publishing integration (reach readers)
3. Collaboration (quality improvement)
4. Marketplace (revenue + retention)

---

## 💰 FINANCIAL IMPACT BY PHASE

### Phase 1: Foundation (Mo 1–2)
- **Revenue:** $0 (BYOK unchanged)
- **Cost:** $50k–$100k (eng + QA)
- **Impact:** Positioning for monetization

### Phase 2: Publishing (Mo 2–4)
- **Revenue:** $0 (still free/BYOK)
- **Cost:** $100k–$150k (api integration, analytics)
- **Impact:** Unlock KDP publishing (reach)

### Phase 3: Collaboration (Mo 3–5)
- **Revenue:** $0 (feature, no direct monetization)
- **Cost:** $150k–$200k (eng)
- **Impact:** Increase author retention 35% → 45%

### Phase 4: Marketplace (Mo 5–8)
- **Revenue:** $30k–$50k/mo (marketplace commission)
- **Cost:** $200k–$300k (recruiter, payouts infra)
- **Impact:** Revenue multiplication (4x value per author)

### Phase 5: Scale (Mo 8–18)
- **Revenue:** $100k–$200k/mo (cumulative)
- **Cost:** $300k–$500k/mo (ops + eng)
- **Impact:** Path to profitability (margin expansion)

---

## 🎯 SUCCESS METRICS BY FEATURE

### Feature 3: Collaboration
- % of projects with ≥1 collaborator → 30%+
- Avg feedback rounds per project → <2
- Author satisfaction (revision feedback) → NPS >60

### Feature 4: Quality Gates
- % passing automated review → >95%
- % requesting expert review → 15–30%
- Avg book rating (post-publication) → +0.3 stars for reviewed books

### Feature 5: Publishing Integration
- % of books published → 80%+
- Days from compile to KDP live → <2 days
- Repeat publishing rate → 40%+ (book #2)

### Feature 6: Marketplace
- Freelancers onboarded → 50–100 by Mo 8
- Service attachment rate → 40%+ of authors
- Coaching subscription enrollment → 10–15%
- Marketplace revenue → $30k–$50k/mo

---

## 🗓️ Timeline Visualization

```
Month:   1   2   3   4   5   6   7   8   9   10  11  12  13  14  15  16  17  18
         |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
Phase 1: [=====] Quality Gates
Phase 2:     [===========] Publishing Integration
Phase 3:         [===========] Collaboration
Phase 4:             [==================] Marketplace
Phase 5:                             [==========================] Scale & Optimize
```

---

## 🔄 Feature Lifecycle

Each feature follows this lifecycle:

```
Design → Develop → Test → Alpha → Beta → Production → Maintain
```

### Example: Feature 4 (Quality Gates)

| Stage | Month | Status | Details |
|---|---|---|---|
| **Design** | 0–1 | ✅ DONE | Spec document, QA checklist |
| **Develop** | 1–2 | 🔄 IN PROGRESS | Auto checks (plagiarism, readability) |
| **Test** | 2 | 🔄 IN PROGRESS | Unit + integration tests |
| **Alpha** | 2 | 🔵 PLANNED | Internal team testing |
| **Beta** | 2 | 🔵 PLANNED | 10% of authors, optional opt-in |
| **Production** | 2 | 🔵 PLANNED | Roll out to all authors |
| **Maintain** | 3+ | 🔵 PLANNED | Monitor metrics, iterate |

---

## 📋 Current Backlog Status

### Ready to Build (P0 — Start Immediately)
- Feature 4: Quality Gates (Automated)
- Feature 5: Publishing Integration

### Designed, Ready (P1 — Start After Phase 2)
- Feature 3: Collaboration & Revision Management
- Feature 4: Quality Gates (Paid Review)

### Designed, Can Wait (P2 — Deferred to Phase 4+)
- Feature 6: Marketplace Services
- Reader Engagement & Feedback
- Everyone Library (UGC)
- White-Label Licensing

### Not Yet Designed (P3 — Future Planning)
- Audiobook production
- Hosted library (premium tier)
- Matching algorithm (data-driven)

---

## ✅ Checklist: Ready for Roadmap Review

- [x] Current features documented (26 built + 3 partial)
- [x] Timeline clear (18 months, 5 phases)
- [x] Dependencies mapped
- [x] Effort estimates provided
- [x] Success metrics defined
- [x] Financial impact projected
- [x] Backlog prioritized (P0–P3)
- [x] Status indicators consistent (✅ BUILT, 🔵 PLANNED, 📋 PROPOSED, ❌ NOT BUILT)

---

## 📞 Questions?

For questions on:
- **Strategy:** See `FEATURE_3-6_IMPLEMENTATION_REASONING.md`
- **Current state:** See `01_mentible_current_status.md`
- **Competitive context:** See `MENTIBLE_vs_KINDLE_KDP_COMPARISON.md`

---

**Roadmap Version:** 1.0  
**Last Updated:** August 16, 2026  
**Next Review:** October 2026 (after Phase 1 completion)

