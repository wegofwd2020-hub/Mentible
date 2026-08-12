# Ticket: Whole-book draft is much shorter than per-topic content

**Status:** Open — backlog (raised 2026-08-12 by Siva). Not a bug; a design/expectation gap. Parked
for later; the owner has thoughts to add before deciding.

## Observation

Generating a **Whole Book** draft produces noticeably **shorter** output than generating content
**Per topic**. Is something wrong? — No. It's architectural (details below), but the whole-book path
is deliberately shallow and the difference is large enough to feel like a defect.

## Why it happens (verified in code, 2026-08-12)

Two different generation shapes:

### Whole-book — `backend/src/trust/generate.py` (`generate_draft`)
- **One** LLM call for the *entire* book (`req = LLMRequest(prompt, max_tokens=16384, …)`; no loop).
- Prompt built from the `book` format spec in `backend/src/trust/format_specs.py`:
  ```python
  "book": FormatSpec(
      "write a short draft of 3 to 6 sections",  # section_rule — explicitly SHORT
      "",                                          # rules — EMPTY, no length/depth target
      supports_diagrams=True,
  )
  ```
- Output schema caps sections: `_DraftOutput.sections: list[...] = Field(min_length=1, max_length=6)`.
- **Result:** the whole book = one call → **3–6 short sections total.**

### Per-topic — `backend/src/trust/generate_topic.py` (`generate_topic_draft`)
- **One** LLM call **per topic** (`max_tokens=16384` each), prompt = `topic_prompt.build_topic_prompt`
  → "write **one section per subtopic**", grounded only in that topic's sources.
- Output schema caps sections: `_TopicOutput.sections: … Field(min_length=1, max_length=20)`.
- **Result:** *each topic* → up to **20 sections** of prose, with the full token budget to itself.

### Net
A 5-topic book:
- **Per-topic:** 5 calls × up to 20 deep sections each (full budget per topic) → very long.
- **Whole-book:** 1 call × 3–6 "short" sections for the *whole* book → much shorter.

So per-topic is architecturally far richer. Whole-book is, by its spec, a **quick skeleton / overview
draft**; per-topic is the **deep authoring** path. Working as designed — but `book`'s spec literally
says "short draft" with empty length rules, so it is intentionally shallow.

## Options to consider (when we come back to this)

1. **Beef up the `book` FormatSpec (cheapest real improvement).** Change the section rule to e.g.
   "a thorough draft of 6–12 sections", add a length rule (e.g. "~250–400 words per section"), and
   bump the schema cap `max_length` 6 → ~12. Still one call within the 16384 budget, so total depth
   is bounded, but far more than today. Small backend change + backend refresh. Watch the token
   budget / generation time (stays under the CF ~100s timeout headroom from the #410 fix, but a
   bigger book output moves toward the 16384 cap).
2. **Iterate whole-book per-section / per-topic (multi-call).** Generate section-by-section (or reuse
   the per-topic generator across the TOC) and assemble → matches per-topic depth. Bigger change:
   slower, more tokens, reintroduces the multi-minute → CloudFlare 524 timeout risk (see #410 /
   [[reference_llm_output_shape_gotchas]]) unless made async (job + poll).
3. **Reframe the UX (copy-only).** Label whole-book as a "quick overview draft" and per-topic as the
   "full draft," so the difference is expected rather than surprising. Cheapest; no generation change.

## Owner's notes (to fill in)

_(Siva to add thoughts here before we decide.)_

-

## References

- `backend/src/trust/generate.py`, `backend/src/trust/format_specs.py` (`book` spec),
  `backend/src/trust/generate_topic.py`, `backend/src/trust/topic_prompt.py`
- max_tokens history / timeout: `docs/... #394, #404, #410`,
  [[reference_llm_output_shape_gotchas]]
