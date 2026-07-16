# ADR-036 — Vision-assisted figure captions: the smallest slice that lets a figure reach a model

**Status:** Proposed — 2026-07-16
**Decision-maker:** Sivakumar Mambakkam
**Amends:** ADR-034 D3.1's applied copy (the shipped "nothing is sent to the AI" claim goes false —
D5 below), ADR-035 D5's replacement copy (written before vision existed).
**Extends:** `wegofwd-llm`'s `LLMRequest` with optional image parts — **additive → minor bump**
(ADR-012 D4); `Capabilities.vision` finally becomes true somewhere.
**Constrained by:** ADR-035 D2 (media E2E at rest — unweakened, see D2), ADR-016 D1/D3 (one provider
per unit; fallback never silent — D4), ADR-001 (BYOK passthrough, unamended — D2), ADR-034 D3
(claims honesty — D5).
**Follows:** ADR-029 D5's template for non-text media processing — *"rather than let it ride in by
implication, it is parked with its own future decision (opt-in, per-file, cost shown up front)."*
**Builds on:** media slice 1 (attach — PR #318, device-verified 2026-07-16) and slice 2
(ADR-035 hosted sync — Proposed).

---

## Context

Media slice 1 shipped attach-a-figure as free, device-local, and **with no egress at all**: the
figure never leaves the device, which is why the shipped copy can say *"Figures stay on your device.
Nothing is sent to the AI."* Slice 2 (ADR-035) syncs figures across devices end-to-end encrypted —
still no model ever sees one.

Slice 3 is the first time a figure reaches a model. That makes it the slice where the honesty
question actually bites, and where a decision made by implication would be worst.

The obvious framings — OCR-for-grounding, or images as generation input — are both larger than they
look. Grounding needs a *derived index of image content*, which collides directly with ADR-035 D2
(an index derived from content we deliberately cannot read) and depends on ADR-029's index, which is
unbuilt. Generation-input changes the scoped-query model itself (the six dimensions are text today).
Neither is the smallest thing that proves the seam.

**Caption assist is.** It is per-image, opt-in, author-in-the-loop, produces no new stored artifact
beyond a caption the author already owns, and still forces every hard question: the image contract,
the provider-capability collision, and the copy. If the seam is wrong, this is the cheapest place to
find out.

Recorded before any code exists.

## Decision

**Ship "suggest a caption" for an attached figure: the device decrypts locally and sends the image
through the existing BYOK/managed passthrough to a vision-capable model; the author edits and
approves the result. Nothing is auto-applied, nothing new is stored, and the copy stops claiming
figures never reach a model.**

### D1 — Scope: caption + alt text, author-in-the-loop, never auto-applied

"Suggest a caption" on a figure returns a **draft** caption and alt text. The author edits and
accepts it, or discards it. **It is never written without an explicit accept.**

No index, no embeddings, no retrieval, no new storage. The output lands in `TopicImage.caption`,
which already exists (slice 1).

The author-in-the-loop rule is not UX politeness — it is the whole basis of D7's provenance stance.
Remove it and this becomes a machine writing factual claims about the author's images under the
author's name.

### D2 — The path, stated precisely (and what it does NOT change)

The device decrypts the figure locally and submits it through the **existing backend passthrough**
(ADR-001) — the same route text takes today. Two claims that must not be blurred:

- **ADR-035 D2 is not weakened.** E2E is an **at-rest custody** property: the server holds no key
  that opens a *stored* blob, and that stays exactly true. A figure the author *deliberately
  submits* for captioning is transient passthrough, not custody. The server does not read stored
  media; it relays bytes the author chose to send, then drops them.
- **Server-side vision remains foreclosed** (ADR-035 D2's stated consequence). Nothing here reads a
  figure the author didn't hand over for this request. The device is still the only thing that can
  decrypt the library.

This is ADR-034 D3.1's **storage ≠ processing** distinction used honestly — naming the moment
processing happens — rather than hidden behind it. "Your figures are stored only on your device" and
"your figure is sent to a model when you ask for a caption" are both true, and D5 makes the app say
the second one.

ADR-001 is **unamended**: the BYOK key still travels only in the `/generate`-class request body, is
never logged, never persisted. The image is request data with the same discipline — never logged,
never persisted, dropped after the call.

### D3 — Contract: optional image parts on `LLMRequest` (additive, minor bump)

`LLMRequest` is text-only today (`prompt: str`). Vision needs optional image parts. Per ADR-012 D4
this is an **additive change → minor version**; consumers pinned at `@v0.2.0` are unaffected until
they choose to bump. It belongs in the shared package (ADR-012 D2 — product-neutral: any of the
three products could caption an image); a Mentible-local vision path would violate ADR-012 D1/D5.

**`Capabilities.vision` already exists — and no adapter has ever set it true.** A capability flag
with nothing behind it, which is exactly the shape of the `isStarter` field that let Help promise
starter libraries that did not exist. This ADR is where `vision` stops being decorative: adapters
that genuinely support images declare it, and D4 makes the flag load-bearing.

### D4 — Provider pin: fail loudly, offer an explicit re-pin

ADR-016 D1 pins **one provider per unit**, and not every provider in ADR-005's registry can see
images. When the book's pinned provider reports `vision = false`:

- "Suggest a caption" is **disabled**, with the reason named ("this book's provider can't read
  images"), and an **explicit re-pin** is offered.
- No silent substitution. ADR-016 D3 permits fallback but **never silently**; a caption quietly
  drafted by a provider the book isn't pinned to would give that caption a different provenance from
  the unit around it — the precise coupling D1 exists to prevent.

The author hits a wall and must make a decision. That is the honest outcome, not a failure of the
design.

### D5 — Honesty: the shipped claim goes false; say the true thing instead (ADR-034 D3.1)

Two strings ship today and become **false the moment this lands**:

- `mobile/src/components/FiguresPanel.tsx:141` — "Figures stay on your device. Nothing is sent to the AI."
- `mobile/src/help-content/topics.ts` (attach-figures topic) — "Your figures stay on your device; nothing is sent to the AI."

ADR-034 D3.1 bans "nothing leaves your device" as written; "nothing is sent to the AI" is the same
class of claim, and slice 3 is the event that makes it untrue. The replacement is conditional,
because the truth is conditional:

> *"Your figures stay on your device. If you ask for a caption suggestion, that image is sent to
> <provider> to draft it."*

**Name the destination** (ADR-034 D3.2): the copy states the actual provider and, for a
confidentiality-sensitive audience, its no-train / retention posture. "Sent to the AI" is not a
destination.

This also supersedes ADR-035 D5's replacement copy, which was written when captioning did not exist
and therefore still promised no model would see a figure.

Updating this copy is **part of shipping D1**, not a follow-up — the repo's Definition of Done, and
the Help coverage gate, both bind here.

### D6 — Opt-in, per-image, cost shown up front

Straight from ADR-029 D5's template for non-text media: the action is opt-in, per-file, and shows
its cost implication **before** the call. A vision call is not free, and the author is the one paying
(BYOK) or drawing down an allowance (managed, ADR-016 metering).

### D7 — Provenance: an approved caption is the author's

A caption the author edited and accepted is **the author's own words**. No schema marking, no
Content Trust Manifest entry (ADR-015), no provenance indicator (ADR-016 D6 is per *unit* — a
caption is not a unit). Adding a provenance axis for a field the author explicitly approved is
machinery without a reader.

This holds **only** because of D1's never-auto-apply rule. The two decisions stand or fall together:
if a future change ever applies a suggestion without approval, this D7 is void and provenance must
be revisited in the same breath.

## Consequences

**What we gain.** The image seam exists, proved by the smallest feature that needs it. `vision`
stops being a decorative flag. The app says a true thing about where figures go.

**What we lose (honestly).** The strongest version of the figures promise. Today's *"nothing is sent
to the AI"* is a clean, absolute, verifiable claim; after this it becomes conditional and depends on
users reading a sentence. That is a real cost, paid for a real capability, and D5 is what keeps it
from being paid silently.

We also add a shared-package contract surface (three products) and a per-image cost.

**What is unaffected.** ADR-001 (unamended). ADR-035 D2's at-rest E2E (unweakened — D2). Slice 1's
free device-local attach (a user who never taps "suggest" still has zero egress, and the copy still
says so). Server-side vision (still foreclosed).

**Migration:** additive and opt-in. Nothing changes for existing figures until an author asks.

## Prerequisite — the accessibility bug is NOT this ADR's to claim

Both readers render `alt="${esc(img.caption ?? "")}"` (`mobile/src/lib/figuresHtml.ts`, and the
mirrored WebView twin in `contentHtml.ts`). An **uncaptioned figure therefore gets `alt=""`**, which
is HTML for *decorative* — a screen reader skips it entirely. A meaningful diagram is announced as
nothing, in both readers **and in the compiled EPUB**, a format with real accessibility obligations.

That is a genuine bug, and **it is fixable with a plain alt-text field and no AI whatsoever** — free,
zero egress, no provider, no cost. It should ship **first and separately**.

Vision lowers the *friction* of writing alt text. It is not the fix, and this ADR does not claim to
be one. Marketing caption assist as "the accessibility feature" would be exactly the kind of claim
ADR-034 D3 exists to stop: it would sell an optional paid-ish convenience as the remedy for a defect
we could simply repair.

## Open questions

1. **Image encoding on the wire** — base64 in the request body (matches slice 1's compile payload and
   ADR-001's body discipline) vs multipart; and the per-request size ceiling (slice 1 caps an image
   at 10 MB, which is large for a model call).
2. **Which adapters declare `vision`** — and how `integration_version` (ADR-012) tracks a vendor
   changing its image API.
3. **Prompt + output shape** — one call returning both caption and alt text, or two; and whether alt
   text should differ from the caption at all (they serve different readers).
4. **Managed-path cost attribution** — a vision call is metered (ADR-016) but is not a *generation*;
   confirm it lands in the same allowance without distorting per-unit cost reporting.
5. **Failure copy** — what the author sees when the model returns something useless, and whether a
   rejected suggestion is worth logging (it is not, if it carries image-derived text).
6. **Slice 2 interaction** — captioning a figure whose bytes are hosted-but-not-yet-cached (ADR-035
   D3 lazy fetch): fetch-then-caption, or disable until cached.

## Blast radius

- **`wegofwd-llm`** — `LLMRequest` gains optional image parts; adapters declare `Capabilities.vision`.
  Additive, minor bump (ADR-012 D4). Three consumers, none forced to move.
- **ADR-034 D3.1** — its principle is unchanged; its *applied copy* in this app changes (D5).
- **ADR-035 D5** — its replacement copy is superseded (written pre-vision).
- **ADR-016** — no amendment; D1/D3 are honored as written (D4).
- **Shipped copy** — `FiguresPanel.tsx:141`, `help-content/topics.ts` attach-figures topic.
- **STATUS.md** — ADR-036 row.

## Scope — what this ADR is *not*

- **Not** grounding/retrieval over figures — needs a derived index of content ADR-035 D2 says we
  cannot read, and ADR-029's index is unbuilt. A separate decision.
- **Not** images as generation input ("explain this diagram") — that changes the scoped-query model.
- **Not** server-side vision — ADR-035 D2 forecloses it; D2 above does not reopen it.
- **Not** audio — still parked (ADR-029 D5).
- **Not** the accessibility fix — that is a plain alt-text field, shipped separately and first.
- **Not** a change to slice 1's free device-local attach, or to ADR-001.
- **Not** the build design — the wire format, prompts, and UI are future brainstorms.
