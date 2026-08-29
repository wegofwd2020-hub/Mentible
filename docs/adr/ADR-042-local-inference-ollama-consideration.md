# ADR-042 — Local inference (Ollama): not a managed engine; a deferred BYOK/privacy option

**Status:** Accepted (2026-08-29). Direction call only — **no code**. Records why we
do *not* self-host model inference now, and the one shape in which local inference
could return later.
**Decision-maker:** Sivakumar Mambakkam
**Trigger:** "Should we consider something like Ollama as a jump-off point for
Mentible?" — i.e. use a local/open-model runner (Ollama runs Llama/Qwen/Mistral/…
locally, behind an OpenAI-compatible API) as a generation engine, to cut token
cost and dodge free-tier rate limits.
**Relates to / amends:** ADR-005 (multi-provider seam + hybrid key handling —
managed-vault default + optional BYOK), ADR-014 (per-provider credential set),
ADR-037 (SME expert-validation reposition; "trust is the product"), and the
`wegofwd-llm` registry (`pipeline/providers`, the `openai_compatible` provider).

---

## Context

Mentible's generation is **provider-agnostic** through the `wegofwd-llm` seam: a
registry of providers, each built from config, called through one contract. Today
the engines are **managed Groq** (free tier, the keyless default) plus **BYOK**
(Anthropic / OpenAI / Groq / Gemini / OpenRouter). The product's value is the
**scoping + validation layer**, not the model — "the LLM is the commodity, the
scoping layer is the IP."

Ollama is an OpenAI-compatible local runner. The question is whether it should be
a **jump-off point** — a cheap/free engine we lean on. Three facts frame the call:

1. **Inference has to run somewhere.** The prod box (Hetzner CX22) is small and
   CPU-only. A model large enough for coherent, source-citing content (≈30B+) needs
   real GPU — an expensive, ops-heavy box (drivers, uptime, scaling). Standing that
   up makes Mentible an **inference host**, a new cost center with no product
   differentiation — the opposite of "the model is the commodity."
2. **The free slot is already filled.** Groq's free tier (Qwen-3-8B) gives us a
   keyless, zero-infra, fast default. Ollama only beats it if we already have free
   GPU capacity — we don't.
3. **Quality.** Self-hostable small models (7–8B) are draft-grade — the same tier
   Groq's Qwen is already flagged as (`experimental`). For an **expert-validation**
   product, that's the weak end, and self-hosting buys us nothing over Groq there.

There is one place local inference is genuinely attractive: **privacy**. An SME who
wants *"my sources never leave my machine"* is a clean fit for the trust story — but
that only works where the client can reach a local Ollama (`localhost:11434`), which
the **web app cannot** (network/CORS). It is a **native/desktop-only** capability,
serving the narrow slice of users who will actually run Ollama.

## Decision

**Do not self-host model inference (no managed Ollama / GPU box) now.** Keep the
managed default on Groq-free + Anthropic-BYOK.

**Keep local inference as a deferred, low-effort BYOK option** for the native/desktop
build only: add Ollama to the `wegofwd-llm` registry as an `openai_compatible`
provider pointing at a user-supplied base URL (default `http://localhost:11434/v1`).
This is a config-sized change, not new architecture, and it reinforces the
"your data stays yours" trust angle for the privacy niche. Not built until a
native-app user need justifies it.

## Consequences

- **No new infra or ops** — we do not take on GPU hosting, model management, or
  inference scaling. The economics and quality of the current Groq-free + BYOK setup
  stand.
- **The seam stays ready.** Because generation is already provider-agnostic, adding
  Ollama later is a registry entry + a base-URL credential-set field (ADR-014), with
  no change to the scoping/validation layer.
- **Web stays out of scope** for local inference — a browser cannot reach a user's
  localhost runner. Any Ollama support is gated to native/desktop.
- **Quality expectation is honest** — a local small model is draft-grade; the
  provider tier ("experimental") already communicates this, and the validation
  workflow (ADR-037) remains the quality backstop regardless of engine.

## Alternatives considered

- **Managed Ollama on a GPU server (rejected):** turns us into an inference host;
  cost + ops + quality don't beat Groq-free or Anthropic-BYOK. No differentiation.
- **Ollama as the free testing default (rejected):** Groq's free tier already is
  that, with zero infra and better ergonomics.
- **Do nothing / never (not chosen):** the privacy/zero-cost native niche is real
  and the seam makes it cheap, so we record it as deferred rather than closed.
