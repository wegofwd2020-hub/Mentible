from __future__ import annotations

_PREFIX = "Zoho-enczapikey"


def normalize_zepto_token(token: str) -> str:
    """Return the bare ZeptoMail Send-Mail token.

    ZeptoMail's Authorization header is ``Zoho-enczapikey <token>``. A very common
    setup mistake is to paste the WHOLE header value into ``ZEPTOMAIL_TOKEN`` — so
    the stored value already starts with ``Zoho-enczapikey ``. Our senders prepend
    the scheme themselves, which would then double it (``Zoho-enczapikey
    Zoho-enczapikey <token>``) and ZeptoMail rejects it with an opaque HTTP 500.

    Strip a leading scheme (and surrounding whitespace) so the token is used
    correctly whether the env var holds the bare token or the full header value.
    """
    t = token.strip()
    if t.startswith(_PREFIX):
        t = t[len(_PREFIX) :].strip()
    return t


def zepto_auth_header(token: str) -> str:
    """The full ``Authorization`` header value for a ZeptoMail request."""
    return f"{_PREFIX} {normalize_zepto_token(token)}"
