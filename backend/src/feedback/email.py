from __future__ import annotations

import html

import httpx

from backend.config import settings
from backend.src.core.log_redaction import get_logger
from backend.src.email.zepto import zepto_auth_header

log = get_logger("feedback.email")

_TIMEOUT = httpx.Timeout(8.0)


def _body_html(*, name: str, email: str, page: str, payload: dict) -> str:
    rows = {
        "From": f"{name} <{email}>",
        "Page": page,
        "Type": payload.get("type"),
        "Company": payload.get("company") or "—",
        "Role": payload.get("role") or "—",
        "Contact preference": payload.get("contact_preference"),
    }
    meta = "".join(
        f"<p><b>{html.escape(k)}:</b> {html.escape(str(v))}</p>" for k, v in rows.items()
    )
    text = html.escape(payload.get("text") or "").replace("\n", "<br>")
    return f"{meta}<hr><p>{text}</p>"


async def send_feedback_email(
    *,
    name: str,
    email: str,
    page: str,
    payload: dict,
    http_client: httpx.AsyncClient | None = None,
) -> bool:
    """Email a feedback submission to the support inbox via ZeptoMail. BEST-EFFORT:
    returns False (never raises) if unconfigured or the send fails — the DB row is
    the primary, durable record. `from` must be on the ZeptoMail-verified domain;
    the submitter's address goes in Reply-To. NEVER logs the token."""
    token = settings.zeptomail_token
    if not token:
        return False

    message = {
        "from": {"address": settings.zeptomail_from, "name": "Mentible Feedback"},
        "to": [{"email_address": {"address": settings.feedback_to}}],
        "reply_to": [{"email_address": {"address": email, "name": name}}],
        "subject": f"[mentible] feedback — {page}",
        "htmlbody": _body_html(name=name, email=email, page=page, payload=payload),
    }
    client = http_client or httpx.AsyncClient(timeout=_TIMEOUT)
    own_client = http_client is None
    try:
        resp = await client.post(
            f"{settings.zeptomail_base_url.rstrip('/')}/email",
            headers={
                "Authorization": zepto_auth_header(token),
                "Content-Type": "application/json",
            },
            json=message,
        )
        if resp.status_code >= 400:
            log.warning("feedback_email_failed", status=resp.status_code)
            return False
        return True
    except httpx.HTTPError:
        log.warning("feedback_email_transport_error")
        return False
    finally:
        if own_client:
            await client.aclose()
