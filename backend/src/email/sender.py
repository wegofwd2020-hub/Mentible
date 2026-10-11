"""Outgoing mail for intervention emails.

Provider is chosen by settings.email_provider:
- "zeptomail" (default): Zoho transactional HTTP API.
- "smtp": Gmail (or any STARTTLS SMTP host) with a login. Uses the standard
  library, run in a worker thread so the event loop is not blocked.

Never logs the SMTP password or the API token.
"""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

import httpx

from backend.config import settings
from backend.src.core.log_redaction import get_logger

log = get_logger(__name__)


async def send_html_email(
    *, to: str, subject: str, html_body: str, reply_to: str | None = None
) -> bool:
    """Send one HTML email. Returns True on provider acceptance, False otherwise."""
    if settings.email_provider == "smtp":
        return await asyncio.to_thread(_send_smtp, to, subject, html_body, reply_to)
    return await _send_zeptomail(to, subject, html_body, reply_to)


async def _send_zeptomail(to: str, subject: str, html_body: str, reply_to: str | None) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{settings.zeptomail_base_url}/email",
                headers={"Authorization": settings.zeptomail_token},
                json={
                    "from": {"address": settings.zeptomail_from, "name": "Mentible"},
                    "to": [{"email_address": {"address": to}}],
                    "subject": subject,
                    "htmlbody": html_body,
                    "reply_to": {"address": reply_to or settings.feedback_to},
                },
            )
    except Exception as e:  # network / DNS / TLS
        log.warning("zeptomail_send_exception", error=str(e))
        return False
    if resp.status_code != 200:
        log.warning("zeptomail_send_rejected", status=resp.status_code, body=resp.text[:200])
        return False
    return True


def _send_smtp(to: str, subject: str, html_body: str, reply_to: str | None) -> bool:
    if not settings.smtp_user or not settings.smtp_password:
        log.warning("smtp_send_not_configured")
        return False

    sender = settings.smtp_from or settings.smtp_user
    msg = EmailMessage()
    msg["From"] = formataddr(("Mentible", sender))
    msg["To"] = to
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content("This message is HTML. Open it in an HTML-capable mail client.")
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            smtp.starttls(context=ssl.create_default_context())
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log.warning("smtp_send_failed", error=str(e))
        return False
    return True
