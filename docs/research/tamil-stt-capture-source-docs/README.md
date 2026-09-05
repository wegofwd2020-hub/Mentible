# Tamil STT Capture — original source docs (provenance archive)

These four Markdown files are the **original feature proposals** that seeded the
Tamil speech-to-text "Capture" work (the ADR-037 *Capture* phase). They are kept
here **verbatim, for provenance only** — to record what was originally proposed
and by whom.

**They are superseded.** The authoritative, current design is:

- Design spec: [`docs/superpowers/specs/2026-09-04-tamil-stt-capture-design.md`](../../superpowers/specs/2026-09-04-tamil-stt-capture-design.md)
- Slice-1 plan: [`docs/superpowers/plans/2026-09-04-tamil-stt-capture-slice1.md`](../../superpowers/plans/2026-09-04-tamil-stt-capture-slice1.md)
- Shipped code: PR #510 (backend spine — capture seam, migration 0027, transcribe task, upload endpoint), merged to `main`.

Do **not** treat these files as guidance. Where they conflict with the spec, the
spec wins. Several of their core recommendations were **deliberately overridden**
when the proposal was reconciled with the existing architecture:

| Source doc proposed | Repo decision (why) |
|---|---|
| Self-hosted Whisper GPU (e.g. EC2 `g4dn`) | **Rejected** — commodity managed/BYOK STT (Groq / OpenAI). Self-hosted inference violates ADR-042 ("the model is the commodity"). |
| React / MUI SPA for the review UI | **RN + Expo** (Android + RN-web, one codebase) — the existing app stack. |
| New transcript-editor tables + bespoke audit trail | **Reuse the trust loop** — transcript is an `artifact(format='transcript')` with immutable `artifact_version`s and the existing append-only `approval` / `feedback`. No new transcript tables. |
| Per-word confidence, auto-diarization, model retraining, FERPA logic | **Dropped / deferred** — commodity Whisper gives segment-level confidence only; speaker tagging is manual (slice 3); this is an adults-only product (no FERPA). |

## Files

| File | Original name (from author) |
|---|---|
| `feature-rationale.md` | `mentible_feature_rationale_tamil_transcription.md` |
| `transcript-review-feature-spec.md` | `transcript_review_feature_spec.md` |
| `implementation-guide.md` | `tamil_stt_implementation_guide.md` |
| `mp3-upload-integration-design.md` | `mp3_upload_integration_design.md` |

Archived 2026-09-05.
