"""Test-suite safety: keep pytest off any non-local (production) database.

The repo `.env` may set `DATABASE_URL` to a remote Supabase pooler for local app /
admin-console work against prod data. pydantic-settings loads that `.env`, so an
unguarded test run (or an agent running plain `pytest`) can silently execute
against production. `conftest.py` uses `looks_remote` to refuse that.
"""

from __future__ import annotations

from urllib.parse import urlparse

# Hostnames that are unambiguously the developer's own machine / CI service container.
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "0.0.0.0", ""})


def db_host(dsn: str) -> str:
    """The hostname of a Postgres DSN (empty string if unparseable/absent)."""
    try:
        return (urlparse(dsn).hostname or "").lower()
    except ValueError:
        return ""


def looks_remote(dsn: str) -> bool:
    """True iff `dsn` points at a host that is NOT the local machine — i.e. a DSN
    the test suite must never run against. Empty/local hosts are safe (False)."""
    if not dsn:
        return False
    host = db_host(dsn)
    if host in _LOCAL_HOSTS:
        return False
    # Belt-and-suspenders: even a non-obvious host that names a known managed
    # provider is remote (guards a future alias that isn't literally localhost).
    return True
