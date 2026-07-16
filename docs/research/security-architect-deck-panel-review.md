# Security-architect deck — adversarial panel review

Three-lens simulated review of `mentible-for-security-architects.pptx` /
`docs/adr-033-web/persona-architect.html`. LLM simulation — a cheap pre-filter, not real users.

## Scorecard

| Lens | Score | Verdict |
|---|---|---|
| Skeptical senior security architect (target user) | **2 / 10** | Distrust the deck as written; try the free on-device search only *if it ships* and *after* the locality claim is fixed. |
| CISO (buyer / approver) | **2 / 10** | **Block** — free tier ships confidential threat models to an unnamed third-party LLM under a false "nothing leaves your machine" claim. |
| Pragmatic staff engineer (Glean / Cursor / wiki user) | **2 / 10** | Pass — unless auto-index-from-existing-systems + device-local-by-default are real and verifiable. |

**Consensus = 2.0 / 10** — the lowest of all four personas. This audience is both the most
claim-sensitive and the most equipped to verify.

## Objections ranked by consensus

1. **"Nothing leaves your machine" is false for generation — all 3, hardest from the CISO.**
   Retrieval is on-device; the moment you ask it to *write*, the confidential threat model is
   POSTed to a third-party LLM API. "The deck engineers the exact confusion it should be
   dispelling." The most dangerous line in the deck for this audience.
2. **The product isn't shipped — the security architect READ YOUR REPO and caught it.**
   > "'Knowledge Library' and the hosted sync tier are a **Proposed, design-only ADR (029) with
   > zero code**, and a hosted tier (033) **gated on a managed-billing launch that hasn't happened.**
   > This isn't a demo, it's a mockup of a roadmap item."
   Present-tense pitch for a specced-not-built product. Applies to **all four decks.**
3. **No accuracy data on security content — all 3.** "Never a chatbot's guesses" is impossible for
   RAG (grounds the prompt, not the output). A confidently-wrong control recommendation is a
   liability, not a convenience. Zero eval / hallucination-rate / confidence calibration.
4. **Loses to existing tools — staff engineer + architect.** Glean auto-indexes where docs already
   live; Cursor/Copilot @-mention repo docs in-context; grep is instant and zero trust-surface.
   "Grounded/cited" is **table-stakes now**, not a pitch. "Hand it your docs" = a shadow copy that
   "silently rots."
5. **Staleness / superseded docs + access control — architect + staff eng.** Your ADR folder keeps
   Rejected ADRs on purpose; retrieval will "confidently cite the dead one." No version/status
   awareness, and no access-control model on the library (threat models are the most sensitive docs
   in the org) — unaddressed across all 8 slides.
6. **"Confidential by default" (paid) contradicts your own architecture.** ADR-033 says the hosted
   tier is **not zero-knowledge** — content is decrypted server-side to index it. The claim needs an
   asterisk the deck doesn't carry.

## Biggest fixes
1. **Truthful, narrower claim:** "Retrieval is 100% on-device and free. When you ask me to write,
   you see and choose the provider (BYOK) — nothing goes anywhere without you seeing the destination."
2. **Don't pitch unshipped features present-tense** — show the shipped free-tier lexical search first;
   label the RAG/hosted tier as roadmap, honestly.
3. **Auto-index, permission-aware connectors** (GitHub/Confluence) respecting existing ACLs; kill the
   manual "hand it your docs" step.
4. **Surface inline citations** (the ADR-029 D4 manifest/citation machinery already exists in the spec)
   + superseded-doc awareness + a named provider / DPA / no-train statement.

## Verbatim highlights
- CISO: "Free + no-contract + third-party LLM call = uncontracted data egress of our most sensitive
  documents. That's the whole risk in one sentence. **Block.**"
- Security architect: "I checked whether any of this is shipped — it's a Proposed ADR with zero code.
  I don't evaluate roadmap items against my threat models."
- Staff engineer: "'The senior engineer who's read every ADR' is doing a lot of work to disguise 'RAG
  over whatever subset of docs you remembered to feed it.'"
