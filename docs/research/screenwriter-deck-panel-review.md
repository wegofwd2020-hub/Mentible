# Screenwriter deck — adversarial panel review

Three-lens simulated review of `mentible-for-screenwriters.pptx` /
`docs/adr-033-web/persona-screenwriter.html`. LLM simulation — a cheap pre-filter, not real users.

## Scorecard

| Lens | Score | Verdict |
|---|---|---|
| Skeptical working screenwriter (target user) | **3 / 10** | Try the free local version once, sync off, on a project I don't care about — never near a real script. |
| Entertainment / IP lawyer | **3 / 10** | **Advise against on unreleased studio material** until confidentiality + provider terms are answered in writing. |
| Showrunner / room mentor | **4 / 10** | Personal-use fact-checker only — not a room tool — and only once "never breaks canon" is stripped from the pitch. |

**Consensus ≈ 3.3 / 10.**

## Objections ranked by consensus

1. **It's a *drafting* pitch disguised as a research tool — all 3.** "I'll write from them / never
   break your canon" + the "draft a scene brief" demo = generating narrative prose, which a working
   writer does **not** want automated ("a scene brief *is* a narrative choice"). The fix everyone
   named independently: **reposition as a canon retrieval & citation engine**, not a scene generator.
2. **"Never breaks your canon" / "story editor who never contradicts" — writer + showrunner.**
   Continuity errors are *subtle and thematic*; RAG catches stated facts and will miss the breaks
   that matter while giving false confidence. "A story editor *pushes back*; 'never contradicts' is
   a yes-man, not an editor." Replace with "surfaces what it found and what it couldn't verify."
3. **Confidentiality of unreleased IP — IP lawyer (the killer).** "Nothing leaves your laptop" is
   **false for the operation Mara cares about**: asking it to draft ships her bille to a third-party
   LLM API. Plus writer-specific must-says the deck omits: **AI-authorship / copyrightability**
   (machine-drafted prose may not be protectable — Copyright Office guidance) and **WGA / studio
   disclosure** — the "I'll write" framing actively obscures both.
4. **Voice homogenization — writer.** "A hundred writers drafting from their bible sample the same
   model → the same tell-tale smoothness under different character names."
5. **Solo tool vs a room — showrunner.** Built for one laptop; a room *argues* canon, it doesn't
   look it up. "Bible in files" is true for one kind of writer; most keep it in the room's memory.

## Biggest fixes
1. **Reframe: canon cross-reference & citation engine** ("what have I established about the airfield,"
   with card/page citations) — kill scene-brief drafting and the "story editor" language.
2. **Split storage from generation, truthfully** (see the honesty fix); publish a real local-only
   architecture doc, not a slide; name the model provider + its API/no-train terms.
3. **Add authorship/WGA caveat:** "drafts are a starting point; material you don't substantially
   rewrite may not be independently copyrightable and may need disclosure under your agreements."
4. **Confidence + provenance on every output** ("checked these 3 docs, found nothing contradicting
   this, but I have nothing after March"). Sell the humility.

## Verbatim highlights
- Screenwriter: "I download it for the corkboard, and six months later I'm pasting its 'scene brief'
  into Final Draft with light edits — I've quietly become a reviser of machine output."
- IP lawyer: "'Your unreleased work never leaves it' is the line most likely to get a client to paste
  a bible into the box right before the tool ships that content to an external LLM's API. That's the
  whole ballgame for a confidentiality-sensitive client."
- Showrunner: "A tool that says 'no continuity breaks' and is wrong 10% of the time is *worse* than a
  coordinator who says 'let me check' — it removes the instinct to double-check."
