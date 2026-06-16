"""BYOK key-redaction for structlog — re-export shim.

This module is security-critical. See ADR-001.

The implementation now lives in the shared `wegofwd-secure` package (ADR-019), so
the redaction logic has exactly ONE copy across the product family — a divergent
copy is, by definition, a leaked-key risk. This module preserves the original
import path (`backend.src.core.log_redaction`) and StudyBuddy's logger name.

The CI gate `tests/test_no_key_in_logs.py` still exercises every code path with a
known test key through these re-exports.
"""

from __future__ import annotations

from typing import Any

import structlog
from wegofwd_secure.redaction import (
    configure_logging,
    redact_keys,
    scrub_validation_errors,
)

__all__ = [
    "configure_logging",
    "get_logger",
    "redact_keys",
    "scrub_validation_errors",
]


def get_logger(name: str = "studybuddy_q") -> Any:
    """Convenience accessor — always returns a redaction-wired logger.

    Wraps the package accessor to keep StudyBuddy's default logger name.
    """
    return structlog.get_logger(name)
