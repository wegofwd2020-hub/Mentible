import httpx
import pytest

from backend.config import settings
from backend.src.feedback.email import send_feedback_email


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


_PAYLOAD = {
    "type": "bug",
    "company": "Acme",
    "role": "Founder",
    "contact_preference": "email_follow_up",
    "text": "the thing broke",
}


@pytest.mark.asyncio
async def test_send_posts_to_zeptomail_with_enczapikey_and_reply_to(monkeypatch):
    monkeypatch.setattr(settings, "zeptomail_token", "tok-123")
    monkeypatch.setattr(settings, "zeptomail_from", "feedback@kaundinyalabs.com")
    monkeypatch.setattr(settings, "feedback_to", "support@kaundinyalabs.com")

    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["json"] = request.read()
        return httpx.Response(201, json={"data": "ok"})

    ok = await send_feedback_email(
        name="Jane",
        email="jane@x.com",
        page="/trust/p1",
        payload=_PAYLOAD,
        http_client=_client(handler),
    )

    assert ok is True
    assert captured["url"] == "https://api.zeptomail.com/v1.1/email"
    assert captured["auth"] == "Zoho-enczapikey tok-123"
    body = captured["json"]
    assert b"feedback@kaundinyalabs.com" in body  # verified-domain from
    assert b"support@kaundinyalabs.com" in body  # to
    assert b"jane@x.com" in body  # reply_to = submitter
    assert b"the thing broke" in body
    # reply_to must be the FLAT {address,name} shape ZeptoMail requires — the
    # wrapped {email_address:{...}} shape 400s with "Parameter address missing".
    import json as _json

    reply_to = _json.loads(body)["reply_to"]
    assert reply_to == [{"address": "jane@x.com", "name": "Jane"}]


@pytest.mark.asyncio
async def test_no_token_means_no_send(monkeypatch):
    monkeypatch.setattr(settings, "zeptomail_token", None)
    called = {"n": 0}

    def handler(_):
        called["n"] += 1
        return httpx.Response(201)

    ok = await send_feedback_email(
        name="J", email="j@x.com", page="/", payload=_PAYLOAD, http_client=_client(handler)
    )
    assert ok is False and called["n"] == 0


@pytest.mark.asyncio
async def test_send_failure_is_best_effort_returns_false(monkeypatch):
    monkeypatch.setattr(settings, "zeptomail_token", "tok")
    ok = await send_feedback_email(
        name="J",
        email="j@x.com",
        page="/",
        payload=_PAYLOAD,
        http_client=_client(lambda _: httpx.Response(500, json={"error": "boom"})),
    )
    assert ok is False


@pytest.mark.asyncio
async def test_does_not_log_the_token(monkeypatch, capsys):
    monkeypatch.setattr(settings, "zeptomail_token", "SECRET-zepto-xyz")
    await send_feedback_email(
        name="J",
        email="j@x.com",
        page="/",
        payload=_PAYLOAD,
        http_client=_client(lambda _: httpx.Response(500)),
    )
    out = capsys.readouterr()
    assert "SECRET-zepto-xyz" not in (out.out + out.err)
