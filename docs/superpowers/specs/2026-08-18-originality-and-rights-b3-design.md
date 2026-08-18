# Originality & Rights (B3) — Design Spec

**Status:** Proposed · **Date:** 2026-08-18 · **Area:** `backend/src/trust/`, `mobile/src/`, `compiler/` (colophon tie-in) · **Extends:** P1-4 quality/grounding report

## Why

The competitive shortlist §B3 flags two confirmed gaps: **plagiarism/originality detection** and **copyright-violation detection**. Both are unbuilt. Two hard constraints (verified) shape what's honest to build:

1. The LLM seam (`wegofwd_llm`) is **model-only** and can't search the web — so an LLM can meaningfully check a draft against **its own cited sources** (over-close paraphrase / verbatim reuse), not against the whole web. Real against-the-web plagiarism needs a paid third-party API (deferred — pluggable later).
2. **Automated copyright-infringement detection is infeasible** (content-ID scale). The achievable, honest copyright work is **rights attestation + display**, not scanning.

So B3 ships two parts: **(A)** an owner-only **source-overlap originality check** that clones the P1-4 grounding machinery, and **(B)** a per-project **rights attestation** surfaced with the existing `dc:rights` colophon. No web scanning, no automated infringement detection (out of scope, like P2-6 Scope C).

## Decisions (locked with the user)

- **D1 — Originality = LLM source-overlap check**, clearly labeled as checking *the author's own cited sources* (verbatim / near-verbatim vs synthesized), NOT against-the-web plagiarism. Owner-only, billable, async — the exact grounding pattern.
- **D2 — Copyright = rights attestation + display only.** A per-project attestation ("I hold the rights to my sources / this is my original work") + optional rights-holder name, surfaced with the `dc:rights` colophon and an "originality & rights are the author's responsibility" note. NO scanning, NO ADR-021 moderation queue this slice.
- **D3 — No new external vendor / no new outbound HTTP client.** Reuse the LLM seam + the managed/BYOK key fork exactly as grounding does. (A pluggable web-plagiarism adapter is explicitly deferred.)

## Part A — Source-overlap originality check (clone of grounding)

Mirror the P1-4 grounding implementation end-to-end (the explorer's anchors are the template):

### Data model
- New migration `version_originality` table, **same shape as `version_grounding` (mig 0021)**: PK `(version_id, version_kind)` (`version_kind ∈ ('artifact','topic')`), columns `report jsonb`, `model text`, `checked_at timestamptz`, `cited_content_hash text`.
- New `backend/src/trust/originality_repo.py` — `upsert()` / `get()` cloning `grounding_repo.py`.

### Report shape (`report jsonb`)
```
{
  "sections": [
    { "index": int, "heading": str,
      "overlap": "none" | "paraphrase" | "verbatim",
      "note": str|null,            // one-line why, e.g. "reproduces source S2 nearly verbatim"
      "source_ref": str|null }     // which cited source it overlaps, when applicable
  ],
  "summary": { "verbatim": int, "paraphrase": int, "clean": int, "total": int }
}
```
A section citing **no** live source gets a no-LLM `overlap:"none"` shortcut (mirror grounding's `unsupported` shortcut) — nothing to overlap.

### Compute path (owner-only, billable, async) — clone grounding exactly
- `backend/src/trust/originality.py` `generate_originality(sections, citedByIndex, provider args) -> (report, in_tokens, out_tokens)` — per section, `build_originality_prompt(sectionBody, citedSourceTexts)` → `build_provider` → `generate_validated` → `parse_json_response`. Prompt asks: *does this section reproduce the cited source text verbatim / near-verbatim, or is it synthesized in the author's own words? Classify + name the source.* Returns token counts for metering.
- Endpoints: `POST /api/v1/trust/artifacts/versions/{id}/originality-check` (+ topic twin `POST /topic-versions/{id}/originality-check`) — 202 + Celery job; owner-only via `_require_role`; managed/BYOK key fork via `resolve_managed_access` (managed) / `encrypt_api_key` Redis envelope (BYOK), identical to `grounding-check` (`router.py:446-527`).
- Worker `originality_check_task` → `_run_originality_check` — clone `_run_grounding_check` (`tasks.py:1030`): key resolution fork (`get_managed_key` vs `decrypt_api_key`), call `generate_originality` in a thread, `originality_repo.upsert`, meter managed spend via `_record_trust_usage`, shred the key in `finally`.
- GET version-detail (`router.py:299`, topic twin `:1199`) attaches `q["originality"]` from `originality_repo.get`, with a **read-time `stale`** flag (recompute `cited_content_hash` over currently-cited live inputs, compare to stored — reuse `cited_content_hash` from `tasks.py:59`; same mechanism as grounding at `router.py:321-323`).

### Mobile
- `mobile/src/components/QualityCard.tsx` — add a **4th row "Originality"** mirroring the Grounding row: shows the summary (e.g. "3 sections closely mirror a cited source" / "all sections synthesized"), `checked_at`, a stale note, and an **owner-only "Run originality check"** `Button` wired to a new `onRunOriginality` prop (gated by `busy`/`isOwner`). Label it so it's clear this checks *your cited sources*, not the web.
- `mobile/src/api/trustClient.ts` — add `originality` to `QualityReport`; a `runOriginalityCheck(versionId, kind, keys)` (POST to the new endpoint, then poll the shared job endpoint + re-fetch the version), mirroring `runGroundingCheck` (`:184`).

## Part B — Rights attestation (copyright, display-only)

### Data model
- Add to the trust **project** row (small migration): `rights_attested_at timestamptz null`, `rights_holder text null`. (Attestation is per-project, not per-version — it's about the author's relationship to their sources/work.)

### Backend
- An endpoint to set it (owner-only): `PUT /api/v1/trust/projects/{id}/rights` `{ attested: bool, rights_holder?: str }` → sets `rights_attested_at = now()` (or null to withdraw) + `rights_holder`. Surface `rights_attested_at`/`rights_holder` on the project detail response.
- **Colophon tie-in:** when `rights_holder` is set, feed it into the export's `dc:rights` (the compiler colophon already accepts `metadata.rights`; the export path can pass `© <year> <rights_holder>. All rights reserved.` when the project attests). No compiler change if the export already threads `metadata.rights`; otherwise a one-line thread.

### Mobile
- A **rights-attestation control** on the project (owner-only) — a checkbox "I attest I hold the rights to the sources I've used and that this is my original work" + an optional "Rights holder" text field — placed on the project **Overview** (or a small "Rights" section). Persists via the new endpoint.
- Surface the attested state + an **"Originality & rights are the author's responsibility"** note in the `QualityCard` (a small footer line) and/or the Publish surface, so it's visible at export time. Non-blocking (display-only; does not gate export).

## Non-goals

- No against-the-web plagiarism scanning; no third-party plagiarism API this slice (pluggable adapter deferred).
- No automated copyright-infringement detection / content-ID / fingerprinting (infeasible).
- No ADR-021 moderation/complaint/takedown queue.
- Attestation does NOT gate or block export — it's informational.

## Testing

- **Backend:** `originality_repo` upsert/get; `generate_originality` report shape + the no-cited-source `none` shortcut (mock the provider); the endpoint owner-only + managed/BYOK fork + 202-job; the read-time `stale` recompute; managed spend metered; **the API key never logged** (assert against caplog, per ADR-001). Rights endpoint owner-only, sets/withdraws attestation, surfaces on project detail; the `dc:rights` colophon carries `rights_holder` when attested.
- **Mobile:** `QualityCard` renders the originality row + owner-only button (re-enables on error); `trustClient.runOriginalityCheck` posts + re-fetches; the rights control persists + the responsibility note renders. Help coverage for any new user-facing action.
- **Migrations** apply cleanly (both new); no RLS, app-level `require_project_access` unchanged.

## Rollout

Backend (2 migrations) + mobile + a tiny compiler/colophon thread → web + backend ROOT refresh (migrations run) + APK. Dormant nothing — this is all in-product (no external service/key). Owner-only billable check meters managed spend exactly like grounding.
