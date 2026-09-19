"""Tests for InterventionService (sub-project 3)."""

import pytest
from backend.src.analytics.models import StallReason
from backend.src.analytics.intervention import STALL_REASON_TEMPLATES, InterventionService


def test_template_exists_for_each_stall_reason():
    """Every StallReason has a corresponding template."""
    for reason in StallReason:
        assert reason in STALL_REASON_TEMPLATES or reason == StallReason.UNKNOWN, \
            f"Missing template for {reason}"


def test_each_template_has_required_fields():
    """Each template has subject and body."""
    for reason, template in STALL_REASON_TEMPLATES.items():
        assert "subject" in template, f"Template {reason} missing subject"
        assert "body" in template, f"Template {reason} missing body"
        assert len(template["subject"]) > 0, f"Template {reason} has empty subject"
        assert len(template["body"]) > 0, f"Template {reason} has empty body"
        assert "{app_url}" in template["body"], f"Template {reason} missing {{app_url}} placeholder"


def test_template_subjects_are_distinct():
    """Each template has a unique subject."""
    subjects = [t["subject"] for t in STALL_REASON_TEMPLATES.values()]
    assert len(subjects) == len(set(subjects)), "Duplicate template subjects found"


def test_template_bodies_mention_stall_reason_context():
    """Templates are contextual to the stall reason."""
    # no_meaningful_action mentions saving/approving
    assert "save" in STALL_REASON_TEMPLATES[StallReason.NO_MEANINGFUL_ACTION]["body"].lower()
    # invite_unresponded mentions reviewers
    assert "review" in STALL_REASON_TEMPLATES[StallReason.INVITE_UNRESPONDED]["body"].lower()
    # payment_incomplete mentions checkout
    assert "checkout" in STALL_REASON_TEMPLATES[StallReason.PAYMENT_INCOMPLETE]["body"].lower()


def test_unknown_stall_reason_uses_fallback():
    """UNKNOWN stall reason has a generic template."""
    template = STALL_REASON_TEMPLATES[StallReason.UNKNOWN]
    assert "paused" in template["body"].lower()
    assert "help" in template["body"].lower()


def test_all_templates_include_call_to_action():
    """Each template includes a link/CTA."""
    for reason, template in STALL_REASON_TEMPLATES.items():
        combined = (template["subject"] + template["body"]).lower()
        assert "mentible" in combined or "open" in combined or "checkout" in combined or "resume" in combined, \
            f"Template {reason} missing clear CTA"
