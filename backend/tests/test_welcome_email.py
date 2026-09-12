import httpx
import pytest

from backend.config import settings
from backend.src.email.welcome import render_welcome_html, send_welcome_email


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_render_personalizes_greeting_and_escapes_name():
    with_name = render_welcome_html("Jane")
    assert "Welcome, Jane" in with_name
    assert "{{GREETING}}" not in with_name
    # a hostile name is HTML-escaped (it lands inside markup)
    assert "&lt;script&gt;" in render_welcome_html("<script>")


def test_render_falls_back_to_neutral_greeting():
    html = render_welcome_html(None)
    assert "Welcome —" in html or "Welcome &" in html  # em-dash neutral greeting
    assert "Welcome," not in html
    assert render_welcome_html("   ") == html  # whitespace-only == no name


@pytest.mark.asyncio
async def test_send_posts_to_zeptomail_from_welcome_sender(monkeypatch):
    monkeypatch.setattr(settings, "zeptomail_token", "tok-123")
    monkeypatch.setattr(settings, "welcome_from", "hello@kaundinyalabs.com")

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["json"] = request.read()
        return httpx.Response(201, json={"data": "ok"})

    sent, detail = await send_welcome_email(
        to="new@x.com", name="Jane", http_client=_client(handler)
    )

    assert sent is True and detail == "sent"
    assert captured["url"] == "https://api.zeptomail.com/v1.1/email"
    assert captured["auth"] == "Zoho-enczapikey tok-123"
    body = captured["json"]
    assert b"hello@kaundinyalabs.com" in body  # welcome sender
    assert b"new@x.com" in body  # recipient
    assert b"Welcome, Jane" in body  # personalized body


@pytest.mark.asyncio
async def test_no_token_returns_false_with_reason(monkeypatch):
    monkeypatch.setattr(settings, "zeptomail_token", None)
    called = {"n": 0}

    def handler(_):
        called["n"] += 1
        return httpx.Response(201)

    sent, detail = await send_welcome_email(to="x@y.z", name=None, http_client=_client(handler))
    assert sent is False and "not configured" in detail and called["n"] == 0


@pytest.mark.asyncio
async def test_provider_error_returns_false_with_status(monkeypatch):
    monkeypatch.setattr(settings, "zeptomail_token", "tok")
    sent, detail = await send_welcome_email(
        to="x@y.z",
        name=None,
        http_client=_client(lambda _: httpx.Response(500, json={"e": "boom"})),
    )
    assert sent is False and "500" in detail


@pytest.mark.asyncio
async def test_does_not_log_the_token(monkeypatch, capsys):
    monkeypatch.setattr(settings, "zeptomail_token", "SECRET-welcome-xyz")
    await send_welcome_email(
        to="x@y.z", name=None, http_client=_client(lambda _: httpx.Response(500))
    )
    out = capsys.readouterr()
    assert "SECRET-welcome-xyz" not in (out.out + out.err)
