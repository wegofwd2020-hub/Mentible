"""Link source ingest: HTML->text extraction and SSRF / size / type guards."""

from __future__ import annotations

import httpx
import pytest

from backend.src.trust import link_ingest
from backend.src.trust.link_ingest import LinkIngestError, extract_text, fetch_link_text

PUBLIC = "https://93.184.216.34/page"  # IP literal, public: no DNS in tests


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_extract_text_drops_script_style_nav_and_keeps_blocks():
    html = (
        "<html><head><title>T</title><style>p{}</style></head><body>"
        "<nav>Menu links</nav><script>var x=1;</script>"
        "<h1>RAG</h1><p>Retrieval &amp; generation.</p><p>Second   para.</p>"
        "<footer>copyright</footer></body></html>"
    )
    text = extract_text(html)
    assert "Menu links" not in text
    assert "var x" not in text
    assert "copyright" not in text
    assert "RAG" in text
    assert "Retrieval & generation." in text
    assert "Second para." in text
    assert "\n" in text  # block boundaries survive


def test_extract_text_empty_page_is_empty():
    assert extract_text("<html><body><script>a()</script></body></html>") == ""


@pytest.mark.asyncio
async def test_fetch_returns_extracted_text():
    def handler(request):
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            content=b"<html><body><p>Vector stores hold embeddings.</p></body></html>",
        )

    text = await fetch_link_text(PUBLIC, http_client=_client(handler))
    assert text == "Vector stores hold embeddings."


@pytest.mark.asyncio
async def test_plain_text_passes_through():
    def handler(request):
        return httpx.Response(
            200, headers={"content-type": "text/plain"}, content=b"line one\n\nline two"
        )

    assert await fetch_link_text(PUBLIC, http_client=_client(handler)) == "line one\n\nline two"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/admin",
        "http://10.0.0.5/",
        "http://169.254.169.254/latest/meta-data/",
        "http://100.64.0.1/",  # CGNAT
        "http://[::1]/",
        "http://[::ffff:10.1.2.3]/",  # IPv4-mapped private
        "file:///etc/passwd",
        "ftp://93.184.216.34/x",
        "https://user:pw@93.184.216.34/",
    ],
)
async def test_non_public_or_unsafe_urls_refused_before_any_request(url):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=b"x")

    with pytest.raises(LinkIngestError):
        await fetch_link_text(url, http_client=_client(handler))
    assert calls == []


@pytest.mark.asyncio
async def test_redirect_to_private_address_is_refused():
    def handler(request):
        return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})

    with pytest.raises(LinkIngestError, match="non-public"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_redirect_chain_within_limit_followed():
    def handler(request):
        if request.url.path == "/page":
            return httpx.Response(301, headers={"location": "/final"})
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"landed")

    assert await fetch_link_text(PUBLIC, http_client=_client(handler)) == "landed"


@pytest.mark.asyncio
async def test_too_many_redirects_refused():
    def handler(request):
        return httpx.Response(302, headers={"location": "/loop"})

    with pytest.raises(LinkIngestError, match="too many redirects"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_http_error_status_refused():
    def handler(request):
        return httpx.Response(404, headers={"content-type": "text/html"}, content=b"nope")

    with pytest.raises(LinkIngestError, match="HTTP 404"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_non_text_content_type_refused():
    def handler(request):
        return httpx.Response(200, headers={"content-type": "application/pdf"}, content=b"%PDF")

    with pytest.raises(LinkIngestError, match="not an HTML or plain-text"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_oversized_body_refused(monkeypatch):
    monkeypatch.setattr(link_ingest, "MAX_BYTES", 100)

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"a" * 500)

    with pytest.raises(LinkIngestError, match="too large"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_page_with_no_visible_text_refused():
    def handler(request):
        return httpx.Response(
            200, headers={"content-type": "text/html"}, content=b"<html><script>x()</script></html>"
        )

    with pytest.raises(LinkIngestError, match="no readable text"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_transport_error_message_does_not_leak_url():
    def handler(request):
        raise httpx.ConnectError("boom " + str(request.url))

    with pytest.raises(LinkIngestError) as exc:
        await fetch_link_text(PUBLIC, http_client=_client(handler))
    assert "93.184.216.34" not in str(exc.value)


# --- generation-time guard: legacy / empty link sources must fail, not vanish ---

from types import SimpleNamespace  # noqa: E402

from backend.src.trust.link_ingest import is_unresolved_link, unresolved_link_message  # noqa: E402


def _src(kind, content, title=None, source_ref=None):
    return SimpleNamespace(kind=kind, content=content, title=title, source_ref=source_ref)


def test_legacy_url_only_link_is_unresolved():
    assert is_unresolved_link(
        _src("link", "https://example.com/rag", source_ref="https://example.com/rag")
    )


def test_empty_link_is_unresolved():
    assert is_unresolved_link(_src("link", "   "))


def test_extracted_link_text_is_resolved():
    assert not is_unresolved_link(
        _src("link", "Vector stores hold embeddings.\nRetrieval ranks chunks.")
    )


def test_note_and_transcript_never_unresolved():
    assert not is_unresolved_link(_src("note", "https://example.com"))
    assert not is_unresolved_link(_src("transcript", ""))


def test_message_names_only_bad_links_and_none_when_clean():
    good = _src("link", "Real page text here.", title="Good")
    bad = _src("link", "https://x.example/a", title="RAG intro")
    assert unresolved_link_message([good]) is None
    msg = unresolved_link_message([good, bad])
    assert '"RAG intro"' in msg and '"Good"' not in msg
    assert "re-add" in msg


@pytest.mark.asyncio
async def test_compressed_body_refused():
    def handler(request):
        return httpx.Response(
            200, headers={"content-type": "text/plain", "content-encoding": "gzip"}, content=b"x"
        )

    with pytest.raises(LinkIngestError, match="compressed"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_declared_oversize_refused_before_body_read(monkeypatch):
    monkeypatch.setattr(link_ingest, "MAX_BYTES", 100)

    def handler(request):
        return httpx.Response(
            200, headers={"content-type": "text/plain", "content-length": "5000"}, content=b"a"
        )

    with pytest.raises(LinkIngestError, match="too large"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


@pytest.mark.asyncio
async def test_identity_encoding_requested():
    seen = {}

    def handler(request):
        seen["ae"] = request.headers.get("accept-encoding")
        return httpx.Response(200, headers={"content-type": "text/plain"}, content=b"ok")

    await fetch_link_text(PUBLIC, http_client=_client(handler))
    assert seen["ae"] == "identity"


@pytest.mark.asyncio
async def test_overall_deadline_enforced(monkeypatch):
    import asyncio

    monkeypatch.setattr(link_ingest, "FETCH_DEADLINE_S", 0.05)

    def handler(request):
        async def slow():
            await asyncio.sleep(1)
            yield b"late"

        return httpx.Response(
            200, headers={"content-type": "text/plain"}, stream=_AsyncStream(slow())
        )

    with pytest.raises(LinkIngestError, match="too long"):
        await fetch_link_text(PUBLIC, http_client=_client(handler))


class _AsyncStream(httpx.AsyncByteStream):
    def __init__(self, gen):
        self._gen = gen

    async def __aiter__(self):
        async for chunk in self._gen:
            yield chunk
