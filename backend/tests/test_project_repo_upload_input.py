import pytest

from backend.src.trust import project_repo


class _FakeConn:
    """Minimal asyncpg-like stub: records the SQL + args, returns a canned row."""

    def __init__(self):
        self.calls = []

    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return {
            "id": "11111111-1111-1111-1111-111111111111",
            "project_id": args[0],
            "kind": "upload",
            "title": args[1],
            "content": None,
            "source_ref": None,
            "storage_path": args[2],
            "content_hash": args[3],
            "created_at": None,
        }


@pytest.mark.asyncio
async def test_add_upload_input_inserts_kind_upload_with_storage_and_hash():
    conn = _FakeConn()
    row = await project_repo.add_upload_input(
        conn,
        project_id="p1",
        title="Kolam interview",
        storage_path="/var/audio/abc.mp3",
        content_hash="deadbeef",
    )
    sql, args = conn.calls[0]
    assert "storage_path" in sql and "content_hash" in sql
    assert "'upload'" in sql  # kind is a SQL literal
    assert args == ("p1", "Kolam interview", "/var/audio/abc.mp3", "deadbeef")
    assert row.kind == "upload"
    assert row.storage_path == "/var/audio/abc.mp3"
    assert row.content_hash == "deadbeef"
