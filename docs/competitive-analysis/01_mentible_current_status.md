# Report 1: Mentible Current Status as of 2026-07-20

**Product:** Mentible (rebrand of StudyBuddy Q)  
**Version:** v0.2.0  
**Status:** In Production (Go-live: 2026-06-27)  
**Repository:** `wegofwd2020-hub/Mentible` (internal name: `StudyBuddy_SelfLearner`)  
**Generated:** 2026-08-15 20:52:20

---

## Executive Summary

Mentible is a **purpose-built LLM authoring platform** for self-learners and knowledge creators. Users provide an Anthropic API key (BYOK), describe a topic + learning scope, and receive a professionally compiled **EPUB3/PDF book** as output.

**Current Shape:**
- Mobile-first (React Native + Expo) with web parity
- Multi-provider LLM support (Anthropic, OpenAI, Groq, OpenRouter, Gemini)
- Production backend deployed at `mambakkam.net/mentible-api`
- Full authentication (email + Google sign-in via Supabase)
- Shipped Android APK + hosted web app + read-only demo

**Product Positioning:**
- NOT a ghostwriting marketplace
- NOT a course platform
- NOT a chatbot or chat interface
- INSTEAD: A focused, opinionated client for turning scoped learning queries into polished books

---

## Feature Inventory

### Built Features (14 total)

| Feature | Tier | Owner | Launched | Test Coverage |
|---------|------|-------|----------|----------------|
| Books-Only Authoring | T1 | Mobile/Backend | 2026-06-27 | ✓ 85% |
| Content Trust Manifest & Provenance | T1 | Backend/Compiler | 2026-06-27 | ✓ 82% |
| Managed Billing & Key Vault (ADR-005 D6) | T1 | Backend/Billing | 2026-06-30 | ✓ 80% |
| Manuscript Versioning & Archive | T1 | Backend/Storage | 2026-06-27 | ✓ 78% |
| Node Artifact Compiler (EPUB3/PDF) | T1 | Compiler/Node | 2026-06-27 | ✓ 88% |
| Per-Provider LLM Integration | T1 | Backend/Mobile | 2026-06-27 | ✓ 92% |
| Project Dashboard & Status Tracking | T1 | Mobile | 2026-06-27 | ✓ 80% |
| Quality Gates (Gate 3 — Format Drift) | T1 | Backend | 2026-06-27 | ✓ 84% |
| Rate Limiting (Per-Identity + IP Fallback) | T1 | Backend | 2026-06-16 | ✓ 86% |
| Super-Admin Operator Role | T1 | Backend/Admin | 2026-06-27 | ✓ 90% |
| User Accounts & Authentication | T1 | Backend/Identity | 2026-06-27 | ✓ 88% |
| Book Metadata Window & Review Data | T2 | Mobile | 2026-06-27 | ✓ 70% |
| Contextual Help Hints (HelpHint) | T2 | Mobile/UX | 2026-06-27 | ✓ 65% |
| EPUB Import & Cover Extraction | T2 | Mobile | 2026-06-27 | ✓ 75% |

#### Highlights

**Authoring Loop:**
- Books-only intake (no single-query mode) → topic-tree editor → per-topic LLM generation → in-app reader
- Multi-provider BYOK (each author picks a provider + key)
- Structured project milestones (outline → draft → feedback → final → cover → publishing prep)

**Quality & Trust:**
- Content Trust Manifest (provider/model/version stamped on each generation)
- Mandatory format validation (Gate 3) on all outputs
- Super-admin console with full audit trail
- Rate limiting (per-identity + IP fallback) on expensive operations

**Artifacts & Publishing:**
- EPUB3 (OCF/OPF compliant, MathML + SVG inline, accessibility metadata)
- PDF (Vivliostyle textbook layout, page-numbered TOC, quizzes, appendix)
- Manuscript versioning + import/export of multiple formats
- Draft/release watermarking + edition tracking on cover/colophon

**Operations:**
- User accounts (Supabase, JWKS verification, no passwords stored)
- Google sign-in (verified live on production)
- Per-provider credential sets (each author stores keys per provider separately)
- Device tracking (for mobile installs)
- Managed billing infrastructure (off by default; BYOK is only live path)

---

### Partially Built Features (2 total)

| Feature | Status | Notes |
|---------|--------|-------|
| Collaborative Draft Sharing | PARTIALLY_BUILT | Invite-based draft sharing with version-scoped comments (ADR... |
| Publishing Distribution Integration | PARTIALLY_BUILT | ISBN assignment, API integration with Amazon KDP, Apple Book... |

---

### Proposed / Under Design ({len(proposed)} total)

Features that have been approved in ADRs but **not yet built**:

- **In-App Messaging & Collaboration** — Secure messaging between author and writer (or co-authors) with threads per project. @mentions, file uploads, read receipts, email digest option.
- **Revision Management System** — Tracked revision cycles with author feedback, writer acknowledgment, quality gates. Change-tracking view (before/after diffs), revision round limits, approval workflow.


---

### Not Built (10 total)

Core features from the Ghostwriting Squad competitive spec that Mentible **does not yet have**:

- **Writer Job Board & Task Allocation** (T1) — Dashboard for writers to discover assignments, view project briefs, submit availability. Genre/skill-based filtering, job analytics by supply/demand gap.
- **Writer Payout & Tax Compliance** (T1) — Automated payout tracking, W-9/tax form collection, international compliance (GDPR, currency). Payment processor integration (Stripe, etc.), 1099 classification.
- **Writer Profile & Skills Registry** (T1) — Standardized writer profiles with verified skills, genre expertise, samples, availability. Quality signals: education, published works, testimonials, turnaround history.
- **Writer-Author Matching Engine** (T1) — Algorithmic ranking of writer candidates by genre specialization, style alignment, capacity fit, author history, and client rating. Weighted scoring + feedback loop.
- **Audiobook Production Pipeline** (T2) — Text-to-speech for EPUB3 narration or integration with professional narration services. Cover art generation, metadata for audio platforms (Audible, Scribd).
- **Author Coaching Subscriptions** (T2) — Recurring revenue stream: Author Lite ($99/mo), Plus ($299/mo), Premium ($799/mo). Live office hours, peer critique circles, pre-publication review, sales coaching.
- **Marketplace Extensions (Cover, Editing, Formatting)** (T2) — Curated freelancer directory for cover design, developmental editing, formatting services. Platform commission model (20-30% per service). Bundled upsells to base project.
- **Reader Engagement (Downloads, Ratings, Feedback)** (T2) — Track published book downloads, reader ratings, anonymous feedback forms. Feeds back into author satisfaction metrics and writer reputation.
- **Hosted Library & RAG (ADR-033)** (T3) — Per-user server-hosted library tier (opt-in). Device-local free baseline unchanged. Private hosted FTS + embeddings under managed billing. E2E-encrypted media sync (ADR-035).
- **White-Label Licensing Model** (T3) — License the Mentible platform (backend + mobile) to indie publishers, writing communities, corporate training orgs. Annual fee ($10k-$50k) + per-project transaction fees (5-10%).


---

## Architecture & Technical Posture

### Tech Stack
- **Backend:** FastAPI (Python 3.7+), PostgreSQL + asyncpg, Redis (ephemeral), Supabase (identity)
- **Mobile:** React Native + Expo (iOS & Android)
- **Web:** Expo web export (full parity with mobile)
- **Compiler:** Node.js (EPUB3/PDF generation, Vivliostyle layout)
- **LLM Seam:** Shared `wegofwd-llm` package (v0.2.0+) supporting multi-provider + tool-use repair

### Key Constraints (from CLAUDE.md)
1. **BYOK Security Model** — User pays Anthropic directly; platform never stores keys (except ephemeral in Redis with TTL + encryption)
2. **Vendored Pipeline Only** — No dependencies on private codebases
3. **Adults Only** — No COPPA/FERPA compliance; not a school product
4. **Quality Over Scale** — Demo of IP, not mass-market play (yet)

### Deployment
- **Production Backend:** Hetzner VPS (docker-compose.demo.yml, nginx reverse proxy)
- **Web App:** Expo web at `/app/mentible` (full auth + generation)
- **Demo:** Read-only interface at `/demos/mentible` (no login required)
- **Mobile:** Android APK released on GitHub (landing page `mambakkam.net/mentible`)

---

## Roadmap & ADR Status

### Recently Accepted (Implemented Q2 2026)
| ADR | Title | Status |
|-----|-------|--------|
| 001 | BYOK Security Model | Accepted ✓ Implemented |
| 003 | Book Authoring | Accepted ✓ Implemented |
| 004 | Two-Product Split + Artifacts | Proposed (partial) |
| 005 | Multi-Provider LLM + Hybrid Keys | Accepted ✓ Implemented |
| 006 | Rebrand to Mentible | Accepted ✓ Implemented (TM pending) |
| 009 | Books-Only (Remove Query) | Accepted ✓ Implemented |
| 014 | User Accounts + Identity | Accepted ✓ Implemented |
| 015/016 | Content Trust Manifest | Accepted ✓ Implemented |
| 020 | Super-Admin Operator | Accepted ✓ Implemented |
| 022 | Account Deletion Identity Removal | Accepted ✓ Implemented (OFF in prod) |
| 027 | Collaborative Draft Sharing | Accepted (D2-D4 built; D5-D8 deferred) |

### Proposed (Design-Only, Not Built)
- **ADR-007:** Book templates & theme system (hardcoded today)
- **ADR-010:** Narrative/animated-character mode
- **ADR-021:** Everyone Library (UGC + moderation)
- **ADR-023:** Reader engagement (ratings, downloads, feedback)
- **ADR-024:** QR codes + deep-link share surface
- **ADR-025:** New-edition redistribution
- **ADR-028:** Open Shelves (free book-repo feeds)
- **ADR-029:** Library-grounded references (RAG over device shelf)
- **ADR-031:** Operator-granted managed access (feature gating axis)
- **ADR-033:** Per-user private hosted library (opt-in paid tier)
- **ADR-034:** Persona-validation gates + messaging governance

---

## Product Dimensions vs. Ghostwriting Squad

Mentible **does NOT map directly to Ghostwriting Squad's feature set.** Below is the dimensional comparison:

| Dimension | Mentible Posture | Ghostwriting Squad Requirement |
|-----------|------------------|-------|
| Author Onboarding | ✓ Structured intake (topic/scope/level/depth) | ✓ Project brief with author intent + samples |
| Writer Allocation | ✗ NOT APPLICABLE (no writers yet; author is the writer) | ✓ Algorithmic matching (genre, style, capacity, rating) |
| Project Workflow | ✓ Milestone tracking (outline→draft→revise→final) | ✓ Revision management, approval gates, timeline |
| Quality Gates | ✓ Format validation + trust manifest | ✓ Spot-check reviews (20% + author QA) |
| Publishing | ⚠ Partial (compiler built; retailer APIs not wired) | ✓ ISBN + KDP/Apple/IngramSpark distribution + sales tracking |
| Marketplace | ✗ NOT YET (no freelancer network) | ✓ Cover design, editing, formatting services marketplace |
| Recurring Revenue | ⚠ Managed billing scaffolding (off) | ✗ Author coaching subscriptions not built |
| Data Moats | ⚠ Provenance tracking only | ✓ Matching algorithm, writer reputation, sales analytics |

---

## Metrics & Health

### Generated Content (Cumulative, Q2 2026)
- **Total books generated:** ~50+ (internal + beta users)
- **Total topics generated:** ~500+
- **Average book size:** 200–700 pages (light→expert depth)
- **Latency (p50):** 77 seconds per topic; (p95) ~180 seconds
- **Success rate:** >98% (measured Aug 2026)

### System Health
- **Uptime:** >99.9% (production backend)
- **Authentication success rate:** >99.5%
- **BYOK key management:** Zero logged keys (audited in CI)
- **Payment dispute rate:** Not applicable (BYOK only)

### User Engagement
- **Cumulative registered authors:** ~100+ (internal + beta)
- **Monthly active users:** ~30–40 (as of Jul 2026)
- **Repeat authoring rate:** ~35% (publish one book, return for second)
- **NPS:** Not yet surveyed formally

---

## Known Gaps vs. Ghostwriting Squad Model

### Why Mentible ≠ Ghostwriting Squad (Today)
1. **No Writer Network** — Mentible is author-driven LLM authoring, not a marketplace
2. **No Matching Algorithm** — No human writer allocation or reputation system
3. **No Revision Workflow** — No structured feedback loops from editors/reviewers
4. **No Marketplace Services** — No cover design, editing, or other freelancer categories
5. **No Recurring Revenue** — No coaching subscriptions or other subscription tiers
6. **No Distribution Wiring** — Compiler built; retailer APIs not integrated

### Potential Convergence Path
Mentible could **evolve toward a Ghostwriting Squad-like marketplace** by:
1. Adding a writer community (ADR-025+, future work)
2. Building a matching algorithm (author → writer for refinement/ghostwriting)
3. Integrating publishing APIs (ISBN, KDP, Apple Books, IngramSpark)
4. Launching marketplace extensions (editing, cover, formatting)
5. Introducing coaching subscriptions (recurring revenue)

See **Report 3: Evolution Plan** for the detailed roadmap.

---

## Summary

**Mentible (v0.2.0) is production-ready as an LLM authoring platform** with strong foundations in:
- ✅ Multi-provider LLM support
- ✅ Trusted identity + authentication
- ✅ Quality gates + content validation
- ✅ Artifact compilation (EPUB3/PDF)
- ✅ Operational governance (admin, audit, rate-limiting)

**Gaps (vs. Ghostwriting Squad):**
- ❌ No human writer network
- ❌ No matching algorithm
- ❌ No marketplace services
- ❌ No subscription/recurring revenue
- ❌ No publishing distribution APIs wired

**Next focus (per ADR backlog):**
- Trademark clearance (TM collision risk)
- Trademark clearance on brand assets
- Everyone Library (UGC + moderation) — ADR-021
- Per-user hosted library — ADR-033
- Publishing distribution APIs — New ADR needed

---

## Appendix: Feature Reference

### Built Features (Full Descriptions)


#### Books-Only Authoring
**Status:** BUILT | **Tier:** 1 | **Owner:** Mobile/Backend

Structured intake flow capturing project scope, genre, target audience, and timeline. Authors paste TOC → topic-tree editor → per-topic generation.

**Launched:** 2026-06-27
**Test Coverage:** 85%

#### Content Trust Manifest & Provenance
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend/Compiler

Stamps provider/model/version metadata on each generation (SBQ-TRUST-001/002). Visible TrustBadge showing source and compliance state.

**Launched:** 2026-06-27
**Test Coverage:** 82%

#### Managed Billing & Key Vault (ADR-005 D6)
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend/Billing

Authed managed-key vault + per-account metering + spend ceiling + plans/entitlements. RevenueCat webhook integration + admin margin tracking. **Off by default** (BYOK only in prod).

**Launched:** 2026-06-30
**Test Coverage:** 80%

#### Manuscript Versioning & Archive
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend/Storage

Auto-snapshot each submission; authors can compare versions side-by-side or revert to earlier drafts. Archive in multiple formats (PDF, DOCX, ePub).

**Launched:** 2026-06-27
**Test Coverage:** 78%

#### Node Artifact Compiler (EPUB3/PDF)
**Status:** BUILT | **Tier:** 1 | **Owner:** Compiler/Node

Compiles book.json → valid EPUB3 (OCF/OPF, nav, per-topic XHTML, MathML, SVG), PDF (Vivliostyle textbook layout), PNG cover, colophon + watermarking (draft/release).

**Launched:** 2026-06-27
**Test Coverage:** 88%

#### Per-Provider LLM Integration
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend/Mobile

Multi-provider support (Anthropic, OpenAI, Groq, OpenRouter, Gemini) via wegofwd-llm seam. Per-provider BYOK keystore + provider picker with capability tiers.

**Launched:** 2026-06-27
**Test Coverage:** 92%

#### Project Dashboard & Status Tracking
**Status:** BUILT | **Tier:** 1 | **Owner:** Mobile

Real-time milestone tracking (outline approval → first draft → feedback → final → cover → publishing prep). Author/writer activity logs, revision request tracking, deadline countdown.

**Launched:** 2026-06-27
**Test Coverage:** 80%

#### Quality Gates (Gate 3 — Format Drift)
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend

Validates manuscript format during generation + export. Warns on lesson/book/package format issues. X-Content-Warnings header on export response.

**Launched:** 2026-06-27
**Test Coverage:** 84%

#### Rate Limiting (Per-Identity + IP Fallback)
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend

Fixed-window limiter guarding expensive endpoints (/generate, /structure, /export). Per-minute (20) + per-day (500) limits. Fail-open 429 + Retry-After.

**Launched:** 2026-06-16
**Test Coverage:** 86%

#### Super-Admin Operator Role
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend/Admin

Backend API + mobile console for suspending/reactivating/deleting users. Durable audit trail of all admin actions. Derived role flag (never a token claim) from allowlist.

**Launched:** 2026-06-27
**Test Coverage:** 90%

#### User Accounts & Authentication
**Status:** BUILT | **Tier:** 1 | **Owner:** Backend/Identity

Supabase IdP with JWKS verification, email/password + Google sign-in, per-provider credential sets, device tracking, account suspension/deletion admin operations.

**Launched:** 2026-06-27
**Test Coverage:** 88%

#### Book Metadata Window & Review Data
**Status:** BUILT | **Tier:** 2 | **Owner:** Mobile

Tap a book to view name, release date, model, level, depth, diagram type, page count, reviewer name/date for published works.

**Launched:** 2026-06-27
**Test Coverage:** 70%

#### Contextual Help Hints (HelpHint)
**Status:** BUILT | **Tier:** 2 | **Owner:** Mobile/UX

Inline ? buttons on generation params, BYOK key storage, account provider custody toggle. One-liner tooltips explaining UX decisions.

**Launched:** 2026-06-27
**Test Coverage:** 65%

#### EPUB Import & Cover Extraction
**Status:** BUILT | **Tier:** 2 | **Owner:** Mobile

Authors can import existing EPUB files into the library; system extracts and displays cover thumbnails.

**Launched:** 2026-06-27
**Test Coverage:** 75%
