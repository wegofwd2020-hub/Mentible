"""Tests for InterventionService (sub-project 3)."""

import pytest
from backend.src.analytics.models import StallReason
from backend.src.analytics.intervention import InterventionService
from backend.src.email.html_templates import (
    REMINDER_1_TEMPLATES,
    REMINDER_2_TEMPLATES,
    REMINDER_3_TEMPLATES,
    get_html_email_template,
)


def test_html_template_exists_for_each_stall_reason():
    """Every StallReason has HTML templates for all 3 tiers."""
    for tier, templates in [
        (1, REMINDER_1_TEMPLATES),
        (2, REMINDER_2_TEMPLATES),
        (3, REMINDER_3_TEMPLATES),
    ]:
        for reason in StallReason:
            assert reason in templates, f"Tier {tier}: missing template for {reason}"


def test_html_template_has_required_fields():
    """Each HTML template has subject and html_body."""
    for tier, templates in [
        (1, REMINDER_1_TEMPLATES),
        (2, REMINDER_2_TEMPLATES),
        (3, REMINDER_3_TEMPLATES),
    ]:
        for reason, template in templates.items():
            assert template.subject, f"Tier {tier}, {reason}: empty subject"
            assert template.html_body, f"Tier {tier}, {reason}: empty html_body"
            # Either has app_url placeholder OR mailto link for support
            has_app_url = "{app_url}" in template.html_body
            has_support_link = "mailto:" in template.html_body
            assert has_app_url or has_support_link, (
                f"Tier {tier}, {reason}: missing CTA placeholder"
            )
            assert "<!DOCTYPE html>" in template.html_body, (
                f"Tier {tier}, {reason}: missing HTML structure"
            )


def test_html_template_subjects_distinct_per_tier():
    """Subjects are unique within each tier."""
    for tier, templates in [
        (1, REMINDER_1_TEMPLATES),
        (2, REMINDER_2_TEMPLATES),
        (3, REMINDER_3_TEMPLATES),
    ]:
        subjects = [t.subject for t in templates.values()]
        assert len(subjects) == len(set(subjects)), (
            f"Tier {tier}: duplicate subjects found"
        )


def test_html_templates_contextual_to_stall_reason():
    """Templates reference the stall reason."""
    # Tier 1: gentle nudge
    assert "draft" in REMINDER_1_TEMPLATES[StallReason.NO_MEANINGFUL_ACTION].html_body.lower()
    assert "review" in REMINDER_1_TEMPLATES[StallReason.INVITE_UNRESPONDED].html_body.lower()
    assert "checkout" in REMINDER_1_TEMPLATES[StallReason.PAYMENT_INCOMPLETE].html_body.lower()

    # Tier 2: escalation
    assert "stuck" in REMINDER_2_TEMPLATES[StallReason.NO_MEANINGFUL_ACTION].html_body.lower()


def test_html_unknown_stall_reason_fallback():
    """UNKNOWN stall reason has a generic HTML template."""
    template = REMINDER_1_TEMPLATES[StallReason.UNKNOWN]
    assert "paused" in template.html_body.lower()
    assert "help" in template.html_body.lower()


def test_all_html_templates_include_cta():
    """All HTML templates include a CTA link."""
    for tier, templates in [
        (1, REMINDER_1_TEMPLATES),
        (2, REMINDER_2_TEMPLATES),
        (3, REMINDER_3_TEMPLATES),
    ]:
        for reason, template in templates.items():
            combined = (template.subject + template.html_body).lower()
            assert ("href" in template.html_body and "app_url" in template.html_body) or \
                   "mailto" in template.html_body, \
                   f"Tier {tier}, {reason}: missing CTA link"


def test_get_html_email_template_by_attempt():
    """get_html_email_template returns correct tier."""
    for attempt, expected_templates in [
        (1, REMINDER_1_TEMPLATES),
        (2, REMINDER_2_TEMPLATES),
        (3, REMINDER_3_TEMPLATES),
    ]:
        template = get_html_email_template(StallReason.NO_MEANINGFUL_ACTION, attempt)
        expected = expected_templates[StallReason.NO_MEANINGFUL_ACTION]
        assert template.subject == expected.subject
        assert template.html_body == expected.html_body
