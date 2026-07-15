# Physician deck — think-aloud / message-test interview script

**Goal.** Find out whether the deck (and the underlying value) actually convinces a real target
physician — where they lean in, where they doubt, whether they'd try it. Measure *reactions and
intent*, not opinions of the slides. Pair with `physician-deck-panel-review.md` (the cheap LLM
pre-filter); this is the real-user confirmation.

**Recruit (screen for):** practicing physicians in the target specialty (start internal medicine /
primary care); mix of ages and tech-comfort; **exclude** anyone who's built health-AI or works for
a competitor. 5–8 interviews (saturation comes fast). Offer an honorarium.

**Logistics:** 30–40 min, 1:1, video, **recorded with consent**. Screen-share the deck — or the web
artifact, so you can watch scrolling / drop-off. One interviewer + one silent note-taker.

**Interviewer rules (critical):**
- **Don't sell. Don't explain. Don't defend.** You're testing the deck, not pitching. If they misread
  a slide, that's data — let it stand.
- **Don't lead.** "Isn't that useful?" is banned. Ask "What's going through your mind?" then stop talking.
- **Capture verbatim objections and the exact slide** where each occurs.
- Silence is a tool — count to five before rescuing them.

---

## Part 1 — Current state (5 min) — *before showing anything*
1. Walk me through the last time you wrote a patient handout or checked a guideline mid-clinic. What did you actually do?
2. Where do the references / guidelines / notes you trust actually live today?
3. Have you tried ChatGPT or similar for anything clinical? What happened — what did you trust / not trust?
4. When a new "AI for doctors" tool shows up, what makes you tune out immediately?

*(Baseline + skepticism triggers, uncontaminated by the pitch.)*

## Part 2 — Think-aloud walkthrough (12–15 min)
> "I'm going to show you something a product made to pitch itself to physicians. **Narrate everything** —
> what you think it's saying, what you like, what makes you skeptical, questions that pop up. No wrong
> reactions; I didn't make it."

Advance slide by slide **at their pace**. Say almost nothing. Per slide, note: do they *get it*
(comprehension), *believe it* (credibility), *care* (relevance), and **every objection**. Mark the
moment they disengage.

## Part 3 — Targeted probes (8 min) — *only after the walkthrough*
- **Comprehension:** "In one sentence, what does this thing do?" (Can't → failed the grunt test.)
- **Core claim:** "It says it answers *only* from your own sources and cites them. Believable? What
  would you need to see to trust that with a patient?"
- **Differentiation:** "How is this different from just using ChatGPT carefully — or UpToDate?"
- **Privacy / PHI — do NOT raise it first; see if THEY do:** "It mentions 'case notes' and 'private.'
  Any reaction?" → then: "Would you put patient information in this? What would you need to know first?"
  *(Whether HIPAA/BAA comes up **unprompted** is a key signal.)*
- **Locality:** "It says on the free tier nothing leaves your laptop. What do you take that to mean —
  including when the AI actually writes the draft?" *(Tests whether the storage-vs-processing distinction
  lands, and whether the v2 wording reads honestly.)*
- **Upgrade:** "Free on your device, paid to sync across devices. Where's the line where you'd pay?"
- **Trust breakers:** "Anything here that felt overstated or made you trust it less?"

## Part 4 — Intent & value (5 min)
- "Would you download the free version this week? Honestly — yes / no / why?"
- "If a colleague asked 'is it worth it?', what would you say?"
- "What's the one thing missing that would make this a clear yes?"
- **WTP:** "If the synced paid version were $X/month, too high / about right / cheap?" (test 2–3 anchors)
- **NPS-ish:** "0–10, how likely to recommend to a physician colleague — and why that number?"

## Part 5 — Wrap
"What did I not ask that I should have?"

---

## Reading the results — "convincing enough" thresholds

- **Comprehension:** ≥ most restate the value in one sentence, unprompted. If not → the deck is unclear;
  fix before anything else.
- **The killer objection:** if HIPAA/PHI/"can I put patient data in it?" comes up **unprompted in most
  interviews** (it will), the deck *must* address it — a conviction ceiling, not a nitpick.
- **Believability:** count "prove it" / "sounds too good" moments. A cluster = an over-claim to soften.
- **Intent:** a **specific, unforced "yes, I'd try the free one"** from ~half your target physicians is a
  real signal. Polite "seems useful" is not — discount it.
- **Verbatim gold:** the exact objections and the exact words they use for the value → those become the
  next deck's copy.

## Notes
- Run the same script per persona (swap the domain probes) to test the other decks.
- Re-run after each deck revision on a fresh set of physicians; don't re-test the same people (they're
  now contaminated).
