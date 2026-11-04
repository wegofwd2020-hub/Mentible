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

Known limit: the DNS check and the connect are two steps, so a hostile DNS
server could rebind between them. Closing that needs connecting to the
pre-resolved IP, which is a follow-up.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

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


async def _assert_public_host(host: str) -> None:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        _assert_public(host)
        return
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM)
    except socket.gaierror as e:
        raise LinkIngestError("could not resolve the link's host") from e
    if not infos:
        raise LinkIngestError("could not resolve the link's host")
    for info in infos:
        _assert_public(info[4][0])


async def _validate_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise LinkIngestError("only http and https links can be read")
    if not parts.hostname:
        raise LinkIngestError("link has no host")
    if parts.username is not None or parts.password is not None:
        raise LinkIngestError("links with embedded credentials are not supported")
    await _assert_public_host(parts.hostname)


async def fetch_link_text(url: str, *, http_client: httpx.AsyncClient | None = None) -> str:
    """Return the readable text of `url`, or raise LinkIngestError.

    Wraps the whole fetch (all redirect hops and the body read) in one deadline,
    so a slow-drip response cannot hold the request open past FETCH_DEADLINE_S.
    """
    try:
        async with asyncio.timeout(FETCH_DEADLINE_S):
            return await _fetch_link_text(url, http_client=http_client)
    except TimeoutError as e:
        raise LinkIngestError("link took too long to read") from e


async def _fetch_link_text(url: str, *, http_client: httpx.AsyncClient | None) -> str:
    current = url.strip()
    owns_client = http_client is None
    # trust_env=False: proxy env vars must not redirect the fetch past our address checks.
    client = http_client or httpx.AsyncClient(
        timeout=_TIMEOUT, follow_redirects=False, trust_env=False
    )
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
        if owns_client:
            await client.aclose()
