# Mentible ADR-033 decks

Every editable PowerPoint deck that explains ADR-033, in one folder. The **standalone HTML
sources** of the interactive web version of each deck live alongside in `docs/adr-033-web/`.

## General explainers

| Deck (.pptx) | What it is | Web source |
|---|---|---|
| `tiers-free-vs-paid.pptx` | Free-vs-paid, at a glance — for a non-technical audience (mock screens, three concept cards, a "one day, three devices" journey, comparison table) | `docs/adr-033-web/tiers-free-vs-paid.html` |
| `persona-value-loop.pptx` | How four personas get value via the **learn → author → carry** loop | `docs/adr-033-web/persona-value-loop.html` |

## Per-persona decks — Mentible introduces itself

Each deck is Mentible speaking first-person to one audience and walking the same story in their
own language:

> **their problem → start free, on your device → *your knowledge library* → how the RAG engine
> works → a library bigger than your shelf → the free→paid trigger → the payoff.**

Every persona gets its **own visual world** — a distinct layout language, background motif, and
"knowledge library" metaphor — so no deck reads as a recolored template. An interactive web
version of each is published as a private artifact.

| Deck (.pptx) | Persona | Visual world | "Knowledge library" is… |
|---|---|---|---|
| `mentible-for-physicians.pptx` | Dr. Anaya — internal-medicine physician | **clinical chart** — chart headers, EKG-line motif, teal-blue | a **tabbed clinical binder** |
| `mentible-for-medical-students.pptx` | Sam — second-year medical student | **notebook** — ruled paper, spiral binding, highlighter, green | a **fan of flashcards** |
| `mentible-for-screenwriters.pptx` | Mara — feature screenwriter | **screenplay** — film-strip rail, scene slugs, `CUT TO:`, dialogue blocks, warm plum | a **corkboard of index cards** |
| `mentible-for-security-architects.pptx` | Dev — software security architect | **blueprint / terminal** — dark grid, monospace, `$` prompts, steel-indigo/cyan | a **schematic system-map** |

Mentible's hero lines are set in each world's native form: screenplay **dialogue** (writer), a
**chart note** (physician), a **study-buddy note** (student), a `// code comment` (architect).

**Shared spine of every deck**

1. **Title** — "Hi, \<name>. I'm Mentible."
2. **The problem** — your material is scattered; generic AI can't be trusted here
3. **Start free, on your device** — no sign-up, nothing leaves your device (zero-knowledge)
4. **This becomes your knowledge library** — the sources *you* chose, in one place I've read
5. **How I actually work** — I retrieve from your library first, then answer citing your sources (RAG, explained plainly)
6. **Bigger than your shelf** — pull curated external texts in → one knowledge library, broader than what you physically keep
7. **When you're ready** — upgrade to a private *hosted* library that follows you across devices
8. **My promise to you** — the payoff, in the persona's terms

**Consistent language across all four**
- The concept is always **"your knowledge library."**
- **Free** = device-local, zero-knowledge. **Paid** = private hosted, synced across devices (ADR-033).
- Grounding in your own material = ADR-029 (retrieval / RAG); curated external texts = ADR-028 (Open Shelves).

**Interactive web artifacts (private) — each in its own world**
- Physician (clinical chart) — https://claude.ai/code/artifact/57dbed2a-ae9d-4fe0-8d0b-c8f37bdde95f
- Medical student (notebook) — https://claude.ai/code/artifact/1499095d-7d96-4ba7-92a8-2a52bffae8c7
- Screenwriter (screenplay) — https://claude.ai/code/artifact/a7ad5f88-f2ee-4ec6-b3e9-278515581617
- Security architect (blueprint) — https://claude.ai/code/artifact/bd2a7043-8093-46a4-8716-07d5b7de1006

*Personas are illustrative. See `docs/adr/ADR-033-per-user-private-hosted-library.md` for the
decision these decks dramatize.*
