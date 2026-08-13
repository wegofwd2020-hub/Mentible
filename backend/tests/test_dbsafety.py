"""The DB-safety guard must classify prod DSNs as remote and local ones as safe."""

from tests._dbsafety import db_host, looks_remote

_PROD_POOLER = "postgresql://postgres.abc:pw@aws-1-us-west-2.pooler.supabase.com:5432/postgres"


def test_supabase_pooler_is_remote():
    assert looks_remote(_PROD_POOLER) is True
    assert db_host(_PROD_POOLER) == "aws-1-us-west-2.pooler.supabase.com"


def test_localhost_dsns_are_safe():
    assert looks_remote("postgresql://postgres:devlocal@localhost:5439/mentible_test") is False
    assert looks_remote("postgresql://postgres:pw@127.0.0.1:5432/mentible_test") is False


def test_empty_dsn_is_safe():
    # No DB configured ⇒ not "remote"; DB-backed tests just skip.
    assert looks_remote("") is False


def test_a_remote_ip_host_is_remote():
    assert looks_remote("postgresql://u:p@10.0.0.5:5432/db") is True
