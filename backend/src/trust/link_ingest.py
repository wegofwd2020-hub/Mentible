"""Fetch a `link` trust source and extract its readable text.

A `link` input used to store only the URL, so the generator had no text to
ground on and silently omitted the section (see the "invent nothing" rule in
topic_prompt.py). This module resolves the URL once, at input creation, and
returns the page's visible text, which the router stores as the input content.

Hardening (the URL is user-supplied, so treat it as hostile):
- http/https only; no userinfo in the URL.
- Every host (including each redirect hop) must resolve to public addresses.
  Private, loopback, link-local (incl. cloud metadata 169.254.x), CGNAT and
  reserved ranges are refused.
- Redirects are followed manually, max 3 hops, each re-validated.
- 10 s timeout, 2 MB body cap, text/html or text/plain only.
- Error messages never echo the URL or the page body.

DNS rebinding: the address check runs inside the connect itself
(`_PinnedPublicBackend.connect_tcp`). It resolves the host once, refuses the
connection if any address is non-public, and dials only a validated IP. The
name is never looked up a second time, so a hostile DNS answer cannot swap in
a private address. TLS still verifies the certificate against the original
hostname (httpcore's default SNI), so HTTPS stays correct.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx

# Private import: httpx 0.27 exposes no public hook for a network backend, and
# the default backend is the one httpx itself would use. Pinned with httpcore 1.0.9.
from httpcore._backends.auto import AutoBackend

MAX_BYTES = 2_000_000
MAX_CHARS = 150_000
MAX_REDIRECTS = 3
_TIMEOUT = httpx.Timeout(10.0)
FETCH_DEADLINE_S = 15.0  # total budget across redirects + body read
_ALLOWED_TYPES = ("text/html", "text/plain")
_USER_AGENT = "Mentible-SourceIngest/1.0"

_SKIP_TAGS = frozenset(
    {
        "script",
        "style",
        "noscript",
        "template",
        "svg",
        "iframe",
        "head",
        "nav",
        "header",
        "footer",
        "form",
    }
)
_BLOCK_TAGS = frozenset(
    {
        "p", "div", "br", "li", "ul", "ol", "tr", "table", "section", "article",
        "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "dt", "dd", "hr",
    }
)  # fmt: skip


class LinkIngestError(ValueError):
    """The link cannot become source text. The message is safe to show the user."""


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip = 0
        self._parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self._skip += 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS:
            if self._skip:
                self._skip -= 1
        elif tag in _BLOCK_TAGS:
            self._parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self._parts.append(data)

    def text(self) -> str:
        return "".join(self._parts)


def extract_text(html: str) -> str:
    """HTML -> visible text, one block per line, blank lines collapsed."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return _normalise(parser.text())


def _normalise(raw: str) -> str:
    lines: list[str] = []
    blank = False
    for line in raw.splitlines():
        cleaned = " ".join(line.split())
        if not cleaned:
            if lines and not blank:
                lines.append("")
            blank = True
            continue
        blank = False
        lines.append(cleaned)
    return "\n".join(lines).strip()


_BARE_URL = re.compile(r"https?://\S+")


def is_unresolved_link(source) -> bool:
    """True for a `link` input that never got page text.

    Covers legacy rows (content is the bare URL, stored before ingest existed)
    and rows with empty content. Such a source must fail generation rather than
    be silently omitted from the draft.
    """
    if getattr(source, "kind", None) != "link":
        return False
    text = (source.content or "").strip()
    return not text or _BARE_URL.fullmatch(text) is not None


def unresolved_link_message(sources) -> str | None:
    """User-facing failure message naming the links to re-add, or None if all resolved."""
    bad = [s for s in sources if is_unresolved_link(s)]
    if not bad:
        return None
    names = ", ".join(f'"{s.title or "untitled link"}"' for s in bad)
    return (
        f"Couldn't read link source(s) {names}. Remove and re-add them so their page text "
        "can be fetched, then generate again."
    )


def _assert_public(ip_text: str) -> None:
    ip = ipaddress.ip_address(ip_text)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if not ip.is_global or ip.is_multicast:
        raise LinkIngestError("link points to a non-public address")


def _literal_ip(host: str) -> str | None:
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None


async def _resolve_public(host: str) -> list[str]:
    """Resolve `host` once and return its addresses, all of which must be public."""
    literal = _literal_ip(host)
    if literal is not None:
        _assert_public(literal)
        return [literal]
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise LinkIngestError("could not resolve the link's host") from e
    addresses = [info[4][0] for info in infos]
    if not addresses:
        raise LinkIngestError("could not resolve the link's host")
    for address in addresses:
        _assert_public(address)  # any private answer refuses the whole host
    return addresses


class _PinnedPublicBackend(httpcore.AsyncNetworkBackend):
    """Connect-time SSRF guard: resolve, validate, then dial a validated IP only.

    httpcore calls `connect_tcp` for every new connection (and so for every
    redirect hop). The lookup and the dial happen here, once, so there is no
    window between check and connect for DNS to change the answer.
    """

    def __init__(self, *, inner=None, resolve=_resolve_public) -> None:
        self._inner = inner or AutoBackend()
        self._resolve = resolve

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ):
        last_error: Exception | None = None
        for address in await self._resolve(host):
            try:
                return await self._inner.connect_tcp(
                    address,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as e:
                last_error = e  # try the next validated address
        raise last_error or httpcore.ConnectError("no address to connect to")

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):
        raise httpcore.ConnectError("unix sockets are not allowed for link fetches")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class _PinnedPublicTransport(httpx.AsyncHTTPTransport):
    """httpx transport whose connection pool uses `_PinnedPublicBackend`."""

    def __init__(self, backend: _PinnedPublicBackend) -> None:
        super().__init__(trust_env=False)
        # httpx 0.27 builds its own pool with no backend argument. Replace it with
        # one that uses ours, keeping the same certificate verification.
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(trust_env=False),
            network_backend=backend,
        )


def _make_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=_PinnedPublicTransport(_PinnedPublicBackend()),
        timeout=_TIMEOUT,
        follow_redirects=False,
        trust_env=False,
    )


async def _validate_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise LinkIngestError("only http and https links can be read")
    if not parts.hostname:
        raise LinkIngestError("link has no host")
    if parts.username is not None or parts.password is not None:
        raise LinkIngestError("links with embedded credentials are not supported")
    # Literal IPs are refused up front. Hostnames are checked at connect time.
    if _literal_ip(parts.hostname) is not None:
        _assert_public(parts.hostname)


async def fetch_link_text(url: str) -> str:
    """Return the readable text of `url`, or raise LinkIngestError.

    Always uses the pinned client: there is no caller-supplied client, so the
    connect-time address guard cannot be bypassed from outside this module.
    Wraps the whole fetch (all redirect hops and the body read) in one deadline,
    so a slow-drip response cannot hold the request open past FETCH_DEADLINE_S.
    """
    try:
        async with asyncio.timeout(FETCH_DEADLINE_S):
            return await _fetch_link_text(url)
    except TimeoutError as e:
        raise LinkIngestError("link took too long to read") from e


async def _fetch_link_text(url: str) -> str:
    current = url.strip()
    # trust_env=False (in _make_client): proxy env vars cannot route past the address guard.
    client = _make_client()
    try:
        for _hop in range(MAX_REDIRECTS + 1):
            await _validate_url(current)
            try:
                async with client.stream(
                    "GET",
                    current,
                    # identity only: we cap the raw bytes, so a compressed body could expand past the cap.
                    headers={
                        "User-Agent": _USER_AGENT,
                        "Accept": "text/html,text/plain;q=0.9",
                        "Accept-Encoding": "identity",
                    },
                ) as resp:
                    if resp.status_code in (301, 302, 303, 307, 308):
                        location = resp.headers.get("location")
                        if not location:
                            raise LinkIngestError("link redirected without a target")
                        current = urljoin(current, location)
                        continue
                    if resp.status_code >= 400:
                        raise LinkIngestError(f"link returned HTTP {resp.status_code}")
                    ctype = resp.headers.get("content-type", "").split(";")[0].strip().lower()
                    if ctype not in _ALLOWED_TYPES:
                        raise LinkIngestError("link is not an HTML or plain-text page")
                    encoding = resp.headers.get("content-encoding", "identity").strip().lower()
                    if encoding not in ("", "identity"):
                        raise LinkIngestError("link sent a compressed body, which is not supported")
                    declared = resp.headers.get("content-length")
                    if declared is not None and declared.isdigit() and int(declared) > MAX_BYTES:
                        raise LinkIngestError("page is too large to ingest")
                    body = bytearray()
                    async for chunk in resp.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            raise LinkIngestError("page is too large to ingest")
                    charset = resp.charset_encoding or "utf-8"
            except httpx.HTTPError as e:
                raise LinkIngestError("could not fetch link") from e
            try:
                decoded = bytes(body).decode(charset, errors="replace")
            except LookupError:
                decoded = bytes(body).decode("utf-8", errors="replace")
            text = extract_text(decoded) if ctype == "text/html" else _normalise(decoded)
            if not text:
                raise LinkIngestError("link has no readable text")
            return text[:MAX_CHARS]
        raise LinkIngestError("too many redirects")
    finally:
        await client.aclose()
