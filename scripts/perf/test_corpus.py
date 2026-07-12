from collections import Counter
from scripts.perf.corpus import CORPUS, CorpusEntry

_LEVELS = {"student", "professional", "expert"}
_FORMATS = {"lesson", "explanation", "quiz"}
_DEPTHS = {"quick", "standard", "deep"}
_REGISTERS = {"conceptual", "balanced", "technical"}


def test_corpus_size_and_bands():
    assert len(CORPUS) == 30
    assert Counter(e.band for e in CORPUS) == {"heavy": 12, "medium": 12, "light": 6}


def test_corpus_entries_use_valid_enum_values():
    for e in CORPUS:
        assert isinstance(e, CorpusEntry)
        assert e.topic.strip()
        assert e.level in _LEVELS
        assert e.format in _FORMATS
        assert e.depth in _DEPTHS
        assert e.diagram_register in _REGISTERS
        assert 0 <= e.target_pages <= 100


def test_every_entry_is_lesson_format():
    # Only `lesson` is wired in the MVP worker; `explanation`/`quiz` are rejected
    # with "format 'X' not yet supported in this MVP" (D13). Guard against
    # re-introducing an unsupported format that would fail every job.
    assert all(e.format == "lesson" for e in CORPUS)


def test_bands_have_expected_weighting():
    heavy = [e for e in CORPUS if e.band == "heavy"]
    assert all(e.depth == "deep" and e.level == "expert" for e in heavy)
    assert all(e.diagram_register == "technical" and e.target_pages >= 6 for e in heavy)
    light = [e for e in CORPUS if e.band == "light"]
    assert all(e.depth == "quick" and e.level == "student" for e in light)
    assert all(e.target_pages == 0 for e in light)
