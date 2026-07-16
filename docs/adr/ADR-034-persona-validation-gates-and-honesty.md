# ADR-034 — Persona-validation gates and honesty principles for the grounded-AI vision

**Status:** Proposed — 2026-07-15 (D2 and D3 are already applied in the deck/artifact set; the ADR
records and ratifies them, and records the per-persona gates D4 as requirements with sequencing open)
**Decision-maker:** Sivakumar Mambakkam
**Relates to:** ADR-001 (BYOK passthrough — the key + retrieved content go to the LLM provider per
request; the root of the storage-vs-processing distinction in D3), ADR-029 (library-grounded
retrieval — *Proposed / design-only, zero code*: the "grounded AI" the decks dramatize), ADR-033
(per-user private hosted library — *Accepted but gated on the managed-billing launch*: the "hosted
sync" the decks dramatize), ADR-028 (device-local Open Shelves — the shipped, free-tier baseline),
ADR-005/016/013 (managed billing + metering — the launch gate hosted features inherit), ADR-014
(device-local / zero-knowledge default — true only for the *free* tier).
**Companion:** `docs/research/` — the adversarial persona-panel reviews (physician, med student,
screenwriter, security architect) and the reusable think-aloud interview script.

---

## Context

We built a set of per-persona marketing decks that dramatize Mentible's differentiator — *grounded
AI over your own knowledge library, private and cross-device* (ADR-029 + ADR-033). To answer "is
this convincing?", each deck was run through a three-lens **adversarial panel** (the target user, a
buyer/gatekeeper, and a compliance/domain expert), with a real-physician **interview script** drafted
for the confirmation step.

The panels scored **2.0–3.3 / 10** and, more usefully, surfaced problems bigger than any wording
tweak. Two are cross-cutting and demand a recorded decision:

1. **A misleading claim, replicated in every deck.** "Nothing leaves your device" was flagged as the
   single most dangerous line by *every* confidentiality lens (physician HIPAA officer, screenwriter
   IP lawyer, security-architect CISO, and the security architect). It conflates **storage** with
   **processing**: the library is stored device-local, but the *generation* call sends the retrieved
   content to the LLM provider (ADR-001 passthrough). For a physician it reads as a HIPAA safe-harbor;
   for a writer, as unreleased-IP protection; for an architect, as "safe to paste a confidential
   threat model." It is none of those as written.

2. **The decks pitch specced-not-shipped features in the present tense.** A reviewer read the repo
   and observed that ADR-029 (grounded RAG) is **Proposed with zero code** and ADR-033 (hosted tier)
   is **gated on the managed-billing launch**. The decks say "I read your chart," "I keep your canon"
   — present tense — for an experience that does not yet exist.

Beyond the two cross-cutting issues, each panel named audience-specific **conviction gates** — the
concrete things that must exist before that audience finds the product credible. These are product
and go-to-market requirements, not slide edits.

This ADR records the decisions that follow.

## Decision

### D1 — Adversarial persona panels + real-user interviews are the validation gate for GTM messaging

Before a persona-facing deck or campaign ships, it passes (a) the **adversarial 3-lens panel**
(target user · buyer/gatekeeper · compliance/domain expert) as a cheap pre-filter, then (b) a
**real-user think-aloud** with ≥5 target users. The reusable kit lives in `docs/research/`
(per-persona panel reviews + the interview script). The panel is a *pre-filter*, not a substitute
for real users — a simulated score is directional only.

### D2 — Grounded-AI + hosted features are marketed as **vision, not present**, until they ship

While ADR-029 is Proposed/unbuilt and ADR-033 is billing-gated, all persona decks and artifacts
carry a **"◆ PRODUCT VISION"** banner stating that the grounded AI and private hosted sync shown are
on the roadmap, not yet shipped. **No present-tense claim of a Proposed/unbuilt capability** in
outbound material. What is *shipped and free* — the device-local library + lexical search (ADR-028) —
may be described in the present tense. *(Already applied across the four decks + artifacts.)*

### D3 — Claims-honesty principles (non-negotiable, independent of GTM sequencing)

1. **Storage ≠ processing.** Device-local *storage* must never be worded as device-local
   *processing*. Because generation is BYOK/managed passthrough to an LLM (ADR-001), the retrieved
   content leaves the device for that request. The phrase "nothing leaves your device/laptop/machine"
   is **banned** as written; state instead "your library stays on your device; when you ask, the
   relevant passage is sent to the AI to draft."
2. **Name the destination.** Disclose the model provider and its no-train / retention posture (DPA
   where applicable) wherever generation is described to a confidentiality-sensitive audience.
3. **Hosted is not zero-knowledge.** Wherever the hosted tier is marketed, disclose that it is
   access-controlled and encrypted but **not** zero-knowledge (ADR-033 D4) — only the free
   device-local tier is zero-knowledge (ADR-014 default).
4. **No absolute accuracy claims.** Drop "never a chatbot's guess / never breaks your canon /
   chapter and verse." RAG grounds the prompt, not the output; claim "shows its citations so you
   verify," and back accuracy assertions with a real evaluation number.

> **Applied by ADR-036 D5 (2026-07-16) — the first feature to make a shipped claim false.**
> Media slice 1 ships "Figures stay on your device. Nothing is sent to the AI." That is the same
> class of claim D3.1 bans, and it is **true today** (attach has no egress). Vision-assisted captions
> (ADR-036) are the event that falsifies it, so ADR-036 D5 replaces it with a conditional statement
> that names the destination per D3.2. Recorded here because D3 is a principle with no enforcement
> mechanism: nothing tests prose, so each feature that falsifies a claim must own the rewrite.

### D4 — Per-persona conviction gates (recorded as requirements; sequencing is open)

Each vertical is **gated on** the following before it is marketed *as present* or taken to market to
that audience. These are prerequisites, not scheduled commitments (sequencing → open questions):

- **Physician / health-system:** a signed **BAA** + explicit PHI handling; **EHR/workflow** fit
  (e.g. SMART-on-FHIR); a **retrieval-accuracy** number, physician-reviewed. Regulated-audience gate.
- **Medical student:** **inline source citations** on every explanation/quiz; **Anki `.apkg`
  export** (sit upstream of the existing stack, don't fight it); re-scope/limit the "Past Papers"
  surface to released material (academic-integrity control); an accuracy/efficacy signal.
- **Screenwriter:** **reposition from "scene generation" to canon retrieval + citation**; an
  **IP/authorship + WGA-disclosure** posture (machine-drafted prose may not be copyrightable);
  contractual confidentiality for unreleased work.
- **Security architect:** a **named model provider under a no-train DPA**; **hosted-not-ZK**
  disclosure; **auto-index connectors** into where docs already live (GitHub/Confluence) respecting
  existing ACLs; **superseded-doc awareness**; and honoring D2 (don't pitch the unshipped tier as
  present).

### D5 — Scope: gates block *messaging/GTM*, not exploration

D4's gates block marketing a vertical *as present* and formal go-to-market to that audience. They do
**not** block: the clearly-labeled **vision** decks (D2), internal exploration, or shipping the free
device-local baseline. This ADR sets the bar for *claims and GTM*, not for what may be built or shown
as vision.

## Consequences

**Positive:** outbound claims are truthful and legally safer (the locality/compliance landmines the
panels found are closed by principle, not per-deck patching); "convincing" is redefined as a set of
concrete, testable gates rather than a vibe; the validation kit makes the loop repeatable per persona.

**Cost / negative:** several gates (BAA, EHR integration, connectors, named-provider DPA) are real
product/legal work, not copy — the honest vision deck is now *truthful* but not yet *convincing to a
buyer* until those exist. Vision-labeling slightly reduces the "it's here now" punch of the decks (an
acceptable trade for not misleading a regulated audience).

**Relationship to prior ADRs:** this ADR does not change ADR-029/033's technical decisions; it
governs how they are *claimed* and *sequenced to market*. When ADR-029 ships and ADR-033's billing
gate opens, D2's vision banner is lifted per-capability, and the relevant D4 gates convert from
"prerequisite" to "met."

## Open questions

1. **Sequencing / first vertical.** Which persona is the beachhead, and in what order are its D4
   gates built? (Not decided here.)
2. **BAA & DMCA/legal.** Health-system BAA and the ADR-033 D5 copyright posture need counsel before
   the physician/regulated verticals go to market.
3. **Accuracy evaluation.** The single retrieval-accuracy number every panel demanded needs a real
   eval harness over representative queries per domain.
4. **Connector strategy.** Auto-index connectors (architect gate) vs the current "hand it your docs"
   model — a product-architecture decision touching ADR-028/029.

## Follow-up tickets
- **SBQ-VAL-001** — run the D1 real-user interviews for the beachhead persona (kit ready in `docs/research/`).
- **SBQ-VAL-002** — retrieval-accuracy eval harness (D3.4 / open Q3).
- *(carried)* per-persona D4 gates as their verticals are prioritized.
