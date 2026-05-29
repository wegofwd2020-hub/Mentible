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

**Chosen (ADR-006): Mentible** — vendor-neutral (fits the multi-provider
direction, ADR-005), not boxed into "study/school," and escapes both the
"StudyBuddy" crowding and the Amazon-Q risk. **Provisional until clearance** —
the preliminary sweep (§4a) leaves it as lead but with a "Mentable" conflict that
needs **attorney review**. *(The tagline is a separate decision — see §4b.)*

The "Q = Query" rationale retires with the old brand (ADR-006 D1).

---

## 4a. Trademark sweep — preliminary findings (2026-05-29)

A **preliminary** availability sweep (web, app stores, domains) was run on the
lead name and the fallback shortlist. **This is not legal clearance:** the
authoritative USPTO/EUIPO register searches could not be completed (those systems
block automated access), so a trademark attorney's knockout opinion is still
required before any name is locked.

| Name | Verdict | Distinctiveness | Availability | Key risk found |
|---|---|---|---|---|
| **Mentible** | 🟡 Amber — **lead** | High (coined word) | `.com` registered/dormant (expired cert); `.ai` no active site | **"Mentable"** — a mental-health **app** (Cluj-Napoca; class-9 software) **and** US provider **Mentable Wellness PLLC** (Charlotte, NC). One letter off, phonetically identical. Different primary industry helps; **needs attorney review**. |
| **SelfSyllabus** | 🟡 Amber — **fallback** | Low–medium (descriptive) | **Best — exact name unused; domain likely open** | Crowded "Syllabus" namespace (Simple Syllabus, Syllabus AI…); no direct hit, but a **weak/descriptive mark**. |
| ~~**Curriculo**~~ | 🔴 Red — **eliminated** | Low (real word) | `.ai`/`.me` taken | Means **"résumé/CV"** in ES/PT (we support `es`); active CV-AI products (Curriculo AI, Curriculo ATS, a Google Play résumé builder). |
| ~~**Knowmad**~~ | 🔴 Red — **eliminated** | Low (descriptive coinage) | `.com`/`.app`/`.online` taken | Saturated across software/edu/AI (Knowmad Mood, Knowmad Digital Marketing, a Knowmad learning app, Knowmad Inc); "knowledge nomad" = our user. |
| ~~**Tutela**~~ | 🔴 Excluded | — | — | Existing trademark (network analytics). |

**Trade-off:** the finalist set is **Mentible** (distinctive but contested) vs
**SelfSyllabus** (available but descriptive). Upskool / Studyforge were not swept
(weaker candidates; Studyforge retains the "study" baggage we are leaving behind).

---

## 4b. Tagline & positioning

> **The tagline is a *separate* decision from the wordmark (§4).** A name must be
> distinctive and ownable; a tagline can be evocative and even descriptive. The
> name remains Mentible-vs-SelfSyllabus (pending attorney review); the tagline
> below pairs with **whichever** name wins.

**Lead tagline candidate: "Author Yourself."**

Chosen for a deliberate double meaning that fits the adult self-learner:

- *Author [the material] **yourself*** — the DIY authoring engine: you generate
  your own structured learning artifact.
- ***Author yourself*** — take authorship of your own learning and growth.
  ("Self-authorship" is an established developmental-psychology concept — Kegan,
  Baxter Magolda — so the phrase carries real intellectual weight.)

It speaks to the user's **identity and agency**, not just the mechanism — a
stronger emotional hook than the prior line.

**Positioning narrative it supports** — the medium progression:

1. **Books** — static text.
2. **Video courses** (Udemy / Coursera) — media with embedded text.
3. **Books *and* media, coexisting and interactive** — the **interactive EPUB3
   artifact + offline reader** (ADR-004). Text, math, diagrams, quizzes, and
   (with later media generation) audio/video in one portable, offline artifact.

> **Honesty check for marketing:** interactive EPUB3 is **not** a brand-new medium
> (Pressbooks, Kotobee, the former iBooks Author live there). The genuine novelty
> is the **combination** — *AI-authored* structured content + an *integrated
> offline interactive reader*. Lead with that, not "we invented a medium."

**Note on "Author Yourself" as a *name*:** it is a strong tagline but a **weak
wordmark** — a descriptive/laudatory verb-phrase is hard to trademark and defend,
awkward as a domain, and "self-authorship" already has prior use. Keep it as the
**tagline/manifesto**, not the brand name.

**Alternate taglines retained:** *"Knowledge in. Lessons out."* (input→output
shape); audience-specific lines in earlier drafts.

---

## 5. Next steps (post-sweep)

- **Attorney knockout search on the finalist** — resolve **Mentible vs Mentable**
  (likelihood of confusion across classes 9 / 41 / 42) via USPTO TESS + EUIPO (the
  Mentable app is EU-based) + a trademark attorney's opinion. This is the **gating
  pre-alpha task**. **SelfSyllabus** is the standing fallback if Mentible fails.
- **Confirm domains** at a registrar: `mentible.com` looks registered/dormant;
  check `.ai` and the SelfSyllabus domains.
- **Ratify into canonical docs** once cleared: update CLAUDE.md + SCOPE.md
  (D5/D19) to the final name and sweep "StudyBuddy Q" references repo-wide.
- **Two-app naming (ADR-004):** decide whether the free reader shares the brand,
  takes a sub-brand, or stands alone.
- **Tagline:** lead with **"Author Yourself"** (see §4b) — keep *"Knowledge in.
  Lessons out."* as the alternate. Pairs with whichever name clears.

---

## 6. Decisions recorded (ADR-006)

1. **Brand name:** ✅ **Rebrand "StudyBuddy Q" → "Mentible"** (provisional until
   cleared). Drops the crowded "StudyBuddy" family and the Amazon-Q risk.
2. **Audience scope:** ✅ **Stay self-learner-only** (D6 reaffirmed), widened to
   make explicit that **adult professionals** are in scope. Schools/tutors/OnDemand
   integration **rejected** (would re-import multi-tenancy + FERPA/COPPA).
3. **Two-app naming (ADR-004):** ⏳ open — does the free reader share "Mentible,"
   get a sub-brand, or stand alone?
4. **Clearance:** 🟡 preliminary sweep done (§4a) — Mentible leads with a Mentable
   conflict; Knowmad/Curriculo eliminated; SelfSyllabus the fallback. **Attorney
   knockout opinion still required** before launch.
5. **Tagline:** ✅ lead candidate **"Author Yourself"** (§4b) — a decision separate
   from the wordmark; pairs with whichever name clears.

---

## Appendix: Sources reviewed

Competitive and name-collision research drew on the public sites and app-store
listings of: Mindgrasp, StudyFetch, NoteGPT, StudyPDF, HyperWrite, iWeaver,
Piktochart, MagicSchool AI, SchoolAI, Coursebox, Teachable, Venngage, eSkilled,
and the several "StudyBuddy"-named products listed in §3.

The §4a trademark sweep additionally reviewed: Mentable app (Cluj-Napoca) and
Mentable Wellness PLLC (Charlotte, NC); Knowmad Mood, Knowmad Digital Marketing,
the Knowmad learning app (Google Play) and Knowmad Inc; Curriculo AI, Curriculo
ATS and the Curriculo Google Play résumé builder; and the Simple Syllabus /
Syllabus AI cluster. Authoritative USPTO/EUIPO register searches were **not**
completed (automated access blocked) and remain a required attorney task.

*(Research conducted May 2026. Market and availability change quickly — re-verify
before launch decisions. The sweep is preliminary and is not legal clearance.)*
