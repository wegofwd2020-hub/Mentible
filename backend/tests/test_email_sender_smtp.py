"""SMTP sender: STARTTLS + login + message shape. No network: smtplib is faked."""

import smtplib
from typing import ClassVar

import pytest

from backend.config import settings
from backend.src.email import sender


class _FakeSMTP:
    instances: ClassVar[list] = []
    fail_login: ClassVar[bool] = False

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port
        self.calls = []
        self.sent = None
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(("login", user))
        if _FakeSMTP.fail_login:
            raise smtplib.SMTPAuthenticationError(535, b"bad credentials")

    def send_message(self, msg):
        self.calls.append("send_message")
        self.sent = msg


@pytest.fixture
def smtp_settings(monkeypatch):
    _FakeSMTP.instances = []
    _FakeSMTP.fail_login = False
    monkeypatch.setattr(sender.smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(settings, "email_provider", "smtp")
    monkeypatch.setattr(settings, "smtp_host", "smtp.gmail.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_user", "sender@example.com")
    monkeypatch.setattr(settings, "smtp_password", "not-a-real-password")
    monkeypatch.setattr(settings, "smtp_from", None)


async def test_smtp_sends_with_starttls_and_login(smtp_settings):
    ok = await sender.send_html_email(
        to="learner@example.com",
        subject="from Mentible: Hello",
        html_body="<p>hi</p>",
        reply_to="support@example.com",
    )

    assert ok is True
    smtp = _FakeSMTP.instances[0]
    assert (smtp.host, smtp.port) == ("smtp.gmail.com", 587)
    assert smtp.calls == ["starttls", ("login", "sender@example.com"), "send_message"]
    assert smtp.sent["To"] == "learner@example.com"
    assert smtp.sent["Subject"] == "from Mentible: Hello"
    assert smtp.sent["Reply-To"] == "support@example.com"
    assert smtp.sent["From"].endswith("<sender@example.com>")
    assert "Mentible" in smtp.sent["From"]


async def test_smtp_auth_failure_returns_false(smtp_settings):
    _FakeSMTP.fail_login = True

    ok = await sender.send_html_email(to="x@example.com", subject="s", html_body="<p>b</p>")

    assert ok is False


async def test_smtp_not_configured_returns_false_without_connecting(monkeypatch):
    monkeypatch.setattr(settings, "email_provider", "smtp")
    monkeypatch.setattr(settings, "smtp_user", None)
    monkeypatch.setattr(settings, "smtp_password", None)
    _FakeSMTP.instances = []
    monkeypatch.setattr(sender.smtplib, "SMTP", _FakeSMTP)

    ok = await sender.send_html_email(to="x@example.com", subject="s", html_body="<p>b</p>")

    assert ok is False
    assert _FakeSMTP.instances == []
