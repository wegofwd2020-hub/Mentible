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

## Verification (2026-06-05)
`base_url`, `default_model`, and `key_prefix` confirmed against vendor docs and
corrected (`model_verified=True`):
- **Groq** `https://api.groq.com/openai/v1` · `llama-3.3-70b-versatile` (current
  production) · `gsk_`.
- **OpenRouter** `https://openrouter.ai/api/v1` ·
  `meta-llama/llama-3.3-70b-instruct:free` (was the older 3.1-8b) · `sk-or-`.
- **Gemini** `https://generativelanguage.googleapis.com/v1beta/openai` ·
  `gemini-2.0-flash` (was the retired 1.5-flash) · `AIza…` (no prefix check).

Re-check periodically — vendors rotate free models. CI never calls them
(tests patch `tasks.build_provider`). **Note:** endpoint/model verified ≠
output verified — the pickers still mark these *experimental* (conformance not
yet measured for book-grade JSON).

## Testing
Green: **backend 158** (backend/tests + tests/llm) · **mobile jest 131**. New
tests: groq wrong-prefix → 422, groq/gemini happy-path via a patched provider,
`gsk_`/`AIza` redaction, keystore prefix validate/mask, registry provider set.

## Follow-ups
Verify endpoints/models live; add more free providers the same way; conformance
tier per model (memo §5) to mark which are authoring-grade vs draft-only.
