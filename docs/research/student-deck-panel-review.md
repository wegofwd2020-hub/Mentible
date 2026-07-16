# Med-student deck — adversarial panel review

Three-lens simulated review of `mentible-for-medical-students.pptx` /
`docs/adr-033-web/persona-student.html`. LLM simulation — a cheap pre-filter, not a
substitute for real students (see `physician-deck-interview-script.md`, reusable per persona).

## Scorecard

| Lens | Score | Verdict |
|---|---|---|
| Skeptical 2nd-year student (target user) | **3 / 10** | Try free as a supplement to Anki/UWorld; never a replacement; only after testing accuracy on a lecture I know cold. |
| Medical educator / course director | **4 / 10** | Tolerate with mandatory citations; **flag "matches your exam" + "Past Papers" to the curriculum committee.** |
| Value / competitor skeptic (Anki + UWorld + AMBOSS user) | **3 / 10** | Try-and-probably-drop; won't earn a subscription over my current stack. |

**Consensus ≈ 3.3 / 10.**

## Objections ranked by consensus

1. **No accuracy proof + no inline source citations — all 3.** The #1 fix everyone named: every
   explanation and quiz item must link to the exact slide/page it came from. "Confidently-wrong
   retrieval is *worse* than a chatbot because my guard is down — you told me to trust it." A
   wrong answer key generated on-device, once, for one student, silently teaches the wrong thing
   and nobody ever finds out.
2. **"Quizzes that match your exam" + "Past Papers" tab = academic-integrity landmine —
   educator (+ student unease).** Teaching-to-the-test framing; the "Past Papers" tab is
   "infrastructure for exam leakage" with no provenance control (released practice bank vs
   harvested-from-last-cohort). Re-scope or remove.
3. **Position vs the existing stack — value-skeptic + student.** Loses to Anki (AnKing decks +
   FSRS scheduling — the "my own material" problem is already solved better by community decks)
   and UWorld/AMBOSS (physician-vetted, board-calibrated items). Real edge = **in-house /
   professor-specific content Qbanks don't cover.** Lead with *that*, not generic "your material."
4. **Crutch / retention risk — student + educator.** Auto-generating cards skips the encoding
   effort that makes active recall work; only ever testing on what's already in your notes
   creates false mastery (never surfaces what you don't know you don't know).
5. **Price silence + switching cost.** Students are broke and already pay for 3 tools; the paywall
   (slide 7) has no number and no reason to open a 4th app.

## Biggest fixes (by adoption impact)

1. **Inline source citations** on every explanation/quiz (verbatim excerpt + slide/page ref) —
   turns "trust the black box" into "verify the black box." Named by all three.
2. **Anki `.apkg` export** (cloze + image-occlusion) so it feeds the existing SRS workflow
   *upstream* instead of competing with Anki.
3. **Drop or hard-re-scope "Past Papers"** to officially-released practice material only, with
   provenance; and disambiguate "matches your exam" (content domain vs question style — not leakage).
4. **A board-style vignette quiz mode** (not surface recall) + at least one accuracy/efficacy number.

## Verbatim highlights
- Student: "One hallucinated drug mechanism during Step 1 prep and I've learned something wrong.
  I need an error rate, not a vibe."
- Educator: "A wrong answer key in a commercial bank gets reported and fixed. One generated
  on-device silently teaches the wrong physiology and nobody ever finds out."
- Value-skeptic: "You're asking me to do the work Anki's community already did for free. Let it
  *export* to Anki and it becomes a fast first-pass generator instead of a fourth destination."
