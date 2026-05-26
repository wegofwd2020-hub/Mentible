# PORT BRIEF — Curriculum Authoring Studio → StudyBuddy Q

> Paste-ready context for a fresh, **Q-rooted** Claude session that does the port.
> Launch the session from this repo root so Q's CLAUDE.md + ADRs load as primary
> context. Pairs with [`docs/adr/ADR-003-book-authoring.md`](adr/ADR-003-book-authoring.md).

## Mission

Bring multi-topic **book authoring** to StudyBuddy Q. A working PROTOTYPE of the
workflow already exists in the sibling repo `StudyBuddy_OnDemand` (the "Curriculum
Authoring Studio"). This is a **re-implementation on Q's stack — NOT a code
transplant, NOT a cross-import.**

## Binding decisions (already made — do not relitigate)

- **OnDemand ADR-004 ("Q grows up"):** the standalone, BYOK, individual
  "author-your-own-book + read it" product lives in Q, not the school platform.
  Q's old "not a course platform" line is relaxed to cover personal book authoring.
- **Reuse is PORT + VENDOR, ONE-WAY.** Honor Q's ADR-002: never `import` from
  `StudyBuddy_OnDemand`; vendor prompt/pipeline IP only. The prototype runs on
  Postgres + RLS + Celery + super_admin — none of that comes across.
- **Honor Q's ADR-001 (BYOK):** keys never stored; adults only; no COPPA/FERPA.

## First step

Read + finalize the draft ADR already written for this:
`docs/adr/ADR-003-book-authoring.md` (status: **Proposed**; this branch is
**unpushed, not merged to main**). Decide its disposition (merge to main / open
PR) before writing code.

## Reference sources in the sibling repo (READ to learn the workflow; never import)

Sibling path from this repo root: `../StudyBuddy_OnDemand/`

**Workflow / LLM IP — the parts worth vendoring + porting:**

| File | What it does |
|---|---|
| `pipeline/toc_structurer.py` | free-text TOC → structured topic tree (LLM) |
| `pipeline/flow_analyzer.py` | advisory pedagogical-order analysis (LLM) |
| `backend/src/admin/authoring_generation.py` | per-topic generate / regenerate / 3× retry |
| `backend/src/admin/authoring_flow.py` | cheap no-LLM ordering check |

**Behaviour spec — read as the de-facto requirements:**
`backend/tests/test_authoring.py`, `test_authoring_pr_b.py`, `test_authoring_pipeline.py`

**Stack-specific — DO NOT port (this is exactly what Q replaces):**
`backend/alembic/versions/0060_*.py` (Postgres tables/RLS) ·
`backend/src/admin/authoring_service.py` (Celery, RLS, super_admin, content store) ·
`backend/src/admin/authoring_router.py` (16 endpoints, `_require_author` admin gate) ·
`web/app/(admin)/admin/authoring/**` + `web/components/authoring/**` (Next.js admin)

## Stack translation (prototype → Q)

| Prototype (OnDemand) | Q |
|---|---|
| Postgres + migration 0060 tables | SQLite (or Redis-only at MVP), device-local |
| RLS / `app.current_school_id` | **DROP** — single-user, no tenancy |
| Celery async tasks | in-process async (Q's `/generate` + `/jobs` pattern) |
| super_admin JWT / `_require_author` | **DROP** — BYOK, no auth |
| `content_subject_versions` + publish | device library + reader (Q already has this) |
| Next.js admin console | RN/Expo screens (Q is mobile-first) |
| `SBMarkdown` + Mermaid/KaTeX renderer | Q's existing `LessonRenderer` (WebView) |

## Q's current state (branch `feat/mobile-skeleton`)

Single-lesson generate (`/generate` + `/jobs`), RN/Expo lesson library with
per-lesson delete + PDF export, vendored pipeline, BYOK. The book-authoring work
**extends** this from one-artefact to TOC → multi-topic-book.

## Phase 1 scope (smallest end-to-end slice)

1. Stateless `POST /structure` — paste TOC → structured topic tree (port `toc_structurer`).
2. Topic-tree editor screen — RN: edit / reorder / add / remove topics.
3. Generate-all loop — iterate topics → the existing single-lesson generator.

**Defer:** flow analysis, snapshots/versioning, regenerate-with-reason, EPUB export.

## Gotchas that DO carry over (re-solve on Q's stack)

- `generate_one` needs a **3× retry on malformed LLM JSON** (LaTeX/markdown backslashes).
- Generation prompts use `diagram_emphasis=True` (Mermaid + richer prose) to counter
  "too terse" output — keep that.

## Gotchas that DON'T apply (prototype-only — Postgres/Celery/RLS artifacts)

jsonb codec registration · `ensure_pipeline_path()` sys.path hack · RLS bypass ·
`unit_name NOT NULL` · `content_subject_versions` provider CHECK — all **N/A** on Q.
