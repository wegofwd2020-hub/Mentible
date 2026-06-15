"""Tests for the system-owner principal — ADR-018 D1/D6.

Covers: the owner identity accessor, constant-time secret verification (fail
closed), config fail-fast on a missing/short secret, and that the owner secret
is redacted from logs by field name.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from backend.config import Settings
from backend.src.core.log_redaction import redact_keys
from backend.src.core.system_owner import owner_id, verify_owner_secret

# Matches conftest's os.environ.setdefault("SYSTEM_OWNER_SECRET", "1" * 64).
_TEST_OWNER_SECRET = "1" * 64


def test_owner_id_is_exposed():
    assert owner_id() == "mentible-system-owner"


def test_verify_owner_secret_accepts_the_configured_secret():
    assert verify_owner_secret(_TEST_OWNER_SECRET) is True


@pytest.mark.parametrize("bad", ["", None, "0" * 64, "1" * 63, " " + "1" * 63])
def test_verify_owner_secret_fails_closed(bad):
    assert verify_owner_secret(bad) is False


def test_config_requires_a_64_hex_owner_secret():
    # Too short → ValidationError (fail-fast at startup, ADR-018 D1).
    with pytest.raises(ValidationError):
        Settings(byok_master_key="0" * 64, system_owner_secret="short")
    # Well-formed → accepted.
    s = Settings(byok_master_key="0" * 64, system_owner_secret="a" * 64)
    assert s.system_owner_secret == "a" * 64


def test_owner_secret_is_redacted_in_logs():
    event = redact_keys(
        None, "info", {"event": "owner_action", "system_owner_secret": _TEST_OWNER_SECRET}
    )
    assert event["system_owner_secret"] == "<redacted>"
    # The real secret value must not survive anywhere in the event dict.
    assert _TEST_OWNER_SECRET not in repr(event)
