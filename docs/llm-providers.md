# Multi-Provider LLM Content Generation

> **Status (2026-05-29):** Multi-provider support is **accepted** — see
> **ADR-005**. **This document is a design target, not yet-built code:** the live
> code is Anthropic-only (`pipeline/providers/`); the `llm/` package and
> `requirements-llm.txt` below **do not exist yet**.
>
> **Two corrections vs. ADR-005** that this doc has not yet been rewritten to
> match: (1) key handling is **hybrid** — *managed keys (we hold them) by
> default* + *optional BYOK*; the env-var/secrets-manager pattern below applies to
> the **managed** path, and a per-request BYOK passthrough path (ADR-001) also
> exists. (2) The Anthropic default model is **`claude-sonnet-4-6`**, not
> `claude-opus-4-8`. The build should follow ADR-005 where they differ.

StudyBuddy can generate study content with **Anthropic, OpenAI, DeepSeek, Qwen,
or Gemma**, selectable at runtime. This page documents how the layer is
structured, how to configure it, and how to use it.

> **At a glance:** four of the five providers (OpenAI, DeepSeek, Qwen, Gemma)
> speak the OpenAI Chat Completions protocol, so they share a single client.
> Only Anthropic uses its own SDK. Application code talks to one interface
> (`LLMProvider`), so switching providers is a one-line change.

---

## Table of contents

- [Architecture](#architecture)
- [Supported providers](#supported-providers)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick start](#quick-start)
- [Letting the user choose a provider](#letting-the-user-choose-a-provider)
- [Web integration example (Flask)](#web-integration-example-flask)
- [Error handling](#error-handling)
- [Adding a new provider](#adding-a-new-provider)
- [Testing](#testing)
- [Provider notes](#provider-notes)

---

## Architecture

```
llm/
├── base.py                       # LLMProvider ABC + LLMRequest / LLMResponse types
├── config.py                     # Provider enum + PROVIDER_REGISTRY (URLs, models, env keys)
├── exceptions.py                 # Typed error hierarchy (LLMError + subclasses)
├── factory.py                    # create_provider(name) / available_providers()
├── content_service.py            # StudyContentGenerator (StudyBuddy's seam)
└── providers/
    ├── openai_compatible.py      # OpenAI + DeepSeek + Qwen + Gemma
    └── anthropic_provider.py     # Anthropic Claude
```

The single operation every provider implements:

| Operation | Input | Output | Raises |
|-----------|-------|--------|--------|
| `generate` | `LLMRequest { messages, system?, model?, max_tokens, temperature }` | `LLMResponse { content, model, provider, usage?, raw }` | `LLMAuthenticationError`, `LLMRateLimitError`, `LLMTimeoutError`, `LLMResponseError`, `LLMConfigurationError` |

---

## Supported providers

| Provider | Client family | Base URL | Default model | API key env var |
|----------|---------------|----------|---------------|-----------------|
| `anthropic` | `anthropic` SDK | _(SDK default)_ | `claude-opus-4-8` | `ANTHROPIC_API_KEY` |
| `openai` | `openai` SDK | `https://api.openai.com/v1` | `gpt-4o` | `OPENAI_API_KEY` |
| `deepseek` | `openai` SDK | `https://api.deepseek.com` | `deepseek-v4-pro` | `DEEPSEEK_API_KEY` |
| `qwen` | `openai` SDK | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `qwen3-max` | `DASHSCOPE_API_KEY` |
| `gemma` | `openai` SDK | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemma-4-31b-it` | `GEMINI_API_KEY` |

Provider names are case-insensitive (`"DeepSeek"`, `"qwen"`, `" Gemma "` all resolve).

---

## Installation

```bash
pip install -r requirements-llm.txt
```

This installs `openai` (covers OpenAI, DeepSeek, Qwen, Gemma) and `anthropic`.

---

## Configuration

Set the environment variable for whichever provider(s) you use:

```bash
export DEEPSEEK_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
# ...etc
```

Keys may also be passed explicitly to `create_provider(..., api_key=...)`,
which takes precedence over the environment variable. **Never commit keys to
the repository** — read them from the environment or a secrets manager.

---

## Quick start

Generate content with DeepSeek:

```python
from llm import StudyContentGenerator

gen = StudyContentGenerator.from_provider_name("deepseek")   # reads DEEPSEEK_API_KEY
material = gen.generate_study_material("binary search trees", level="beginner")

print(material.content)                       # the generated study guide
print(material.provider, material.model)      # -> deepseek deepseek-v4-pro
```

Or use the lower-level provider API directly:

```python
from llm import create_provider, LLMRequest, Message, Role

provider = create_provider("anthropic")
response = provider.generate(
    LLMRequest(
        messages=[Message(role=Role.USER, content="Explain recursion simply.")],
        system="You are a patient tutor.",
        max_tokens=800,
    )
)
print(response.content)
```

---

## Letting the user choose a provider

`available_providers()` returns the canonical names, ready for a dropdown,
CLI menu, or form field:

```python
from llm import StudyContentGenerator, available_providers

available_providers()   # ['anthropic', 'openai', 'deepseek', 'qwen', 'gemma']

def build(topic: str, provider_name: str, model: str | None = None):
    gen = StudyContentGenerator.from_provider_name(provider_name, model=model)
    return gen.generate_study_material(topic)
```

---

## Web integration example (Flask)

```python
from flask import Flask, request, jsonify
from llm import StudyContentGenerator, available_providers
from llm.exceptions import LLMError

app = Flask(__name__)

@app.get("/providers")
def providers():
    return jsonify(available_providers())

@app.post("/generate")
def generate():
    data = request.get_json(force=True)
    try:
        gen = StudyContentGenerator.from_provider_name(
            data.get("provider", "deepseek"), model=data.get("model")
        )
        material = gen.generate_study_material(data["topic"])
        return jsonify({
            "content": material.content,
            "provider": material.provider,
            "model": material.model,
        })
    except LLMError as exc:                       # auth / rate-limit / timeout / bad response
        return jsonify({"error": str(exc), "provider": exc.provider}), 502
    except (KeyError, ValueError) as exc:         # bad input
        return jsonify({"error": str(exc)}), 400
```

---

## Error handling

Vendor-specific SDK exceptions are translated into one uniform hierarchy, so
callers catch a single base class and still discriminate when needed:

```
LLMError
├── LLMConfigurationError        (UnsupportedProviderError)  # missing key / unknown provider
├── LLMAuthenticationError       # HTTP 401 / 403
├── LLMRateLimitError            # HTTP 429  -> safe to back off and retry
├── LLMTimeoutError              # request timed out
└── LLMResponseError             # other non-2xx / malformed response
```

Example of a targeted retry on throttling:

```python
import time
from llm import create_provider
from llm.exceptions import LLMRateLimitError

provider = create_provider("qwen")

for attempt in range(3):
    try:
        response = provider.generate(request)
        break
    except LLMRateLimitError:
        time.sleep(2 ** attempt)   # exponential backoff
else:
    raise RuntimeError("Provider remained rate-limited after 3 attempts")
```

---

## Adding a new provider

If the provider is OpenAI-compatible (most are), add **one entry** to
`PROVIDER_REGISTRY` in `llm/config.py` and one name to the `Provider` enum:

```python
Provider.MISTRAL: ProviderConfig(
    client_kind=ClientKind.OPENAI_COMPATIBLE,
    default_model="mistral-large-latest",
    api_key_env="MISTRAL_API_KEY",
    base_url="https://api.mistral.ai/v1",
),
```

It then appears automatically in `available_providers()`. No other code changes
are required.

---

## Testing

```bash
python -m pytest -q        # 34 tests, no API keys or network required
```

All tests inject fake SDK clients (see `tests/mock_data.py`), exercising request
building, response parsing, and error mapping deterministically and offline.

---

## Provider notes

_Verified May 2026 — endpoints and model names change; re-check vendor docs._

- **DeepSeek** — OpenAI-compatible at `https://api.deepseek.com`. The legacy
  `deepseek-chat` / `deepseek-reasoner` model aliases retire on **2026-07-24**;
  use `deepseek-v4-pro` (max capability) or `deepseek-v4-flash` (fast / cheap).
- **Qwen** — via Alibaba DashScope's OpenAI-compatible endpoint. The default
  here is the international (Singapore) URL; switch to
  `https://dashscope.aliyuncs.com/compatible-mode/v1` for China-registered
  accounts.
- **Gemma** — served through Google's Gemini OpenAI-compatible base URL using a
  `GEMINI_API_KEY`. The Gemma free tier has low rate limits; move to a paid
  Gemini model or self-hosting for sustained use.
- **Abstraction choice** — Anthropic, DeepSeek, and Qwen also offer
  Anthropic-style endpoints, but this layer standardises on the OpenAI shape for
  the four compatible providers because it is the broadest common denominator.
