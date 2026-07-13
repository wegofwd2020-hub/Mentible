"""SSRF guard for the anonymous OPDS feed-fetch endpoint (ADR-028 web escape hatch).

The device-side guard (mobile/src/openshelves/fetchFeed.ts) can only reject literal
private-IP hosts: browser `fetch` never exposes the resolved address, so a public
hostname that resolves to 127.0.0.1 slips past it. Server-side we CAN resolve first,
and we must — an SSRF here reaches our internal network and the cloud metadata
endpoint (169.254.169.254), not just one user's LAN.

Residual, accepted: a TOCTOU window remains between our resolve and httpx's own
resolve at connect time. Closing it fully means pinning the connection to the
checked IP (custom transport + SNI juggling). The redirect re-check (feed_fetch.py)
and this pre-check block every practical bypass we know of; revisit if this endpoint
is ever exposed to untrusted volume.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

Resolver = Callable[[str], Awaitable[list[str]]]


class BlockedUrlError(ValueError):
    """The server refuses to fetch this URL."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.reason = reason


def _is_blocked_ip(raw: str) -> bool:
    try:
        ip = ipaddress.ip_address(raw)
    except ValueError:
        return True  # un-parseable address: refuse rather than guess
    return (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local  # includes 169.254.169.254
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


async def default_resolver(host: str) -> list[str]:
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    return [info[4][0] for info in infos]


async def assert_fetchable(url: str, resolve: Resolver) -> str:
    """Return `url` if the server may fetch it; else raise BlockedUrlError."""
    parts = urlsplit((url or "").strip())
    if parts.scheme != "https":
        raise BlockedUrlError("Feed URLs must use https.", "not_https")

    host = parts.hostname
    if not host:
        raise BlockedUrlError("That doesn't look like a valid URL.", "invalid_url")

    # A literal IP host needs no DNS — check it directly.
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if _is_blocked_ip(host):
            raise BlockedUrlError("That host isn't allowed.", "blocked_host")
        return url

    try:
        addresses = await resolve(host)
    except Exception as exc:  # NXDOMAIN, timeout, …
        raise BlockedUrlError("Could not reach that host.", "blocked_host") from exc

    if not addresses:
        raise BlockedUrlError("Could not reach that host.", "blocked_host")
    # ANY private address blocks the host — a split-horizon record must not slip through.
    if any(_is_blocked_ip(a) for a in addresses):
        raise BlockedUrlError("That host isn't allowed.", "blocked_host")
    return url
