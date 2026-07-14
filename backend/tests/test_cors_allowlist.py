"""CORS is an allowlist, not `*`.

The API was shipped to production with `allow_origins=["*"]`. That never leaked the
BYOK key — the key rides in the request body and credentials are off — but it left
every endpoint, including the anonymous /shelves/feed, callable from any page in a
browser. These tests pin the allowlist so it cannot regress to a wildcard.
"""

from backend.config import Settings


def _origins(**kw: object) -> Settings:
    return Settings(**kw)  # type: ignore[arg-type]


def test_default_allowlist_is_not_a_wildcard() -> None:
    s = _origins()
    assert "*" not in s.cors_origin_list
    assert s.cors_origin_list == ["https://mambakkam.net"]


def test_allowlist_parses_comma_separated_and_drops_blanks() -> None:
    s = _origins(cors_allow_origins="https://a.example, ,https://b.example ")
    assert s.cors_origin_list == ["https://a.example", "https://b.example"]


def test_localhost_regex_matches_any_dev_port() -> None:
    import re

    pattern = _origins().cors_origin_regex
    assert pattern is not None
    rx = re.compile(pattern)
    # Expo web picks an arbitrary port, so the regex must not pin one.
    assert rx.fullmatch("http://localhost:8081")
    assert rx.fullmatch("http://127.0.0.1:19006")
    assert rx.fullmatch("http://localhost")


def test_localhost_regex_does_not_match_a_lookalike_host() -> None:
    import re

    pattern = _origins().cors_origin_regex
    assert pattern is not None
    rx = re.compile(pattern)
    # `localhost.evil.com` is the classic bypass; fullmatch must reject it.
    assert rx.fullmatch("http://localhost.evil.com") is None
    assert rx.fullmatch("https://localhost") is None


def test_localhost_can_be_disabled_for_production() -> None:
    assert _origins(cors_allow_localhost=False).cors_origin_regex is None
