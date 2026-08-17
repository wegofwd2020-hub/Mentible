from backend.src.trust.quality import coverage_report, readability, version_quality


def test_coverage_counts_cited_uncited_and_dangling():
    sections = [
        {"heading": "A", "body": "x", "source_ids": ["s1"]},        # cited
        {"heading": "B", "body": "y", "source_ids": []},            # uncited
        {"heading": "C", "body": "z", "source_ids": ["gone"]},      # dangling only → uncited
    ]
    rep = coverage_report(sections, {"s1", "s2"})
    assert rep["sections_total"] == 3
    assert rep["sections_cited"] == 1
    assert rep["uncited_section_indexes"] == [1, 2]
    assert rep["dangling"] == [{"section_index": 2, "source_id": "gone"}]
    assert rep["source_refs"] == 1


def test_readability_on_a_known_string():
    # "The cat sat on the mat. The dog ran fast." → 2 sentences, 10 words.
    r = readability("The cat sat on the mat. The dog ran fast.")
    assert r["sentences"] == 2
    assert r["words"] == 10
    assert r["grade_level"] < 3          # short, simple → low grade
    assert 90 < r["flesch_reading_ease"] <= 122


def test_readability_strips_math_and_code_and_guards_empty():
    r = readability("Energy $E=mc^2$ is famous.\n\n```mermaid\ngraph TD\n```")
    assert r["words"] >= 3               # math/code stripped, prose counted
    assert readability("")["sentences"] == 0     # divide-by-zero guarded
    assert readability("")["grade_level"] == 0.0


def test_version_quality_bundles_both():
    q = version_quality([{"heading": "A", "body": "One two three.", "source_ids": ["s1"]}], {"s1"})
    assert set(q) == {"coverage", "readability"}
