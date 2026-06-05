# Multi-provider wiring — Phase 5 (free providers)

> **Status:** free OpenAI-compatible providers on `feat/llm-free-providers`
> (branched off Phases 1–3, independent of Phase 4's tool-use). Memo §5/§6.

## What lands
Three **free, BYOK, OpenAI-compatible** providers — they reuse the existing
`OpenAICompatibleProvider` (no new provider code), added as registry + picker
entries:

| Provider | Why | Key | Get a key |
|---|---|---|---|
| **Groq** | free, fast, open models | `gsk_…` | console.groq.com |
| **OpenRouter** | free `:free` model variants | `sk-or-…` | openrouter.ai |
| **Google Gemini** | generous free tier | `AIza…` (no `sk-`) | aistudio.google.com |

## The one real change: per-provider key prefixes
Free providers don't use `sk-`, so the `sk-`/`sk-ant-` assumption is generalized:
- **Registry:** `ProviderSpec.key_prefix` (anthropic `sk-ant-`, openai/deepseek
  `sk-`, groq `gsk_`, openrouter `sk-or-`, gemini `""` = length-only).
- **Backend validation:** `GenerateRequest._api_key_matches_provider` checks the
  registry's `key_prefix` instead of a hardcoded value.
- **🔐 Redaction:** the value-backstop now also catches `gsk_…` and `AIza…`
  (OpenRouter `sk-or-` is already covered by the generic `sk-` rule). No-prefix
  keys (e.g. Mistral) rely on field-name redaction — flagged in code.
- **Mobile:** `constants/providers.ts` carries `keyPrefix`; `keyStore`
  validate/mask are driven by it. Both pickers (Settings + params editor) render
  the new providers automatically.

## ⚠ UNVERIFIED
`base_url`, `default_model`, and exact `key_prefix` for each free provider are
best-effort from training data — **confirm against each vendor** before relying
on them. They're marked UNVERIFIED in the registry. CI never calls them
(tests patch `tasks.build_provider`).

## Testing
Green: **backend 158** (backend/tests + tests/llm) · **mobile jest 131**. New
tests: groq wrong-prefix → 422, groq/gemini happy-path via a patched provider,
`gsk_`/`AIza` redaction, keystore prefix validate/mask, registry provider set.

## Follow-ups
Verify endpoints/models live; add more free providers the same way; conformance
tier per model (memo §5) to mark which are authoring-grade vs draft-only.
