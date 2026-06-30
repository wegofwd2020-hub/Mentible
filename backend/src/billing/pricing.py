"""Token → cost pricing — the wegofwd-billing MECHANISM (pure, no I/O).

Converts observed token counts into a cost estimate in **micro-USD** (1 micro = 1e-6
USD) via a versioned price table. Identical across the wegofwd family ⇒ part of the
extractable mechanism (ADR-019), alongside `vault.py`. The *cap* read against this
cost is policy (`caps.py`, per-app).

⚠️ The rates below are published list prices captured on PRICE_TABLE_VERSION and are
APPROXIMATE — they MUST be verified against the vendor's current pricing before real
billing (ADR-005 O6). Until managed billing charges real money this is internal
accounting only. An unknown (provider, model) falls back to a conservative default so
we never under-count a new model to zero.
"""

from __future__ import annotations

# USD per 1,000,000 tokens, as (input_rate, output_rate). Keep keys = resolved model
# ids the worker actually sends (provenance.model). Verify on update (O6).
PRICE_TABLE_VERSION = "2026-06-30"

_PRICES: dict[tuple[str, str], tuple[float, float]] = {
    # Anthropic.
    ("anthropic", "claude-sonnet-4-6"): (3.0, 15.0),
    ("anthropic", "claude-opus-4-8"): (15.0, 75.0),
    ("anthropic", "claude-haiku-4-5-20251001"): (1.0, 5.0),
    # OpenAI (Phase 6 multi-provider; verify on update — O6).
    ("openai", "gpt-4o"): (2.5, 10.0),
    ("openai", "gpt-4o-mini"): (0.15, 0.6),
    # Groq (open models on LPU — cheap; verify).
    ("groq", "llama-3.3-70b-versatile"): (0.59, 0.79),
    # Gemini (paid tier only for managed — O4).
    ("gemini", "gemini-2.5-flash"): (0.30, 2.5),
    ("gemini", "gemini-2.5-pro"): (1.25, 10.0),
}

# Conservative fallback for an unpriced (provider, model): assume a mid-tier rate so a
# new model is never billed at zero. Intentionally not cheap.
_DEFAULT_RATE: tuple[float, float] = (3.0, 15.0)


def cost_micros(provider: str, model: str, input_tokens: int, output_tokens: int) -> int:
    """Estimated cost of a generation in micro-USD (1e-6 USD), rounded to the nearest
    micro. cost = tokens/1e6 × rate_per_1M, summed over input + output; since the rate
    is per 1M and a micro is 1e-6 USD, this reduces to tokens × rate (verify: 100 input
    tokens at $3/1M = 300 micros = $0.0003)."""
    inp_rate, out_rate = _PRICES.get((provider, model), _DEFAULT_RATE)
    return round(input_tokens * inp_rate + output_tokens * out_rate)
