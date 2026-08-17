# P1-4 — Grounding & readability quality report — Design

**Status:** Approved (brainstorming, 2026-08-17). Implements
[`PRIORITIZED_SHORTLIST.md`](../../competitive-analysis/PRIORITIZED_SHORTLIST.md) P1-4 ("quality gates
beyond format — a citations/grounding report + readability score"). Makes ADR-037's "trust is the
product" *visible*: a per-version quality report that says how well the draft's claims trace to its
sources, and how readable it is.

## Context (verified against the code)

- **Grounded generation already declares section→source citations.** `backend/src/trust/draft_prompt.py`
  / `topic_prompt.py` feed the model the full source text (`[S1] … """{content}"""`) and instruct "use
  ONLY the sources … attribute each section to the source label(s)." The model returns
  `sections[].sources: ["S1", …]`; `generate.py:71` `draft_output_to_sections` maps labels → real input
  ids, dropping unknown labels. **Every stored version already carries `content.sections[].source_ids:
  [uuid]`** — a *model-declared, whole-section* citation (not per-claim, not verified).
- **Source text lives on the input row.** `backend/src/trust/models.py:44` `ProjectInput{id, kind, title,
  content, source_ref, content_hash, …}` — `content` is the full source text (≤200 000 chars). API
  `ProjectInputOut` exposes `content` + `source_ref`.
- **The Content Trust Manifest already has the shape, unpopulated.** The vendored engine
  (`wegofwd_llm/trust.py`) defines `SourcingBlock{every_claim_cited: bool, source_refs: int}` and the
  reader `TrustBadge.tsx:106` already renders it — but `backend/src/export/trust.py`
  `attach_export_trust` only attaches `compliance` + `integrity`; **`sourcing` is never populated.** The
  `compliance` ruleset (`mentible-professional@1.0`) is **format/page/schema only** (A4 page, page-count
  band, visual count, glossary, format-drift) — zero citation or readability analysis. The engine has
  **no readability block.**
- **No readability / claim-matching / coverage code exists** anywhere (greenfield analysis).
- **Generation is async + BYOK-safe.** Generate endpoints (`trust/router.py:336` `generate_version`,
  `:720` `generate_topic_version`) are owner-only, run a managed/BYOK eligibility gate, enqueue a Celery
  task (202 + poll `GET /api/v1/jobs/{job_id}`), and let the **worker** resolve the key (managed vault or
  BYOK envelope in Redis, ADR-001). The LLM plumbing: `generate_validated(provider, req, _validate,
  max_repairs)`, `build_provider(provider_id, api_key, model)`, `LLMRequest(prompt, max_tokens,
  response_format="json")`.
- **Trust workspace screens show no manifest** — only `is_validated`/`recorded_via` badges + a
  per-section source-id chip row (`version/[versionId].tsx:500`). A quality card / per-section indicator
  is additive.
- **ADR-029 (library-grounded references)** is the *reverse* direction (retrieval to pull references
  *into* authoring) and is unbuilt — no overlap with this audit-direction feature beyond both touching
  `SourcingBlock`.

## Decisions (brainstorming 2026-08-17)

1. **Two-tier report.** A version's `quality` has a **deterministic tier** (coverage + readability —
   pure, no LLM, computed on read, always present) and an **LLM tier** (claim-level grounding —
   on-demand, billable, stored).
2. **Claim = sentence.** The LLM pass splits each section body into sentences and labels each
   `supported | partial | unsupported` against the section's cited sources.
3. **LLM pass is on-demand, owner-triggered, billable** (managed or BYOK, same eligibility as
   generation) — NOT auto-run on generate. Stored per version so it isn't recomputed.
4. **Manifest gets deterministic sourcing.** The exported artifact's `SourcingBlock` is populated from
   the **deterministic section coverage** (carried into the compile `book.json`). Threading the
   *claim-level* LLM result into the client-assembled export is heavier and is a **documented
   follow-up** — the workspace shows claim-level; the manifest shows section coverage. Readability stays
   **workspace-only** (the vendored engine has no readability block).

---

## Architecture

```
                    ┌───────────────── per version ─────────────────┐
 DETERMINISTIC ──►  trust/quality.py    coverage_report + readability
   (on read)        (pure functions over content.sections + live inputs)
                            │
 LLM (on demand) ──► POST /trust/…/grounding-check  → Celery task
   owner, billable    trust/grounding.py (generate_validated, per-section
                      claim verdicts) → stored in `version_grounding` (0021)
                            │
                            ▼
      VersionDetailOut.quality = { coverage, readability, grounding|null }
                            │                                   │
             mobile quality card + per-section        export/trust.py →
             indicator + "Run grounding check"        SourcingBlock (deterministic
                                                       coverage) in the artifact manifest
```

---

## Unit A — Deterministic analysis (`backend/src/trust/quality.py`, pure)

**Files:** create `backend/src/trust/quality.py`; tests `backend/tests/test_trust_quality.py`.

- `coverage_report(sections: list[dict], live_input_ids: set[str]) -> dict`:
  `{sections_total, sections_cited, uncited_section_indexes: [int], dangling: [{section_index, source_id}],
  source_refs}`. A section is **cited** iff it has ≥1 `source_id` ∈ `live_input_ids`; a **dangling** cite
  is a `source_id` ∉ `live_input_ids` (e.g. a since-deleted input on a non-validated version).
  `source_refs` = count of distinct live cited ids.
- `readability(text: str) -> dict`: `{flesch_reading_ease: float, grade_level: float, words, sentences}`.
  Standard formulas — Flesch Reading Ease `206.835 − 1.015·(words/sentences) − 84.6·(syllables/words)`;
  Flesch-Kincaid grade `0.39·(words/sentences) + 11.8·(syllables/words) − 15.59`. Syllables via a
  documented vowel-group heuristic. **Strip markdown, `$…$`/`$$…$$` math, and ```code/mermaid``` fences**
  before counting so formulas/code don't skew it. Guard divide-by-zero (0 sentences/words → 0s).
- `version_quality(sections, live_input_ids) -> dict`: `{coverage, readability}` — concatenates section
  bodies for readability, runs coverage. This is the deterministic tier returned on read.

Pure, deterministic, fully unit-testable (assert Flesch against a hand-computed known string).

## Unit B — Version-detail wiring for the deterministic tier

**Files:** `backend/src/trust/router.py` (GET version + GET topic-version assembly), `schemas.py`
(`VersionDetailOut` / `TopicVersionDetailOut` gain `quality: dict | None`), `mobile/src/api/trustClient.ts`
(`VersionDetailView`/`TopicVersionDetailView` gain `quality`).

- When assembling a version detail, fetch the project's **live input ids** (`project_repo.list_inputs`
  → ids) and compute `version_quality(content["sections"], live_ids)`; attach as `.quality.coverage` +
  `.quality.readability`. Also attach `.quality.grounding` = the stored grounding row for this version
  (Unit D) or `null`.
- `quality` is computed per request (cheap — pure string math); no storage for the deterministic tier.

## Unit C — LLM claim-grounding (`backend/src/trust/grounding.py`)

**Files:** create `backend/src/trust/grounding.py`; tests `backend/tests/test_trust_grounding.py`.

- `build_grounding_prompt(section_heading, section_body, cited_sources) -> str`: instruct the model to
  split `section_body` into sentences and, using ONLY `cited_sources` (each `[S1] """{content}"""`),
  label each sentence `supported | partial | unsupported` and name the supporting label(s). Requested
  JSON: `{"claims":[{"text": str, "status": "supported|partial|unsupported", "sources": ["S1"]}]}`.
- `generate_grounding(*, sections, sources, provider_id, api_key, model) -> dict`: for each section, if it
  cites **no** live source → all its sentences are `unsupported` (no LLM call); else call
  `generate_validated(build_provider(provider_id, api_key, model), LLMRequest(prompt, max_tokens=8192,
  response_format="json"), _validate)` (per-section call; 8192 headroom for a many-sentence section). Map the model's `S`-labels back to `source_id`s (reuse the
  `draft_output_to_sections` label→id convention). Aggregate:
  `{claims_total, supported, partial, unsupported, by_section: [{section_index, claims:[{text, status,
  source_ids}]}], model, checked_at}`. Returns the report dict (no I/O — the task persists it).
- Metering: like `generate_draft`, return/observe token counts so managed usage is recorded
  (`_record_trust_usage`).

## Unit D — Grounding-check endpoint + task + persistence

**Files:** `backend/alembic/versions/0021_version_grounding.py` (new); `backend/src/trust/models.py` +
a `grounding_repo.py`; `backend/src/trust/tasks.py` (`grounding_check_task`); `backend/src/trust/router.py`
(two endpoints); `schemas.py`.

- **Migration 0021 — `version_grounding`:** `{version_id uuid, version_kind text, report jsonb, model text,
  checked_at timestamptz, cited_content_hash text, PRIMARY KEY (version_id, version_kind)}`. `version_kind`
  ∈ `('artifact','topic')` (artifact_version and topic_version are separate tables → one polymorphic
  table, keyed by the pair). Upsert on recompute (a version is immutable, but re-running overwrites).
  `cited_content_hash` = a hash of the concatenated cited inputs' `content_hash`s, so the UI can warn
  "inputs changed since this check."
- **Endpoints (owner-only, mirror `generate_version`'s gate + async pattern):**
  `POST /api/v1/trust/artifacts/versions/{version_id}/grounding-check` and
  `POST /api/v1/trust/topic-versions/{version_id}/grounding-check`. Each: `_require_role(..., allow=
  ("owner",))`, managed/BYOK eligibility gate (mirror generate), enqueue `grounding_check_task`, return
  202 + `job_id` (poll `GET /api/v1/jobs/{job_id}`). Worker resolves the key (managed vault / BYOK
  envelope), loads the version's `content.sections` + the cited inputs' text, calls `generate_grounding`,
  upserts `version_grounding`.
- The stored report is surfaced through `VersionDetailOut.quality.grounding` (Unit B), with `checked_at`
  and a `stale: bool` (recomputed `cited_content_hash` != stored → true).

## Unit E — Export manifest producer (deterministic sourcing)

**Files:** `mobile/src/lib/topicsToBook.ts` + `artifactToBook.ts` (carry `source_ids` into the compile
book), `compiler/src/types.ts` (additive optional field), `backend/src/export/trust.py` (populate
`SourcingBlock`).

- The compile `book.json` currently **drops** per-section `source_ids` (`topicsToBook` maps to
  `LessonOutput.sections{heading, body_markdown}`). Add an **additive optional** `source_ids?: string[]`
  onto the lesson section (compiler type + the two mobile assemblers), so the backend can see coverage at
  export. Additive → existing books still compile.
- In `export/trust.py`, add `compute_sourcing(book) -> SourcingBlock`: over all lesson sections,
  `every_claim_cited = every section with body has ≥1 source_id`; `source_refs = distinct source_ids`.
  Attach it in `attach_export_trust` alongside compliance/integrity. If no section carries `source_ids`
  (older/ungrounded book) → omit the block (stays "not assessed", as today).
- **Scope note:** the manifest's `every_claim_cited` is the **deterministic section-coverage** reading.
  Feeding the *claim-level* LLM verdict into the exported artifact requires threading per-version
  grounding through the client-assembled export and is a **documented follow-up**, not in this plan.
  Readability is **not** in the manifest (engine has no block) — workspace-only.

## Unit F — Mobile surfaces

**Files:** `mobile/src/api/trustClient.ts` (`quality` on the two version views + a `runGroundingCheck`
client call + job poll), a new `mobile/src/components/QualityCard.tsx`, `mobile/app/trust/version/
[versionId].tsx` + `topic-version/[id].tsx` (render the card + per-section indicators + the owner button),
`mobile/src/help-content/features.ts` + `topics.ts` (Help DoD).

- **Quality card** (version header, near the validation badge): coverage (`8/10 sections cite a live
  source`, uncited/dangling flagged), readability (`grade 11.2 · Flesch 42`), and — once a grounding run
  exists — `44/47 claims supported` with `checked_at`/`stale`.
- **"Run grounding check"** button (owner-only; hidden for reviewer/editor per the P0-2 role split) →
  `runGroundingCheck(versionId)` → poll job → refresh. Show busy/`stale` states. Reuses the existing
  managed/BYOK key flow the generate buttons use.
- **Per-section indicator**: the existing source-chip row gains a state (cited / uncited / dangling);
  after a grounding run, unsupported sentences in a section are highlighted inline (read from
  `grounding.by_section`).
- Fail-open / graceful: no `quality` field (older backend) → card hidden; grounding `null` → card shows
  only coverage+readability + the run button.
- **Help DoD:** a `FEATURES` key + Help topic for the grounding report, in the same task.

---

## Cross-cutting / global constraints

- **BYOK/ADR-001:** the grounding LLM call obeys the same discipline as generation — key never logged,
  never persisted, resolved by the worker from the managed vault or the BYOK Redis envelope; the section
  bodies + source text are content and must not be logged.
- **Access:** grounding-check is **owner-only** (billable LLM). Reading `quality` follows the normal
  version-read access (owner/reviewer/editor) — the deterministic tier is non-billable and safe to show
  any project member.
- **No RLS / tenant column** (backend rule #4). `version_grounding` is app-level, keyed by version.
- Migrations additive + backward-compatible; the deterministic tier degrades to "not assessed" for old
  data. asyncpg; no key/content in logs; 70% coverage gate. Mobile: `useThemedStyles`, no color-literal
  test asserts, `tsc`/`jest`/`eslint` green. Compiler + backend + mobile CI green.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Decomposition (SDD)

- **T1 — Deterministic analysis (Unit A):** `trust/quality.py` `coverage_report` + `readability` +
  `version_quality`, pure, fully unit-tested (known-value Flesch). No wiring.
- **T2 — Version-detail wiring (Unit B):** attach `quality.coverage`/`.readability` to
  `VersionDetailOut`/`TopicVersionDetailOut` + the TS views. Tests.
- **T3 — LLM grounding module (Unit C):** `trust/grounding.py` prompt+schema+`generate_grounding`,
  mocked-provider tests (per-section claim verdicts, no-source→all-unsupported, label→id mapping).
- **T4 — Grounding endpoint + task + persistence (Unit D):** migration 0021, `grounding_repo`,
  `grounding_check_task`, the two owner-only async endpoints, `quality.grounding` + `stale` on the detail.
  Tests (owner gate, enqueue, upsert, stale).
- **T5 — Export manifest sourcing (Unit E):** carry `source_ids` into the compile book (compiler type +
  both assemblers), `compute_sourcing` in `export/trust.py`, attach `SourcingBlock`. Tests
  (populated/omitted).
- **T6 — Mobile surfaces (Unit F):** `quality` on the client, `QualityCard`, owner run-button + job poll,
  per-section indicators, Help topic. Tests.

(T1→T2 ordered; T3→T4 ordered; T2/T4 feed T6; T5 is independent of the LLM tier and can interleave.)

## Rollout

Backend migration `0021` (additive) + a backend refresh (new grounding module + endpoints). Web deploy +
APK. The grounding LLM pass is billable → covered by the caller's managed allowance or BYOK, same as
generation. No data backfill (deterministic tier computes for existing versions on read; grounding is
absent until first run).

## Out of scope / follow-ups

- **Claim-level grounding in the exported artifact manifest** (threading per-version grounding through the
  client-assembled export) — the manifest ships deterministic section coverage this cut.
- **Readability in the manifest** — the vendored trust engine has no readability block; workspace-only.
- **Plagiarism / external-originality checks** — needs a third-party service; out.
- **Embedding-based grounding** (vs the LLM sentence pass) and **auto-run on generate** — deferred.
- **Cross-input claim matching** (a claim supported by an *uncited* project input) — the pass only checks
  a claim against the section's *declared* sources.

## Open (non-blocking)

- Syllable heuristic accuracy — the Flesch grade is directional, not authoritative; label it as such in
  the UI copy.
- Whether to auto-invalidate a stored grounding when a cited input is edited (vs the `stale` flag) —
  `stale` is the MVP; hard-invalidate is a possible follow-up.
