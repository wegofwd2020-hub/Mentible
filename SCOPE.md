# StudyBuddy Q

> **Working brand:** StudyBuddy Q  *(Q = Query — references the scoped-query model that is the engineering IP)*
> **Repo name:** `StudyBuddy_SelfLearner` *(repo stays internal; brand is public)*
>
> **Status:** Scope locked. Next step is promoting this content into `CLAUDE.md`
> and drafting ADR-001 (BYOK security model).
>
> **Last updated:** 2026-04-25

---

## 1. One-line positioning

**A purpose-built Claude client for self-learners — turns one well-scoped query into one good educational artefact.**

Think *"Claude Code, but for learners instead of coders."* Not a chatbot. Not a course
platform. A focused, opinionated client on top of the Anthropic API whose entire
job is: *take a learning intent + scope dimensions → produce a high-quality lesson,
explanation, quiz, or cheatsheet, beautifully rendered.*

---

## 2. Why this product exists

### 2.1 Origin — first demo feedback (2026-04-25)

> *"The concept of product addressing the county or school needs of providing their
> students with ability to build curriculum could be costly to market and cost time
> and resource. The core concept of Anthropic being able to build education material
> is valuable. So there is a suggestion of looking at option to build an interface
> to directly access Anthropic to get some material."*

The reviewer recognised the **content-generation IP** as the valuable core, and
flagged the **institutional GTM** as expensive. This product is a direct response
to that feedback: a thin, opinionated, end-user-facing surface over the same
scoping IP the school product uses, without the school plumbing.

### 2.2 Goal

The app is a **demonstration that proper query scoping → good educational content**.
Quality over scale. The product *is* the proof of the IP.

### 2.3 Relationship to StudyBuddy_OnDemand

| | StudyBuddy_OnDemand | StudyBuddy_SelfLearner |
|---|---|---|
| Audience | Schools, teachers, districts | Self-motivated adult learners |
| GTM | B2B sales | App store distribution |
| Compliance | FERPA + COPPA | Adult-only — neither |
| Auth | Auth0 + local + admin | External IdP (email / Google / Apple) verified by JWKS — ADR-005/014 |
| Backend | Multi-tenant FastAPI + RLS + Stripe | Single-tenant FastAPI + sync + push |
| Token spend | StudyBuddy pays Anthropic | **Hybrid (ADR-005): we pay on managed plans; user pays on BYOK** |
| Value prop | Governance, audit, curriculum lifecycle | Quality scoping, education-grade rendering |

**No funnel between the two.** Self-learner is not a school upsell. The school
product is not a self-learner upsell. They share IP (prompts), not customers.

---

## 3. Mental model — "between Claude.ai and Claude Code"

The guiding framing for every product decision:

| | Claude.ai | **Solo StudyBuddy** | Claude Code |
|---|---|---|---|
| Surface | General chat | Structured study session | Agentic CLI / IDE |
| Input | Free-form prose | Scoped (topic + level + format + depth + framing) | Code + tool calls |
| Output | Markdown chat | Lesson / explanation / quiz / cheatsheet / worked example | Edits, commands, file ops |
| State | Conversation thread | Personal study library | Workspace / session |
| Specialisation | None — general assistant | Learning | Coding |
| Payment | Subscription ($20/mo) | App fee + BYOK | API usage (BYOK) |
| Rendering | Generic markdown | KaTeX + Mermaid + structured lessons | Code blocks + diffs |

**The opinion is the product.**
- ❌ Refuse to be a general chatbot
- ❌ Refuse free-form prompting (guide the user through scope dimensions)
- ❌ Refuse to render generic markdown (render educational artefacts properly)
- ✅ One topic at a time, well-scoped, beautifully rendered

---

## 4. Persona — wedge audience

**Self-learner** — the adult who has decided "I want to understand X better".

| Sub-segment | Why they use this over Claude.ai / ChatGPT |
|---|---|
| Professional upskilling (e.g., engineer learning ML basics) | KaTeX + Mermaid + structured lesson, not prose |
| Hobbyist deep-diver | Save-to-library — build a personal study collection |
| Returning-to-study adult | Scope dimensions guide them to a *learning artefact*, not a chat reply |
| Researcher / curious mind | Multi-language support; consistent quality via the scoping layer |

**Excluded by design:**
- Children / under-18 (no COPPA, no parental controls)
- Casual / "I'll try anything that's free" users (BYOK filters them out by design)
- Course-builders / curriculum authors (that's StudyBuddy_OnDemand)

---

## 5. Decisions locked in

> **Amended since lock — read the ADRs first.** The product has evolved past the
> original single-app, Anthropic-only, BYOK-only framing below:
> - **ADR-003** adds **book authoring** and makes books **local-first** (revising D4).
> - **ADR-004** splits this into **two products** — a **paid authoring app** (this
>   repo) and a **free, offline reader app** (separate repo) — with content
>   delivered as **artifacts (EPUB3 flagship / PDF print)**, and **amends D17** (the
>   authoring app is now paid).
> - **ADR-005 (Accepted)** makes the product **provider-agnostic** and key handling
>   **hybrid**: a **managed-key vault is the default** (we hold keys, carry token cost
>   under a metered plan allowance), **BYOK is the optional power-user path**. This
>   **revises D1** (BYOK is no longer the only model — it is **not** simply
>   "reaffirmed") **and D9** (passthrough is now one of two key paths), and **pulls
>   accounts/auth + metering from v1.1+ to MVP**.
> - **ADR-014 (Proposed)** specifies the account model: identity via an **external IdP
>   verified by JWKS** (no password machinery), the account owning a **per-provider
>   credential set** with keys **device-local by default**, sync opt-in and
>   zero-knowledge. Amends **D10** and the §6.3 auth model.
>
> Where an ADR differs from a row below, the ADR wins.

| # | Decision | Notes |
|---|---|---|
| D1 | **Hybrid keys — managed default + optional BYOK** *(amended — ADR-005)* | Managed-key vault is the default (we hold keys, carry token cost under a metered plan allowance); **BYOK** (paste your own key, pay the vendor directly) is the optional power-user path. The original "BYOK-only, never a token bill" holds only for BYOK users |
| D2 | **Async generation + push to device** | Backend completes work, FCM push delivers result |
| D3 | **Android first** | Native vs cross-platform still open — see §7.1 |
| D4 | **Cloud sync** (not local-only) *(amended — ADR-003/005)* | Library is **local-first** at MVP (ADR-003); cloud **sync** stays v1.1+. But **accounts/auth move to MVP** (ADR-005 — managed billing needs identity), decoupled from sync |
| D5 | **New repo `StudyBuddy_SelfLearner`** | Vendor prompts from existing repo; no shared runtime |
| D6 | **Standalone product** — no link back to school SKU | No shared customer ID, no upsell, no funnel |
| D7 | **Demo / quality-first**, not scale-first | Optimise for output quality per request, not install count |
| D8 | **Stack — React Native / Expo** | Cross-platform path; iOS comes later for free; matches Epic 3 Path B |
| D9 | **Key handling — Pattern B (per-request passthrough)** *(amended — ADR-005)* | Pattern B is now the **BYOK** path (key in `expo-secure-store`, sent per request, never persisted); the **managed** path adds a separate at-rest vault regime. Generalised to a **per-provider credential set** (ADR-014) |
| D10 | **Auth — email + Google (+ Apple on iOS)** *(amended — ADR-005/014)* | Moved to **MVP** (was v1.1+). Via an **external IdP verified by JWKS** — we don't build password/refresh machinery (ADR-014, proposed; IdP vendor still open) |
| D11 | **Hosting — share infra with StudyBuddy_OnDemand** | One ops plan, two products; covered by the upcoming hosting cost doc |
| D12 | **Latency — minutes** | Async generation + FCM push when done |
| D13 | **Output formats v1 — Lesson / Explanation / Quiz** *(amended — ADR-009: now per-topic content within a book; the standalone single-lesson "Query" surface was removed)* | Cheatsheet / Worked example / Tutorial / Experiment / Audio = v2+ |
| D14 | **Visual aids v1 — all of (b)** | KaTeX + Mermaid + blockquotes + tables + AI-picks. Image gen = v2+ |
| D15 | **Inputs — refined 7-field list** (Topic / Level / Language / Prior knowledge / Format / Framing / Depth) | Side panel collapsible from default canvas view |
| D16 | **Layout — single canvas + collapsible side panel** | No wizard |
| D17 | **App fee model — paid authoring app (subscription/purchase) + free reader** *(amended — ADR-004, then ADR-005)* | Fee covers app + upkeep for **BYOK** users (author pays the vendor). For **managed** users the subscription **also includes a metered token allowance** — we carry the vendor cost, so pricing is margin-aware with per-plan caps (ADR-005 D4). The separate **reader app is a free download** |
| D18 | **v1 storage — fair-use soft cap (~100 units / account)** *(reinterpreted — ADR-005)* | Abuse prevention **and** a cost-control lever for managed token spend, not monetization |
| D19 | **Brand — "StudyBuddy Q"** (Q = Query) | Repo stays `StudyBuddy_SelfLearner`; public-facing brand is "StudyBuddy Q" |

---

## 6. Open decisions (the scope discussion)

These are the real choices that drive architecture. **None are decided yet.**

### 6.1 API key handling — most consequential

| Pattern | How | Decision needed |
|---|---|---|
| **A. Stored** | User pastes once, backend stores encrypted (KMS / per-user envelope), used for every request | Best UX. Liability of holding AI provider credentials |
| **B. Per-request passthrough** | App holds key in Android Keystore, sends with each request, backend uses + discards | Smaller blast radius. Key still touches our process during async job |
| **C. Client-side direct** | App calls Anthropic directly. Backend only stores results | Cleanest security. Conflicts with D2 (async + backend completes work) — would need re-thinking |

**Open question: A, B, or C?**
*(Recommend B as default unless UX of A is judged more important than the security/liability surface.)*
Let us go with B

> **Amended — ADR-005.** B (passthrough) remains the **BYOK** path, but key handling
> is now **hybrid**: a **managed-key vault is the default** (closer to A — we hold
> keys at rest, but they are *our* provider keys, not the user's), with BYOK-B as the
> opt-in power-user path. The managed vault is a distinct at-rest regime (secrets
> manager + rotation), separate from ADR-001's transient passthrough. Custody is now
> **per provider** (ADR-014), not a single product-wide choice.


### 6.2 Mobile stack

| Stack | Pros | Cons |
|---|---|---|
| **Kotlin + Jetpack Compose** (native) | Best Android UX feel, best Keystore integration, best rendering library options | iOS later = full rewrite |
| **React Native / Expo** | Cross-platform path, matches existing Epic 3 Path B plan | UX feels ~80–90% as native |
| **Flutter** | Best cross-platform UX after RN, Material 3 native feel | Smaller talent pool, more integration work |
| **Kotlin Multiplatform (KMP)** | Native Android + native iOS, shared business logic | Newer / less mature; iOS UI still needs SwiftUI |

**Open question: Native Kotlin (best demo quality, slow path to iOS) vs cross-platform?**

Let us work with React Native / Expo

### 6.3 Account / auth model

| Option | Notes |
|---|---|
| Email + password | Simple, full control, password-reset machinery |
| Sign in with Google | One-tap; widespread on Android |
| Both | Most flexible; more code |
| Sign in with Apple | Required by App Store *if* iOS comes later AND we offer any auth |

**Open question: which auth methods at v1?**
Let us go with Both

> **Amended — ADR-005/014.** Auth is no longer v1.1+; it moves to **MVP** (ADR-005,
> managed billing needs identity). "Both" becomes **email + Google (+ Apple on iOS)**
> delivered through an **external IdP verified by JWKS** — we don't build the
> password-reset / refresh-token machinery this table assumed (ADR-014, proposed). The
> account owns a **per-provider credential set**, not a single login-plus-key.

### 6.4 Backend hosting

The hosting cost doc you asked for earlier now covers **two** systems
(StudyBuddy_OnDemand + StudyBuddy_SelfLearner). They could share infra or be
deliberately separated for blast-radius reasons.

**Open question: shared hosting account / separate? Cloud provider preference?**
share the same infra

### 6.5 Library + storage limits

In a BYOK model, your only revenue is the app fee. But cloud-sync storage is a
*recurring* cost on you (token cost is not).

| Option | Notes |
|---|---|
| Unlimited library, free with app | Simplest UX. Storage cost grows with users |
| Free tier: N lessons. Paid IAP: unlimited | Two-tier monetisation; storage cost capped |
| Free with per-lesson size cap | Less restrictive; harder to communicate |

**Open question: pricing tier strategy for library storage?**
**Decided:** **Free tier only for v1.** No paid tier, no IAP, no subscription. The Pro model is a v2 consideration — once the demo proves the IP, revisit what's worth gating.

**v1 fair-use cap (abuse prevention, not monetization):**
- ~100 lessons per account (soft limit, raise on request)
- Multi-device sync allowed
- Standard queue (no priority tier exists yet)

**v2+ candidates** (do NOT build in v1):
- Pro tier with unlimited library
- Export to PDF
- Share lessons via link
- Priority generation queue
- Advanced output formats (Cheatsheet / Worked example / Tutorial)
- Subscription vs one-time IAP — to be decided when v2 is scoped

### 6.6 Generation latency target

| Target | Implication |
|---|---|
| **Minutes** (queue + push when done) | Matches D2; user submits and walks away |
| **Seconds with progress streaming** | More engaging; harder if user backgrounds the app on Android |

**Open question: how long should a generation feel like it takes?**
Minutes

### 6.7 Output formats at v1

The 6 scope dimensions × N output formats = many possibilities. Pick a small set
for v1:

| Format | In v1? |
|---|---|
| Lesson (structured: synopsis → key concepts → sections → key points) | ✅ probably yes |
| Explanation (single-section deep dive on one concept) | ✅ probably yes |
| Quiz (5–10 questions with answers) | ✅ probably yes |
| Cheatsheet / reference card | ⚪ tbd |
| Worked example (especially for maths/science) | ⚪ tbd |
| Tutorial (multi-step walk-through with examples) | ⚪ tbd |
| Experiment (with materials + procedure) | ❌ defer — STEM-only, complex render |
| Audio (text-to-speech) | ❌ defer — separate cost model |

**Open question: confirm v1 output formats?**
for V1 -> Lessons; Eplanation; Quiz; 

### 6.8 Visual aids in v1

| Aid | Recommendation |
|---|---|
| KaTeX (maths) | ✅ ship in v1 — already in our prompts + renderer rules |
| Mermaid (flowcharts, diagrams) | ✅ ship in v1 — same |
| Attributed blockquotes | ✅ ship in v1 — Epic 11 prompt rule |
| GFM tables | ✅ ship in v1 — same |
| "AI picks the right visual" prompt step | ✅ cheap quality win |
| Image generation | ❌ defer to v2 (different model, cost, content-safety story) |

**Open question: confirm v1 visual aids?**
**Decided: Option (b) — all of the ✅ items in v1:** KaTeX (maths), Mermaid (flowcharts/diagrams), attributed blockquotes, GFM tables, "AI picks the right visual" prompt step. Image generation deferred to v2. Renderer pipeline already produces all of these together — porting to React Native is one set of library imports (`react-native-katex` or `react-native-math-view` for KaTeX; Mermaid via WebView; markdown-it for blockquotes/tables).

---

## 7. The core flow (your proposed input list, refined)

### 7.1 User-proposed flow

> **Historical (amended — ADR-009).** This describes the removed standalone
> **Query** single-lesson screen. The app is now Books-only; the same scoped-query
> inputs below are applied **per topic** in the book authoring flow (ADR-003).

1. **Query screen** with prompt fields
2. Inputs:
   - i) Topic
   - ii) Description of expected end use
   - iii) Age-appropriate (if applicable)
   - iv) What you're expecting (explanation / lessons / etc.)

### 7.2 Refined input list

Mapping to the 6 IP scope dimensions from the existing CLAUDE.md (the moat):

| Dimension (IP) | Input field | Default | Required? |
|---|---|---|---|
| Topic | "What do you want to learn?" (textarea) | — | ✅ Yes |
| Grade / depth (level) | Dropdown: Elementary / Middle / High School / Undergrad / Professional / Expert | Standard | ✅ Yes |
| Language | Picker: en / fr / es | en | ✅ Yes |
| Curriculum context (prior knowledge) | "What you already know about this" (textarea, optional) | empty | ⚪ Optional |
| Format | Picker: Lesson / Explanation / Quiz / Cheatsheet / Worked example | Lesson | ✅ Yes |
| Real-world framing | "Anything specific you want to connect this to?" (textarea, optional) | empty | ⚪ Optional |
| Depth/length | Picker: Quick / Standard / Deep dive | Standard | ✅ Yes |

**Why the changes from your original list:**
- (ii) "description of expected end use" + (iv) "what you're expecting" overlapped → collapsed into **Format**
- (iii) "age-appropriate" → renamed **Level** with concrete dropdown values (numbers feel awkward for adults)
- Added **Language**, **Prior knowledge**, **Framing** because these are the dimensions our prompts already use as quality drivers — they are the IP. Hiding them in the solo product would give away the moat.

**Open question: confirm refined input list, or push back on any of it?**
confirming refined input list

### 7.3 Layout

**Recommendation:** single canvas with optional structured side panel.

- Default view: topic textarea + Generate button
- Side panel (collapsible): Level / Language / Format / Depth as pickers; Prior knowledge / Framing as optional textareas
- Power users ignore the panel; new users open it for structured guidance
- Avoid 4-step wizard — proven to lose users

**Open question: confirm canvas-with-panel layout, or prefer wizard?**
let us use Default View.

---

## 8. Architecture shape (sketch — to be detailed once §6 is decided)

```
StudyBuddy_SelfLearner/
  mobile/                    ← React Native + Expo (Android-first, iOS later)
    app/
      screens/               ← Query · Library · Settings (BYOK key entry · Sign in)
      components/            ← Markdown + KaTeX + Mermaid renderer
      hooks/                 ← useGenerateJob · useLibrary · useAuth
      api/                   ← Backend HTTP client · FCM handler
      secure/                ← expo-secure-store wrapper for the BYOK API key

  backend/                   ← FastAPI (reuse team pattern)
    main.py
    src/
      auth/                  ← Account creation · sign in · refresh
      generate/              ← POST /generate (async job) · push when done
      library/               ← GET / DELETE saved lessons
      sync/                  ← Cloud sync (multi-device)
      core/                  ← Job queue · FCM client · Anthropic call (per-request key)
    pipeline/                ← Vendored: prompts.py · providers/ · validators
    tests/

  docs/                      ← This file · ADRs · BYOK security model · architecture diagrams
```

**Vendored from StudyBuddy_OnDemand (copy, don't fork):**
- `pipeline/prompts.py` — universal + per-subject formatting blocks (Epic 11 IP)
- `pipeline/providers/` — `AnthropicProvider` interface
- `pipeline/content_format_validator.py` — drift detection
- `<SBMarkdown>` rendering rules — re-implemented in React Native (`react-native-markdown-display` + `react-native-katex` + Mermaid in WebView)

**Explicitly NOT carried over:**
- Auth0, three-track auth, school auth → replaced by single user-account system
- RLS, multi-tenant DB → single-tenant per user
- Curricula, schools, classrooms, subscriptions, Stripe webhooks → not relevant
- Content review queue, AlexJS gating, format-drift blocking → validators run as warnings, not blockers
- COPPA / FERPA logic → adult-only product

---

## 9. Open questions checklist (for next discussion)

- [X] **§6.1** Key-handling pattern: A (stored) / B (passthrough) / C (client-side)?
- [X] **§6.2** Mobile stack: native Kotlin / RN / Flutter / KMP?
- [X] **§6.3** Auth methods at v1: email+password / Google / both / +Apple?
- [X] **§6.4** Hosting: shared with StudyBuddy_OnDemand / separate / cloud provider?
- [X] **§6.5** Library storage tier strategy?
- [X] **§6.6** Generation latency target — minutes or seconds-with-stream?
- [X] **§6.7** v1 output formats — confirm Lesson / Explanation / Quiz, decide on Cheatsheet / Worked example / Tutorial?
- [X] **§6.8** v1 visual aids — confirm KaTeX / Mermaid / blockquotes / tables / "AI picks", defer image gen?
- [X] **§7.2** Refined input list — confirm or push back?
- [X] **§7.3** Layout — canvas-with-panel or wizard?
- [X] **App fee model** — one-time / subscription / freemium?
- [X] **Brand** — "StudyBuddy — Self Learner" official, or rename?
- [X] **Trademark / app store name availability** — to verify before public posts

---

## 10. Glossary

| Term | Definition |
|---|---|
| **BYOK** | Bring Your Own Key — user supplies their own provider API key, app uses it on the user's behalf, user pays the vendor directly; zero token cost to us. *(ADR-005: BYOK is now the optional power-user path; the default is a **managed-key vault** where we hold keys and carry the token cost under a metered plan.)* |
| **Scope dimensions** | The 6 IP dimensions every content generation is parametrised by: topic / grade / language / curriculum context / format / real-world framing |
| **Vendoring** | Copying source code from another repo into yours rather than depending on it as a package — preserves IP without coupling runtimes |
| **FCM** | Firebase Cloud Messaging — Google's push-notification service for Android |
| **Keystore** | Android's hardware-backed secure storage for cryptographic keys and credentials — where the BYOK API key lives on-device |
| **IAP** | In-App Purchase — Apple/Google's billing API. App stores require it for digital goods sold inside the app, taking ~30% |

---

## 11. Status — 2026-04-25

**Scope locked.** Brand: **StudyBuddy Q**. Repo: `StudyBuddy_SelfLearner`.

**One item still outstanding (deferred, not blocking):**

| Item | When |
|---|---|
| Trademark / app store name availability check ("StudyBuddy Q") | ⚠️ Before alpha release. Specific watch-out: **Amazon Q** is a registered AI assistant in the same space — "StudyBuddy Q" is distinguishable via the "StudyBuddy" prefix, but never collapse to bare "Q" in marketing |

**Next concrete steps:**

1. Promote this `SCOPE.md` content into a `CLAUDE.md` for the new repo (drop the discussion framing; treat as durable spec)
2. Draft **ADR-001: BYOK Security Model (Pattern B)** — documents the per-request passthrough contract: how the key flows (HTTPS body), no-log discipline, encrypted-at-rest in Redis with TTL = job duration, key shredding, audit posture
3. Draft **ADR-002: Repo Structure & Vendoring** — what's copied from StudyBuddy_OnDemand, how prompt updates propagate
4. Stub the directory layout — empty `mobile/`, `backend/`, `docs/`, `pipeline/` folders with `README.md` placeholders
5. Pick the first feature slice for MVP — likely **"Lesson generation, English only, no auth, single device"** — to prove the BYOK end-to-end loop before stacking auth + cloud sync on top
