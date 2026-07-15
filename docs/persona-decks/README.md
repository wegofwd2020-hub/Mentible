# Mentible persona decks

Per-persona presentation decks — **Mentible introduces itself** (first-person voice) to each
audience and walks them through the same story in their own language:

> **their problem → start free, on your device → *your knowledge library* → how the RAG engine
> works → a library bigger than your shelf → the free→paid trigger → the payoff.**

Each deck is a native, editable 8-slide PowerPoint (PowerPoint / Keynote). An interactive web
version of each is also published as a private artifact (links below).

| Deck (.pptx) | Persona | Accent |
|---|---|---|
| `mentible-for-physicians.pptx` | Dr. Anaya — internal-medicine physician | clinical teal-blue |
| `mentible-for-medical-students.pptx` | Sam — second-year medical student | learning green |
| `mentible-for-screenwriters.pptx` | Mara — feature screenwriter | creative plum |
| `mentible-for-security-architects.pptx` | Dev — software security architect | steel indigo |

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

**Interactive web artifacts (private)**
- Physician — https://claude.ai/code/artifact/8e074707-fae7-4828-802a-2631e0e84d1e
- Medical student — https://claude.ai/code/artifact/4473f9db-6ba0-4293-9223-5f4ff0d50209
- Screenwriter — https://claude.ai/code/artifact/27be8328-3bd9-4d6d-aae6-027aa828675e
- Security architect — https://claude.ai/code/artifact/2854a656-097a-40b7-98ec-5df26ff37865

*Personas are illustrative. See `docs/adr/ADR-033-per-user-private-hosted-library.md` for the
decision these decks dramatize.*
