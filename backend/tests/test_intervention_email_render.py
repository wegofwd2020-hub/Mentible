"""Every intervention HTML template renders without error (regression: str.format KeyError on CSS braces)."""

import pytest

from backend.src.analytics.models import StallReason
from backend.src.email.html_templates import get_html_email_template, render_html_body

APP_URL = "https://mentible.app/"


@pytest.mark.parametrize("stall_reason", list(StallReason))
@pytest.mark.parametrize("attempt_count", [1, 2, 3, 4])
def test_every_template_renders(stall_reason, attempt_count):
    template = get_html_email_template(stall_reason, attempt_count)

    html = render_html_body(template.html_body, APP_URL)

    assert "{app_url}" not in html


def test_render_keeps_css_braces_intact():
    html = render_html_body('<style>body { margin: 0; }</style><a href="{app_url}">x</a>', APP_URL)

    assert "body { margin: 0; }" in html
    assert f'href="{APP_URL}"' in html
