# ADR-005 — Multi-provider LLM support (Anthropic-only vs. provider abstraction)

**Status:** Proposed — **STUB, decision not yet made**
**Date:** 2026-05-29
**Would revise:** SCOPE.md **D1** (BYOK — *Anthropic* key) and **D9** (key handling
Pattern B — per-request passthrough), and the framing of Q as "a purpose-built
**Anthropic** client."
**Touches:** ADR-001 (BYOK security model) — env-var/secrets-manager keys are a
different threat model than per-request BYOK passthrough. ADR-002 (vendoring) —
the `pipeline/` layer is currently Anthropic-only by design.

---

## Context

`docs/llm-providers.md` (merged 2026-05-29, PR #35) documents a **multi-provider
LLM abstraction** — one `LLMProvider` interface fronting Anthropic plus four
OpenAI-compatible providers (OpenAI, DeepSeek, Qwen, Gemma), with a factory,
provider registry, and typed error hierarchy.

That document describes an `llm/` package that **does not exist in this repo**.
The actual provider code is `pipeline/providers/` — Anthropic-only, with a
deliberately different interface:

| `docs/llm-providers.md` describes | This repo actually has |
|---|---|
| `llm/` package: `factory.py`, `config.py`, `content_service.py`, … | `pipeline/providers/` only |
| `generate(LLMRequest) -> LLMResponse` (rich typed objects) | `generate(prompt: str) -> tuple[str, int, int]` |
| Typed exception hierarchy (`LLMError` + 5 subclasses) | plain `RuntimeError` |
| 5 providers, keys from env vars / secrets manager | Anthropic only, key passed positionally (BYOK) |
| Anthropic default `claude-opus-4-8` | pinned `claude-sonnet-4-6` |

So the doc is **aspirational / external** relative to the current codebase. It
also points in a direction that **contradicts locked decisions**:

- **D1/D9 and the product premise.** Q is framed as "a purpose-built *Anthropic*
  client" with BYOK. Supporting OpenAI/DeepSeek/Qwen/Gemma is a real pivot, not
  an implementation detail.
- **ADR-001 key model.** The doc's pattern reads provider keys from server-side
  env vars / a secrets manager. Q's model is the opposite: the *user's* key
  arrives per-request in the `/generate` body, lives in Redis with a TTL, and is
  shredded after use — never read from server env. A multi-provider layer would
  have to preserve per-provider BYOK passthrough, not adopt server-held keys.

This ADR exists to **force that decision deliberately** rather than let a merged
doc imply a direction by default.

---

## The question

**Does StudyBuddy Q stay Anthropic-only, or does it adopt a provider-abstraction
layer that lets the user (or us) choose among multiple LLM vendors?**

And if multi-provider: **does BYOK extend to every provider** (the user brings a
key per chosen vendor), or does the product hold non-Anthropic keys server-side
(which changes the money model and the ADR-001 threat model)?

---

## Options (to be evaluated)

1. **Status quo — Anthropic-only.** Keep `pipeline/providers/` single-vendor.
   Treat `docs/llm-providers.md` as exploratory/external and mark or remove it.
   Lowest complexity; keeps the BYOK + ADR-001 discipline intact; matches the
   "purpose-built Anthropic client" positioning.

2. **Provider abstraction, BYOK-per-provider.** Introduce an `LLMProvider`
   seam (the OpenAI-compatible-vs-Anthropic split the doc describes), but keep
   **every** key as user-supplied per-request passthrough. Preserves ADR-001;
   adds real surface (interface, registry, per-provider error mapping, schema
   validation across models of varying instruction-following quality).

3. **Provider abstraction, server-held keys.** We hold provider keys; user pays
   us (not BYOK). Largest change — reverses D1 outright, changes the money model
   (cf. ADR-004 D6), and replaces the ADR-001 transient-key model with
   at-rest secret management. Highest compliance/billing burden.

---

## Decision

**TBD.** No decision has been made. This stub captures the question and the
constraints; fill in the chosen option, rationale, and consequences before any
multi-provider code lands.

---

## Open questions

- **Why multi-provider at all?** Cost, redundancy/failover, user preference,
  access in regions where Anthropic isn't available, or model-capability fit?
  The driving requirement determines whether option 2 or 3 is even relevant.
- **Schema-validation robustness.** The pipeline validates every response against
  a JSON schema and retries 3×. Non-Anthropic models vary in JSON
  instruction-following — does the retry budget hold, or do per-provider prompt
  tweaks become necessary?
- **Default-model drift.** `pipeline/config.py` pins `claude-sonnet-4-6`. A
  multi-provider registry needs a per-provider default and a policy for keeping
  those current (the doc's model names, e.g. `deepseek-v4-pro`, are unverified).
- **Key handling per provider.** If BYOK-per-provider (option 2), how does the
  mobile app store and pass N keys, and how does Redis TTL/shredding generalise?
- **Disposition of `docs/llm-providers.md`.** If option 1, the doc should be
  removed or clearly marked exploratory (it references `import llm` and
  `requirements-llm.txt`, neither of which exist). If 2/3, the doc must be
  rewritten to match the real interface, the Sonnet default, and BYOK.

---

## References

- `docs/llm-providers.md` — the multi-provider design this ADR adjudicates (PR #35).
- ADR-001 (BYOK security) — per-request passthrough key model that any
  multi-provider design must preserve or explicitly revise.
- ADR-002 (vendoring) — `pipeline/` is Anthropic-only by design today.
- SCOPE.md §5 — **D1** (BYOK), **D9** (Pattern B passthrough).
- CLAUDE.md — "purpose-built Anthropic client"; pipeline pins `claude-sonnet-4-6`.
