"""BYOK key-redaction for structlog.

This module is security-critical. See ADR-001.

Two layers of defence:

1. **Field-name redaction.** Any structlog event_dict key whose name
   matches a sensitive-name pattern (api_key, anthropic_key, byok_key, etc.)
   has its value replaced with "<redacted>".

2. **Value pattern redaction.** Any string value containing a substring that
   looks like a provider API key is redacted: `sk-ant-*` (Anthropic) →
   "<redacted-anthropic-key>", and any other `sk-*` token (OpenAI, DeepSeek,
   Qwen, OpenRouter, …) → "<redacted-provider-key>". Multi-provider BYOK means
   more than one key format flows, so the backstop is provider-agnostic
   (ADR-005 + docs/multi-provider-wiring-phase2.md §2b).

The CI gate `tests/test_no_key_in_logs.py` exercises every code path with a
known test key and asserts no log line contains it — this module is the
primary defence against that test failing.

NEVER bypass this processor. NEVER log the request body verbatim without
running it through `redact_keys`.
"""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog

# ── Patterns ──────────────────────────────────────────────────────────────────

# Anthropic API keys start with "sk-ant-" followed by an opaque token.
# Match a generous trailing chunk so partial keys are also caught.
_ANTHROPIC_KEY_RE = re.compile(r"sk-ant-[A-Za-z0-9_\-]{8,}")

# Generic provider-key backstop: any other `sk-…` token (OpenAI `sk-`/`sk-proj-`,
# DeepSeek/Qwen `sk-`, OpenRouter `sk-or-`, …). Applied AFTER the Anthropic regex
# so sk-ant- keys keep their specific label. {16,} avoids matching bare "sk-"
# mentions; over-redaction is the safe direction for a security backstop.
_PROVIDER_KEY_RE = re.compile(r"sk-[A-Za-z0-9_\-]{16,}")

# Free-provider key formats that DON'T start with sk-: Groq (gsk_…), Google
# Gemini (AIza…). Other no-prefix keys (e.g. Mistral) can't be pattern-matched —
# field-name redaction + the no-logging discipline are their backstop.
_OTHER_KEY_RE = re.compile(r"\b(?:gsk_|AIza)[A-Za-z0-9_\-]{16,}")

# Keys whose VALUE should be redacted regardless of content. Lower-cased
# field names; comparison is case-insensitive.
_SENSITIVE_FIELD_NAMES: frozenset[str] = frozenset(
    {
        "api_key",
        "apikey",
        "anthropic_key",
        "anthropic_api_key",
        "openai_key",
        "openai_api_key",
        "provider_key",
        "byok_key",
        "byok",
        "x_api_key",
        "authorization",
        "secret",
        "password",
        "token",
        # System-owner credential (ADR-018 D6). "secret" above already catches a
        # bare `secret` field; these cover the explicit config/field names so an
        # owner secret logged under its own name is redacted too.
        "system_owner_secret",
        "owner_secret",
        "system_owner_key",
    }
)

_REDACTED_VALUE = "<redacted>"
_REDACTED_KEY_PATTERN = "<redacted-anthropic-key>"
_REDACTED_PROVIDER_KEY = "<redacted-provider-key>"


def _scrub_value(value: Any) -> Any:
    """Recursively scrub a value for embedded Anthropic keys.

    Strings: regex-replace any sk-ant-* substring.
    Dicts: recurse into values, also redact by field name.
    Lists/tuples: recurse element-wise.
    Other types: returned unchanged (their __str__ is NOT inspected — adding
    that would create false-positive risk on long stringified objects).
    """
    if isinstance(value, str):
        # Anthropic first (keeps its specific label), then the sk- backstop, then
        # the non-sk free-provider formats (gsk_/AIza).
        scrubbed = _ANTHROPIC_KEY_RE.sub(_REDACTED_KEY_PATTERN, value)
        scrubbed = _PROVIDER_KEY_RE.sub(_REDACTED_PROVIDER_KEY, scrubbed)
        return _OTHER_KEY_RE.sub(_REDACTED_PROVIDER_KEY, scrubbed)
    if isinstance(value, dict):
        return {k: _scrub_dict_field(k, v) for k, v in value.items()}
    if isinstance(value, list):
        return [_scrub_value(v) for v in value]
    if isinstance(value, tuple):
        return tuple(_scrub_value(v) for v in value)
    return value


def _scrub_dict_field(field_name: Any, value: Any) -> Any:
    """Redact by field name, then scrub the value for residual key patterns."""
    if isinstance(field_name, str) and field_name.lower() in _SENSITIVE_FIELD_NAMES:
        return _REDACTED_VALUE
    return _scrub_value(value)


def redact_keys(_logger: Any, _method: str, event_dict: dict) -> dict:
    """structlog processor — strip any Anthropic keys from a log event.

    Mutates event_dict in place AND returns it (structlog convention).
    """
    for k in list(event_dict.keys()):
        event_dict[k] = _scrub_dict_field(k, event_dict[k])
    return event_dict


def scrub_validation_errors(errors: list[dict]) -> list[dict]:
    """Redact the BYOK key from a RequestValidationError `.errors()` list before
    it is returned to the client (ADR-001 — the key must never leave our boundary
    except on the outbound Anthropic call).

    FastAPI's default 422 handler echoes the offending `input` (and sometimes
    `ctx`) back in the response body. On `/generate` a *missing-field* error sets
    `input` to the WHOLE request body — which contains the api_key — so the
    default handler hands the key straight back in the HTTP response. Each error
    is scrubbed two ways:

    - **loc-based** — if the error targets a sensitive field (its `loc` ends in
      `api_key`, `authorization`, …), `input`/`ctx` are redacted wholesale. This
      catches key formats the value-pattern scrubber can't (a too-short key that
      fails `min_length`, or a non-`sk-ant-` key).
    - **value-based** — otherwise `input`/`ctx` are run through `_scrub_value`,
      which redacts a whole-body dict's `api_key` by field name and any
      `sk-ant-` token by pattern.

    Returns a new list; the input is not mutated.
    """
    scrubbed: list[dict] = []
    for err in errors:
        e = dict(err)
        loc = e.get("loc") or ()
        field = loc[-1] if loc else None
        sensitive = isinstance(field, str) and field.lower() in _SENSITIVE_FIELD_NAMES
        for k in ("input", "ctx"):
            if k in e:
                e[k] = _REDACTED_VALUE if sensitive else _scrub_value(e[k])
        scrubbed.append(e)
    return scrubbed


# ── Logging configuration ─────────────────────────────────────────────────────


def configure_logging(level: str = "INFO") -> None:
    """Wire structlog with the redaction processor in the chain.

    Idempotent — safe to call multiple times.

    The `redact_keys` processor MUST appear in the chain. Any future change to
    this configuration that omits it is a security regression — the CI gate
    will catch it.
    """
    log_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
        force=True,
    )

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            redact_keys,  # ← MUST stay in the chain
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "studybuddy_q") -> structlog.stdlib.BoundLogger:
    """Convenience accessor — always returns a redaction-wired logger."""
    return structlog.get_logger(name)
