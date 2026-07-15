# Physician deck — adversarial panel review (v1)

**What this is.** A three-lens adversarial review of the physician persona deck
(`docs/adr-033-decks/mentible-for-physicians.pptx` / `docs/adr-033-web/persona-physician.html`),
run to answer "is it convincing enough?" Each reviewer role-played a distinct skeptical
stakeholder and reacted to the deck's actual slide content. **This is an LLM simulation** —
a cheap pre-filter that predicts objections; it does **not** replace real-physician testing
(see `physician-deck-interview-script.md`). It reviewed **v1**; the fixes below drove **v2**.

## Scorecard

| Lens | Score | Verdict |
|---|---|---|
| Skeptical staff physician (IM, target user) | **3 / 10** | Download out of curiosity; won't put a patient-facing doc out until it's caught lying once. |
| CMIO (health-system buyer) | **3 / 10** | Watch, don't pilot — return with an EHR + security story. |
| HIPAA / compliance officer | **2 / 10** | **Block pending answers.** |

**Consensus ≈ 2.7 / 10.** Not a craft failure — the deck is well-made and emotionally
resonant. It scores low because it was built to *charm one persona* and skipped the
objections that actually **gate** a physician/health-system decision. **Warmth ≠ conviction**
for this audience.

## Objections ranked by consensus (how many lenses raised each)

1. **HIPAA / PHI / BAA — all 3.** A "Case notes" tab solicits PHI; the deck never says HIPAA,
   BAA, or "don't paste patient data." Ceiling on everything else.
2. **No proof — physician + CMIO.** Zero validation/accuracy numbers. "Never guessing / chapter
   and verse" is the exact overconfidence Slide 2 mocks. A physician pitch with no benchmark is
   auto-discounted.
3. **No EHR / workflow fit — CMIO (physician: verification friction).** "Tab away, feed docs in,
   copy-paste out" doesn't survive real clinic use. The CMIO called this *disqualifying* for a pilot.
4. **"Why not UpToDate / DynaMed?" — physician + CMIO.** IM already has vetted answer tools;
   the deck never says why *my scattered PDFs + AI* beats a maintained, physician-vetted reference.
5. **Closed-vs-open contradiction + stale sources — physician + CMIO.** Slide 4/5 sells a closed
   universe ("your chart, not the web"); Slide 6 opens it to "curated catalogs." Public-domain
   medical texts are *old* — copyright-expired ≠ current standard of care.
6. **Consumer tool vs enterprise governance — CMIO.** Individual sync, no admin console, SSO, or
   version-controlled guideline sets → "40 physicians each curating their own 'trusted' tab is
   clinical variance I try to eliminate, not fund."

## The most urgent finding — a claim that may be *false*, not just unconvincing

The HIPAA officer isolated the single most dangerous line:

> **"On the free tier I live entirely on your device. I can't see your library — and neither can anyone else."**

This conflates **storage** with **processing.** The free tier is device-local *retrieval* — but
generation is **BYOK passthrough to the LLM (ADR-001)**: the moment a physician asks Mentible to
draft a handout *using* their Case notes, that content goes into the API request to the model
provider. The library stays local; **the patient data in the prompt does not.** As written, the
claim is misleading, and for a physician reading it as a HIPAA safe-harbor, dangerous. **Fix this
regardless of the persuasion question — it is a correctness/legal issue, not marketing polish.**

## Strongest points per lens (verbatim)

- **Physician:** "It never addresses the real failure mode — not inventing a citation, but *misquoting
  or overgeneralizing the passage it did retrieve*." · "Which is it — grounded in the guideline I
  filed, or a text your catalog pulled in that I never vetted?" · Biggest fix: *one accuracy number +
  one HIPAA sentence* → moves from "poke at the free download" to "pilot it for a week."
- **CMIO:** "This was written for Dr. Anaya, not for me — it's the profile of tool that shows up on my
  risk register 18 months later as unmanaged shadow IT." · Public-domain ingestion is a clinical-safety
  flag because public-domain generally means *old*. · A fair point *for* us: the device-local free tier
  is a genuinely strong privacy story the deck under-sells (could invoke the Cures Act CDS-exemption
  framing).
- **HIPAA officer:** "A product that *solicits* clinical notes and says nothing about PHI handling is not
  privacy-aware, it's privacy-blind." · "'Private, encrypted, never shared' is a marketing sentence, not
  a security posture." · Must state: BAA availability per tier, whether library content is transmitted to
  a model provider on each ask, data residency/retention/subprocessors, a PHI warning *on the Case-notes
  tab itself*, and no-training commitment.

## Fixes ranked by conviction-impact

1. **Make the locality claim truthful** — "your *library* stays on your device; when you ask, the
   relevant text is sent to the AI model to draft the answer — used once, not stored by us."
2. **One HIPAA/BAA line per tier + a PHI warning tied to the Case-notes tab.** Even "no BAA yet — don't
   enter identifiable patient data" beats silence.
3. **One validation number** — "retrieval matched the source passage in X% of N test queries,
   physician-reviewed." Moves the physician from curiosity to pilot.
4. **Resolve the closed-vs-open contradiction**; bound public-domain to *general reference, never
   guideline/protocol*; always show which sources fed an answer.
5. **A differentiation beat (vs UpToDate)** and, for buyers, an **enterprise/EHR track** (admin console,
   SSO, SMART-on-FHIR roadmap, audit log of what was retrieved per encounter).
6. **Soften absolutes** — drop "never guessing / chapter and verse"; keep "shows its citations so you
   verify before you sign off" (human-in-the-loop is a strength, not a weakness).

*Fixes 1–3 are implemented in the physician deck v2. Fixes 4–6 partially addressed; enterprise/EHR
track (5) is a product-roadmap question, not just a slide.*
