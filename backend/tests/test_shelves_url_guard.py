"""SSRF guard for the anonymous feed-fetch endpoint."""

from __future__ import annotations

import pytest

from backend.src.shelves.url_guard import BlockedUrlError, assert_fetchable


def resolver_returning(*ips: str):
    async def _resolve(host: str) -> list[str]:
        return list(ips)

    return _resolve


PUBLIC = resolver_returning("93.184.216.34")


@pytest.mark.asyncio
async def test_public_https_url_is_allowed():
    url = "https://m.gutenberg.org/ebooks/2701.opds"
    assert await assert_fetchable(url, PUBLIC) == url


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://m.gutenberg.org/f.opds",  # plaintext
        "file:///etc/passwd",
        "gopher://example.org/",
        "not a url",
        "",
    ],
)
async def test_non_https_or_malformed_is_rejected(url: str):
    with pytest.raises(BlockedUrlError):
        await assert_fetchable(url, PUBLIC)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",        # loopback
        "10.0.0.5",         # private
        "172.16.3.9",       # private
        "192.168.1.10",     # private
        "169.254.169.254",  # cloud metadata — the one that matters
        "::1",              # IPv6 loopback
        "fd00::1",          # IPv6 unique-local
        "fe80::1",          # IPv6 link-local
        "0.0.0.0",
    ],
)
async def test_hostname_resolving_to_a_private_ip_is_rejected(ip: str):
    """DNS rebinding: a public-looking hostname that resolves inside the network.

    This is the case the on-device guard structurally CANNOT catch.
    """
    with pytest.raises(BlockedUrlError) as exc:
        await assert_fetchable("https://evil.example.org/f.opds", resolver_returning(ip))
    assert exc.value.reason == "blocked_host"


@pytest.mark.asyncio
async def test_rejects_when_ANY_resolved_address_is_private():
    """A host resolving to both a public and a private address is still blocked."""
    mixed = resolver_returning("93.184.216.34", "127.0.0.1")
    with pytest.raises(BlockedUrlError):
        await assert_fetchable("https://evil.example.org/f.opds", mixed)


@pytest.mark.asyncio
async def test_literal_private_ip_host_is_rejected_without_dns():
    async def _explode(host: str) -> list[str]:
        raise AssertionError("must not resolve a literal IP")

    with pytest.raises(BlockedUrlError):
        await assert_fetchable("https://127.0.0.1/f.opds", _explode)


@pytest.mark.asyncio
async def test_unresolvable_host_is_rejected():
    async def _fail(host: str) -> list[str]:
        raise OSError("NXDOMAIN")

    with pytest.raises(BlockedUrlError):
        await assert_fetchable("https://nope.invalid/f.opds", _fail)
