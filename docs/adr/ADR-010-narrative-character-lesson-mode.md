# ADR-010 — Optional narrative + animated-character lesson mode

**Status:** Proposed — 2026-06-05 (awaiting decision)
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-006 (audience scope — adult self-learners), ADR-007
(book templates + theme / generation directives live in template params),
ADR-005 (multi-provider — quality varies by model), `docs/ARTIFACT_PIPELINE.md`
(interactive-vs-static matrix), and the **animated-visuals prototype**
(`docs/animated-visuals-prototype.md`, PR #79).
**Implemented by:** _none yet — proposal._

---

## Context

PR #79 added a free **animated-visual path**: the LLM emits a self-contained
animated **SVG** (SMIL / CSS, no JS) in a ```svg block and the reader drops it
inline so it animates. The prototype showed this renders well not only for
*diagrams in motion* (orbit, wave, cycle, an algorithm pass) but also for simple
**flat-cartoon characters** — people and animals that wave, blink, sway, bounce.
The generation prompt now even carries a gated character exemplar.

That raises a **product** question the rendering capability alone doesn't answer:
should a lesson be able to be a **narrative** — a short story with a recurring
friendly character/mascot — rather than only an expository explanation?

The tension:

- **For:** narrative framing, analogy, and a light recurring character can aid
  adult learning — memory hooks, engagement, "the curious cat who wondered why
  the moon followed her home" as a vehicle for a real concept. It's free (same
  text→SVG pipeline) and differentiates Mentible.
- **Against:** Mentible is positioned for **adult self-learners** and is
  explicitly **"not a children's product"** (CLAUDE.md, ADR-006). Cartoon
  characters and storytelling risk reading as childish and cheapening the
  exec/professional voice the flagship books use.

Crucially, the character capability is now *nudged in the default prompt* (behind
a gate), but there is **no explicit, author-controlled mode** — so narrative/
character output is neither reliably available nor reliably suppressed. That's the
gap this ADR closes.

## Decision (proposed)

Introduce **narrative mode as an explicit, opt-in generation parameter** — never
the default. Concretely:

1. **A new template dimension** alongside Level / Depth / Diagram-register, e.g.
   `tone: "expository" | "narrative"` (default **expository**), pinned per book
   (and overridable per lesson) exactly like `diagramRegister`.
2. **Expository (default) is unchanged** — no story framing, no characters; the
   current behaviour and the exec-professional voice are untouched.
3. **Narrative mode** unlocks, in the prompt:
   - story/analogy framing of the lesson's real content (the concept still leads;
     the story is the vehicle, not decoration), and
   - **at most one simple animated character** per lesson (flat-cartoon SVG via
     the existing free path) — never realistic, never a real person.
4. **The gated character exemplar in the prompt fires only in narrative mode.**
   In expository mode the model is told NOT to use characters.
5. **Stays within the adult-learner frame:** narrative ≠ childish. Guidance steers
   toward case-study / analogy / "explain it as a short story for a smart adult,"
   not nursery-rhyme tone.

## Options considered

1. **Status quo (after PR #79)** — gated character example in the default prompt,
   no explicit mode. _Rejected:_ characters appear unpredictably and rarely, with
   no author control and no clean off-switch for technical books.
2. **Always-on narrative** — storytelling in every lesson. _Rejected:_ directly
   contradicts the adult/expository positioning and is wrong for technical or
   reference content.
3. **Opt-in narrative mode (this decision)** — an author-chosen template dimension,
   default off. _Chosen:_ gives control, preserves the default product, reuses the
   free pipeline and the existing per-book template plumbing.
4. **A separate story-based-learning SKU / kids product.** _Rejected:_ out of
   scope — D6 (self-learner-only) and ADR-006 keep this a single adult product.

## Consequences

- **Plumbing** mirrors `diagramRegister` end-to-end: a `tone` field on the mobile
  `GenerationParams` + editor control + `buildGenerateRequest`, the backend
  `GenerateRequest`, and a prompt branch in `prompt_builder`. Per-book pinned and
  provenance-stamped like everything else.
- **Quality varies by model** (ADR-005) — narrative + character SVG is harder than
  diagrams; weaker free models will do it less well. Measure before promoting any
  provider to "authoring-grade" for narrative.
- **Artifact fallback:** animated SVG is interactive-only. In the **static
  EPUB/PDF** artifact it renders as a *still frame* (per `ARTIFACT_PIPELINE.md`'s
  interactive-vs-static matrix) — a narrative lesson must still read well frozen
  (caption the figure; don't depend on motion for meaning).
- **Brand risk** is contained: opt-in + adult-framed + never default means the
  flagship exec-professional books are unaffected unless an author deliberately
  chooses narrative.

## Open questions

- **Boolean or spectrum?** `tone: expository | narrative`, or a richer "voice"
  dimension later? Start with the boolean.
- **Characters at all, or narrative prose only first?** A safer first step ships
  **narrative framing without character art** (prose + the existing diagram
  visuals), with animated characters behind a further sub-flag once quality is
  measured. (Recommended phasing.)
- **Recurring character across a book** (consistency, a book mascot) vs per-lesson
  one-offs — the former needs the character description pinned in the book template.
- **Static-artifact still-frame** treatment for animated figures — pick the frame
  + caption convention.

## Recommendation

Accept the **opt-in `tone` dimension**, and **phase it**: ship narrative *prose*
framing first (low risk, no new render concerns), then enable the single animated
character behind measured conformance — keeping expository the default throughout.
