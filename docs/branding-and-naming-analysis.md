# Branding & Naming Analysis

> **Status:** **Decision made — ADR-006 Accepted (2026-05-29).** The brand
> **rebrands from "StudyBuddy Q" to "Mentible"** *(pending the mandatory
> trademark/domain sweep — see §3/§5)*. Audience stays **self-learners +
> professionals** (D6 reaffirmed; no school funnel). This doc is now the research
> record behind that decision; the candidate names in §4 are the **fallback
> shortlist** if "Mentible" fails clearance.
> **New brand:** **Mentible** *(provisional until cleared)* — supersedes D5/D19.
> **Audience:** adult self-learners, incl. professionals (D6).

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

**Implication:** these two risks (crowded "StudyBuddy" + Amazon-Q-adjacent "Q")
are why **ADR-006 decided to rebrand to "Mentible"** — a name that escapes both.
The same gating discipline now applies to the *new* name: **the mandatory
pre-alpha trademark sweep** (USPTO TESS, Google Play, App Store) + domain check
must clear **"Mentible"** before it is locked.

> ⚠️ This document flags collision risk; it does **not** clear any name legally.
> "Mentible" is **provisional** until a proper **trademark + domain availability
> search** passes. If it fails, fall back to the §4 shortlist and re-clear.

---

## 4. Chosen name + fallback shortlist

**Chosen (ADR-006): Mentible** — tagline *"Knowledge in. Lessons out."* It is
vendor-neutral (fits the multi-provider direction, ADR-005), not boxed into
"study/school," and escapes both the "StudyBuddy" crowding and the Amazon-Q risk.
**Provisional until the trademark/domain sweep passes** (§5).

**Fallback shortlist** — if "Mentible" fails clearance, re-clear in this order:

| Name | Tagline | Note |
|------|---------|------|
| **Knowmad** | "Build the course you wish existed." | Existing coined term ("knowledge nomad") — prior use; verify. |
| **Curriculo** | "From idea to ready-to-study material." | Unverified; check TESS/domains. |
| **SelfSyllabus** | "You bring the curiosity. We build the curriculum." | On-audience; descriptive, weaker mark. |
| **Upskool** *(Upskule)* | "Teach yourself anything, structured." | Spelling collisions likely. |
| **Studyforge** | "Where topics become study material." | Crowded "forge/smith" edtech space; retains "study". |
| ~~**Tutela**~~ | — | ❌ Excluded — existing trademark (network analytics). |

The "Q = Query" rationale retires with the old brand (ADR-006 D1).

---

## 5. Next steps (post-decision)

- **Clear "Mentible" before locking it** (CLAUDE.md pitfall #6): USPTO TESS,
  Google Play, App Store, and `.com`/`.ai` domains. This is a **gating pre-alpha
  task**. If it fails, take the §4 fallback shortlist in order and re-clear.
- **Ratify into canonical docs** once cleared: update CLAUDE.md + SCOPE.md
  (D5/D19) to "Mentible" and sweep "StudyBuddy Q" references repo-wide.
- **Two-app naming (ADR-004):** decide whether the free reader shares "Mentible,"
  takes a sub-brand, or stands alone.
- **Tagline:** lead with the **input → output** shape — *"Knowledge in. Lessons
  out."*

---

## 6. Decisions recorded (ADR-006)

1. **Brand name:** ✅ **Rebrand "StudyBuddy Q" → "Mentible"** (provisional until
   cleared). Drops the crowded "StudyBuddy" family and the Amazon-Q risk.
2. **Audience scope:** ✅ **Stay self-learner-only** (D6 reaffirmed), widened to
   make explicit that **adult professionals** are in scope. Schools/tutors/OnDemand
   integration **rejected** (would re-import multi-tenancy + FERPA/COPPA).
3. **Two-app naming (ADR-004):** ⏳ open — does the free reader share "Mentible,"
   get a sub-brand, or stand alone?
4. **Clearance:** ⏳ run the trademark + domain sweep for "Mentible" before launch.

---

## Appendix: Sources reviewed

Competitive and name-collision research drew on the public sites and app-store
listings of: Mindgrasp, StudyFetch, NoteGPT, StudyPDF, HyperWrite, iWeaver,
Piktochart, MagicSchool AI, SchoolAI, Coursebox, Teachable, Venngage, eSkilled,
and the several "StudyBuddy"-named products listed in §3.

*(Research conducted May 2026. Market and availability change quickly — re-verify
before launch decisions.)*
