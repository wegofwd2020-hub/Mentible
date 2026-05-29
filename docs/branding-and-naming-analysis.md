# Branding & Naming Analysis

> **Status:** Draft for discussion — **revised 2026-05-29** to align with this
> repo's locked decisions (SCOPE.md §5) and ADR-004. Earlier drafts analysed the
> *broader StudyBuddy family*; this version is scoped to **StudyBuddy Q**.
> **Scope:** Competitive landscape, name-collision findings, trademark risk, and
> candidate names — the last of which are relevant **only if** the locked brand
> is revisited (see **ADR-006**).
> **Locked brand:** **StudyBuddy Q** (D5, D19). **Locked audience:**
> **self-learners only** (D6). A change to either requires ADR-006, not this doc.

---

## 1. Product summary (what StudyBuddy Q actually is)

StudyBuddy Q is a **purpose-built Anthropic client for adult self-learners**.
The user pastes their own Anthropic API key (**BYOK**), describes what they want
to learn across the six scope dimensions, and gets back a rendered lesson,
explanation, or quiz. It is **not** a chatbot, **not** a course platform, and
**not** a children's or school product.

Per **ADR-004**, the product is now **two apps**:

| | **Authoring app** (this repo) | **Reader app** (separate repo) |
|---|---|---|
| Role | generate content → compile an **EPUB3/PDF artifact** | open any EPUB/MOBI/PDF; "light up" *our* books |
| Network | online (Anthropic, BYOK) | offline |
| Money | paid / subscription | free download |

> **Single audience.** Unlike the broader "StudyBuddy" family, Q serves **one**
> audience — the adult self-learner. **Schools and tutors are explicitly out of
> scope** (D6; CLAUDE.md: "No school anything"). The school/curriculum-cascade
> use case belongs to the sibling product **StudyBuddy OnDemand**, not here. Any
> branding that targets schools/tutors would reverse a locked decision.

### Why "Q"

**Q = Query.** It references the **scoped-query model** — the six dimensions
(topic, level, language, prior knowledge, format, real-world framing) that turn a
bare prompt into a real educational artefact. That scoping layer is the product
IP; "the LLM is the commodity." **Q is *not* "quiz."**

---

## 2. Competitive landscape

The market splits into two adjacent clusters. StudyBuddy Q sits on the
**authoring / generation** side, but narrowed to the **solo adult learner** —
which is itself an underserved slice.

### 2a. Student-facing study-material generators (consume → study)

| Product | What it does |
|---------|--------------|
| **Mindgrasp** | Turns uploaded material into notes, flashcards, quizzes, summaries, and a 24/7 AI tutor |
| **StudyFetch** | Notes, quizzes, flashcards, exam simulations, AI-generated educational videos from any material |
| **NoteGPT / StudyPDF / HyperWrite / iWeaver / Piktochart** | Variations of "AI study guide maker" from notes, PDFs, or topics |

### 2b. Authoring / curriculum builders (school- and creator-oriented)

| Product | What it does |
|---------|--------------|
| **MagicSchool AI** | Auto-generates standards-aligned K–12 lesson plans |
| **SchoolAI** | Standards-aligned plans with FERPA/COPPA compliance + teacher dashboards |
| **Coursebox** | Turns documents, slides, and notes into structured modules, lessons, objectives |
| **Teachable** | Curriculum generator that helps experts translate expertise into a course outline |
| **Venngage / eSkilled / Mini Course Generator** | Additional course/syllabus builders |

### 2c. The wedge for Q

Most competitors are either student-consumption tools or **school/creator**
authoring platforms (multi-tenant, standards-aligned, dashboard-driven). Few
target the **adult self-learner who wants to author a structured, rigorous
artefact for their own learning, BYOK, and read it offline.** Q's differentiators
are the **opinionated 6-dimension scoping**, **BYOK** (no token markup), and the
**offline interactive artifact** (ADR-004) — not breadth of audience.

---

## 3. Name-collision finding (action required)

**"StudyBuddy" is extremely crowded.** At least five distinct active products use
the name:

1. A Schoology grades app (VaultIQ Inc.)
2. A social study-partner matching app
3. An AI-powered school platform (`studybuddyeducation.com`)
4. A K-12 LMS ("We Care StudyBuddy")
5. A campus tutoring app (`studybuddymobile.com`)

**Plus the "Q" suffix carries its own risk: Amazon Q.** CLAUDE.md pitfall #6
flags this directly — the brand must be watched for **Amazon Q** trademark
conflict, and should **never collapse to a bare "Q"** in marketing.

**Implication:** the locked brand **"StudyBuddy Q"** faces uphill SEO /
discoverability (crowded "StudyBuddy") *and* a trademark watch-out on the "Q"
(Amazon Q). This does **not** by itself overturn the locked brand (D5/D19) — but
it makes the **mandatory pre-alpha trademark sweep** (USPTO TESS, Google Play,
App Store) a gating task, and it argues for a style rule that always renders the
full **"StudyBuddy Q"**.

> ⚠️ This document flags collision risk; it does **not** clear any name legally.
> A proper **trademark + domain availability search** is required before alpha —
> for "StudyBuddy Q" itself, and for any alternative considered under ADR-006.

---

## 4. Candidate names (only relevant if ADR-006 revisits the locked brand)

> The public brand is **locked to "StudyBuddy Q"** (D5/D19). The names below are
> **not recommendations** — they are raw options retained for the event that
> **ADR-006** decides the "StudyBuddy" crowding / Amazon Q risk warrants a
> rebrand. Audience-leaning notes are kept for completeness but **schools/tutors
> are out of scope** for Q (D6); for Q, only the self-learner column applies.

| Name | Tagline | Note |
|------|---------|------|
| **Knowmad** | "Build the course you wish existed." | Existing coined term ("knowledge nomad") — prior use; verify. |
| **SelfSyllabus** | "You bring the curiosity. We build the curriculum." | On-audience (self-learner); descriptive, weaker mark. |
| **Upskool** *(Upskule)* | "Teach yourself anything, structured." | Self-learner-leaning; spelling collisions likely. |
| **Curriculo** | "From idea to ready-to-study material." | Unverified; check TESS/domains. |
| **Mentible** | "Knowledge in. Lessons out." | Unverified; check TESS/domains. |
| **Tutela** | "Every topic, made teachable." | ⚠️ Existing trademark (network analytics) — high collision risk. |
| **Studyforge** | "Where topics become study material." | Crowded "forge/smith" edtech space. |

On the **"Q = quiz"** idea raised in earlier drafts: that misreads the brand —
**Q = Query** (§1). A quiz-specific wordmark (e.g. "QuizCraft") could at most be a
*feature* sub-brand, never the umbrella; the core value is scoped material
generation, not just questions.

---

## 5. Recommendation

- **Hold the locked brand: "StudyBuddy Q."** Treat §4 as contingency input for
  ADR-006, not a rename proposal.
- **Make the trademark sweep a gating pre-alpha task** (CLAUDE.md pitfall #6):
  clear **"StudyBuddy Q"** on USPTO TESS, Google Play, and the App Store, and run
  an **Amazon Q** conflict assessment.
- **Adopt a usage rule:** always render the full **"StudyBuddy Q"** — never bare
  "Q."
- The **"input → output" tagline shape** is strong and brand-agnostic — e.g.
  *"Knowledge in. Lessons out."* — usable whatever ADR-006 decides.

---

## 6. Open questions / next steps (tracked in ADR-006)

1. **Brand name:** keep "StudyBuddy Q" or revisit given StudyBuddy crowding +
   Amazon Q risk? (ADR-006 Q1)
2. **Audience scope:** stay self-learner-only (D6), or re-expand — which would
   reverse a locked decision and re-import OnDemand's school/compliance concerns?
   (ADR-006 Q2)
3. **Two-app naming (ADR-004):** does the free reader share the brand, get a
   sub-brand, or stand alone?
4. **Clearance:** run trademark + domain (.com / .ai) checks for "StudyBuddy Q"
   (and any ADR-006 alternative) before launch decisions.

---

## Appendix: Sources reviewed

Competitive and name-collision research drew on the public sites and app-store
listings of: Mindgrasp, StudyFetch, NoteGPT, StudyPDF, HyperWrite, iWeaver,
Piktochart, MagicSchool AI, SchoolAI, Coursebox, Teachable, Venngage, eSkilled,
and the several "StudyBuddy"-named products listed in §3.

*(Research conducted May 2026. Market and availability change quickly — re-verify
before launch decisions.)*
