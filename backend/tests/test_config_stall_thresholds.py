"""Test stall detection configuration loading."""

import os
import pytest


def test_stall_thresholds_loaded_from_env(monkeypatch):
    """Stall thresholds are loaded from environment variables."""
    # Clear any cached settings
    monkeypatch.delenv("STALL_THRESHOLD_DISCOVER_JOIN", raising=False)
    monkeypatch.delenv("STALL_THRESHOLD_CREATE_FIRST_VALUE", raising=False)
    monkeypatch.delenv("STALL_THRESHOLD_REFINE_VALIDATE", raising=False)
    monkeypatch.delenv("STALL_THRESHOLD_FINISH_PAY", raising=False)
    monkeypatch.delenv("STALL_THRESHOLD_RETURN_ADVOCATE", raising=False)

    # Set custom thresholds
    monkeypatch.setenv("STALL_THRESHOLD_DISCOVER_JOIN", "6")
    monkeypatch.setenv("STALL_THRESHOLD_CREATE_FIRST_VALUE", "8")
    monkeypatch.setenv("STALL_THRESHOLD_REFINE_VALIDATE", "12")
    monkeypatch.setenv("STALL_THRESHOLD_FINISH_PAY", "15")
    monkeypatch.setenv("STALL_THRESHOLD_RETURN_ADVOCATE", "20")

    # Re-import to get fresh settings
    import importlib
    import backend.config as config_module
    importlib.reload(config_module)
    settings = config_module.settings

    assert settings.stall_threshold_discover_join == 6
    assert settings.stall_threshold_create_first_value == 8
    assert settings.stall_threshold_refine_validate == 12
    assert settings.stall_threshold_finish_pay == 15
    assert settings.stall_threshold_return_advocate == 20


def test_stall_thresholds_dict_property():
    """stall_thresholds property returns a dict keyed by stage name."""
    from backend.config import settings

    thresholds = settings.stall_thresholds
    assert isinstance(thresholds, dict)
    assert "discover_join" in thresholds
    assert "create_first_value" in thresholds
    assert "refine_validate" in thresholds
    assert "finish_pay" in thresholds
    assert "return_advocate" in thresholds

    # All values are positive integers
    for stage, threshold in thresholds.items():
        assert isinstance(threshold, int), f"{stage} threshold is not an int"
        assert threshold > 0, f"{stage} threshold must be positive, got {threshold}"


def test_stall_pattern_thresholds():
    """Pattern-based stall thresholds are configured."""
    from backend.config import settings

    assert settings.stall_generation_loop_count >= 1
    assert isinstance(settings.stall_generation_loop_zero_saves, bool)
    assert settings.max_intervention_attempts >= 1
    assert settings.intervention_retry_interval_days >= 1
