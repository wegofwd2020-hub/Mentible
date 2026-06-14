# SBQ-TRUST-002 — Export-time compliance + integrity attach

> Paste-ready ticket. Completes the **ContentTrustManifest** (ADR-015) by attaching
> the two blocks that only exist after compile: `compliance` (format check) and
> `integrity` (`content_hash`). Follow-up to **SBQ-TRUST-001** (generation-time
> provenance/validation/policy) and **ADR-011** (the Pramana Consumable Package).

---

## JIRA fields

| Field | Value |
|-------|-------|
| **Project** | StudyBuddy Q (SBQ) |
| **Issue Type** | Story |
| **Summary** | Attach format-compliance + content-hash to the trust manifest at export, render on the reader |
| **Component** | backend / export · mobile / reader |
| **Labels** | `enhancement`, `trust`, `adr-015`, `compliance` |
| **Priority** | Medium |
| **Estimate** | 8 story points |
| **Dependencies** | **Hard:** SBQ-TRUST-001 merged (`engine_trust`, `<TrustBadge>`, `wegofwd-llm` ≥ v0.2.0). **Soft:** `poppler-utils` (`pdfinfo`) in the backend image for page-level params — see §"Runtime". |
| **Fix Version** | v1 — Android alpha |

---

## User Story

> **As a** self-learner (and, on the Pramana path, a compliance reviewer)
> **I want** the compiled book/course to show which format and integrity checks it passed
> **so that** I can trust the finished artifact, not just the raw generation.

---

## Background — why these two blocks live at export

A `ContentTrustManifest` (ADR-015) is assembled in stages. SBQ-TRUST-001 stamped
the **generation-time** blocks (`provenance`, `validation`, `policy`). The other two
can only be computed once content is finalised into an artifact:

- **`integrity.content_hash`** — a fingerprint of the canonical book body. Only
  meaningful over the *whole* compiled book, not a single in-flight unit.
- **`compliance`** — the format/brand check runs against the *rendered artifact*
  (page count, visual count, chapter length …), which doesn't exist until compile.

The export path (`backend/src/export/compiler.py`) is **key-free and deterministic**
— the right place to attach both. This produces a **book-level** manifest (the
deliverable is the unit), distinct from SBQ-TRUST-001's per-lesson manifest.

### Two real producers already in the repo

| Source | What it measures | Status today |
|---|---|---|
| `pipeline/content_format_validator.py` | Content drift: a tabular-titled section with no GFM table, a formula section with no `$…$` math. Pure functions, per-unit. | **Automated** (runs in the pipeline; not yet called from Mentible export) |
| `docs/comparisons/product-sense-ai_format-compliance.md` (the 13 A/B/C params vs `doc format.xlsx`) | Artifact format: page size/count, visual count, chapter length, glossary, typography, cover … | **Manual report** (measured via `pdfinfo` + `book.json` parse) |

This ticket **automates the mechanically-measurable subset** of the A/B/C check and
folds in the content-drift validator. The subjective params (voice, cover style,
typographic taste) are **not** auto-assessed here — they are excluded from the
count, not silently passed (see §"Honest counting"). Their automation (LLM-judge or
stored manual verdict) is **SBQ-TRUST-003**.

---

## The compliance ruleset (`mentible-professional@1.0`)

Auto-checkable now, all from `book.json` + `pdfinfo` on the compiled PDF (exactly
the manual report's measurement basis):

| ID | Param | Auto-check | Source |
|---|---|---|---|
| A1 | Page size | `pdfinfo` page dims == A4 (595×842 pt) | PDF |
| A2 | Page count | content pages within target band (≈50, ≤55) | PDF |
| A3 | Visual count | figures + tables in band (20–30) | `book.json` lists |
| B2 | Chapter length | every chapter within 3–5 pp | PDF per-chapter map |
| B5 | Glossary present | end-of-book glossary section exists | `book.json` |
| C-drift | Content format | no `content_format_validator` warnings | `book.json` units |

**Not auto-assessed (→ SBQ-TRUST-003), excluded from the count:** B1 voice, B3
examples-are-real, B4 Concept→Visual→Example→Takeaways rhythm, C1–C3 visual/cover
style, C4 typographic taste.

> Ship A1/A2/A3/B2/B5 + content-drift = a **6-check** `mentible-professional@1.0`
> v1. The badge then truthfully reads e.g. "Passed 6/6 format checks" — and grows
> to the full 13 as SBQ-TRUST-003 lands the judged params.

---

## Backend — the assembler (new module)

`backend/src/export/trust.py` (pure; no I/O beyond the `pdfinfo` call it's handed):

```python
"""Book-level trust assembly at export (ADR-015 SBQ-TRUST-002).

Attaches the two post-compile blocks — compliance (mentible-professional@1.0)
and integrity (content_hash) — onto a ContentTrustManifest. Provenance/validation
are carried over from the per-unit manifests stamped at generation (SBQ-TRUST-001).
Key-free, like the rest of export."""

from __future__ import annotations

import dataclasses
import hashlib
import json

from wegofwd_llm.trust import ComplianceBlock, ContentTrustManifest, IntegrityBlock

# import the existing drift validator (pipeline is vendored one-way into this repo)
from pipeline.content_format_validator import check_content


def content_hash(book: dict) -> str:
    """sha256 of the canonical book body — stable across key reorderings."""
    canonical = json.dumps(book, sort_keys=True, separators=(",", ":")).encode()
    return "sha256:" + hashlib.sha256(canonical).hexdigest()


def compute_compliance(book: dict, pdf_meta: dict) -> ComplianceBlock:
    """Run the auto-checkable mentible-professional@1.0 params. pdf_meta carries
    {page_size_pt, content_pages, per_chapter_pages} from pdfinfo (see router)."""
    checks: list[bool] = []

    # A1 page size A4
    checks.append(pdf_meta.get("page_size_pt") == (595, 842))
    # A2 content page band (≈50, ≤55) — lower bound advisory, hard cap at 55
    pages = pdf_meta.get("content_pages", 0)
    checks.append(45 <= pages <= 55)
    # A3 visual count band 20–30
    visuals = _count_visuals(book)
    checks.append(20 <= visuals <= 30)
    # B2 every chapter 3–5 pp
    checks.append(all(3 <= n <= 5 for n in pdf_meta.get("per_chapter_pages", [])) or False)
    # B5 glossary present
    checks.append(_has_glossary(book))
    # C-drift: no format-drift warnings across units
    warnings = [w for unit in _units(book) for w in check_content(unit["type"], unit["data"])]
    checks.append(len(warnings) == 0)

    passed = sum(checks)
    total = len(checks)
    status = "pass" if passed == total else "pass_with_notes" if passed >= total - 2 else "fail"
    return ComplianceBlock(
        ruleset="mentible-professional@1.0",
        checks_passed=passed,
        checks_total=total,
        status=status,
    )


def attach_export_trust(
    base: ContentTrustManifest, book: dict, pdf_meta: dict, *, signed: bool = False
) -> ContentTrustManifest:
    """Attach compliance + integrity to a manifest carried from generation."""
    return dataclasses.replace(
        base,
        compliance=compute_compliance(book, pdf_meta),
        integrity=IntegrityBlock(content_hash=content_hash(book), signed=signed),
    )
```

(`_count_visuals`, `_has_glossary`, `_units` are small book.json readers — implement
against the same fields the manual report parsed: List of Figures / List of Tables,
`toc.subjects[].topics[]`, and the glossary section.)

### Where the base manifest comes from

`base` is the book's carried-over provenance/validation. Two options (decide in §Open):

1. **Aggregate** the per-unit `trust` manifests saved with the book (SBQ-TRUST-001)
   — provenance from the pinned model, `validation.schema_validated = all units passed`.
2. **Re-stamp** from the book's pinned params via `engine_trust(book.provider, book.model, schema_validated=True)`.

Lean: option 1 (it reflects what actually happened); fall back to 2 if a book has
units without a stored manifest (pre-SBQ-TRUST-001 content).

### Export router — return the manifest with the artifact

`compile_book` already produces the PDF bytes. Compute `pdf_meta` from them and
return the manifest in a response header (artifact stays the body):

```diff
 # backend/src/export/router.py — after compile_book(...)
+from base64 import b64encode
+from backend.src.export.trust import attach_export_trust
+from backend.src.export.pdf_meta import probe_pdf   # pdfinfo wrapper (new, §Runtime)
+
+manifest = attach_export_trust(base_manifest, book, probe_pdf(result.data))
+headers["X-Content-Trust-Manifest"] = b64encode(
+    json.dumps(manifest.to_public_dict()).encode()
+).decode()
```

> The manifest is non-secret (ADR-015 `to_public_dict()`), so a header is safe.
> For the **Pramana** path (ADR-011) the same manifest is written into the
> Consumable Package's `manifest.json` instead of a header — same object, different
> transport.

### Runtime

`pdfinfo` (poppler-utils) in the backend image for A1/A2/B2. Add to
`backend/Dockerfile` next to the Chromium/Vivliostyle deps the PDF path already
needs. If absent, `probe_pdf` returns `{}` → A1/A2/B2 fall to `False` and the book
still exports (compliance just reports a lower `checks_passed`, never crashes).

---

## Mobile — render on the reader

`exportBook` already returns the artifact `ArrayBuffer`; read the header too:

```diff
 // mobile/src/api/client.ts — exportBook
-  return await res.arrayBuffer();
+  const header = res.headers.get("X-Content-Trust-Manifest");
+  const trust = header ? (JSON.parse(atob(header)) as TrustManifest) : undefined;
+  return { artifact: await res.arrayBuffer(), trust };
```

Render the **book-level** badge on the reader / export-success screen:

```tsx
{exported.trust && <TrustBadge manifest={exported.trust} />}
```

`<TrustBadge>` already renders the `compliance` ("Passed 6/6 format checks") and
`integrity` ("Tamper-evident fingerprint") rows — no component change needed.

---

## Honest counting (the load-bearing rule)

- A param that **can't** be auto-checked is **excluded from `checks_total`** — never
  counted as a silent pass. The badge shows "6/6" because six ran, not "13/13".
- `content_format_validator` warnings are **advisory** → at worst `pass_with_notes`,
  never `fail` (consistent with its non-fatal design).
- If `pdfinfo` is unavailable, affected checks report **fail**, not skip — a missing
  measurement is not a pass.

---

## Acceptance Criteria (Gherkin)

```
AC1  Given a compiled book
     Then the export response carries X-Content-Trust-Manifest, base64 JSON
     validating against content-trust-manifest.v1.json with compliance + integrity.

AC2  Then integrity.content_hash is sha256:<64 hex> and is STABLE across two
     compiles of the same book.json (canonical-JSON hashing).

AC3  Given a book that meets A1/A2/A3/B2/B5 and has no drift warnings
     Then compliance.status == "pass" and checks_passed == checks_total.

AC4  Given a book with a tabular-titled section and no table
     Then a content_format_validator warning exists
     And compliance.status == "pass_with_notes" (never "fail").

AC5  Given pdfinfo is unavailable in the runtime
     Then export still succeeds (200) and compliance reports a LOWER checks_passed
     (the page-level checks fail) — it does not crash or silently pass them.

AC6  Then the reader shows a TrustBadge with "Passed N/N format checks" and the
     integrity row; subjective params (voice/cover) are absent, not shown as passed.

AC7  No secret material in the header or manifest (to_public_dict guarantee).
```

---

## Tests

- **Backend unit:** `content_hash` stability + canonicalisation; `compute_compliance`
  for pass / pass_with_notes / fail and the pdfinfo-missing path; the
  `content_format_validator` integration (reuse its existing fixtures).
- **Backend e2e:** extend `test_export.py` — compile a fixture book, assert the
  header decodes, validates against the JSON schema, and carries a stable hash.
- **Mobile:** `deriveTrustRows()` already covers compliance/integrity rows; add a
  reader render test that a book-level manifest shows the format + integrity lines.

---

## Rollout

1. `backend/src/export/trust.py` + `pdf_meta.py` (pdfinfo wrapper) + `poppler-utils` in image.
2. Wire the export router header; wire `exportBook` to read it.
3. Render on the reader / export-success screen.
4. **SBQ-TRUST-003** (follow-up): the judged subjective params (B1/B3/B4/C1–C4) →
   grows `mentible-professional` from 6 to 13 checks; consider an LLM-judge via
   the seam, or a stored manual verdict carried on `book.json`.
5. **Pramana** (ADR-011): write the same manifest into the Consumable Package
   `manifest.json` instead of a header; it becomes the audit-evidence record
   (`content_hash` + `review` SoD added on the Pramana approval gate).

---

## Out of Scope

- Subjective/judged format params (SBQ-TRUST-003).
- Manifest **signing** (`integrity.signed`) — depends on ADR-011 §10 key-custody decision; this ticket ships `signed: false`.
- Persisting the book-level manifest into the saved library record (follow-up).
- The compiler emitting its own metadata sidecar (we use `pdfinfo` on output bytes to stay backend-only).
- Pramana's `review`/SoD block (set on the Pramana side, ADR-011).
