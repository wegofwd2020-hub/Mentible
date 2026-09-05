from datetime import datetime

from backend.src.trust.schemas import ProjectInputOut


def test_upload_input_null_content_coerced_to_empty_string():
    # kind='upload' rows (audio capture) have a NULL content column. The response
    # schema must NOT 500 on that — it coerces None -> "" so GET /projects still
    # serializes and the mobile client (content: string) never sees null.
    out = ProjectInputOut(
        id="i1",
        kind="upload",
        title="Interview 1",
        content=None,
        source_ref=None,
        created_at=datetime(2026, 9, 5),
    )
    assert out.content == ""
    assert out.kind == "upload"


def test_text_input_content_preserved():
    out = ProjectInputOut(
        id="i2",
        kind="transcript",
        title=None,
        content="some text",
        source_ref=None,
        created_at=None,
    )
    assert out.content == "some text"
