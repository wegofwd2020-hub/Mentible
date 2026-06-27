"""Unit tests for export-time trust assembly (SBQ-TRUST-002).

Pure functions — no subprocess, no Node. The page-level checks are exercised by
feeding crafted `pdf_meta` dicts (what `pdfinfo` would have produced), so the
compliance logic is tested independently of poppler being installed.
"""

from __future__ import annotations

import pytest
from wegofwd_llm.errors import LLMConfigurationError

from backend.src.export import trust as export_trust

# A4 page geometry + a ~50-page book, as pdfinfo would report it.
_GOOD_PDF_META = {"page_size_pt": (595, 842), "content_pages": 50}


def _book_with(*, visuals: int = 0, glossary: bool = False) -> dict:
    """A book whose units carry `visuals` mermaid figures and, optionally, a
    glossary — enough to drive the book.json-derived checks (A3, B5)."""
    body = "intro\n" + "```mermaid\ngraph TD; A-->B\n```\n" * visuals
    book: dict = {
        "title": "T",
        "generationParams": {"provider": "anthropic", "model": None},
        "content": {
            "u1": {
                "topicId": "u1",
                "lesson": {"sections": [{"heading": "H", "body_markdown": body}]},
            }
        },
    }
    if glossary:
        book["metadata"] = {"glossary": [{"term": "x", "definition": "y"}]}
    return book


# ── content_hash ──────────────────────────────────────────────────────────────


def test_content_hash_is_sha256_prefixed_hex():
    h = export_trust.content_hash({"title": "T"})
    assert h.startswith("sha256:")
    assert len(h) == len("sha256:") + 64


def test_content_hash_is_stable_across_key_order():
    # AC2: canonical hashing — key order must not change the fingerprint.
    a = export_trust.content_hash({"title": "T", "z": 1, "a": 2})
    b = export_trust.content_hash({"a": 2, "title": "T", "z": 1})
    assert a == b


def test_content_hash_changes_with_content():
    assert export_trust.content_hash({"title": "A"}) != export_trust.content_hash({"title": "B"})


# ── book.json readers ─────────────────────────────────────────────────────────


def test_count_visuals_counts_tables_and_mermaid():
    book = {
        "content": {
            "u1": {"lesson": {"sections": [{"body_markdown": "| a | b |\n|---|---|\n"}]}},
            "u2": {"data": {"content": "```mermaid\ngraph\n```"}},
        }
    }
    assert export_trust._count_visuals(book) == 2


def test_has_glossary():
    assert export_trust._has_glossary(_book_with(glossary=True)) is True
    assert export_trust._has_glossary(_book_with(glossary=False)) is False
    assert export_trust._has_glossary({"metadata": {"glossary": []}}) is False


# ── compute_compliance ────────────────────────────────────────────────────────


def test_compliance_all_pass(monkeypatch):
    # AC3: meets A1/A2/A3/B5 with no drift ⇒ pass, checks_passed == checks_total.
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [])
    book = _book_with(visuals=25, glossary=True)
    c = export_trust.compute_compliance(book, _GOOD_PDF_META)
    assert c.ruleset == "mentible-professional@1.0"
    assert c.status == "pass"
    assert c.checks_passed == c.checks_total == 5


def test_compliance_drift_is_advisory_not_fail(monkeypatch):
    # AC4: a content-format-drift warning caps the result at pass_with_notes,
    # never a hard fail — even though every other check passed.
    monkeypatch.setattr(
        export_trust, "book_warnings", lambda book: [{"rule": "expected_table"}]
    )
    book = _book_with(visuals=25, glossary=True)
    c = export_trust.compute_compliance(book, _GOOD_PDF_META)
    assert c.status == "pass_with_notes"
    assert c.checks_passed == 4 and c.checks_total == 5


def test_compliance_pdfinfo_missing_fails_page_checks_not_skips(monkeypatch):
    # AC5: no pdf_meta (EPUB export, or poppler absent) ⇒ A1/A2 FAIL, lowering
    # checks_passed — never a silent pass, never a crash.
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [])
    book = _book_with(visuals=25, glossary=True)
    c = export_trust.compute_compliance(book, {})
    assert c.status != "pass"
    assert c.checks_passed == 3 and c.checks_total == 5  # A3, B5, C-drift only


def test_drift_never_causes_a_hard_fail_on_epub(monkeypatch):
    # Regression: an EPUB has empty pdf_meta, so A1/A2 always fail. An otherwise
    # clean book (A3 + B5 pass) plus a single ADVISORY drift warning must NOT flip
    # to "fail" — drift is non-fatal and can only soften a pass.
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [{"rule": "expected_table"}])
    book = _book_with(visuals=25, glossary=True)  # A3 + B5 pass
    c = export_trust.compute_compliance(book, {})  # EPUB: no page geometry
    assert c.status == "pass_with_notes"  # not "fail"
    # Removing the drift warning must not change the status (it wasn't the cause).
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [])
    assert export_trust.compute_compliance(book, {}).status == "pass_with_notes"


def test_compliance_fail_when_most_checks_miss(monkeypatch):
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [{"rule": "x"}])
    book = _book_with(visuals=0, glossary=False)  # no visuals, no glossary, drift
    c = export_trust.compute_compliance(book, {})
    assert c.status == "fail"
    assert c.checks_passed == 0


def test_b2_excluded_until_chapter_map_present(monkeypatch):
    # B2 (per-chapter pages) is excluded from the count when no chapter map
    # exists, and activates (raising checks_total) when pdf_meta carries one.
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [])
    book = _book_with(visuals=25, glossary=True)
    without = export_trust.compute_compliance(book, _GOOD_PDF_META)
    with_map = export_trust.compute_compliance(
        book, {**_GOOD_PDF_META, "per_chapter_pages": [4, 4, 5]}
    )
    assert without.checks_total == 5
    assert with_map.checks_total == 6 and with_map.checks_passed == 6


# ── base_manifest + attach ────────────────────────────────────────────────────


def test_base_manifest_restamps_from_pinned_provider():
    m = export_trust.base_manifest(_book_with())
    assert m.provenance.provider == "anthropic"
    assert m.validation.schema_validated is True
    assert m.validation.schema_id == "book@1"
    # generation-only base: no export blocks yet.
    assert m.compliance is None and m.integrity is None


def test_attach_export_trust_adds_compliance_and_integrity(monkeypatch):
    monkeypatch.setattr(export_trust, "book_warnings", lambda book: [])
    book = _book_with(visuals=25, glossary=True)
    base = export_trust.base_manifest(book)
    full = export_trust.attach_export_trust(base, book, _GOOD_PDF_META)
    d = full.to_public_dict()
    # AC1: provenance + validation carried over; compliance + integrity attached.
    assert {"provenance", "validation", "compliance", "integrity"} <= d.keys()
    assert d["integrity"]["content_hash"].startswith("sha256:")
    assert d["compliance"]["status"] == "pass"


def test_unknown_provider_raises_for_caller_to_handle():
    # The router wraps assembly in try/except and ships the artifact without the
    # header if provenance can't be stamped — so an unknown provider must surface
    # as an exception here, not a silent bad manifest.
    with pytest.raises(LLMConfigurationError):
        export_trust.base_manifest({"generationParams": {"provider": "nope"}})
