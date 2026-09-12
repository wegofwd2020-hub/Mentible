from __future__ import annotations

import html
from pathlib import Path

import httpx

from backend.config import settings
from backend.src.core.log_redaction import get_logger
from backend.src.email.zepto import zepto_auth_header

log = get_logger("email.welcome")

_TIMEOUT = httpx.Timeout(8.0)
_TEMPLATE_PATH = Path(__file__).parent / "templates" / "welcome.html"

# Loaded once at import — the template is a static asset packaged with the backend.
_TEMPLATE = _TEMPLATE_PATH.read_text(encoding="utf-8")


def render_welcome_html(name: str | None) -> str:
    """Fill the welcome template's greeting. A name personalizes it
    ("Welcome, Jane — you're in."); no name falls back to the neutral greeting.
    The name is HTML-escaped — it lands inside markup."""
    clean = (name or "").strip()
    greeting = (
        f"Welcome, {html.escape(clean)} — you&rsquo;re in."
        if clean
        else "Welcome — you&rsquo;re in."
    )
    return _TEMPLATE.replace("{{GREETING}}", greeting)


async def send_welcome_email(
    *,
    to: str,
    name: str | None,
    http_client: httpx.AsyncClient | None = None,
) -> tuple[bool, str]:
    """Send the welcome email to `to` via ZeptoMail. Admin-triggered (not
    best-effort like feedback), so it returns (sent, detail) rather than a bare
    bool — the caller surfaces the reason. NEVER raises, NEVER logs the token.
    `from` MUST be on the ZeptoMail-verified domain (settings.welcome_from)."""
    token = settings.zeptomail_token
    if not token:
        return False, "email is not configured (no ZeptoMail token)"

    message = {
        "from": {"address": settings.welcome_from, "name": "Mentible"},
        "to": [{"email_address": {"address": to}}],
        "subject": "Welcome to Mentible",
        "htmlbody": render_welcome_html(name),
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
            log.warning("welcome_email_failed", status=resp.status_code)
            return False, f"email provider returned {resp.status_code}"
        return True, "sent"
    except httpx.HTTPError:
        log.warning("welcome_email_transport_error")
        return False, "email provider unreachable"
    finally:
        if own_client:
            await client.aclose()
