from backend.src.trust.models import ARTIFACT_FORMATS


def test_transcript_is_an_allowed_artifact_format():
    assert "transcript" in ARTIFACT_FORMATS
