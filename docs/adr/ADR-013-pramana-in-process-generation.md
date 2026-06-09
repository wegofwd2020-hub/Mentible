# ADR-013 — Pramana in-process generation (amends ADR-011)

**Status:** Accepted — 2026-06-09
**Decision-maker:** Sivakumar Mambakkam / WeGoFwd
**Amends:** **ADR-011** §3.1 and §8 — *"Pramana never generates content"* is
**narrowed**, not deleted. Pramana may generate a defined class of **text-first
compliance artifacts in-process**; Mentible remains the sole producer of the
**packaged learner consumable**.
**Resolves:** **ADR-012 D7** (the open "what does Pramana generate?" question).
**Relates:** **ADR-012** (the `wegofwd-llm` package — the shared mechanism that
makes this possible), Pramana `docs/03_ai_drafted_human_approved_content.md` (the
approval gate that makes it safe).

---

## 1. Context — the contradiction to resolve

ADR-012 made Pramana a **runtime consumer** of the shared `wegofwd-llm` seam
(D7) — i.e. Pramana will call an LLM itself. But **ADR-011 is explicit that it
must not**:

> **ADR-011 §3.1:** "Mentible generates + packages; Pramana defines + delivers.
> Mentible never assigns or tracks; **Pramana never generates content.**"
> **ADR-011 §8:** Content generation → *Mentible owns; Pramana —.*

The North Star and Pramana's own `docs/03 §5` say the same: generation happens in
Mentible and arrives as a pushed **Consumable Package**.

So "Pramana generates" must be scoped deliberately, or it silently **duplicates**
Mentible's engine and erodes the clean split. This ADR draws that boundary so the
two paths are **complementary, not redundant**, and confirms the compliance
invariant survives either way.

## 2. The dividing line — the **artifact**, not the act of calling an LLM

The split is **not** "who is allowed to call a model" (after ADR-012, both can).
It is **what is produced and how it is delivered**:

| | **Mentible** (ADR-011, unchanged) | **Pramana in-process** (this ADR) |
|---|---|---|
| Produces | a **packaged learner consumable** — deck/lessons + quiz + animated visuals **compiled into EPUB3/PDF**, signed | **text-first compliance artifacts** native to Pramana's domain — no packaging/compilation |
| Delivery | pushed as a **Consumable Package** into `consumer_library` | written **directly** into a `ContentDraft` in-process |
| Why there | rich multimodal manufacturing + artifact pipeline | single-call text generation tightly coupled to the definitions library + SME workflow |

**Boundary test (use this when unsure):**
> *Does the output need to be compiled/packaged and delivered to a **learner** as
> a multimodal consumable?* → **Mentible.**
> *Is it a **text-first artifact native to the compliance domain**, gated by
> approval, needing no packaging?* → **Pramana may generate it in-process.**

## 3. Decision

### D1 — Mentible remains the sole producer of the packaged consumable
Everything in ADR-011 §4 (the Consumable Package), §5 (the flow), and §6
(push-to-`consumer_library`) is **unchanged**. Pramana does **not** build a
packaging pipeline, EPUB/PDF compiler, or signing flow. If an artifact needs that,
it is a **Package Request** to Mentible (ADR-011 §4) — full stop.

### D2 — Pramana MAY generate a defined, enumerated class of text artifacts
In-process, via `wegofwd-llm`, Pramana may generate **only**:

1. **Clause plain-language summaries** — explanations of a framework clause for the
   **definitions library itself** (source-of-truth–native; never a learner course).
2. **Assessment / quiz items** drafted against a specific clause (single-call,
   on-demand, often an SME refining one question).
3. **Policy / control / attestation text** — control descriptions, attestation
   language, remediation guidance tied to a clause.

This list is the **ceiling**. Anything resembling a multi-module training course,
a deck, narrated video, or anything destined for `artifacts[]` (EPUB3/PDF/MP4) is
**out** — that is Mentible's Package Request path (D1).

### D3 — Same mechanism, same provenance
Pramana's generation uses the **same `wegofwd-llm` seam** (managed keys — D3 of
ADR-012: the caller passes the key), the **same `provenance()` stamp**, and the
schema-agnostic conformance loop with **Pramana's own** content schemas. There is
**one** generation mechanism in the family, not two.

### D4 — The approval gate is invariant (the compliance non-negotiable)
**Every** piece of generated content — whether pushed by Mentible *or* generated
in-process by Pramana — enters the **same** `ContentDraft → IN_REVIEW → APPROVED →
PUBLISHED` machine (Pramana `docs/03 §3`; ADR-011 §7). Specifically:

- No generated content is **assignable** until a qualified human approves it.
- **Separation of duties holds even for in-house generation:** the approver must
  be a different human from the SME who *triggered* Pramana's generation. The
  generator being "Pramana's own service" does **not** relax SoD — a service is
  never an approver.
- Provenance + `content_hash` are stored on the draft for audit and drift
  detection regardless of origin.

In other words: ADR-013 changes **who may draft**, never **how content is
approved**. The SOX-critical gate is untouched.

### D5 — No-duplication rule
Pramana must not reimplement Mentible capabilities to avoid a Package Request.
Multimodal packaging, the artifact compiler, signing, and the consumable schema
stay **only** in Mentible. If a need straddles the line, it resolves to Mentible
(the heavier, audited path) by default.

## 4. Why this boundary (rationale)

- **Coupling/latency.** Generating one quiz item or a clause summary is a single
  LLM call. Routing it through Mentible's request → manufacture → sign → push →
  ingest → approve handoff is absurd overhead for a text artifact an SME wants
  inline.
- **Source-of-truth locality.** Clause summaries belong to Pramana's **definitions
  library** (its source of truth), not to a learner-facing consumable. Asking an
  external engine to author your own source of truth inverts ownership.
- **SME ergonomics.** In-app "draft / regenerate this question" is a Pramana
  workflow; it should not require commissioning a cross-product package.
- **It costs nothing extra.** ADR-012 already put the mechanism in a shared
  library; D2 just lets Pramana import it for the narrow text cases.

## 5. What does NOT change

- ADR-011's Consumable Package contract, push delivery, and Mentible-as-packager.
- The North Star's core: **Mentible manufactures packaged consumables; Pramana
  owns definitions, delivery, approval, and tracking.**
- The rule that **a human, not a model, owns accuracy** (Pramana `docs/03 §2`).

### North Star, refined
> *Mentible = the **packaged-consumable** manufacturing engine. Pramana = the
> definitions library + delivery/tracking **+ in-process generation of text-first
> compliance artifacts**. Both generate through the one shared `wegofwd-llm` seam;
> both terminate at Pramana's human-approval gate.*

(Update the recorded North Star note and Pramana `docs/03 §5` to match.)

## 6. Consequences

**Positive:** Pramana gets fast, in-domain drafting (clause summaries, quiz items,
control text) without the packaging round-trip; one generation mechanism + one
provenance vocabulary across the family; the compliance gate is provably unchanged;
the Mentible/Pramana split stays crisp because the boundary is a concrete artifact
test, not a vague "who generates."

**Negative:** "Pramana never generates" was a pleasingly simple invariant; this
adds nuance reviewers must learn (mitigated by the D2 ceiling + the §2 boundary
test). A second generation entry point means a second place to enforce the
approval gate and meter managed-key spend. Some judgment calls will sit near the
line (mitigated by D5: default to Mentible).

## 7. Open questions

- **First slice.** Recommend **quiz-item drafting against a clause** + **clause
  plain-language summaries** first (highest SME value, smallest surface), behind
  the existing approval gate.
- **Prompts.** Does Pramana reuse Mentible's vendored prompt library, or author
  its own **compliance-specific** prompts? (Leaning: its own — compliance register
  differs from the learner-facing voice; prompts are *content*, not the seam.)
- **Managed-key spend controls** in Pramana (rate limits / caps), mirroring
  ADR-005 D5's metering concern for the managed path.
- **Edit-vs-regenerate** for SME drafts (already an open question in
  Pramana `docs/03 §10`) — unchanged by this ADR, but now also applies to in-house
  drafts.

## 8. References

- **ADR-011** — Mentible⇄Pramana handoff; **§3.1/§8 amended** (narrowed) by this ADR.
- **ADR-012** — the `wegofwd-llm` package; **D7 resolved** here.
- Pramana `docs/03_ai_drafted_human_approved_content.md` — the approval state
  machine + SoD that this ADR reuses unchanged (update §5 North Star note).
- ADR-005 — managed-key metering concern (applies to Pramana's path too).
